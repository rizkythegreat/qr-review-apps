import { afterEach, describe, expect, it, vi } from 'vitest';
import { rootCertificates } from 'node:tls';
import { X509Certificate } from 'node:crypto';
import { databaseCa } from '../src/server/database-tls';
import { createPool } from '../src/server/db';
import { readConfig } from '../src/server/config';
import { migrationPool } from '../scripts/migrate';

afterEach(() => vi.unstubAllEnvs());

describe('database CA parsing', () => {
  const certificate = rootCertificates[0];
  const pem = new X509Certificate(certificate).toString();

  it.each([
    certificate,
    certificate.replace(/\n/g, '\\n'),
    certificate.replace(/\n/g, '\r\n'),
    JSON.stringify(certificate),
    "'" + certificate + "'",
  ])('passes canonical PEM to TLS for supported pasted formats %#', (value) => {
    expect(databaseCa(value)).toBe(pem);
  });

  it('preserves every certificate in a CA bundle', () => {
    const second = new X509Certificate(rootCertificates[1]).toString();
    expect(databaseCa(certificate + '\n' + rootCertificates[1])).toBe(pem + '\n' + second);
  });

  it('rejects malformed CA without including its value in the error', () => {
    expect(databaseCa(undefined)).toBeUndefined();
    expect(databaseCa('  ')).toBeUndefined();
    for (const value of [
      'private-details',
      '-----BEGIN CERTIFICATE-----\nprivate-details\n-----END CERTIFICATE-----',
    ]) {
      expect(() => databaseCa(value)).toThrow('Invalid database CA certificate');
      try {
        databaseCa(value);
      } catch (error) {
        expect(String(error)).not.toContain('private-details');
      }
    }
  });

  it('uses canonical CA and verifies the server for both application and migrations', async () => {
    const ca = JSON.stringify(certificate);
    const config = readConfig({
      PUBLIC_ORIGIN: 'https://qr.test',
      DATABASE_URL: 'postgresql://unused/db',
      DATABASE_SSL_CA: ca,
      PIN_PEPPER: Buffer.alloc(32, 1).toString('base64'),
      HMAC_KEY: Buffer.alloc(32, 2).toString('base64'),
      ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
    });
    vi.stubEnv('DATABASE_URL', config.DATABASE_URL);
    vi.stubEnv('MIGRATION_DATABASE_URL', '');
    vi.stubEnv('DATABASE_SSL', 'true');
    vi.stubEnv('DATABASE_SSL_CA', ca);
    for (const pool of [createPool(config), migrationPool()]) {
      try {
        expect(pool.options.ssl).toEqual({ rejectUnauthorized: true, ca: pem });
      } finally {
        await pool.end();
      }
    }
  });
});
