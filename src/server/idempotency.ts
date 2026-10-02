import type { PoolClient } from 'pg';
import type { Config } from './config';
import { canonical, decrypt, encrypt, hmac } from './crypto';
import { ApiError } from './errors';
import { guardView, type Qr } from './models';

export interface Result {
  status?: number;
  data?: unknown;
  pagination?: { limit: number; next_cursor: string | null };
  headers?: Record<string, string>;
  body?: Buffer | string | null;
}
export interface Idempotency {
  scope: string;
  key: string;
  payload: unknown;
  ifMatch: string | null;
  secret?: boolean;
  publicReplay?: boolean;
}
type RecordRow = {
  fingerprint: string;
  committed: boolean;
  response: Buffer | null;
  response_expires_at: Date;
  qr_id: string | null;
  state_guard: unknown;
};
export async function idempotent(
  db: PoolClient,
  config: Config,
  options: Idempotency | undefined,
  work: () => Promise<{ result: Result; qr?: Qr }>,
): Promise<Result> {
  if (!options) return (await work()).result;
  const identity = `${options.scope}:${options.key}`;
  const locked = (
    await db.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked',
      [identity],
    )
  ).rows[0].locked;
  if (!locked)
    throw new ApiError(409, 'REQUEST_IN_PROGRESS', 'Permintaan sedang diproses.', undefined, 2);
  const fingerprint = hmac(
    config,
    'idempotency',
    canonical({ payload: options.payload, if_match: options.ifMatch }),
  );
  const old = (
    await db.query<RecordRow>(
      'SELECT * FROM qr_review.idempotency_records WHERE scope=$1 AND key=$2 AND expires_at>now()',
      [options.scope, options.key],
    )
  ).rows[0];
  if (old) {
    if (old.fingerprint !== fingerprint)
      throw new ApiError(
        409,
        'IDEMPOTENCY_KEY_REUSED',
        'Key sudah digunakan untuk isian yang berbeda.',
      );
    if (old.committed && (old.response_expires_at.getTime() <= Date.now() || !old.response))
      throw new ApiError(
        410,
        'SECRET_REPLAY_EXPIRED',
        'Hasil rahasia sudah kedaluwarsa. Periksa status unit.',
      );
    if (old.committed && options.publicReplay && old.qr_id) {
      const qr = (
        await db.query<Qr>('SELECT * FROM qr_review.qr_codes WHERE id=$1 FOR SHARE', [old.qr_id])
      ).rows[0];
      if (!qr || canonical(old.state_guard) !== canonical(guardView(qr)))
        throw new ApiError(409, 'QR_STATE_CHANGED', 'Status atau kepemilikan QR telah berubah.');
    }
    if (old.committed) return decrypt<Result>(config, old.response!, `idempotency:${identity}`);
  }
  if (!old)
    await db.query(
      `INSERT INTO qr_review.idempotency_records(scope,key,fingerprint,response_expires_at)
    VALUES($1,$2,$3,now()+interval '24 hours') ON CONFLICT(scope,key) DO UPDATE SET
    fingerprint=EXCLUDED.fingerprint,committed=false,response=NULL,secret=false,response_expires_at=EXCLUDED.response_expires_at,
    expires_at=EXCLUDED.expires_at,qr_id=NULL,state_guard=NULL`,
      [options.scope, options.key, fingerprint],
    );
  await db.query('SAVEPOINT idempotent_work');
  try {
    const { result, qr } = await work();
    await db.query(
      `UPDATE qr_review.idempotency_records SET committed=true,response=$3,secret=$4,expires_at=now()+interval '24 hours',
      response_expires_at=now()+$5::interval,qr_id=$6,state_guard=$7 WHERE scope=$1 AND key=$2`,
      [
        options.scope,
        options.key,
        encrypt(config, result, `idempotency:${identity}`),
        !!options.secret,
        options.secret ? '15 minutes' : '24 hours',
        qr?.id || null,
        qr ? guardView(qr) : null,
      ],
    );
    return result;
  } catch (error) {
    if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
      await db.query('ROLLBACK TO SAVEPOINT idempotent_work');
      // Persist only the HMAC fingerprint. Corrected payloads require a new key; no failed response is replayed.
      error.preserveIdempotency = true;
    }
    throw error;
  }
}
