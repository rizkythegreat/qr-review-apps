import type { Config } from './config';
import { canonical, equal, hmac } from './crypto';
import { ApiError } from './errors';
import { uuid } from './validation';

interface Cursor {
  created_at: string;
  id: string;
  filter: string;
}
export function encodeCursor(
  config: Config,
  row: { created_at: Date; id: string },
  filter: unknown,
) {
  const value = Buffer.from(
    JSON.stringify({
      created_at: row.created_at.toISOString(),
      id: row.id,
      filter: hmac(config, 'filter', canonical(filter)),
    }),
  ).toString('base64url');
  return `${value}.${hmac(config, 'cursor', value)}`;
}
export function decodeCursor(
  config: Config,
  cursor: string | undefined,
  filter: unknown,
): Cursor | undefined {
  if (cursor === undefined) return undefined;
  try {
    if (cursor.length > 1024) throw new Error();
    const [value, signature, ...extra] = cursor.split('.');
    if (extra.length || !signature || !equal(signature, hmac(config, 'cursor', value)))
      throw new Error();
    const row = JSON.parse(Buffer.from(value, 'base64url').toString()) as Cursor;
    if (
      !uuid.safeParse(row.id).success ||
      !/^\d{4}-\d\d-\d\dT.*Z$/.test(row.created_at) ||
      !Number.isFinite(Date.parse(row.created_at)) ||
      row.filter !== hmac(config, 'filter', canonical(filter))
    )
      throw new Error();
    return row;
  } catch {
    throw new ApiError(400, 'INVALID_CURSOR', 'Cursor tidak valid atau filter berubah.');
  }
}
