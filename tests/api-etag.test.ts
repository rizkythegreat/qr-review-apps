import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../src/lib/api';

afterEach(() => vi.unstubAllGlobals());

describe('QR concurrency tokens through hosting proxies', () => {
  it.each([null, 'W/"v7"', '"proxy-generated-tag"'])(
    'uses the QR payload version when the response ETag is %s',
    async (etag) => {
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(
          Response.json(
            { data: { id: 'qr-id', version: 7 }, request_id: 'read' },
            {
              headers: etag ? { ETag: etag } : {},
            },
          ),
        )
        .mockResolvedValueOnce(Response.json({ data: { version: 8 }, request_id: 'write' }));
      vi.stubGlobal('fetch', fetch);
      const qr = await apiRequest<{ version: number }>('/api/v1/admin/qr-codes/qr-id');
      const changed = await apiRequest('/api/v1/admin/qr-codes/qr-id/stock', {
        method: 'PATCH',
        etag: qr.etag,
        body: { stock_status: 'AVAILABLE', reason: 'Checked' },
      });
      expect(new Headers(fetch.mock.calls[1][1].headers).get('If-Match')).toBe('"v7"');
      expect(changed.etag).toBe('"v8"');
    },
  );

  it('uses the nested QR version for owner sessions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json(
          {
            data: { qr: { version: 4 }, csrf_token: 'test-csrf' },
            request_id: 'session',
          },
          { headers: { ETag: 'W/"v4"' } },
        ),
      ),
    );
    expect((await apiRequest('/api/v1/owner/session')).etag).toBe('"v4"');
  });

  it.each([undefined, 0, -1, '7', 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'does not invent a concurrency token for an invalid version %s',
    async (version) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          Response.json(
            {
              data: { version },
              request_id: 'other',
            },
            { headers: { ETag: '"original"' } },
          ),
        ),
      );
      expect((await apiRequest('/other')).etag).toBe('"original"');
    },
  );
});
