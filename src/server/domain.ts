import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Config } from './config';
import { ApiError, conflict, missing } from './errors';
import {
  activationCode,
  decrypt,
  encrypt,
  equal,
  hashPin,
  hmac,
  opaque,
  verifyPin,
} from './crypto';
import {
  activationAllowed,
  adminView,
  batchView,
  ownerView,
  type Qr,
  type Grant,
  type Batch,
} from './models';
import { type Idempotency, idempotent, type Result } from './idempotency';
import { type CredentialScope, Limiter } from './rate-limit';
import {
  clearCookie,
  cookieToken,
  ownerSession,
  requireCsrf,
  requireSession,
  sessionCookie,
} from './auth';
import type { BodyOf } from './validation';

export type Actor = { type: 'ADMIN' | 'OWNER' | 'SYSTEM'; id: string | null };
export async function getQr(db: PoolClient | Pool, id: string, byToken = false, lock = false) {
  const row = (
    await db.query<Qr>(
      `SELECT * FROM qr_review.qr_codes WHERE ${byToken ? 'token' : 'id'}=$1 ${lock ? 'FOR UPDATE' : ''}`,
      [id],
    )
  ).rows[0];
  if (!row) missing();
  return row;
}
export function checkVersion(q: Qr, ifMatch: string | null) {
  if (!ifMatch) throw new ApiError(428, 'PRECONDITION_REQUIRED', 'If-Match diperlukan.');
  if (ifMatch !== `"v${q.version}"`)
    throw new ApiError(412, 'VERSION_MISMATCH', 'Data sudah berubah. Muat ulang.');
}
export function etag(q: Qr) {
  return { ETag: `"v${q.version}"` };
}
export async function audit(
  db: PoolClient,
  q: Qr,
  actor: Actor,
  action: string,
  changes: unknown,
  reason?: string,
) {
  await db.query(
    'INSERT INTO qr_review.audit_events(id,qr_id,actor_type,actor_id,action,changes,reason) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [randomUUID(), q.id, actor.type, actor.id, action, changes, reason || null],
  );
}
export async function mutate(
  db: PoolClient,
  q: Qr,
  changes: Partial<Qr>,
  actor: Actor,
  action: string,
  reason?: string,
  visible?: unknown,
) {
  const fields = Object.keys(changes) as (keyof Qr)[];
  const values = fields.map((k) => changes[k]);
  const updated = (
    await db.query<Qr>(
      `UPDATE qr_review.qr_codes SET ${fields.map((k, i) => `${k}=$${i + 1}`).join(',')},version=version+1,updated_at=now() WHERE id=$${values.length + 1} RETURNING *`,
      [...values, q.id],
    )
  ).rows[0];
  await audit(db, updated, actor, action, visible ?? changes, reason);
  return updated;
}
export async function revoke(db: PoolClient, q: Qr, sessions = true, grants = true) {
  if (sessions)
    await db.query(
      'UPDATE qr_review.owner_sessions SET revoked_at=now() WHERE qr_id=$1 AND revoked_at IS NULL',
      [q.id],
    );
  if (grants)
    await db.query(
      'UPDATE qr_review.support_grants SET revoked_at=now() WHERE qr_id=$1 AND revoked_at IS NULL AND consumed_at IS NULL',
      [q.id],
    );
}
export async function invalidateSnapshot(db: PoolClient, q: Qr) {
  await db.query(
    'UPDATE qr_review.qr_batches SET snapshot_valid=false,activation_snapshot=NULL WHERE id=$1',
    [q.batch_id],
  );
  await db.query(
    `UPDATE qr_review.export_jobs SET status='EXPIRED',artifact=NULL,failure_code='ACTIVATION_EXPORT_UNAVAILABLE'
    WHERE batch_id=$1 AND kind='ACTIVATION_CODES' AND status <> 'EXPIRED'`,
    [q.batch_id],
  );
}
function ensureActive(q: Qr) {
  if (q.status === 'SUSPENDED')
    throw new ApiError(423, 'QR_SUSPENDED', 'QR sedang ditangguhkan. Hubungi dukungan.');
  if (q.status !== 'ACTIVE') conflict('QR_TRANSITION_INVALID');
}

