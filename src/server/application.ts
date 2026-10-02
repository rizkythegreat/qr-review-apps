import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import type { Config } from './config';
import { ApiError, logFailure, missing, unavailable } from './errors';
import { bodies, parseBody, token, uuid } from './validation';
import { Domain, etag, getQr } from './domain';
import {
  type VerifyAdmin,
  ownerSession,
  requireAdmin,
  requireOrigin,
  requireSession,
  supabaseVerifier,
} from './auth';
import { transaction } from './db';
import { adminView, batchView, exportView, ownerView, type Batch, type Qr } from './models';
import { createExport, download, getBatch, inspectExport, qrImage } from './exports';
import { decodeCursor, encodeCursor } from './pagination';
import { type Result, type Idempotency } from './idempotency';
import {
  idempotentOperations,
  matchRoute,
  secretOperations,
  versionOperations,
  type Operation,
} from './routes';
import { errorResponse, fallback, headers, readJson, respond, source } from './http';
import { type Visit, recordVisit, shouldCount } from './statistics';

const listSchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(1024).optional(),
});
const qrListSchema = listSchema.extend({
  search: z.string().trim().min(1).max(120).optional(),
  status: z.enum(['UNACTIVATED', 'ACTIVE', 'SUSPENDED', 'RETIRED']).optional(),
  stock_status: z.enum(['GENERATED', 'AVAILABLE', 'SOLD', 'DAMAGED']).optional(),
  batch_id: uuid.optional(),
});
const imageSchema = z.strictObject({
  format: z.enum(['png', 'svg']).default('png'),
  size_px: z.coerce.number().int().min(256).max(2048).default(1024),
});
type PageRow = { id: string; created_at: Date };
export interface ApplicationOptions {
  pool: Pool;
  config: Config;
  verifyAdmin?: VerifyAdmin;
  recordVisit?: (visit: Visit) => Promise<void>;
}
export class Application {
  readonly domain: Domain;
  private verify: VerifyAdmin;
  constructor(private options: ApplicationOptions) {
    this.domain = new Domain(options.pool, options.config);
    this.verify = options.verifyAdmin || supabaseVerifier(options.config);
  }
  get pool() {
    return this.options.pool;
  }
  get config() {
    return this.options.config;
  }
  async handle(request: Request): Promise<Response> {
    const requestId = randomUUID();
    try {
      const url = new URL(request.url);
      if (url.protocol !== 'https:') throw new ApiError(403, 'FORBIDDEN', 'HTTPS diperlukan.');
      const match = matchRoute(request.method, url.pathname);
      if (!match) missing();
      const { id: op, params } = match;
      const sourceId = source(this.config, request);
      let admin: string | undefined;
      if (match.path.startsWith('/api/v1/admin/')) {
        admin = await requireAdmin(this.pool, request, this.verify);
        await this.domain.limiter.general(`admin:${admin}`);
      } else {
        await this.domain.limiter.general(`source:${sourceId}`);
      }
      const unsafe = !['GET', 'HEAD'].includes(request.method);
      if (unsafe && !admin) requireOrigin(this.config, request);
      for (const [k, v] of Object.entries(params))
        if (!(k === 'token' ? token : uuid).safeParse(v).success)
          throw new ApiError(400, 'INVALID_PARAMETER', 'Parameter tidak valid.');
      const query = Object.fromEntries(url.searchParams.entries());
      if ([...url.searchParams.keys()].length !== Object.keys(query).length)
        throw new ApiError(400, 'INVALID_PARAMETER', 'Parameter duplikat tidak diizinkan.');
      const allowedQuery = ['listQr', 'listBatches', 'listAuditEvents', 'getQrImage'].includes(op);
      if (!allowedQuery && Object.keys(query).length)
        throw new ApiError(400, 'INVALID_PARAMETER', 'Parameter tidak diizinkan.');
      let raw: unknown;
      if (op in bodies) raw = await readJson(request);
      if (versionOperations.has(op)) {
        const matchHeader = request.headers.get('if-match');
        if (!matchHeader) throw new ApiError(428, 'PRECONDITION_REQUIRED', 'If-Match diperlukan.');
        if (!/^"v[1-9][0-9]*"$/.test(matchHeader))
          throw new ApiError(400, 'INVALID_PARAMETER', 'If-Match harus strong ETag QR.');
      }
      const key = request.headers.get('idempotency-key');
      if (idempotentOperations.has(op) && (!key || !uuid.safeParse(key).success))
        throw new ApiError(400, 'INVALID_PARAMETER', 'Idempotency-Key UUID diperlukan.');
      // Parse each body in its branch to preserve TypeScript's exact inferred input type.
      const result = await this.dispatch(
        op,
        params,
        query,
        raw,
        request,
        admin,
        sourceId,
        match.path,
        key,
      );
      return respond(result, requestId);
    } catch (error) {
      if (error instanceof ApiError) return errorResponse(error, requestId);
      logFailure('api_failed', requestId, undefined, error);
      return errorResponse(unavailable(), requestId);
    }
  }
  private async dispatch(
    op: Operation,
    p: Record<string, string>,
    query: Record<string, string>,
    raw: unknown,
    request: Request,
    admin: string | undefined,
    sourceId: string,
    path: string,
    key: string | null,
  ): Promise<Result> {
    const actor = { type: 'ADMIN' as const, id: admin || null };
    const ifMatch = request.headers.get('if-match');
    const idem = (
      principal = admin ? `admin:${admin}` : `token:${p.token}`,
    ): Idempotency | undefined =>
      idempotentOperations.has(op)
        ? {
            scope: `${principal}:${request.method}:${path.replace(/\{([^}]+)\}/g, (_, name) => p[name])}`,
            key: key!,
            payload: raw,
            ifMatch,
            secret: secretOperations.has(op),
            publicReplay: !admin,
          }
        : undefined;
    switch (op) {
      case 'adminMe':
        return { data: { user_id: admin, role: 'ADMIN' } };
      case 'adminDashboard': {
        const rows = (
          await this.pool.query<{ status: string; stock_status: string; count: string }>(
            'SELECT status,stock_status,count(*) FROM qr_review.qr_codes GROUP BY status,stock_status',
          )
        ).rows;
        const qr_counts = { UNACTIVATED: 0, ACTIVE: 0, SUSPENDED: 0, RETIRED: 0 },
          stock_counts = { GENERATED: 0, AVAILABLE: 0, SOLD: 0, DAMAGED: 0 };
        for (const r of rows) {
          qr_counts[r.status as keyof typeof qr_counts] += Number(r.count);
          stock_counts[r.stock_status as keyof typeof stock_counts] += Number(r.count);
        }
        return {
          data: {
            total_units: rows.reduce((n, r) => n + Number(r.count), 0),
            qr_counts,
            stock_counts,
            as_of: new Date(),
          },
        };
      }
      case 'createBatch':
        return this.domain.run(idem(), (db) => this.domain.batch(db, parseBody(op, raw), actor));
      case 'listBatches':
        return this.list(op, query, p);
      case 'getBatch':
        return { data: batchView(await getBatch(this.pool, p.batch_id)) };
      case 'createExport':
        return this.domain.run(idem(), (db) => createExport(db, p.batch_id, parseBody(op, raw)));
      case 'getExport':
        return transaction(this.pool, async (db) => ({
          data: exportView(await inspectExport(db, p.export_id)),
        }));
      case 'downloadExport': {
        const job = await transaction(this.pool, (db) => inspectExport(db, p.export_id));
        if (request.headers.has('range'))
          throw new ApiError(400, 'INVALID_PARAMETER', 'Unduhan range tidak didukung.');
        return download(this.config, job);
      }
      case 'listQr':
        return this.list(op, query, p);
      case 'getQrAdmin': {
        const q = await getQr(this.pool, p.qr_id);
        return { data: adminView(this.config, q), headers: etag(q) };
      }
      case 'getQrImage': {
        const q = await getQr(this.pool, p.qr_id);
        const parsed = imageSchema.safeParse(query);
        if (!parsed.success)
          throw new ApiError(400, 'INVALID_PARAMETER', 'Opsi gambar tidak valid.');
        return {
          body: await qrImage(
            this.config.PUBLIC_ORIGIN,
            q.token,
            parsed.data.format,
            parsed.data.size_px,
          ),
          headers: { 'Content-Type': parsed.data.format === 'png' ? 'image/png' : 'image/svg+xml' },
        };
      }
      case 'updateStock': {
        const b = parseBody(op, raw);
        return this.domain.run(undefined, (db) =>
          this.domain.stock(db, p.qr_id, b, ifMatch, actor),
        );
      }
      case 'recordSale':
        return this.domain.run(idem(), (db) =>
          this.domain.sale(db, p.qr_id, parseBody(op, raw), ifMatch, actor),
        );
      case 'getSale': {
        await getQr(this.pool, p.qr_id);
        const sale = (
          await this.pool.query('SELECT * FROM qr_review.sales_records WHERE qr_id=$1', [p.qr_id])
        ).rows[0];
        if (!sale) throw new ApiError(404, 'SALE_NOT_FOUND', 'Penjualan belum dicatat.');
        return { data: sale };
      }
      case 'suspendQr':
      case 'resumeQr':
      case 'retireQr':
        return this.domain.run(idem(), (db) =>
          this.domain.status(db, p.qr_id, op, parseBody(op, raw).reason, ifMatch, actor),
        );
      case 'rotateActivationCode':
        return this.domain.run(idem(), (db) =>
          this.domain.rotate(db, p.qr_id, parseBody(op, raw).reason, ifMatch, actor),
        );
      case 'createPinResetGrant':
      case 'createTransferGrant':
        return this.domain.run(idem(), (db) =>
          this.domain.grant(
            db,
            p.qr_id,
            op === 'createPinResetGrant' ? 'PIN_RESET' : 'OWNERSHIP_TRANSFER',
            parseBody(op, raw),
            ifMatch,
            actor,
          ),
        );
      case 'listAuditEvents':
        await getQr(this.pool, p.qr_id);
        return this.list(op, query, p);
      case 'getPublicQr': {
        const q = await getQr(this.pool, p.token, true);
        return {
          data: {
            token: q.token,
            status: q.status,
            activation_allowed: q.status === 'UNACTIVATED' && q.stock_status === 'SOLD',
            manage_path: '/manage',
            supported_review_link_policy: 'GOOGLE_REVIEW_V1',
          },
        };
      }
      case 'activateQr':
        return this.domain.run(
          idem(),
          (db) => this.domain.activate(db, p.token, parseBody(op, raw)),
          { identity: p.token, source: sourceId },
        );
      case 'createOwnerSession': {
        const b = parseBody(op, raw);
        return this.domain.run(undefined, (db) => this.domain.login(db, b, request), {
          identity: b.token,
          source: sourceId,
        });
      }
      case 'ownerMe':
        return transaction(this.pool, async (db) => {
          const { qr: q, session: s } = requireSession(
            await ownerSession(db, this.config, request, true),
          );
          return {
            data: {
              qr: ownerView(q),
              expires_at: s.expires_at,
              csrf_token: s.csrf_token,
              read_only: q.status === 'SUSPENDED',
            },
            headers: etag(q),
          };
        });
      case 'updateOwnerQr': {
        const b = parseBody(op, raw);
        return this.domain.run(undefined, (db) => this.domain.ownerUpdate(db, request, b, ifMatch));
      }
      case 'ownerStats':
        return transaction(this.pool, async (db) => {
          const { qr: q } = requireSession(await ownerSession(db, this.config, request, true));
          const s = (
            await db.query(
              'SELECT id,total_visits,last_visited_at FROM qr_review.ownership_periods WHERE id=$1',
              [q.ownership_id],
            )
          ).rows[0];
          return {
            data: {
              ownership_id: s.id,
              total_visits: Number(s.total_visits),
              last_visited_at: s.last_visited_at,
              as_of: new Date(),
              metric: 'QR_VISITS',
              counts_submitted_reviews: false,
            },
          };
        });
      case 'changeOwnerPin': {
        const b = parseBody(op, raw);
        const auth = requireSession(await ownerSession(this.pool, this.config, request));
        return this.domain.run(undefined, (db) => this.domain.changePin(db, request, b, ifMatch), {
          identity: auth.qr.token,
          source: sourceId,
        });
      }
      case 'logoutOwner':
        return this.domain.run(undefined, (db) => this.domain.logout(db, request));
      case 'claimPinReset':
      case 'claimOwnershipTransfer': {
        const grantToken =
          raw &&
          typeof raw === 'object' &&
          'grant_token' in raw &&
          typeof raw.grant_token === 'string'
            ? raw.grant_token
            : '';
        const principal = `grant:${this.domain.limiter.key('grant-id', grantToken)}`;
        return this.domain.run(
          idem(principal),
          (db) =>
            this.domain.claim(
              db,
              op === 'claimPinReset' ? 'PIN_RESET' : 'OWNERSHIP_TRANSFER',
              parseBody(op, raw),
            ),
          { identity: principal, source: sourceId },
        );
      }
    }
  }
  private async list(
    op: 'listBatches' | 'listQr' | 'listAuditEvents',
    input: Record<string, string>,
    params: Record<string, string>,
  ): Promise<Result> {
    const parsed = (op === 'listQr' ? qrListSchema : listSchema).safeParse(input);
    if (!parsed.success)
      throw new ApiError(
        400,
        input.cursor !== undefined ? 'INVALID_CURSOR' : 'INVALID_PARAMETER',
        'Parameter daftar tidak valid.',
      );
    const { limit, cursor, ...filters } = parsed.data;
    const filter = { operation: op, qr_id: params.qr_id || null, ...filters };
    const position = decodeCursor(this.config, cursor, filter);
    const where: string[] = [],
      values: unknown[] = [];
    const add = (value: unknown) => {
      values.push(value);
      return `$${values.length}`;
    };
    if (position)
      where.push(
        `(created_at,id)<(${add(position.created_at)}::timestamptz,${add(position.id)}::uuid)`,
      );
    if (op === 'listQr') {
      for (const k of ['status', 'stock_status', 'batch_id'] as const)
        if (k in filters) where.push(`${k}=${add(filters[k as keyof typeof filters])}`);
      if ('search' in filters && filters.search) {
        const value = add(filters.search);
        where.push(`(token=${value} OR strpos(lower(store_name),lower(${value}))>0)`);
      }
    }
    if (op === 'listAuditEvents') where.push(`qr_id=${add(params.qr_id)}`);
    const table =
      op === 'listQr' ? 'qr_codes' : op === 'listBatches' ? 'qr_batches' : 'audit_events';
    const rows = (
      await this.pool.query<PageRow>(
        `SELECT * FROM qr_review.${table} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC,id DESC LIMIT ${add(limit + 1)}`,
        values,
      )
    ).rows;
    const page = rows.slice(0, limit);
    const data =
      op === 'listQr'
        ? page.map((r) => adminView(this.config, r as Qr))
        : op === 'listBatches'
          ? page.map((r) => batchView(r as Batch))
          : page;
    return {
      data,
      pagination: {
        limit,
        next_cursor: rows.length > limit ? encodeCursor(this.config, page.at(-1)!, filter) : null,
      },
    };
  }
  async resolve(request: Request, publicToken: string): Promise<Response> {
    const requestId = randomUUID(),
      head = request.method === 'HEAD';
    try {
      if (new URL(request.url).protocol !== 'https:')
        return fallback(503, 'Gunakan koneksi HTTPS.', requestId, head);
      await this.domain.limiter.general(`source:${source(this.config, request)}`, true);
      if (!token.safeParse(publicToken).success) missing();
      const row = (
        await this.pool.query<Qr & { resolved_at: Date }>(
          'SELECT *,clock_timestamp() AS resolved_at FROM qr_review.qr_codes WHERE token=$1',
          [publicToken],
        )
      ).rows[0];
      if (!row) missing();
      if (row.status === 'ACTIVE') {
        if (shouldCount(request, this.config)) {
          const visit = {
            qr_id: row.id,
            ownership_id: row.ownership_id!,
            visited_at: row.resolved_at,
          };
          const record =
            this.options.recordVisit ||
            ((v: Visit) => recordVisit(this.pool, v, this.config.STATISTICS_TIMEOUT_MS));
          let timeout: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              record(visit),
              new Promise<never>((_, reject) => {
                timeout = setTimeout(
                  () => reject(new Error('statistics_timeout')),
                  this.config.STATISTICS_TIMEOUT_MS,
                );
              }),
            ]);
          } catch {
            logFailure('statistics_recording_failed', requestId);
          } finally {
            clearTimeout(timeout);
          }
        }
        return new Response(null, {
          status: 302,
          headers: { ...headers(requestId, true), Location: row.review_url! },
        });
      }
      if (row.status === 'RETIRED')
        return fallback(410, 'Unit ini tidak lagi digunakan.', requestId, head);
      if (row.status === 'SUSPENDED')
        return fallback(200, 'Layanan sementara ditangguhkan. Hubungi dukungan.', requestId, head);
      const response = fallback(
        200,
        row.stock_status === 'SOLD'
          ? 'QR belum aktif. Aktivasi tersedia menggunakan kode pada kartu rahasia.'
          : 'QR belum aktif dan belum tersedia untuk aktivasi.',
        requestId,
        head,
      );
      response.headers.set('X-QR-Page', 'activation');
      return response;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404)
        return fallback(404, 'QR tidak ditemukan.', requestId, head);
      if (error instanceof ApiError && error.status === 429)
        return fallback(429, error.message, requestId, head, error.retryAfter);
      logFailure('resolver_failed', requestId, undefined, error);
      return fallback(503, 'Layanan sementara tidak tersedia. Coba lagi.', requestId, head, 5);
    }
  }
}
