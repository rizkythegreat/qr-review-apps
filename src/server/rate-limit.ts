import type { Pool, PoolClient } from 'pg';
import type { Config } from './config';
import { hmac } from './crypto';
import { ApiError } from './errors';
import { transaction } from './db';

type Bucket = {
  bucket: string;
  count: number;
  window_started_at: Date;
  blocked_until: Date | null;
};
export type CredentialScope = { identity: string; source: string };
export class Limiter {
  constructor(
    private pool: Pool,
    private config: Config,
  ) {}
  key(purpose: string, input: string) {
    return hmac(this.config, `limit:${purpose}`, input);
  }
  async general(principal: string, resolver = false) {
    await transaction(this.pool, async (db) => {
      const bucket = await this.lock(db, this.key(resolver ? 'resolver' : 'api', principal), 60000);
      if (bucket.count >= (resolver ? 300 : 120))
        throw this.error(bucket.window_started_at.getTime() + 60000);
      await db.query(
        'UPDATE qr_review.rate_limits SET count=count+1,updated_at=now() WHERE bucket=$1',
        [bucket.bucket],
      );
    });
  }
  async lock(db: PoolClient, key: string, windowMs: number): Promise<Bucket> {
    await db.query('INSERT INTO qr_review.rate_limits(bucket) VALUES($1) ON CONFLICT DO NOTHING', [
      key,
    ]);
    const row = (
      await db.query<Bucket>('SELECT * FROM qr_review.rate_limits WHERE bucket=$1 FOR UPDATE', [
        key,
      ])
    ).rows[0];
    if (row.blocked_until && row.blocked_until.getTime() > Date.now())
      throw this.error(row.blocked_until.getTime());
    if (
      (row.blocked_until && row.blocked_until.getTime() <= Date.now()) ||
      row.window_started_at.getTime() + windowMs <= Date.now()
    ) {
      await db.query(
        'UPDATE qr_review.rate_limits SET count=0,window_started_at=now(),blocked_until=NULL,updated_at=now() WHERE bucket=$1',
        [key],
      );
      row.count = 0;
      row.window_started_at = new Date();
      row.blocked_until = null;
    }
    return row;
  }
  error(until: number) {
    return new ApiError(
      429,
      'RATE_LIMITED',
      'Terlalu banyak percobaan. Coba lagi nanti.',
      undefined,
      Math.max(1, Math.ceil((until - Date.now()) / 1000)),
    );
  }
  async credentialTransaction<T>(
    scope: CredentialScope | undefined,
    work: (db: PoolClient) => Promise<T>,
  ): Promise<T> {
    const result = await transaction(this.pool, async (db) => {
      const buckets = scope
        ? [
            { key: this.key('credential-source', scope.source), max: 50 },
            { key: this.key('credential-token', scope.identity), max: 30 },
            { key: this.key('credential-pair', `${scope.identity}:${scope.source}`), max: 5 },
          ].sort((a, b) => a.key.localeCompare(b.key))
        : [];
      for (const b of buckets) await this.lock(db, b.key, 900000);
      await db.query('SAVEPOINT credential_work');
      try {
        return { value: await work(db) };
      } catch (error) {
        const credentialFailure =
          scope &&
          error instanceof ApiError &&
          ['INVALID_CREDENTIALS', 'INVALID_ACTIVATION_CODE', 'GRANT_INVALID_OR_EXPIRED'].includes(
            error.code,
          );
        if (!(error instanceof ApiError) || (!credentialFailure && !error.preserveIdempotency))
          throw error;
        if (!error.preserveIdempotency) await db.query('ROLLBACK TO SAVEPOINT credential_work');
        if (credentialFailure)
          for (const b of buckets)
            await db.query(
              `UPDATE qr_review.rate_limits SET count=count+1,
          blocked_until=CASE WHEN count+1 >= $2 THEN now()+interval '15 minutes' ELSE NULL END,
          updated_at=now() WHERE bucket=$1`,
              [b.key, b.max],
            );
        return { error };
      }
    });
    if ('error' in result) throw result.error;
    return result.value;
  }
}
