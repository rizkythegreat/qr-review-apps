import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigurationError, readConfig } from '../src/server/config';
import { handleApi, handleResolver } from '../src/server/runtime';

const environment = {
  PUBLIC_ORIGIN: 'https://qr-review-apps.vercel.app',
  DATABASE_URL: 'postgresql://admin:private-password@private-host/db',
  PIN_PEPPER: Buffer.alloc(32, 1).toString('base64'),
  HMAC_KEY: Buffer.alloc(32, 2).toString('base64'),
  ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('configuration failure diagnostics', () => {
  it.each([
    'qr-review-apps.vercel.app',
    'http://qr-review-apps.vercel.app',
    'https://qr-review-apps.vercel.app/',
    'https://qr-review-apps.vercel.app/admin',
    '"https://qr-review-apps.vercel.app"',
  ])('reports an invalid origin safely: %s', (origin) => {
    try {
      readConfig({ ...environment, PUBLIC_ORIGIN: origin });
      expect.fail('Invalid origin must be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect(error).toMatchObject({ fields: ['PUBLIC_ORIGIN'] });
      expect(String(error)).not.toContain(origin);
      expect(String(error)).not.toContain('private-password');
    }
  });

  it('logs missing and invalid keys while keeping API responses and secret values private', async () => {
    for (const [name, value] of Object.entries(environment)) vi.stubEnv(name, value);
    vi.stubEnv('PIN_PEPPER', undefined);
    vi.stubEnv('HMAC_KEY', 'invalid-private-hmac');
    vi.stubEnv('ENCRYPTION_KEY', undefined);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await handleApi(new Request(environment.PUBLIC_ORIGIN + '/api/v1/admin/me'));
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body.error).toEqual({
      code: 'SERVICE_UNAVAILABLE',
      message: 'Layanan sementara tidak tersedia. Coba lagi.',
    });
    expect(response.headers.get('x-request-id')).toBe(body.request_id);
    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({
      event: 'configuration_unavailable',
      request_id: body.request_id,
      invalid_fields: ['PIN_PEPPER', 'HMAC_KEY', 'ENCRYPTION_KEY'],
    });
    const output = JSON.stringify({ body, logs: log.mock.calls });
    for (const secret of ['invalid-private-hmac', 'private-password', 'private-host'])
      expect(output).not.toContain(secret);
    expect(body).not.toHaveProperty('invalid_fields');
  });

  it('keeps resolver HEAD failures private and correlates the invalid field with the request ID', async () => {
    for (const [name, value] of Object.entries(environment)) vi.stubEnv(name, value);
    vi.stubEnv('PUBLIC_ORIGIN', 'invalid-private-origin');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await handleResolver(
      new Request(environment.PUBLIC_ORIGIN + '/r/0000000000000000000000', { method: 'HEAD' }),
      '0000000000000000000000',
    );
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('');
    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({
      event: 'configuration_unavailable',
      request_id: response.headers.get('x-request-id'),
      invalid_fields: ['PUBLIC_ORIGIN'],
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain('invalid-private-origin');
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-password');
  });
});
