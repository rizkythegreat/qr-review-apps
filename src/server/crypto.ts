import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';
import type { Config } from './config';

function derive(password: Buffer, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, 32, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
}
export function opaque(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}
export function activationCode() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const data = randomBytes(10);
  let bits = 0,
    value = 0,
    output = '';
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += alphabet[(value >>> bits) & 31];
    }
  }
  return output;
}
export function hmac(config: Config, purpose: string, value: string) {
  return createHmac('sha256', Buffer.from(config.HMAC_KEY, 'base64'))
    .update(purpose)
    .update('\0')
    .update(value)
    .digest('hex');
}
export function equal(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function pinMaterial(config: Config, pin: string) {
  return createHmac('sha256', Buffer.from(config.PIN_PEPPER, 'base64')).update(pin).digest();
}
export async function hashPin(config: Config, pin: string, salt = randomBytes(16)) {
  const hash = await derive(pinMaterial(config, pin), salt);
  return `scrypt$32768$8$3$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}
export async function verifyPin(config: Config, pin: string, stored?: string | null) {
  const parts = stored?.split('$');
  // Missing/retired/unknown units still run the same password KDF.
  const salt = parts?.length === 6 ? Buffer.from(parts[4], 'base64url') : Buffer.alloc(16, 1);
  const candidate = await hashPin(config, pin, salt);
  return equal(candidate, stored || 'invalid');
}
export function encrypt(config: Config, value: unknown, purpose: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(config.ENCRYPTION_KEY, 'base64'), iv);
  cipher.setAAD(Buffer.from(purpose));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}
export function decrypt<T>(config: Config, value: Buffer, purpose: string): T {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(config.ENCRYPTION_KEY, 'base64'),
    value.subarray(0, 12),
  );
  decipher.setAAD(Buffer.from(purpose));
  decipher.setAuthTag(value.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString(),
  ) as T;
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
