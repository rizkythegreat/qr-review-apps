import { Pool, type PoolClient, type PoolConfig } from 'pg';
import type { Config } from './config';
import { databaseCa } from './database-tls';

export type Db = Pool | PoolClient;
export function createPool(config: Config, overrides: PoolConfig = {}) {
  return new Pool({
    connectionString: config.DATABASE_URL,
    max: config.DATABASE_POOL_SIZE,
    ssl:
      config.DATABASE_SSL === 'true'
        ? {
            rejectUnauthorized: true,
            ca: databaseCa(config.DATABASE_SSL_CA),
          }
        : false,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 10000,
    statement_timeout: 10000,
    application_name: 'qr-review-api',
    ...overrides,
  });
}
export async function transaction<T>(pool: Pool, work: (db: PoolClient) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const result = await work(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    db.release();
  }
}
