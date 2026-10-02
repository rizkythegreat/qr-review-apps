import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { failureCode, logFailure } from '../src/server/errors';
import { Application } from '../src/server/application';
import { readConfig } from '../src/server/config';

afterEach(() => vi.restoreAllMocks());

describe('private failure diagnostics', () => {
  it.each(['SELF_SIGNED_CERT_IN_CHAIN', '28P01', '42P01', '42501', 'ENETUNREACH', 'ENOTFOUND'])(
    'logs only the allowed error code %s',
    (code) => {
      const error = Object.assign(
        new Error('postgresql://admin:private-password@private-host/db'),
        {
          code,
          detail: 'private SQL parameters',
        },
      );
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      logFailure('api_failed', 'test-request', undefined, error);
      const entry = JSON.parse(log.mock.calls[0][0]);
      expect(entry).toMatchObject({
        event: 'api_failed',
        request_id: 'test-request',
        error_code: code,
      });
      expect(Object.keys(entry).sort()).toEqual(['error_code', 'event', 'request_id', 'time']);
      expect(JSON.stringify(entry)).not.toContain('private');
    },
  );

  it('finds wrapped and aggregate causes without exposing their messages', () => {
    const error = Object.assign(new Error('private cause'), { code: 'ECONNRESET' });
    expect(failureCode(new Error('private wrapper', { cause: error }))).toBe('ECONNRESET');
    expect(
      failureCode(new AggregateError([new Error('private error'), error], 'private aggregate')),
    ).toBe('ECONNRESET');
  });

  it('handles unknown, cyclic and excessively deep errors safely', () => {
    const cyclic = new Error('private secret');
    cyclic.cause = cyclic;
    let deep: Error = Object.assign(new Error('private secret'), { code: 'ENOTFOUND' });
    for (let i = 0; i < 10; i++) deep = new Error('private wrapper', { cause: deep });
    for (const error of [
      cyclic,
      deep,
      Object.assign(new Error('private secret'), { code: 'TOKEN' }),
      'private secret',
      null,
    ])
      expect(failureCode(error)).toBe('UNKNOWN_FAILURE');
  });

  it('recognizes pooler and connection timeouts without reproducing private messages', () => {
    expect(failureCode(new Error('Tenant or user not found: private username'))).toBe(
      'DATABASE_POOLER_USER_NOT_FOUND',
    );
    expect(
      failureCode(new Error('Connection terminated due to connection timeout: private host')),
    ).toBe('DATABASE_CONNECTION_TIMEOUT');
  });

  it('reports database failures in server logs while keeping API and resolver responses generic', async () => {
    const error = Object.assign(new Error('private-password private-host private SQL'), {
      code: 'SELF_SIGNED_CERT_IN_CHAIN',
    });
    const query = vi.fn().mockRejectedValue(error);
    const config = readConfig({
      PUBLIC_ORIGIN: 'https://qr.test',
      DATABASE_URL: 'postgresql://unused',
      PIN_PEPPER: Buffer.alloc(32, 1).toString('base64'),
      HMAC_KEY: Buffer.alloc(32, 2).toString('base64'),
      ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
    });
    const app = new Application({
      config,
      pool: { query, connect: vi.fn().mockRejectedValue(error) } as unknown as Pool,
      verifyAdmin: async () => '11111111-1111-4111-8111-111111111111',
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await app.handle(
      new Request('https://qr.test/api/v1/admin/me', {
        headers: { authorization: 'Bearer private-bearer-token' },
      }),
    );
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({
      event: 'api_failed',
      request_id: body.request_id,
      error_code: 'SELF_SIGNED_CERT_IN_CHAIN',
    });
    const resolver = await app.resolve(
      new Request('https://qr.test/r/0000000000000000000000'),
      '0000000000000000000000',
    );
    expect(resolver.status).toBe(503);
    const html = await resolver.text();
    expect(JSON.parse(log.mock.calls[1][0])).toMatchObject({
      event: 'resolver_failed',
      request_id: resolver.headers.get('x-request-id'),
      error_code: 'SELF_SIGNED_CERT_IN_CHAIN',
    });
    const output = JSON.stringify({ body, html, logs: log.mock.calls });
    expect(output).not.toContain('private');
    expect(JSON.stringify({ body, html })).not.toContain('SELF_SIGNED_CERT_IN_CHAIN');
  });
});
