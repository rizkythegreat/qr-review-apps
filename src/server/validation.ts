import { z } from 'zod';
import { ApiError } from './errors';

export const token = z.string().regex(/^[A-Za-z0-9_-]{22}$/);
export const uuid = z.uuid();
const pin = z.string().regex(/^[0-9]{4}$/);
const text = (min: number, max: number) =>
  z
    .string()
    .trim()
    .refine((value) => {
      const length = Array.from(value).length;
      return length >= min && length <= max;
    });
const name = text(1, 120);
const reason = text(5, 500);
const code = z.string().regex(/^[A-Z2-7]{16}$/);
const grant = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export function normalizeReviewUrl(input: string): string {
  const reject = (): never => {
    throw new ApiError(422, 'UNSUPPORTED_REVIEW_URL', 'Gunakan link review Google yang didukung.', [
      {
        field: 'review_url',
        code: 'UNSUPPORTED_REVIEW_URL',
        message:
          'Gunakan https://g.page/r/{code}/review atau https://search.google.com/local/writereview?placeid={id}.',
      },
    ]);
  };
  if (input.length > 2048 || /[\u0000-\u0020\u007f\\%#]/u.test(input)) return reject();
  // Check the original authority/path too: URL() silently normalizes dot segments and userinfo.
  const match = /^(https):\/\/([^/?#]+)(\/[^?#]*)(\?[^#]*)?$/i.exec(input);
  if (!match || !/^(g\.page|search\.google\.com)(:443)?$/i.test(match[2])) return reject();
  const path = match[3],
    query = match[4] || '';
  const host = match[2].toLowerCase().replace(/:443$/, '');
  if (host === 'g.page' && /^\/r\/[A-Za-z0-9_-]{1,200}\/review$/.test(path) && !query)
    return `https://g.page${path}`;
  if (
    host === 'search.google.com' &&
    path === '/local/writereview' &&
    /^\?placeid=[A-Za-z0-9_-]{1,255}$/.test(query)
  )
    return `https://search.google.com${path}${query}`;
  return reject();
}
const review = z.string().max(2048).transform(normalizeReviewUrl);
const action = z.strictObject({ reason });
const support = z.strictObject({ reason, verification_reference: text(5, 200) });
export const bodies = {
  createBatch: z.strictObject({ label: name, quantity: z.number().int().min(1).max(500) }),
  createExport: z
    .strictObject({
      kind: z.enum(['PUBLIC_QR', 'ACTIVATION_CODES']),
      image_format: z.enum(['png', 'svg']).optional(),
      size_px: z.number().int().min(256).max(2048).optional(),
    })
    .refine(
      (v) =>
        v.kind !== 'ACTIVATION_CODES' || (v.image_format === undefined && v.size_px === undefined),
    ),
  updateStock: z.strictObject({ stock_status: z.enum(['AVAILABLE', 'DAMAGED']), reason }),
  recordSale: z.strictObject({
    reference: text(1, 100),
    sold_at: z.iso
      .datetime({ offset: true })
      .refine(
        (v) => new Date(v).getTime() <= Date.now(),
        'Waktu penjualan tidak boleh di masa depan.',
      ),
    buyer_name: name.optional(),
    support_contact: name.optional(),
  }),
  suspendQr: action,
  resumeQr: action,
  retireQr: action,
  rotateActivationCode: action,
  createPinResetGrant: support,
  createTransferGrant: support,
  activateQr: z.strictObject({
    activation_code: code,
    store_name: name,
    review_url: review,
    pin,
    pin_confirmation: pin,
  }),
  createOwnerSession: z.strictObject({ token, pin }),
  updateOwnerQr: z
    .strictObject({ store_name: name.optional(), review_url: review.optional() })
    .refine((v) => Object.keys(v).length > 0),
  changeOwnerPin: z
    .strictObject({ current_pin: pin, new_pin: pin, new_pin_confirmation: pin })
    .refine((v) => v.current_pin !== v.new_pin, 'PIN baru harus berbeda.'),
  claimPinReset: z.strictObject({ grant_token: grant, new_pin: pin, new_pin_confirmation: pin }),
  claimOwnershipTransfer: z.strictObject({
    grant_token: grant,
    store_name: name,
    review_url: review,
    new_pin: pin,
    new_pin_confirmation: pin,
  }),
};
export type BodyOf<K extends keyof typeof bodies> = z.infer<(typeof bodies)[K]>;
export function parseBody<K extends keyof typeof bodies>(operation: K, input: unknown): BodyOf<K> {
  const result = bodies[operation].safeParse(input);
  if (!result.success)
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      'Periksa isian permintaan.',
      result.error.issues.map((i) => ({
        field: i.path.join('.') || 'body',
        code: i.code,
        message: 'Nilai tidak valid atau field tidak diizinkan.',
      })),
    );
  const value = result.data as Record<string, unknown>;
  const a = value.pin ?? value.new_pin,
    b = value.pin_confirmation ?? value.new_pin_confirmation;
  if (b !== undefined && a !== b)
    throw new ApiError(422, 'PIN_CONFIRMATION_MISMATCH', 'Konfirmasi PIN tidak cocok.', [
      {
        field: value.pin !== undefined ? 'pin_confirmation' : 'new_pin_confirmation',
        code: 'PIN_CONFIRMATION_MISMATCH',
        message: 'Konfirmasi PIN tidak cocok.',
      },
    ]);
  return result.data as BodyOf<K>;
}