export class Domain {
  readonly limiter: Limiter;
  constructor(
    readonly pool: Pool,
    readonly config: Config,
  ) {
    this.limiter = new Limiter(pool, config);
  }
  run(
    options: Idempotency | undefined,
    work: (db: PoolClient) => Promise<{ result: Result; qr?: Qr }>,
    credentials?: CredentialScope,
  ) {
    return this.limiter.credentialTransaction(credentials, (db) =>
      idempotent(db, this.config, options, () => work(db)),
    );
  }
  async batch(db: PoolClient, b: BodyOf<'createBatch'>, actor: Actor) {
    const id = randomUUID();
    const units = Array.from({ length: b.quantity }, () => ({
      id: randomUUID(),
      token: opaque(16),
      activation_code: activationCode(),
    }));
    const snapshot = encrypt(
      this.config,
      units.map((u) => ({ token: u.token, activation_code: u.activation_code })),
      `batch:${id}`,
    );
    const batch = (
      await db.query<Batch>(
        'INSERT INTO qr_review.qr_batches(id,label,quantity,activation_snapshot) VALUES($1,$2,$3,$4) RETURNING *',
        [id, b.label, b.quantity, snapshot],
      )
    ).rows[0];
    await db.query(
      `INSERT INTO qr_review.qr_codes(id,batch_id,token,activation_hash)
      SELECT x.id,$1,x.token,x.hash FROM jsonb_to_recordset($2::jsonb) AS x(id uuid,token text,hash text)`,
      [
        id,
        JSON.stringify(
          units.map((u) => ({
            id: u.id,
            token: u.token,
            hash: hmac(this.config, 'activation', u.activation_code),
          })),
        ),
      ],
    );
    await db.query(
      `INSERT INTO qr_review.audit_events(id,qr_id,action,actor_type,actor_id,changes)
      SELECT gen_random_uuid(),id,'BATCH_GENERATED',$2,$3,jsonb_build_object('batch_id',batch_id,'stock_status',stock_status)
      FROM qr_review.qr_codes WHERE batch_id=$1`,
      [id, actor.type, actor.id],
    );
    return { result: { status: 201, data: batchView(batch) } };
  }
  async stock(
    db: PoolClient,
    id: string,
    b: BodyOf<'updateStock'>,
    ifMatch: string | null,
    actor: Actor,
  ) {
    let q = await getQr(db, id, false, true);
    checkVersion(q, ifMatch);
    if (
      q.status !== 'UNACTIVATED' ||
      !(
        (q.stock_status === 'GENERATED' && ['AVAILABLE', 'DAMAGED'].includes(b.stock_status)) ||
        (q.stock_status === 'AVAILABLE' && b.stock_status === 'DAMAGED')
      )
    )
      conflict('STOCK_TRANSITION_INVALID');
    if (b.stock_status === 'DAMAGED') {
      await revoke(db, q);
      await invalidateSnapshot(db, q);
      q = await mutate(
        db,
        q,
        {
          stock_status: 'DAMAGED',
          status: 'RETIRED',
          activation_hash: null,
          auth_generation: q.auth_generation + 1,
        },
        actor,
        'STOCK_DAMAGED',
        b.reason,
        { stock_status: 'DAMAGED', status: 'RETIRED' },
      );
    } else
      q = await mutate(db, q, { stock_status: 'AVAILABLE' }, actor, 'STOCK_AVAILABLE', b.reason);
    return { qr: q, result: { data: adminView(this.config, q), headers: etag(q) } };
  }
  async sale(
    db: PoolClient,
    id: string,
    b: BodyOf<'recordSale'>,
    ifMatch: string | null,
    actor: Actor,
  ) {
    let q = await getQr(db, id, false, true);
    checkVersion(q, ifMatch);
    if (!['GENERATED', 'AVAILABLE'].includes(q.stock_status) || q.status !== 'UNACTIVATED')
      conflict('STOCK_TRANSITION_INVALID');
    const sale = (
      await db.query(
        'INSERT INTO qr_review.sales_records(id,qr_id,reference,sold_at,buyer_name,support_contact) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
        [randomUUID(), id, b.reference, b.sold_at, b.buyer_name || null, b.support_contact || null],
      )
    ).rows[0];
    q = await mutate(db, q, { stock_status: 'SOLD' }, actor, 'SALE_RECORDED', undefined, {
      stock_status: 'SOLD',
      sale_id: sale.id,
      reference: b.reference,
    });
    return { qr: q, result: { status: 201, data: sale, headers: etag(q) } };
  }
  async status(
    db: PoolClient,
    id: string,
    action: 'suspendQr' | 'resumeQr' | 'retireQr',
    reason: string,
    ifMatch: string | null,
    actor: Actor,
  ) {
    let q = await getQr(db, id, false, true);
    checkVersion(q, ifMatch);
    const target =
      action === 'suspendQr' ? 'SUSPENDED' : action === 'resumeQr' ? 'ACTIVE' : 'RETIRED';
    if (
      (action === 'suspendQr' && q.status !== 'ACTIVE') ||
      (action === 'resumeQr' && q.status !== 'SUSPENDED') ||
      (action === 'retireQr' && q.status === 'RETIRED')
    )
      conflict('QR_TRANSITION_INVALID');
    await revoke(db, q);
    if (target === 'RETIRED') await invalidateSnapshot(db, q);
    q = await mutate(
      db,
      q,
      {
        status: target,
        activation_hash: target === 'RETIRED' ? null : q.activation_hash,
        auth_generation: q.auth_generation + 1,
      },
      actor,
      action,
      reason,
      { status: target },
    );
    return { qr: q, result: { data: adminView(this.config, q), headers: etag(q) } };
  }
  async revealActivationCode(db: PoolClient, id: string) {
    const q = await getQr(db, id, false, true);
    const unavailable = () => {
      throw new ApiError(
        409,
        'ACTIVATION_CODE_UNAVAILABLE',
        'Salinan kode aktivasi tidak lagi tersedia. Gunakan kode yang telah diunduh atau rotasi kode untuk unit yang belum aktif.',
      );
    };
    if (!activationAllowed(q) || !q.activation_hash) unavailable();
    const batch = (
      await db.query<Batch>('SELECT * FROM qr_review.qr_batches WHERE id=$1', [q.batch_id])
    ).rows[0];
    if (
      !batch.snapshot_valid ||
      !batch.activation_snapshot ||
      batch.activation_codes_expires_at.getTime() <= Date.now()
    )
      unavailable();
    const codes = decrypt<{ token: string; activation_code: string }[]>(
      this.config,
      batch.activation_snapshot!,
      `batch:${batch.id}`,
    );
    const code = codes.find((entry) => entry.token === q.token)?.activation_code;
    if (!code || !equal(hmac(this.config, 'activation', code), q.activation_hash!)) unavailable();
    return {
      result: {
        data: { qr_id: q.id, activation_code: code, expires_at: batch.activation_codes_expires_at },
      },
    };
  }
  async rotate(db: PoolClient, id: string, reason: string, ifMatch: string | null, actor: Actor) {
    let q = await getQr(db, id, false, true);
    checkVersion(q, ifMatch);
    if (q.status !== 'UNACTIVATED' || q.stock_status === 'DAMAGED')
      conflict('QR_TRANSITION_INVALID');
    const raw = activationCode();
    await revoke(db, q);
    await invalidateSnapshot(db, q);
    q = await mutate(
      db,
      q,
      {
        activation_hash: hmac(this.config, 'activation', raw),
        auth_generation: q.auth_generation + 1,
      },
      actor,
      'ACTIVATION_CODE_ROTATED',
      reason,
      { activation_code_rotated: true },
    );
    return {
      qr: q,
      result: { data: { qr_id: id, activation_code: raw, version: q.version }, headers: etag(q) },
    };
  }
  async grant(
    db: PoolClient,
    id: string,
    kind: Grant['kind'],
    b: BodyOf<'createPinResetGrant'>,
    ifMatch: string | null,
    actor: Actor,
  ) {
    let q = await getQr(db, id, false, true);
    checkVersion(q, ifMatch);
    if (!['ACTIVE', 'SUSPENDED'].includes(q.status)) conflict('QR_TRANSITION_INVALID');
    const transfer = kind === 'OWNERSHIP_TRANSFER';
    await revoke(db, q, transfer, true);
    q = await mutate(
      db,
      q,
      transfer
        ? { status: 'SUSPENDED', auth_generation: q.auth_generation + 1 }
        : { status: q.status },
      actor,
      `${kind}_GRANT_CREATED`,
      b.reason,
      {
        grant_kind: kind,
        verification_reference: b.verification_reference,
        status: transfer ? 'SUSPENDED' : q.status,
      },
    );
    const raw = opaque();
    const grant = (
      await db.query<Grant>(
        'INSERT INTO qr_review.support_grants(id,qr_id,kind,token_hash,auth_generation,ownership_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
        [
          randomUUID(),
          id,
          kind,
          hmac(this.config, 'grant', raw),
          q.auth_generation,
          q.ownership_id,
        ],
      )
    ).rows[0];
    return {
      qr: q,
      result: {
        status: 201,
        headers: etag(q),
        data: {
          id: grant.id,
          qr_id: id,
          kind,
          expires_at: grant.expires_at,
          claim_url: `${this.config.PUBLIC_ORIGIN}/${transfer ? 'ownership-transfer' : 'pin-reset'}#grant=${raw}`,
          qr_version: q.version,
        },
      },
    };
  }
  async activate(db: PoolClient, token: string, b: BodyOf<'activateQr'>) {
    let q = await getQr(db, token, true, true);
    if (q.status === 'RETIRED') throw new ApiError(410, 'QR_RETIRED', 'Unit tidak lagi digunakan.');
    if (q.status === 'ACTIVE') conflict('QR_ALREADY_ACTIVE');
    if (q.status !== 'UNACTIVATED') conflict('QR_TRANSITION_INVALID');
    if (!activationAllowed(q)) conflict('STOCK_TRANSITION_INVALID');
    if (
      !q.activation_hash ||
      !equal(hmac(this.config, 'activation', b.activation_code), q.activation_hash)
    )
      throw new ApiError(401, 'INVALID_ACTIVATION_CODE', 'Kode aktivasi tidak valid.');
    const ownership = randomUUID(),
      pinHash = await hashPin(this.config, b.pin);
    const period = (
      await db.query(
        'INSERT INTO qr_review.ownership_periods(id,qr_id) VALUES($1,$2) RETURNING started_at',
        [ownership, q.id],
      )
    ).rows[0];
    const actor: Actor = { type: 'OWNER', id: ownership };
    let sale: { id: string; reference: string } | undefined;
    if (q.stock_status !== 'SOLD') {
      const id = randomUUID();
      const reference = `ACT-${id}`;
      sale = (
        await db.query(
          'INSERT INTO qr_review.sales_records(id,qr_id,reference,sold_at) VALUES($1,$2,$3,$4) RETURNING id,reference',
          [id, q.id, reference, period.started_at],
        )
      ).rows[0];
    }
    q = await mutate(
      db,
      q,
      {
        stock_status: 'SOLD',
        status: 'ACTIVE',
        store_name: b.store_name,
        review_url: b.review_url,
        pin_hash: pinHash,
        activation_hash: null,
        ownership_id: ownership,
        activated_at: period.started_at,
        auth_generation: q.auth_generation + 1,
      },
      actor,
      'ACTIVATED',
      undefined,
      {
        status: 'ACTIVE',
        store_name: b.store_name,
        review_url: b.review_url,
        ownership_id: ownership,
      },
    );
    if (sale)
      await audit(db, q, actor, 'SALE_RECORDED', {
        stock_status: 'SOLD',
        sale_id: sale.id,
        reference: sale.reference,
      });
    await invalidateSnapshot(db, q);
    return {
      qr: q,
      result: {
        status: 201,
        data: {
          token: q.token,
          status: 'ACTIVE',
          store_name: q.store_name,
          manage_url: `${this.config.PUBLIC_ORIGIN}/manage`,
          activated_at: q.activated_at,
        },
      },
    };
  }
  async login(db: PoolClient, b: BodyOf<'createOwnerSession'>, request: Request) {
    const q = (
      await db.query<Qr>('SELECT * FROM qr_review.qr_codes WHERE token=$1 FOR UPDATE', [b.token])
    ).rows[0];
    const valid = await verifyPin(this.config, b.pin, q?.pin_hash);
    if (!valid || !q || !['ACTIVE', 'SUSPENDED'].includes(q.status))
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Token atau PIN tidak valid.');
    const previous = cookieToken(request);
    if (previous)
      await db.query('UPDATE qr_review.owner_sessions SET revoked_at=now() WHERE session_hash=$1', [
        hmac(this.config, 'session', previous),
      ]);
    const raw = opaque(),
      csrf = opaque();
    const s = (
      await db.query(
        'INSERT INTO qr_review.owner_sessions(session_hash,qr_id,ownership_id,auth_generation,csrf_token) VALUES($1,$2,$3,$4,$5) RETURNING expires_at',
        [hmac(this.config, 'session', raw), q.id, q.ownership_id, q.auth_generation, csrf],
      )
    ).rows[0];
    return {
      qr: q,
      result: {
        data: {
          qr: ownerView(q),
          expires_at: s.expires_at,
          csrf_token: csrf,
          read_only: q.status === 'SUSPENDED',
        },
        headers: { 'Set-Cookie': sessionCookie(raw) },
      },
    };
  }
  async ownerUpdate(
    db: PoolClient,
    request: Request,
    b: BodyOf<'updateOwnerQr'>,
    ifMatch: string | null,
  ) {
    const { qr: q, session } = requireSession(await ownerSession(db, this.config, request, true));
    requireCsrf(request, session);
    checkVersion(q, ifMatch);
    ensureActive(q);
    const updated = await mutate(db, q, b, { type: 'OWNER', id: q.ownership_id }, 'OWNER_UPDATED');
    return { qr: updated, result: { data: ownerView(updated), headers: etag(updated) } };
  }
  async changePin(
    db: PoolClient,
    request: Request,
    b: BodyOf<'changeOwnerPin'>,
    ifMatch: string | null,
  ) {
    const { qr: q, session } = requireSession(await ownerSession(db, this.config, request, true));
    requireCsrf(request, session);
    checkVersion(q, ifMatch);
    ensureActive(q);
    if (!(await verifyPin(this.config, b.current_pin, q.pin_hash)))
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'PIN tidak valid.');
    const pinHash = await hashPin(this.config, b.new_pin);
    await revoke(db, q);
    const updated = await mutate(
      db,
      q,
      { pin_hash: pinHash, auth_generation: q.auth_generation + 1 },
      { type: 'OWNER', id: q.ownership_id },
      'PIN_CHANGED',
      undefined,
      { pin_changed: true },
    );
    return { qr: updated, result: { status: 204, headers: { 'Set-Cookie': clearCookie } } };
  }
  async logout(db: PoolClient, request: Request) {
    const auth = await ownerSession(db, this.config, request, true);
    if (auth) {
      requireCsrf(request, auth.session);
      await db.query('UPDATE qr_review.owner_sessions SET revoked_at=now() WHERE session_hash=$1', [
        auth.session.session_hash,
      ]);
    }
    return { result: { status: 204, headers: { 'Set-Cookie': clearCookie } } };
  }
  async claim(
    db: PoolClient,
    kind: Grant['kind'],
    b: BodyOf<'claimPinReset'> | BodyOf<'claimOwnershipTransfer'>,
  ) {
    const initial = (
      await db.query<Grant>('SELECT * FROM qr_review.support_grants WHERE token_hash=$1', [
        hmac(this.config, 'grant', b.grant_token),
      ])
    ).rows[0];
    const invalid = (): never => {
      throw new ApiError(
        410,
        'GRANT_INVALID_OR_EXPIRED',
        'Tautan dukungan tidak valid atau kedaluwarsa.',
      );
    };
    if (!initial) invalid();
    let q = await getQr(db, initial.qr_id, false, true);
    const grant = (
      await db.query<Grant>('SELECT * FROM qr_review.support_grants WHERE id=$1 FOR UPDATE', [
        initial.id,
      ])
    ).rows[0];
    if (
      !grant ||
      grant.kind !== kind ||
      grant.consumed_at ||
      grant.revoked_at ||
      grant.expires_at.getTime() <= Date.now() ||
      grant.auth_generation !== q.auth_generation ||
      grant.ownership_id !== q.ownership_id ||
      !['ACTIVE', 'SUSPENDED'].includes(q.status)
    )
      invalid();
    const transfer = kind === 'OWNERSHIP_TRANSFER';
    if (transfer && q.status !== 'SUSPENDED') invalid();
    const pinHash = await hashPin(this.config, b.new_pin);
    let ownership = q.ownership_id;
    const changes: Partial<Qr> = { pin_hash: pinHash, auth_generation: q.auth_generation + 1 };
    if (transfer && 'store_name' in b) {
      await db.query('UPDATE qr_review.ownership_periods SET ended_at=now() WHERE id=$1', [
        ownership,
      ]);
      ownership = randomUUID();
      await db.query('INSERT INTO qr_review.ownership_periods(id,qr_id) VALUES($1,$2)', [
        ownership,
        q.id,
      ]);
      Object.assign(changes, {
        status: 'ACTIVE',
        ownership_id: ownership,
        store_name: b.store_name,
        review_url: b.review_url,
      });
    }
    await db.query('UPDATE qr_review.support_grants SET consumed_at=now() WHERE id=$1', [grant.id]);
    await revoke(db, q);
    q = await mutate(
      db,
      q,
      changes,
      { type: 'OWNER', id: ownership },
      `${kind}_CLAIMED`,
      undefined,
      transfer
        ? {
            status: 'ACTIVE',
            ownership_id: ownership,
            store_name: changes.store_name,
            review_url: changes.review_url,
            pin_changed: true,
          }
        : { pin_changed: true },
    );
    return {
      qr: q,
      result: {
        data: {
          token: q.token,
          status: q.status,
          manage_url: `${this.config.PUBLIC_ORIGIN}/manage`,
          completed_at: q.updated_at,
        },
      },
    };
  }
}
