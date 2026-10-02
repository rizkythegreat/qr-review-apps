import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { databaseCa } from '../src/server/database-tls';

export async function migrate(pool: Pool) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended('qr-review-migrations',0))");
    await db.query('CREATE SCHEMA IF NOT EXISTS qr_review');
    await db.query('REVOKE ALL ON SCHEMA qr_review FROM PUBLIC');
    await db.query(
      `CREATE TABLE IF NOT EXISTS qr_review.schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())`,
    );
    const dir = resolve('supabase/migrations');
    for (const name of (await readdir(dir)).filter((n) => n.endsWith('.sql')).sort()) {
      const sql = await readFile(resolve(dir, name), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const row = (
        await db.query('SELECT checksum FROM qr_review.schema_migrations WHERE name=$1', [name])
      ).rows[0];
      if (row) {
        if (row.checksum !== checksum) throw new Error(`Migration checksum changed: ${name}`);
        continue;
      }
      await db.query(sql);
      await db.query('INSERT INTO qr_review.schema_migrations(name,checksum) VALUES($1,$2)', [
        name,
        checksum,
      ]);
    }
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    db.release();
  }
}
export function migrationPool() {
  const connectionString = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL or MIGRATION_DATABASE_URL required');
  return new Pool({
    connectionString,
    connectionTimeoutMillis: 10000,
    ssl:
      process.env.DATABASE_SSL === 'false'
        ? false
        : {
            rejectUnauthorized: true,
            ca: databaseCa(process.env.DATABASE_SSL_CA),
          },
  });
}
export function formatMigrationError(error: unknown): string {
  const errors = error instanceof AggregateError ? error.errors : [error];
  for (const failure of errors) {
    if (!(failure instanceof Error)) continue;
    const code = (failure as Error & { code?: string }).code;
    switch (code) {
      case 'SELF_SIGNED_CERT_IN_CHAIN':
      case 'DEPTH_ZERO_SELF_SIGNED_CERT':
      case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
      case 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY':
        return 'Migration failed: database SSL certificate is not trusted. Set DATABASE_SSL_CA to the CA certificate downloaded from Supabase Database settings.';
      case 'CERT_HAS_EXPIRED':
        return 'Migration failed: database SSL certificate has expired. Check the system clock and download the current CA from Supabase Database settings.';
      case 'ERR_TLS_CERT_ALTNAME_INVALID':
        return 'Migration failed: database hostname does not match its SSL certificate. Copy the hostname from the Supabase Connect dialog.';
      case '28P01':
      case '28000':
        return 'Migration failed: database authentication was rejected. Check the database username and password in DATABASE_URL or MIGRATION_DATABASE_URL; encode special characters in the password.';
      case 'ENOTFOUND':
      case 'EAI_AGAIN':
        return 'Migration failed: database hostname could not be resolved. Check the connection string and network DNS.';
      case 'ECONNREFUSED':
      case 'ECONNRESET':
      case 'ETIMEDOUT':
      case 'ENETUNREACH':
      case 'EHOSTUNREACH':
        return 'Migration failed: database server could not be reached. Check the hostname, port, network restrictions, and project status; use the session pooler for IPv4 networks.';
      case '42501':
        return 'Migration failed: database role lacks migration permissions. Set MIGRATION_DATABASE_URL to a connection with schema ownership permissions.';
      case '3D000':
        return 'Migration failed: the configured database does not exist. Check the database name in the connection string.';
    }
    if (failure.message.startsWith('Migration checksum changed:'))
      return 'Migration failed: an applied migration has changed. Restore its original SQL and put subsequent changes in a new migration.';
    if (failure.message.includes('Tenant or user not found'))
      return 'Migration failed: the pooler could not find the project or database user. Copy the session pooler connection string from Supabase Connect.';
    if (/connection timeout|timeout exceeded when trying to connect/i.test(failure.message))
      return 'Migration failed: database connection timed out. Check network restrictions and project status.';
    if (failure.cause instanceof Error) {
      const causeMessage = formatMigrationError(failure.cause);
      if (causeMessage !== 'Migration failed. Check database access and migration checksum.')
        return causeMessage;
    }
  }
  return 'Migration failed. Check database access and migration checksum.';
}
async function main() {
  const pool = migrationPool();
  try {
    await migrate(pool);
    console.log('Database migrations applied.');
  } finally {
    await pool.end();
  }
}
if (process.argv[1]?.endsWith('/migrate.ts'))
  main().catch((error: unknown) => {
    console.error(formatMigrationError(error));
    process.exitCode = 1;
  });
