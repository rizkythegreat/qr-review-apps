import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { readConfig } from '../../src/server/config';
import { migrate } from '../../scripts/migrate';
import { Application } from '../../src/server/application';

export async function testDatabase() {
  const base =
    process.env.TEST_DATABASE_URL ||
    `postgresql://${encodeURIComponent(process.env.USER || 'postgres')}@localhost:5432/postgres`;
  const admin = new Pool({ connectionString: base });
  const name = `qr_review_test_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE DATABASE ${name}`);
  const url = new URL(base);
  url.pathname = `/${name}`;
  const pool = new Pool({ connectionString: url.toString(), max: 10, statement_timeout: 10000 });
  try {
    await migrate(pool);
  } catch (error) {
    await pool.end();
    await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
    await admin.end();
    throw error;
  }
  const config = readConfig({
    PUBLIC_ORIGIN: 'https://qr.test',
    DATABASE_URL: url.toString(),
    DATABASE_SSL: 'false',
    PIN_PEPPER: Buffer.alloc(32, 1).toString('base64'),
    HMAC_KEY: Buffer.alloc(32, 2).toString('base64'),
    ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
    TRUSTED_IP_HEADER: 'x-test-ip',
    TEST_TRAFFIC_SECRET: 'secret-test-traffic',
  });
  const adminId = randomUUID();
  const app = new Application({
    pool,
    config,
    verifyAdmin: async (bearer) => {
      if (bearer === 'valid-admin') return adminId;
      return randomUUID();
    },
  });
  return {
    name,
    pool,
    config,
    adminId,
    app,
    admin,
    async reset() {
      await pool.query(`TRUNCATE qr_review.audit_events,qr_review.scan_events,qr_review.owner_sessions,qr_review.support_grants,
        qr_review.idempotency_records,qr_review.export_jobs,qr_review.rate_limits,qr_review.sales_records,
        qr_review.qr_codes,qr_review.ownership_periods,qr_review.qr_batches,qr_review.admin_users CASCADE`);
      await pool.query('INSERT INTO qr_review.admin_users(user_id) VALUES($1)', [adminId]);
    },
    async close() {
      await pool.end();
      await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
      await admin.end();
    },
  };
}
