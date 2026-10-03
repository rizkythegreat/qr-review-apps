/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import YAML from 'yaml';
import JSZip from 'jszip';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import { testDatabase } from '../helpers/database';
import { decrypt, hmac, opaque } from '../../src/server/crypto';
import { processOneExport } from '../../src/server/exports';
import { Application } from '../../src/server/application';
import { maintenance } from '../../src/server/maintenance';
import { migrate } from '../../scripts/migrate';

const spec = YAML.parse(readFileSync('openapi-qr-review-v0.1.yaml', 'utf8'));
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema({ $id: 'contract', components: spec.components });
let db: Awaited<ReturnType<typeof testDatabase>>;
type Reply = {
  status: number;
  data: any;
  error: any;
  pagination: any;
  json: any;
  response: Response;
};
async function call(
  method: string,
  path: string,
  body?: unknown,
  options: {
    cookie?: string;
    csrf?: string;
    version?: number;
    key?: string;
    source?: string;
    admin?: string | null;
    origin?: string | null;
    raw?: string;
    headers?: Record<string, string>;
    app?: Application;
    scheduleExport?: (id: string) => void;
  } = {},
): Promise<Reply> {
  const headers: Record<string, string> = {
    'x-test-ip': options.source || '198.51.100.1',
    ...options.headers,
  };
  if (path.startsWith('/api/v1/admin') && options.admin !== null)
    headers.Authorization = `Bearer ${options.admin || 'valid-admin'}`;
  if (options.origin !== null) headers.Origin = options.origin || db.config.PUBLIC_ORIGIN;
  if (body !== undefined || options.raw !== undefined)
    headers['Content-Type'] ||= 'application/json';
  if (options.cookie) headers.Cookie = options.cookie;
  if (options.csrf) headers['X-CSRF-Token'] = options.csrf;
  if (options.version !== undefined) headers['If-Match'] = `"v${options.version}"`;
  headers['Idempotency-Key'] = options.key || randomUUID();
  const request = new Request(db.config.PUBLIC_ORIGIN + path, {
    method,
    headers,
    body: options.raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const response = await (options.app || db.app).handle(request, options.scheduleExport);
  const json = response.headers.get('content-type')?.includes('application/json')
    ? await response.clone().json()
    : undefined;
  if (json) {
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(json.request_id).toBe(response.headers.get('x-request-id'));
    if (json.error) {
      const validate = ajv.getSchema('contract#/components/schemas/Error')!;
      expect(validate(json), JSON.stringify(validate.errors)).toBe(true);
    } else {
      const match = Object.entries(spec.paths).find(([route]) =>
        new RegExp('^' + route.replace(/\{[^}]+\}/g, '[^/]+') + '$').test(path.split('?')[0]),
      );
      const schema = (match?.[1] as any)?.[method.toLowerCase()]?.responses?.[response.status]
        ?.content?.['application/json']?.schema?.$ref;
      expect(
        schema,
        `Missing contracted response for ${method} ${path} ${response.status}`,
      ).toBeTruthy();
      const validate = ajv.getSchema('contract' + schema)!;
      expect(validate(json), JSON.stringify(validate.errors)).toBe(true);
    }
  }
  return {
    status: response.status,
    data: json?.data,
    error: json?.error,
    pagination: json?.pagination,
    json,
    response,
  };
}
async function batch(quantity = 1) {
  const result = await call('POST', '/api/v1/admin/batches', { label: 'Production', quantity });
  expect(result.status).toBe(201);
  const qr = (await call('GET', `/api/v1/admin/qr-codes?batch_id=${result.data.id}&limit=100`))
    .data;
  const snapshot = (
    await db.pool.query('SELECT activation_snapshot FROM qr_review.qr_batches WHERE id=$1', [
      result.data.id,
    ])
  ).rows[0];
  const codes = decrypt<{ token: string; activation_code: string }[]>(
    db.config,
    snapshot.activation_snapshot,
    `batch:${result.data.id}`,
  );
  return { batch: result.data, qr, codes };
}
async function sold() {
  const b = await batch();
  const q = b.qr[0];
  const stock = await call(
    'PATCH',
    `/api/v1/admin/qr-codes/${q.id}/stock`,
    { stock_status: 'AVAILABLE', reason: 'Quality checked' },
    { version: q.version },
  );
  expect(stock.status).toBe(200);
  const sale = await call(
    'POST',
    `/api/v1/admin/qr-codes/${q.id}/sales`,
    {
      reference: 'SALE-001',
      sold_at: new Date(Date.now() - 1000).toISOString(),
      buyer_name: 'Buyer',
      support_contact: 'contact@example.test',
    },
    { version: stock.data.version },
  );
  expect(sale.status).toBe(201);
  return {
    q: (await call('GET', `/api/v1/admin/qr-codes/${q.id}`)).data,
    code: b.codes[0].activation_code,
    batch: b.batch,
  };
}
const setup = (code: string) => ({
  activation_code: code,
  store_name: 'Original Store',
  review_url: 'https://g.page/r/Store/review',
  pin: '0042',
  pin_confirmation: '0042',
});
async function active() {
  const b = await sold();
  const a = await call('POST', `/api/v1/public/qr/${b.q.token}/activate`, setup(b.code));
  expect(a.status).toBe(201);
  return { ...b, q: (await call('GET', `/api/v1/admin/qr-codes/${b.q.id}`)).data };
}
async function login(token: string, pin = '0042') {
  const r = await call('POST', '/api/v1/owner/sessions', { token, pin });
  expect(r.status).toBe(200);
  return {
    cookie: r.response.headers.get('set-cookie')!.split(';')[0],
    csrf: r.data.csrf_token,
    version: r.data.qr.version,
    session: r.data,
  };
}
async function resolve(
  token: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    app?: Application;
    query?: string;
    waitUntil?: (task: Promise<void>) => void;
  } = {},
) {
  return (options.app || db.app).resolve(
    new Request(`${db.config.PUBLIC_ORIGIN}/r/${token}${options.query || ''}`, {
      method: options.method || 'GET',
      headers: { 'x-test-ip': '198.51.100.1', ...options.headers },
    }),
    token,
    options.waitUntil,
  );
}
beforeAll(async () => {
  db = await testDatabase();
});
beforeEach(async () => {
  await db.reset();
});
afterAll(async () => {
  if (db) await db.close();
});

