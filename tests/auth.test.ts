import { SignJWT } from 'jose';
import { afterEach, it, expect, vi } from 'vitest';
import { supabaseVerifier } from '../src/server/auth';
import { readConfig } from '../src/server/config';

const config = readConfig({
  PUBLIC_ORIGIN: 'https://qr.test',
  DATABASE_URL: 'postgresql://unused',
  DATABASE_SSL: 'false',
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key',
  PIN_PEPPER: Buffer.alloc(32, 1).toString('base64'),
  HMAC_KEY: Buffer.alloc(32, 2).toString('base64'),
  ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
});
const id = '11111111-1111-4111-8111-111111111111';
async function jwt(options: { issuer?: string; audience?: string; expiry?: number } = {}) {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(id)
    .setIssuer(options.issuer || config.SUPABASE_URL + '/auth/v1')
    .setAudience(options.audience || 'authenticated')
    .setExpirationTime(options.expiry || Math.floor(Date.now() / 1000) + 300)
    .sign(Buffer.alloc(32, 1));
}
afterEach(() => vi.unstubAllGlobals());
it('requires Supabase Auth server validation even when decoded JWT claims look valid', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }));
  vi.stubGlobal('fetch', fetch);
  await expect(supabaseVerifier(config)(await jwt())).rejects.toMatchObject({
    status: 401,
    code: 'UNAUTHENTICATED',
  });
  expect(fetch).toHaveBeenCalledOnce();
});
it('accepts a server-verified matching user and rejects a mismatched subject', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ id }))
    .mockResolvedValueOnce(Response.json({ id: '22222222-2222-4222-8222-222222222222' }));
  vi.stubGlobal('fetch', fetch);
  const token = await jwt();
  expect(await supabaseVerifier(config)(token)).toBe(id);
  await expect(supabaseVerifier(config)(token)).rejects.toMatchObject({ status: 401 });
  expect(fetch.mock.calls[0][1]).toMatchObject({
    cache: 'no-store',
    headers: { apikey: config.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` },
  });
});
it('rejects expired, wrong issuer or wrong audience JWTs before an Auth request', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  for (const options of [
    { issuer: 'https://evil.test/auth/v1' },
    { audience: 'service_role' },
    { expiry: Math.floor(Date.now() / 1000) - 1 },
  ]) {
    await expect(supabaseVerifier(config)(await jwt(options))).rejects.toMatchObject({
      status: 401,
    });
  }
  expect(fetch).not.toHaveBeenCalled();
});
it('reports Auth outages as retryable service failures', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network failure')));
  await expect(supabaseVerifier(config)(await jwt())).rejects.toMatchObject({
    status: 503,
    code: 'SERVICE_UNAVAILABLE',
  });
});
