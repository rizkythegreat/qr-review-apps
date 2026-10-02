import { describe, expect, it } from 'vitest';
import { formatMigrationError } from '../scripts/migrate';

describe('migration error diagnostics', () => {
  it.each([
    ['SELF_SIGNED_CERT_IN_CHAIN', 'DATABASE_SSL_CA'],
    ['28P01', 'authentication was rejected'],
    ['ENOTFOUND', 'hostname could not be resolved'],
    ['ENETUNREACH', 'session pooler'],
    ['42501', 'MIGRATION_DATABASE_URL'],
  ])('explains %s without exposing the original error message', (code, guidance) => {
    const error = Object.assign(new Error('postgresql://admin:private-password@private-host/db'), {
      code,
    });
    const message = formatMigrationError(error);
    expect(message).toContain(guidance);
    expect(message).not.toContain('private-password');
    expect(message).not.toContain('private-host');
  });

  it('finds actionable connection failures in causes and aggregate errors', () => {
    const failure = Object.assign(new Error('private connection details'), { code: 'ETIMEDOUT' });
    expect(formatMigrationError(new Error('wrapper', { cause: failure }))).toContain(
      'server could not be reached',
    );
    expect(
      formatMigrationError(new AggregateError([failure], 'private connection details')),
    ).toContain('server could not be reached');
  });

  it('distinguishes changed migrations without printing filenames or SQL', () => {
    const message = formatMigrationError(
      new Error('Migration checksum changed: private-details.sql'),
    );
    expect(message).toContain('an applied migration has changed');
    expect(message).not.toContain('private-details');
  });

  it('keeps unexpected errors private', () => {
    for (const error of [new Error('password=private-password'), 'private-password', null]) {
      expect(formatMigrationError(error)).toBe(
        'Migration failed. Check database access and migration checksum.',
      );
    }
  });
});
