import { decodeJwt } from 'jose';
import type { Config } from './config';
import type { Db } from './db';
import { ApiError, unavailable } from './errors';
import { equal, hmac } from './crypto';
import type { Qr, Session } from './models';

export type VerifyAdmin = (bearer: string) => Promise<string>;
export function supabaseVerifier(config: Config): VerifyAdmin {
  return async (bearer) => {
    if (!config.SUPABASE_URL || !config.SUPABASE_PUBLISHABLE_KEY) throw unavailable();
    let claims;
    try {
      claims = decodeJwt(bearer);
    } catch {
      throw new ApiError(401, 'UNAUTHENTICATED', 'Login admin diperlukan.');
    }
    if (
      claims.iss !== `${config.SUPABASE_URL.replace(/\/$/, '')}/auth/v1` ||
      claims.aud !== 'authenticated' ||
      typeof claims.exp !== 'number' ||
      claims.exp <= Date.now() / 1000 ||
      typeof claims.sub !== 'string'
    )
      throw new ApiError(401, 'UNAUTHENTICATED', 'Login admin diperlukan.');
    // Supabase Auth verifies the signature, expiry and current user; decoded claims alone are never trusted.
    let response: Response;
    try {
      response = await fetch(`${config.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/user`, {
        headers: { apikey: config.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${bearer}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw unavailable();
    }
    if (response.status >= 500 || response.status === 429) throw unavailable();
    if (!response.ok) throw new ApiError(401, 'UNAUTHENTICATED', 'Login admin diperlukan.');
    const user = (await response.json()) as { id?: string };
    if (user.id !== claims.sub)
      throw new ApiError(401, 'UNAUTHENTICATED', 'Login admin diperlukan.');
    return claims.sub;
  };
}
export async function requireAdmin(db: Db, request: Request, verify: VerifyAdmin) {
  const match = /^Bearer ([^\s]+)$/i.exec(request.headers.get('authorization') || '');
  if (!match) throw new ApiError(401, 'UNAUTHENTICATED', 'Login admin diperlukan.');
  const id = await verify(match[1]);
  if (
    !(await db.query('SELECT user_id FROM qr_review.admin_users WHERE user_id=$1', [id])).rowCount
  )
    throw new ApiError(403, 'FORBIDDEN', 'Akses admin diperlukan.');
  return id;
}
export function cookieToken(request: Request) {
  const matches = (request.headers.get('cookie') || '')
    .split(';')
    .map((v) => v.trim())
    .filter((v) => v.startsWith('__Host-owner_session='));
  if (matches.length !== 1) return undefined;
  const value = matches[0].slice('__Host-owner_session='.length);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
}
export const clearCookie =
  '__Host-owner_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0';
export function sessionCookie(value: string) {
  return `__Host-owner_session=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=1800`;
}
export function requireOrigin(config: Config, request: Request) {
  if (request.headers.get('origin') !== config.PUBLIC_ORIGIN)
    throw new ApiError(403, 'ORIGIN_NOT_ALLOWED', 'Origin permintaan tidak diizinkan.');
}
export function requireCsrf(request: Request, s: Session) {
  if (!equal(request.headers.get('x-csrf-token') || '', s.csrf_token))
    throw new ApiError(403, 'CSRF_INVALID', 'Token keamanan tidak valid.');
}
export async function ownerSession(
  db: Db,
  config: Config,
  request: Request,
  lock = false,
): Promise<{ qr: Qr; session: Session } | null> {
  const raw = cookieToken(request);
  if (!raw) return null;
  const session = (
    await db.query<Session>('SELECT * FROM qr_review.owner_sessions WHERE session_hash=$1', [
      hmac(config, 'session', raw),
    ])
  ).rows[0];
  if (!session || session.revoked_at || session.expires_at.getTime() <= Date.now()) return null;
  // All QR mutations lock the QR first. Recheck the session after acquiring this lock to avoid stale auth.
  const qr = (
    await db.query<Qr>(`SELECT * FROM qr_review.qr_codes WHERE id=$1 ${lock ? 'FOR UPDATE' : ''}`, [
      session.qr_id,
    ])
  ).rows[0];
  const latest = (
    await db.query<Session>('SELECT * FROM qr_review.owner_sessions WHERE session_hash=$1', [
      session.session_hash,
    ])
  ).rows[0];
  if (
    !qr ||
    !latest ||
    latest.revoked_at ||
    latest.expires_at.getTime() <= Date.now() ||
    qr.status === 'RETIRED' ||
    qr.auth_generation !== latest.auth_generation ||
    qr.ownership_id !== latest.ownership_id
  )
    return null;
  return { qr, session: latest };
}
export function requireSession(value: Awaited<ReturnType<typeof ownerSession>>) {
  if (!value) throw new ApiError(401, 'SESSION_EXPIRED', 'Sesi berakhir. Login kembali.');
  return value;
}