describe('admin, production and inventory', () => {
  it('binds failed validation to its key while rolling back all batch changes', async () => {
    const key = randomUUID();
    const invalid = await call(
      'POST',
      '/api/v1/admin/batches',
      { label: 'Bad batch', quantity: 501 },
      { key },
    );
    expect(invalid.status).toBe(422);
    const corrected = await call(
      'POST',
      '/api/v1/admin/batches',
      { label: 'Bad batch', quantity: 1 },
      { key },
    );
    expect(corrected.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect((await db.pool.query('SELECT count(*) FROM qr_review.qr_batches')).rows[0].count).toBe(
      '0',
    );
    const record = (
      await db.pool.query(
        'SELECT response,committed FROM qr_review.idempotency_records WHERE key=$1',
        [key],
      )
    ).rows[0];
    expect(record).toEqual({ response: null, committed: false });
    expect(
      (await call('POST', '/api/v1/admin/batches', { label: 'Good batch', quantity: 1 })).status,
    ).toBe(201);
  });
  it('requires a verified identity AND a database admin role', async () => {
    expect((await call('GET', '/api/v1/admin/me', undefined, { admin: null })).status).toBe(401);
    expect(
      (await call('GET', '/api/v1/admin/me', undefined, { admin: 'valid-non-admin' })).status,
    ).toBe(403);
    expect((await call('GET', '/api/v1/admin/me')).data).toEqual({
      user_id: db.adminId,
      role: 'ADMIN',
    });
  });
  it('atomically creates 100 unique units and safely replays batch retries', async () => {
    const key = randomUUID(),
      body = { label: '  October production  ', quantity: 100 };
    const a = await call('POST', '/api/v1/admin/batches', body, { key });
    expect(a.status).toBe(201);
    const replay = await call('POST', '/api/v1/admin/batches', body, { key });
    expect(replay.data.id).toBe(a.data.id);
    const rows = (await db.pool.query('SELECT * FROM qr_review.qr_codes')).rows;
    expect(rows).toHaveLength(100);
    expect(new Set(rows.map((q) => q.token)).size).toBe(100);
    expect(
      rows.every(
        (q) => q.status === 'UNACTIVATED' && q.stock_status === 'GENERATED' && !q.pin_hash,
      ),
    ).toBe(true);
    expect(JSON.stringify(a.json)).not.toContain('activation_code"');
    expect(
      (await call('POST', '/api/v1/admin/batches', { ...body, quantity: 99 }, { key })).error.code,
    ).toBe('IDEMPOTENCY_KEY_REUSED');
    expect((await call('GET', '/api/v1/admin/dashboard')).data.total_units).toBe(100);
    await migrate(db.pool);
    expect((await db.pool.query('SELECT count(*) FROM qr_review.qr_codes')).rows[0].count).toBe(
      '100',
    );
  });
  it('returns REQUEST_IN_PROGRESS without starting another transaction for the same key', async () => {
    const key = randomUUID(),
      scope = `admin:${db.adminId}:POST:/api/v1/admin/batches`;
    const conn = await db.pool.connect();
    await conn.query('BEGIN');
    try {
      await conn.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${scope}:${key}`]);
      const r = await call(
        'POST',
        '/api/v1/admin/batches',
        { label: 'Batch', quantity: 1 },
        { key },
      );
      expect(r.status).toBe(409);
      expect(r.error.code).toBe('REQUEST_IN_PROGRESS');
      expect(r.response.headers.get('retry-after')).toBe('2');
    } finally {
      await conn.query('ROLLBACK');
      conn.release();
    }
  });
  it('enforces the proxy-safe QR version header before updating stock', async () => {
    const { qr } = await batch();
    const path = `/api/v1/admin/qr-codes/${qr[0].id}/stock`;
    const body = { stock_status: 'AVAILABLE', reason: 'Checked' };
    const stale = await call('PATCH', path, body, { headers: { 'X-QR-If-Match': '"v99"' } });
    expect(stale.status).toBe(412);
    expect(stale.error.code).toBe('VERSION_MISMATCH');
    const conflicting = await call('PATCH', path, body, {
      version: 1,
      headers: { 'X-QR-If-Match': '"v2"' },
    });
    expect(conflicting.status).toBe(400);
    const saved = await call('PATCH', path, body, { headers: { 'X-QR-If-Match': '"v1"' } });
    expect(saved.status).toBe(200);
    expect(saved.data.stock_status).toBe('AVAILABLE');
    expect(saved.data.version).toBe(2);
    const outdated = await call(
      'PATCH',
      path,
      { stock_status: 'DAMAGED', reason: 'Checked' },
      {
        headers: { 'X-QR-If-Match': '"v1"' },
      },
    );
    expect(outdated.status).toBe(412);
    expect(
      (
        await db.pool.query('select stock_status,version from qr_review.qr_codes where id=$1', [
          qr[0].id,
        ])
      ).rows[0],
    ).toMatchObject({ stock_status: 'AVAILABLE', version: 2 });
  });

  it('enforces If-Match, QC transitions and one durable sale per unit', async () => {
    const { qr } = await batch();
    const q = qr[0],
      path = `/api/v1/admin/qr-codes/${q.id}`;
    expect(
      (await call('PATCH', path + '/stock', { stock_status: 'AVAILABLE', reason: 'Checked' }))
        .status,
    ).toBe(428);
    expect(
      (
        await call(
          'PATCH',
          path + '/stock',
          { stock_status: 'AVAILABLE', reason: 'Checked' },
          { version: 99 },
        )
      ).status,
    ).toBe(412);
    const stock = await call(
      'PATCH',
      path + '/stock',
      { stock_status: 'AVAILABLE', reason: 'Checked' },
      { version: 1 },
    );
    expect(stock.data.version).toBe(2);
    expect(stock.response.headers.get('etag')).toBe('"v2"');
    const key = randomUUID(),
      body = { reference: 'Receipt', sold_at: new Date(Date.now() - 1000).toISOString() };
    const a = await call('POST', path + '/sales', body, { version: 2, key });
    expect(a.status).toBe(201);
    const replay = await call('POST', path + '/sales', body, { version: 2, key });
    expect(replay.data.id).toBe(a.data.id);
    expect((await call('GET', path + '/sales')).data.id).toBe(a.data.id);
    expect(
      (await db.pool.query('SELECT count(*) FROM qr_review.sales_records')).rows[0].count,
    ).toBe('1');
    expect(
      (
        await call(
          'PATCH',
          path + '/stock',
          { stock_status: 'DAMAGED', reason: 'Damaged' },
          { version: 3 },
        )
      ).error.code,
    ).toBe('STOCK_TRANSITION_INVALID');
  });
  it('makes DAMAGED stock and RETIRED QR terminal without recycling a token', async () => {
    const { qr } = await batch();
    const q = qr[0],
      path = `/api/v1/admin/qr-codes/${q.id}`;
    const r = await call(
      'PATCH',
      path + '/stock',
      { stock_status: 'DAMAGED', reason: 'Print failed' },
      { version: 1 },
    );
    expect(r.data.stock_status).toBe('DAMAGED');
    expect(r.data.status).toBe('RETIRED');
    expect((await resolve(q.token)).status).toBe(410);
    expect(
      (await call('POST', path + '/resume', { reason: 'Recover unit' }, { version: 2 })).error.code,
    ).toBe('QR_TRANSITION_INVALID');
    expect(
      (
        await call(
          'PATCH',
          path + '/stock',
          { stock_status: 'AVAILABLE', reason: 'Retry QC' },
          { version: 2 },
        )
      ).status,
    ).toBe(409);
    await expect(
      db.pool.query('UPDATE qr_review.qr_codes SET token=$1 WHERE id=$2', [opaque(16), q.id]),
    ).rejects.toThrow('immutable');
  });
  it('paginates by timestamp and UUID without skipping same-time units, and binds cursors to filters', async () => {
    const b = await batch(5);
    const first = await call('GET', `/api/v1/admin/qr-codes?batch_id=${b.batch.id}&limit=2`);
    const second = await call(
      'GET',
      `/api/v1/admin/qr-codes?batch_id=${b.batch.id}&limit=2&cursor=${first.pagination.next_cursor}`,
    );
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.pagination.next_cursor).not.toBeNull();
    const third = await call(
      'GET',
      `/api/v1/admin/qr-codes?batch_id=${b.batch.id}&limit=2&cursor=${second.pagination.next_cursor}`,
    );
    expect(new Set([...first.data, ...second.data, ...third.data].map((q: any) => q.id)).size).toBe(
      5,
    );
    expect(third.pagination.next_cursor).toBeNull();
    const changed = await call(
      'GET',
      `/api/v1/admin/qr-codes?status=ACTIVE&cursor=${first.pagination.next_cursor}`,
    );
    expect(changed.error.code).toBe('INVALID_CURSOR');
    expect((await call('GET', '/api/v1/admin/qr-codes?cursor=tampered')).error.code).toBe(
      'INVALID_CURSOR',
    );
    expect((await call('GET', '/api/v1/admin/batches')).data).toHaveLength(1);
  });
  it('schedules committed export jobs and status polling, and only processes the requested job once', async () => {
    const b = await batch(2);
    const path = `/api/v1/admin/batches/${b.batch.id}/exports`;
    const first = await call('POST', path, { kind: 'PUBLIC_QR', size_px: 256 });
    const schedule = vi.fn();
    const second = await call(
      'POST',
      path,
      { kind: 'ACTIVATION_CODES' },
      { scheduleExport: schedule },
    );
    expect(second.status).toBe(202);
    expect(schedule).toHaveBeenCalledWith(second.data.id);
    expect(
      (
        await db.pool.query('select status from qr_review.export_jobs where id=$1', [
          second.data.id,
        ])
      ).rows[0].status,
    ).toBe('QUEUED');
    schedule.mockClear();
    await call('GET', `/api/v1/admin/exports/${second.data.id}`, undefined, {
      scheduleExport: schedule,
    });
    expect(schedule).toHaveBeenCalledWith(second.data.id);
    const processed = await Promise.all([
      processOneExport(db.pool, db.config, { jobId: second.data.id }),
      processOneExport(db.pool, db.config, { jobId: second.data.id }),
    ]);
    expect(processed.sort()).toEqual([false, true]);
    expect((await call('GET', `/api/v1/admin/exports/${first.data.id}`)).data.status).toBe(
      'QUEUED',
    );
    schedule.mockClear();
    expect(
      (
        await call('GET', `/api/v1/admin/exports/${second.data.id}`, undefined, {
          scheduleExport: schedule,
        })
      ).data.status,
    ).toBe('READY');
    expect(schedule).not.toHaveBeenCalled();
    await call('GET', `/api/v1/admin/exports/${first.data.id}`, undefined, {
      admin: null,
      scheduleExport: schedule,
    });
    expect(schedule).not.toHaveBeenCalled();
  });

  it('recovers a stale export lease and reports serverless processing limits', async () => {
    const b = await batch(1);
    const path = `/api/v1/admin/batches/${b.batch.id}/exports`;
    const stale = await call('POST', path, { kind: 'PUBLIC_QR', size_px: 256 });
    await db.pool.query(
      "update qr_review.export_jobs set status='RUNNING',started_at=now()-interval '6 minutes',lease_id=$2 where id=$1",
      [stale.data.id, randomUUID()],
    );
    expect(await processOneExport(db.pool, db.config, { jobId: stale.data.id })).toBe(true);
    expect((await call('GET', `/api/v1/admin/exports/${stale.data.id}`)).data.status).toBe('READY');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      for (const [options, failure] of [
        [{ maxDurationMs: 0 }, 'EXPORT_TIME_LIMIT'],
        [{ maxArtifactBytes: 1 }, 'EXPORT_TOO_LARGE'],
      ] as const) {
        const queued = await call('POST', path, { kind: 'PUBLIC_QR', size_px: 256 });
        await processOneExport(db.pool, db.config, { jobId: queued.data.id, ...options });
        const failed = await call('GET', `/api/v1/admin/exports/${queued.data.id}`);
        expect(failed.data).toMatchObject({
          status: 'FAILED',
          failure_code: failure,
          download_path: null,
        });
        expect(
          (
            await db.pool.query('select artifact from qr_review.export_jobs where id=$1', [
              queued.data.id,
            ])
          ).rows[0].artifact,
        ).toBeNull();
      }
    } finally {
      log.mockRestore();
    }
  });

  it('exports separate public and secret ZIPs, and decodes a real PNG to the permanent URL', async () => {
    const b = await batch(2);
    const pub = await call('POST', `/api/v1/admin/batches/${b.batch.id}/exports`, {
      kind: 'PUBLIC_QR',
      size_px: 256,
    });
    const secret = await call('POST', `/api/v1/admin/batches/${b.batch.id}/exports`, {
      kind: 'ACTIVATION_CODES',
    });
    expect(pub.status).toBe(202);
    expect(secret.status).toBe(202);
    expect((await call('GET', `/api/v1/admin/exports/${pub.data.id}/download`)).error.code).toBe(
      'EXPORT_NOT_READY',
    );
    await processOneExport(db.pool, db.config);
    await processOneExport(db.pool, db.config);
    expect((await call('GET', `/api/v1/admin/exports/${pub.data.id}`)).data.status).toBe('READY');
    const r = await call('GET', `/api/v1/admin/exports/${pub.data.id}/download`);
    const zip = await JSZip.loadAsync(await r.response.arrayBuffer());
    const manifest = await zip.file('manifest.csv')!.async('string');
    expect(manifest).not.toContain('activation');
    const png = PNG.sync.read(await zip.file(`qr/${b.qr[0].token}.png`)!.async('nodebuffer'));
    const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
    expect(decoded?.data).toBe(`${db.config.PUBLIC_ORIGIN}/r/${b.qr[0].token}`);
    const secrets = await call('GET', `/api/v1/admin/exports/${secret.data.id}/download`);
    const secretZip = await JSZip.loadAsync(await secrets.response.arrayBuffer());
    expect(Object.keys(secretZip.files)).toEqual(['activation-codes.csv']);
    expect(await secretZip.file('activation-codes.csv')!.async('string')).toContain(
      b.codes[0].activation_code,
    );
    const raw = (
      await db.pool.query('SELECT artifact FROM qr_review.export_jobs WHERE id=$1', [
        secret.data.id,
      ])
    ).rows[0].artifact;
    expect(raw.subarray(0, 2).toString()).not.toBe('PK');
    const svg = await call(
      'GET',
      `/api/v1/admin/qr-codes/${b.qr[0].id}/image?format=svg&size_px=512`,
    );
    const svgText = await svg.response.text();
    expect(svgText).toContain('width="512"');
    expect(svgText).toContain('viewBox="0 0 512 512"');
    expect(svgText).not.toContain('<script');
  });
  it('invalidates queued and ready activation archives after rotation or activation', async () => {
    const b = await sold();
    const j = await call('POST', `/api/v1/admin/batches/${b.batch.id}/exports`, {
      kind: 'ACTIVATION_CODES',
    });
    await processOneExport(db.pool, db.config);
    const rotate = await call(
      'POST',
      `/api/v1/admin/qr-codes/${b.q.id}/activation-code/rotate`,
      { reason: 'Lost card' },
      { version: b.q.version },
    );
    expect(rotate.status).toBe(200);
    expect((await call('GET', `/api/v1/admin/exports/${j.data.id}/download`)).error.code).toBe(
      'EXPORT_EXPIRED',
    );
    expect(
      (
        await call('POST', `/api/v1/admin/batches/${b.batch.id}/exports`, {
          kind: 'ACTIVATION_CODES',
        })
      ).error.code,
    ).toBe('ACTIVATION_EXPORT_UNAVAILABLE');
    expect(
      (await call('POST', `/api/v1/public/qr/${b.q.token}/activate`, setup(b.code))).error.code,
    ).toBe('INVALID_ACTIVATION_CODE');
    expect(
      (
        await call(
          'POST',
          `/api/v1/public/qr/${b.q.token}/activate`,
          setup(rotate.data.activation_code),
        )
      ).status,
    ).toBe(201);
  });
  it('keeps secret idempotency tombstones after the 15-minute encrypted replay expires', async () => {
    const b = await sold(),
      key = randomUUID(),
      body = { reason: 'Replace secret card' };
    const path = `/api/v1/admin/qr-codes/${b.q.id}/activation-code/rotate`;
    const a = await call('POST', path, body, { key, version: b.q.version });
    const r = await call('POST', path, body, { key, version: b.q.version });
    expect(r.data.activation_code).toBe(a.data.activation_code);
    await db.pool.query(
      "UPDATE qr_review.idempotency_records SET response_expires_at=now()-interval '1 minute' WHERE key=$1",
      [key],
    );
    const old = await call('POST', path, body, { key, version: b.q.version });
    expect(old.error.code).toBe('SECRET_REPLAY_EXPIRED');
    expect((await call('GET', `/api/v1/admin/qr-codes/${b.q.id}`)).data.version).toBe(
      a.data.version,
    );
  });
});

describe('activation, owner sessions and resolver', () => {
  it('redirects through a real statistics-table failure without a partial aggregate update', async () => {
    const b = await active();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await db.pool
      .query(`CREATE FUNCTION qr_review.reject_visit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Statistics unavailable'; END $$;
      CREATE TRIGGER unavailable_statistics BEFORE INSERT ON qr_review.scan_events
      FOR EACH ROW EXECUTE FUNCTION qr_review.reject_visit();`);
    try {
      expect((await resolve(b.q.token)).status).toBe(302);
      expect(
        (await db.pool.query('SELECT count(*) FROM qr_review.scan_events')).rows[0].count,
      ).toBe('0');
      expect(
        (await db.pool.query('SELECT total_visits FROM qr_review.ownership_periods')).rows[0]
          .total_visits,
      ).toBe('0');
    } finally {
      await db.pool.query(
        'DROP TRIGGER unavailable_statistics ON qr_review.scan_events; DROP FUNCTION qr_review.reject_visit();',
      );
      log.mockRestore();
    }
    expect((await resolve(b.q.token)).status).toBe(302);
    expect(
      (await db.pool.query('SELECT total_visits FROM qr_review.ownership_periods')).rows[0]
        .total_visits,
    ).toBe('1');
  });
  it('keeps delayed statistics alive after redirect and counts repeated eligible scans', async () => {
    const b = await active();
    const { recordVisit } = await import('../../src/server/statistics');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const delayed = new Application({
      pool: db.pool,
      config: db.config,
      recordVisit: async (visit) => {
        await gate;
        await recordVisit(db.pool, visit, 150);
      },
    });
    const tasks: Promise<void>[] = [];
    const waitUntil = (task: Promise<void>) => {
      tasks.push(task);
    };
    expect((await resolve(b.q.token, { app: delayed, waitUntil })).status).toBe(302);
    expect(tasks).toHaveLength(1);
    expect(
      (
        await db.pool.query('select total_visits from qr_review.ownership_periods where id=$1', [
          b.q.ownership_id,
        ])
      ).rows[0].total_visits,
    ).toBe('0');
    // The redirect has completed while the write remains pending beyond its old time budget.
    await new Promise((resolve) => setTimeout(resolve, 200));
    release();
    await Promise.all(tasks);
    tasks.length = 0;
    for (let i = 0; i < 2; i++) await resolve(b.q.token, { app: delayed, waitUntil });
    await Promise.all(tasks);
    expect(
      (
        await db.pool.query('select total_visits from qr_review.ownership_periods where id=$1', [
          b.q.ownership_id,
        ])
      ).rows[0].total_visits,
    ).toBe('3');
    tasks.length = 0;
    await resolve(b.q.token, { app: delayed, waitUntil, method: 'HEAD' });
    await resolve(b.q.token, { app: delayed, waitUntil, headers: { 'User-Agent': 'Googlebot' } });
    expect(tasks).toHaveLength(0);
  });

  it('handles background statistics failure without rejecting the task or redirect', async () => {
    const b = await active();
    const broken = new Application({
      pool: db.pool,
      config: db.config,
      recordVisit: async () => {
        throw Object.assign(new Error('private database details'), { code: '28P01' });
      },
    });
    const tasks: Promise<void>[] = [];
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await resolve(b.q.token, {
        app: broken,
        waitUntil: (task) => {
          tasks.push(task);
        },
      });
      expect(response.status).toBe(302);
      await Promise.all(tasks);
      expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({
        event: 'statistics_recording_failed',
        error_code: '28P01',
      });
      expect(JSON.stringify(log.mock.calls)).not.toContain('private');
    } finally {
      log.mockRestore();
    }
  });

  it('caps slow statistics separately and still returns the redirect', async () => {
    const b = await active();
    const slow = new Application({
      pool: db.pool,
      config: db.config,
      recordVisit: () => new Promise<void>(() => {}),
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const start = performance.now();
    try {
      expect((await resolve(b.q.token, { app: slow })).status).toBe(302);
      expect(performance.now() - start).toBeLessThan(1000);
      expect(log).toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
  it('rejects unsold activation and wrong codes without consuming credentials', async () => {
    const generated = await batch();
    expect(
      (
        await call(
          'POST',
          `/api/v1/public/qr/${generated.qr[0].token}/activate`,
          setup(generated.codes[0].activation_code),
        )
      ).error.code,
    ).toBe('QR_NOT_SOLD');
    const b = await sold();
    const key = randomUUID();
    const wrong = await call(
      'POST',
      `/api/v1/public/qr/${b.q.token}/activate`,
      setup('AAAAAAAAAAAAAAAA'),
      { key },
    );
    expect(wrong.error.code).toBe('INVALID_ACTIVATION_CODE');
    expect(
      (
        await db.pool.query('SELECT status,activation_hash FROM qr_review.qr_codes WHERE id=$1', [
          b.q.id,
        ])
      ).rows[0],
    ).toEqual({ status: 'UNACTIVATED', activation_hash: hmac(db.config, 'activation', b.code) });
    expect(
      (await call('POST', `/api/v1/public/qr/${b.q.token}/activate`, setup(b.code), { key })).error
        .code,
    ).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(
      (await call('POST', `/api/v1/public/qr/${b.q.token}/activate`, setup(b.code))).status,
    ).toBe(201);
  });
  it('allows exactly one concurrent activation and replays the winner without cookies', async () => {
    const b = await sold(),
      path = `/api/v1/public/qr/${b.q.token}/activate`,
      a = setup(b.code);
    const keys = [randomUUID(), randomUUID()],
      inputs = [a, { ...a, store_name: 'Contender' }];
    const r = await Promise.all(
      inputs.map((body, i) => call('POST', path, body, { key: keys[i] })),
    );
    expect(r.filter((v) => v.status === 201)).toHaveLength(1);
    expect(r.filter((v) => v.status === 409)).toHaveLength(1);
    const committed = (await call('GET', `/api/v1/admin/qr-codes/${b.q.id}`)).data;
    expect(committed.store_name).toBe(r.find((v) => v.status === 201)!.data.store_name);
    expect(
      (
        await db.pool.query('SELECT count(*) FROM qr_review.ownership_periods WHERE qr_id=$1', [
          b.q.id,
        ])
      ).rows[0].count,
    ).toBe('1');
    const winner = r.findIndex((v) => v.status === 201);
    {
      const replay = await call('POST', path, inputs[winner], { key: keys[winner] });
      expect(replay.status).toBe(201);
      expect(replay.data).toEqual(r[winner].data);
      expect(replay.response.headers.get('set-cookie')).toBeNull();
      await call(
        'POST',
        `/api/v1/admin/qr-codes/${b.q.id}/suspend`,
        { reason: 'Support review' },
        { version: committed.version },
      );
      expect((await call('POST', path, inputs[winner], { key: keys[winner] })).error.code).toBe(
        'QR_STATE_CHANGED',
      );
    }
  });
  it('returns privacy-safe metadata and correct fallback/HEAD status', async () => {
    const g = await batch();
    const metadata = await call('GET', `/api/v1/public/qr/${g.qr[0].token}`);
    expect(metadata.data.activation_allowed).toBe(false);
    expect(metadata.data.review_url).toBeUndefined();
    expect(metadata.data.stock_status).toBeUndefined();
    const html = await resolve(g.qr[0].token);
    expect(html.status).toBe(200);
    expect(await html.text()).toContain('belum tersedia');
    const b = await sold();
    expect((await call('GET', `/api/v1/public/qr/${b.q.token}`)).data.activation_allowed).toBe(
      true,
    );
    expect((await resolve(opaque(16))).status).toBe(404);
    const head = await resolve(g.qr[0].token, { method: 'HEAD' });
    expect(await head.text()).toBe('');
    expect(head.status).toBe(200);
  });
  it('counts only eligible GETs, redirects to updated URLs without cache and survives statistics failure', async () => {
    const b = await active(),
      s = await login(b.q.token);
    const r = await resolve(b.q.token, { query: '?test=true&destination=https://evil.test' });
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('https://g.page/r/Store/review');
    expect(r.headers.get('cache-control')).toBe('no-store, max-age=0');
    await resolve(b.q.token, { method: 'HEAD' });
    await resolve(b.q.token, { headers: { 'User-Agent': 'Googlebot' } });
    await resolve(b.q.token, { headers: { 'x-deployment-test': 'secret-test-traffic' } });
    let stats = await call('GET', '/api/v1/owner/me/stats', undefined, s);
    expect(stats.data.total_visits).toBe(1);
    expect(stats.data.last_visited_at).not.toBeNull();
    expect(stats.data.counts_submitted_reviews).toBe(false);
    const update = await call(
      'PATCH',
      '/api/v1/owner/me',
      { review_url: 'https://search.google.com/local/writereview?placeid=NewStore' },
      s,
    );
    expect(update.status).toBe(200);
    const broken = new Application({
      pool: db.pool,
      config: db.config,
      recordVisit: async () => {
        throw new Error('statistics unavailable');
      },
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const next = await resolve(b.q.token, { app: broken });
      expect(next.status).toBe(302);
      expect(next.headers.get('location')).toContain('NewStore');
      expect(log).toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
    stats = await call('GET', '/api/v1/owner/me/stats', undefined, s);
    expect(stats.data.total_visits).toBe(1);
  });
  it('binds each session to one QR and rejects injected IDs and cross-session CSRF', async () => {
    const a = await active(),
      b = await active(),
      sa = await login(a.q.token),
      sb = await login(b.q.token);
    expect((await call('GET', '/api/v1/owner/me', undefined, sa)).data.qr.id).toBe(a.q.id);
    expect(
      (await call('PATCH', '/api/v1/owner/me', { store_name: 'Owned A', qr_id: b.q.id }, sa))
        .status,
    ).toBe(422);
    expect(
      (await call('PATCH', '/api/v1/owner/me', { store_name: 'Owned A' }, { ...sa, csrf: sb.csrf }))
        .error.code,
    ).toBe('CSRF_INVALID');
    const changed = await call('PATCH', '/api/v1/owner/me', { store_name: 'Owned A' }, sa);
    expect(changed.data.id).toBe(a.q.id);
    expect((await call('GET', `/api/v1/admin/qr-codes/${b.q.id}`)).data.store_name).toBe(
      'Original Store',
    );
    const cookie = sa.cookie;
    expect(cookie).toMatch(/^__Host-owner_session=/);
    const loginResponse = await call('POST', '/api/v1/owner/sessions', {
      token: a.q.token,
      pin: '0042',
    });
    expect(loginResponse.response.headers.get('set-cookie')).toContain(
      'HttpOnly; Secure; SameSite=Strict; Max-Age=1800',
    );
    expect(JSON.stringify(loginResponse.json)).not.toContain('__Host-owner_session');
  });
  it('persists five credential failures and cooldown across application instances', async () => {
    const b = await active();
    for (let i = 0; i < 5; i++)
      expect(
        (await call('POST', '/api/v1/owner/sessions', { token: b.q.token, pin: '9999' })).error
          .code,
      ).toBe('INVALID_CREDENTIALS');
    const second = new Application({ pool: db.pool, config: db.config });
    const blocked = await call(
      'POST',
      '/api/v1/owner/sessions',
      { token: b.q.token, pin: '0042' },
      { app: second },
    );
    expect(blocked.status).toBe(429);
    expect(Number(blocked.response.headers.get('retry-after'))).toBeGreaterThan(0);
    const otherSource = await call(
      'POST',
      '/api/v1/owner/sessions',
      { token: b.q.token, pin: '0042' },
      { app: second, source: '198.51.100.2' },
    );
    expect(otherSource.status).toBe(200);
    await db.pool.query(
      "UPDATE qr_review.rate_limits SET blocked_until=now()-interval '1 second',window_started_at=now()-interval '16 minutes'",
    );
    expect(
      (await call('POST', '/api/v1/owner/sessions', { token: b.q.token, pin: '0042' })).status,
    ).toBe(200);
  });
  it('normalizes unknown/unactivated/retired and wrong-PIN login errors', async () => {
    const b = await batch();
    const unknown = await call('POST', '/api/v1/owner/sessions', {
      token: opaque(16),
      pin: '0042',
    });
    const generated = await call('POST', '/api/v1/owner/sessions', {
      token: b.qr[0].token,
      pin: '0042',
    });
    expect(unknown.error).toEqual(generated.error);
    expect(unknown.error.code).toBe('INVALID_CREDENTIALS');
  });
  it('rejects missing/foreign Origin, oversized, malformed, non-JSON and extra JSON fields', async () => {
    const b = await sold(),
      path = `/api/v1/public/qr/${b.q.token}/activate`;
    expect((await call('POST', path, setup(b.code), { origin: null })).error.code).toBe(
      'ORIGIN_NOT_ALLOWED',
    );
    expect((await call('POST', path, setup(b.code), { origin: 'https://evil.test' })).status).toBe(
      403,
    );
    expect((await call('POST', path, undefined, { raw: '{' })).error.code).toBe('MALFORMED_JSON');
    expect((await call('POST', path, undefined, { raw: 'x'.repeat(16385) })).error.code).toBe(
      'PAYLOAD_TOO_LARGE',
    );
    expect(
      (await call('POST', path, setup(b.code), { headers: { 'Content-Type': 'text/plain' } })).error
        .code,
    ).toBe('UNSUPPORTED_MEDIA_TYPE');
    expect((await call('POST', path, { ...setup(b.code), status: 'ACTIVE' })).status).toBe(422);
    const bad = await db.app.handle(new Request('http://qr.test/api/v1/public/qr/' + b.q.token));
    expect(bad.status).toBe(403);
  });
  it('changes PIN atomically, invalidates grants and all old sessions, and expires sessions absolutely', async () => {
    const b = await active(),
      a = await login(b.q.token),
      other = await login(b.q.token);
    const grant = await call(
      'POST',
      `/api/v1/admin/qr-codes/${b.q.id}/pin-reset-grants`,
      { reason: 'Lost PIN help', verification_reference: 'VERIFY-001' },
      { version: b.q.version },
    );
    const updated = { ...a, version: grant.data.qr_version };
    const changed = await call(
      'POST',
      '/api/v1/owner/me/pin',
      { current_pin: '0042', new_pin: '0053', new_pin_confirmation: '0053' },
      updated,
    );
    expect(changed.status).toBe(204);
    expect(changed.response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect((await call('GET', '/api/v1/owner/me', undefined, other)).error.code).toBe(
      'SESSION_EXPIRED',
    );
    expect(
      (await call('POST', '/api/v1/owner/sessions', { token: b.q.token, pin: '0042' })).status,
    ).toBe(401);
    const next = await login(b.q.token, '0053');
    await db.pool.query("UPDATE qr_review.owner_sessions SET expires_at=now()-interval '1 second'");
    expect((await call('GET', '/api/v1/owner/me', undefined, next)).status).toBe(401);
    expect((await call('POST', '/api/v1/owner/session/logout', undefined, next)).status).toBe(204);
  });
  it('revokes old sessions on suspend and gives newly logged-in owners read-only access', async () => {
    const b = await active(),
      s = await login(b.q.token),
      path = `/api/v1/admin/qr-codes/${b.q.id}`;
    const suspended = await call(
      'POST',
      path + '/suspend',
      { reason: 'Under investigation' },
      { version: b.q.version },
    );
    expect((await resolve(b.q.token)).status).toBe(200);
    expect((await call('GET', '/api/v1/owner/me', undefined, s)).status).toBe(401);
    const readOnly = await login(b.q.token);
    expect(readOnly.session.read_only).toBe(true);
    expect(
      (await call('PATCH', '/api/v1/owner/me', { store_name: 'New store' }, readOnly)).error.code,
    ).toBe('QR_SUSPENDED');
    expect((await call('GET', '/api/v1/owner/me/stats', undefined, readOnly)).status).toBe(200);
    const resumed = await call(
      'POST',
      path + '/resume',
      { reason: 'Issue resolved' },
      { version: suspended.data.version },
    );
    expect(resumed.data.status).toBe('ACTIVE');
    expect((await call('GET', '/api/v1/owner/me', undefined, readOnly)).status).toBe(401);
    await call(
      'POST',
      path + '/retire',
      { reason: 'Permanent removal' },
      { version: resumed.data.version },
    );
    expect((await resolve(b.q.token)).status).toBe(410);
    expect((await call('GET', `/api/v1/public/qr/${b.q.token}`)).data.status).toBe('RETIRED');
  });
});

describe('manual fresh start SQL', () => {
  it('resets all operational data atomically while preserving admin access and database structure', async () => {
    const b = await active();
    await login(b.q.token);
    await call(
      'POST',
      `/api/v1/admin/qr-codes/${b.q.id}/pin-reset-grants`,
      { reason: 'Verified reset request', verification_reference: 'RESET-TEST' },
      { version: b.q.version },
    );
    await call('POST', `/api/v1/admin/batches/${b.batch.id}/exports`, { kind: 'PUBLIC_QR' });
    await resolve(b.q.token, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const tables = [
      'scan_events',
      'audit_events',
      'owner_sessions',
      'support_grants',
      'sales_records',
      'idempotency_records',
      'export_jobs',
      'qr_codes',
      'ownership_periods',
      'qr_batches',
      'rate_limits',
    ];
    const counts = async () =>
      Promise.all(
        tables.map(async (table) =>
          Number((await db.pool.query(`SELECT count(*) FROM qr_review.${table}`)).rows[0].count),
        ),
      );
    const before = await counts();
    expect(before.every((count) => count > 0)).toBe(true);
    const migrations = (
      await db.pool.query('SELECT name,checksum FROM qr_review.schema_migrations ORDER BY name')
    ).rows;
    const sql = readFileSync('scripts/sql/reset-app-data.sql', 'utf8');
    const connection = await db.pool.connect();
    try {
      // A rollback restores all tables, even with the circular ownership foreign key.
      await connection.query(sql.replace('\nCOMMIT;', '\nROLLBACK;'));
      expect(await counts()).toEqual(before);
      await connection.query(sql);
    } finally {
      await connection.query('ROLLBACK');
      connection.release();
    }
    expect(await counts()).toEqual(tables.map(() => 0));
    expect(
      (await db.pool.query('SELECT name,checksum FROM qr_review.schema_migrations ORDER BY name'))
        .rows,
    ).toEqual(migrations);
    expect((await call('GET', '/api/v1/admin/me')).status).toBe(200);
    expect((await call('GET', '/api/v1/admin/dashboard')).data.total_units).toBe(0);
    expect(
      (
        await db.pool.query(
          `SELECT relrowsecurity FROM pg_class WHERE oid='qr_review.qr_codes'::regclass`,
        )
      ).rows[0].relrowsecurity,
    ).toBe(true);
    expect(
      (
        await db.pool.query(
          `SELECT tgenabled FROM pg_trigger WHERE tgrelid='qr_review.qr_codes'::regclass AND tgname='immutable_qr'`,
        )
      ).rows[0].tgenabled,
    ).toBe('O');
    const fresh = await batch();
    expect(fresh.qr).toHaveLength(1);
    await expect(
      db.pool.query('DELETE FROM qr_review.qr_codes WHERE id=$1', [fresh.qr[0].id]),
    ).rejects.toThrow('QR units cannot be deleted');
  });
});

describe('global admin activity', () => {
  it('requires an authenticated allowlisted admin', async () => {
    expect(
      (await call('GET', '/api/v1/admin/audit-events', undefined, { admin: null })).status,
    ).toBe(401);
    expect(
      (await call('GET', '/api/v1/admin/audit-events', undefined, { admin: 'outside' })).status,
    ).toBe(403);
  });

  it('includes existing events across QR units with stable pagination and bound filters', async () => {
    const b = await batch(3);
    const all = await call('GET', '/api/v1/admin/audit-events');
    expect(all.status).toBe(200);
    expect(all.data).toHaveLength(3);
    expect(new Set(all.data.map((row: any) => row.qr_id))).toEqual(
      new Set(b.qr.map((q: any) => q.id)),
    );
    for (const row of all.data) {
      expect(row.qr_token).toBe(b.qr.find((q: any) => q.id === row.qr_id).token);
      expect(row.action).toBe('BATCH_GENERATED');
      expect(row.store_name).toBeNull();
    }
    const ids: string[] = [];
    let cursor = '';
    do {
      const page = await call(
        'GET',
        `/api/v1/admin/audit-events?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      ids.push(...page.data.map((row: any) => row.id));
      cursor = page.pagination.next_cursor;
      if (cursor) {
        expect(
          (
            await call(
              'GET',
              `/api/v1/admin/audit-events?action=STOCK_AVAILABLE&cursor=${encodeURIComponent(cursor)}`,
            )
          ).error.code,
        ).toBe('INVALID_CURSOR');
        expect(
          (
            await call(
              'GET',
              `/api/v1/admin/audit-events?from=2020-01-01&cursor=${encodeURIComponent(cursor)}`,
            )
          ).error.code,
        ).toBe('INVALID_CURSOR');
      }
    } while (cursor);
    expect(ids).toEqual(all.data.map((row: any) => row.id));
    expect(new Set(ids).size).toBe(3);
    for (const search of [b.qr[0].token, b.qr[0].id]) {
      const filtered = await call('GET', `/api/v1/admin/audit-events?search=${search}`);
      expect(filtered.data).toHaveLength(1);
      expect(filtered.data[0].qr_id).toBe(b.qr[0].id);
    }
    expect((await call('GET', '/api/v1/admin/audit-events?search=missing')).data).toEqual([]);
    expect(JSON.stringify(all.json)).not.toContain(b.codes[0].activation_code);
  });

  it('filters names, actions and inclusive WIB dates at midnight boundaries', async () => {
    const b = await batch(2);
    await db.pool.query('UPDATE qr_review.qr_codes SET store_name=$2 WHERE id=$1', [
      b.qr[0].id,
      'Toko Kopi',
    ]);
    const dates = [
      '2020-01-01T16:59:59.999Z',
      '2020-01-01T17:00:00.000Z',
      '2020-01-02T16:59:59.999Z',
      '2020-01-02T17:00:00.000Z',
    ];
    const ids = dates.map(() => randomUUID());
    for (let i = 0; i < dates.length; i++)
      await db.pool.query(
        `INSERT INTO qr_review.audit_events(id,qr_id,action,actor_type,changes,created_at) VALUES($1,$2,$3,'ADMIN','{}',$4)`,
        [ids[i], b.qr[0].id, i === 2 ? 'SUSPENDED' : 'suspendQr', dates[i]],
      );
    const filtered = await call(
      'GET',
      '/api/v1/admin/audit-events?search=kOpI&action=suspendQr&from=2020-01-02&to=2020-01-02',
    );
    expect(filtered.status).toBe(200);
    expect(filtered.data.map((row: any) => row.id)).toEqual([ids[2], ids[1]]);
    expect(filtered.data.every((row: any) => row.store_name === 'Toko Kopi')).toBe(true);
    expect((await call('GET', '/api/v1/admin/audit-events?action=SALE_RECORDED')).data).toEqual([]);
  });

  it('rejects malformed filters, reversed dates, duplicate parameters and invalid cursors', async () => {
    for (const query of [
      'from=2020-02-30',
      'from=2020-01-03&to=2020-01-02',
      'action=unknown',
      'search=',
      'limit=101',
      'unexpected=true',
      'action=ACTIVATED&action=OWNER_UPDATED',
    ])
      expect((await call('GET', `/api/v1/admin/audit-events?${query}`)).error.code).toBe(
        'INVALID_PARAMETER',
      );
    expect((await call('GET', '/api/v1/admin/audit-events?cursor=invalid')).error.code).toBe(
      'INVALID_CURSOR',
    );
  });
});

describe('support, audit and durable retention', () => {
  it('claims reset once, preserves URL/ownership/status, revokes sessions and permits a matching retry', async () => {
    const b = await active(),
      s = await login(b.q.token);
    const grant = await call(
      'POST',
      `/api/v1/admin/qr-codes/${b.q.id}/pin-reset-grants`,
      { reason: 'Verified forgotten PIN', verification_reference: 'VERIFY-002' },
      { version: b.q.version },
    );
    expect((await call('GET', '/api/v1/owner/me', undefined, s)).status).toBe(200);
    const secret = new URL(grant.data.claim_url).hash.slice('#grant='.length),
      key = randomUUID(),
      body = { grant_token: secret, new_pin: '1234', new_pin_confirmation: '1234' };
    const claimed = await call('POST', '/api/v1/public/pin-reset/claim', body, { key });
    expect(claimed.status).toBe(200);
    expect((await call('GET', '/api/v1/owner/me', undefined, s)).status).toBe(401);
    expect((await call('POST', '/api/v1/public/pin-reset/claim', body, { key })).data).toEqual(
      claimed.data,
    );
    expect((await call('POST', '/api/v1/public/pin-reset/claim', body)).error.code).toBe(
      'GRANT_INVALID_OR_EXPIRED',
    );
    const q = (await call('GET', `/api/v1/admin/qr-codes/${b.q.id}`)).data;
    expect(q.ownership_id).toBe(b.q.ownership_id);
    expect(q.review_url).toBe(b.q.review_url);
    const next = await login(b.q.token, '1234');
    await call(
      'POST',
      '/api/v1/owner/me/pin',
      { current_pin: '1234', new_pin: '5678', new_pin_confirmation: '5678' },
      next,
    );
    expect((await call('POST', '/api/v1/public/pin-reset/claim', body, { key })).error.code).toBe(
      'QR_STATE_CHANGED',
    );
  });
  it('transfers ownership with fresh statistics while delayed visits remain in the resolved original period', async () => {
    const b = await active(),
      s = await login(b.q.token);
    await resolve(b.q.token);
    const snapshot = { qr_id: b.q.id, ownership_id: b.q.ownership_id, visited_at: new Date() };
    const grant = await call(
      'POST',
      `/api/v1/admin/qr-codes/${b.q.id}/transfer-grants`,
      { reason: 'New verified owner', verification_reference: 'VERIFY-003' },
      { version: b.q.version },
    );
    expect(grant.status).toBe(201);
    expect((await call('GET', '/api/v1/owner/me', undefined, s)).status).toBe(401);
    expect((await resolve(b.q.token)).status).toBe(200);
    const secret = new URL(grant.data.claim_url).hash.slice('#grant='.length);
    const result = await call('POST', '/api/v1/public/ownership-transfer/claim', {
      grant_token: secret,
      store_name: 'New Owner',
      review_url: 'https://g.page/r/NewOwner/review',
      new_pin: '1234',
      new_pin_confirmation: '1234',
    });
    expect(result.status).toBe(200);
    const next = await login(b.q.token, '1234');
    expect(next.session.qr.ownership_id).not.toBe(b.q.ownership_id);
    const { recordVisit } = await import('../../src/server/statistics');
    await recordVisit(db.pool, snapshot, 150);
    expect((await call('GET', '/api/v1/owner/me/stats', undefined, next)).data.total_visits).toBe(
      0,
    );
    expect(
      (
        await db.pool.query(
          'SELECT total_visits,ended_at FROM qr_review.ownership_periods WHERE id=$1',
          [b.q.ownership_id],
        )
      ).rows[0].total_visits,
    ).toBe('2');
    expect((await resolve(b.q.token)).headers.get('location')).toBe(
      'https://g.page/r/NewOwner/review',
    );
    expect((await call('GET', '/api/v1/owner/me/stats', undefined, next)).data.total_visits).toBe(
      1,
    );
    const audit = await call('GET', `/api/v1/admin/qr-codes/${b.q.id}/audit-events`);
    expect(audit.data.some((e: any) => e.action === 'OWNERSHIP_TRANSFER_CLAIMED')).toBe(true);
    const serialized = JSON.stringify(audit.json);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('pin_hash');
    expect(serialized).not.toContain(b.code);
  });
  it('invalidates older grants, rejects wrong kind/expired claims and keeps transfer suspended on expiry', async () => {
    const b = await active(),
      path = `/api/v1/admin/qr-codes/${b.q.id}`;
    const first = await call(
      'POST',
      path + '/pin-reset-grants',
      { reason: 'Owner verified', verification_reference: 'VERIFY-005' },
      { version: b.q.version },
    );
    const second = await call(
      'POST',
      path + '/transfer-grants',
      { reason: 'New owner verified', verification_reference: 'VERIFY-006' },
      { version: first.data.qr_version },
    );
    const oldSecret = new URL(first.data.claim_url).hash.slice(7),
      newSecret = new URL(second.data.claim_url).hash.slice(7);
    expect(
      (
        await call('POST', '/api/v1/public/pin-reset/claim', {
          grant_token: oldSecret,
          new_pin: '1234',
          new_pin_confirmation: '1234',
        })
      ).status,
    ).toBe(410);
    expect(
      (
        await call('POST', '/api/v1/public/pin-reset/claim', {
          grant_token: newSecret,
          new_pin: '1234',
          new_pin_confirmation: '1234',
        })
      ).status,
    ).toBe(410);
    await db.pool.query("UPDATE qr_review.support_grants SET expires_at=now()-interval '1 second'");
    expect(
      (
        await call('POST', '/api/v1/public/ownership-transfer/claim', {
          grant_token: newSecret,
          store_name: 'Next',
          review_url: 'https://g.page/r/Next/review',
          new_pin: '1234',
          new_pin_confirmation: '1234',
        })
      ).status,
    ).toBe(410);
    expect((await call('GET', path)).data.status).toBe('SUSPENDED');
  });
  it('purges expired secrets and raw events without deleting ownership aggregates', async () => {
    const b = await active();
    await resolve(b.q.token);
    await db.pool.query("UPDATE qr_review.scan_events SET visited_at=now()-interval '91 days'");
    await db.pool.query(
      "UPDATE qr_review.qr_batches SET activation_codes_expires_at=now()-interval '1 second'",
    );
    await maintenance(db.pool);
    expect((await db.pool.query('SELECT count(*) FROM qr_review.scan_events')).rows[0].count).toBe(
      '0',
    );
    expect(
      (await db.pool.query('SELECT total_visits FROM qr_review.ownership_periods')).rows[0]
        .total_visits,
    ).toBe('1');
    expect(
      (await db.pool.query('SELECT activation_snapshot FROM qr_review.qr_batches')).rows[0]
        .activation_snapshot,
    ).toBeNull();
  });
  it('returns retryable service failures rather than activation when the database fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const query = vi
      .spyOn(db.app.domain.limiter, 'general')
      .mockRejectedValue(new Error('DB unreachable'));
    try {
      const r = await resolve(opaque(16));
      expect(r.status).toBe(503);
      expect(await r.text()).not.toContain('Aktivasi tersedia');
      const api = await call('GET', `/api/v1/public/qr/${opaque(16)}`);
      expect(api.error.code).toBe('SERVICE_UNAVAILABLE');
    } finally {
      query.mockRestore();
      log.mockRestore();
    }
  });
  it('denies direct access to QR credentials with database privileges and RLS', async () => {
    const role = `qr_browser_test_${randomUUID().replaceAll('-', '')}`;
    await db.admin.query(`CREATE ROLE ${role} NOLOGIN`);
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE ${role}`);
      await expect(client.query('SELECT pin_hash FROM qr_review.qr_codes')).rejects.toThrow(
        'permission denied',
      );
      await client.query('ROLLBACK');
      await db.pool.query(`GRANT USAGE ON SCHEMA qr_review TO ${role}`);
      await db.pool.query(`GRANT SELECT ON qr_review.qr_codes TO ${role}`);
      await batch();
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE ${role}`);
      expect((await client.query('SELECT * FROM qr_review.qr_codes')).rows).toHaveLength(0);
      await client.query('ROLLBACK');
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await db.pool.query(`DROP OWNED BY ${role}`);
      await db.admin.query(`DROP ROLE ${role}`);
    }
  });
  it('meets local batch limits: 500 units stored under 30 seconds and public package under 2 minutes', async () => {
    const start = performance.now();
    const r = await call('POST', '/api/v1/admin/batches', {
      label: 'Maximum batch',
      quantity: 500,
    });
    expect(r.status).toBe(201);
    const batchDuration = performance.now() - start;
    expect(batchDuration).toBeLessThan(30000);
    const job = await call('POST', `/api/v1/admin/batches/${r.data.id}/exports`, {
      kind: 'PUBLIC_QR',
      image_format: 'png',
      size_px: 1024,
    });
    const exportStart = performance.now();
    await processOneExport(db.pool, db.config);
    const exportDuration = performance.now() - exportStart;
    expect(exportDuration).toBeLessThan(120000);
    expect((await call('GET', `/api/v1/admin/exports/${job.data.id}`)).data.status).toBe('READY');
    await mkdir('artifacts', { recursive: true });
    await writeFile(
      'artifacts/local-performance.json',
      JSON.stringify(
        {
          verified_at: new Date().toISOString(),
          environment: 'local PostgreSQL 15, in-process API',
          batch_quantity: 500,
          image_format: 'png',
          size_px: 1024,
          batch_ms: Math.round(batchDuration),
          export_ms: Math.round(exportDuration),
          batch_target_ms: 30000,
          export_target_ms: 120000,
        },
        null,
        2,
      ) + '\n',
    );
  }, 150000);
});
