import { describe, it, expect } from 'vitest';
import { normalizeReviewUrl, parseBody } from '../src/server/validation';
import { activationCode, decrypt, encrypt, hashPin, opaque, verifyPin } from '../src/server/crypto';
import { readConfig } from '../src/server/config';
import { shouldCount } from '../src/server/statistics';

const config = readConfig({
  PUBLIC_ORIGIN: 'https://qr.test',
  DATABASE_URL: 'postgresql://unused',
  DATABASE_SSL: 'false',
  PIN_PEPPER: Buffer.alloc(32, 1).toString('base64'),
  HMAC_KEY: Buffer.alloc(32, 2).toString('base64'),
  ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
  TEST_TRAFFIC_SECRET: 'deployment-secret',
});
describe('GOOGLE_REVIEW_V1', () => {
  it.each([
    ['HTTPS://G.PAGE:443/r/Case_Sensitive-1/review', 'https://g.page/r/Case_Sensitive-1/review'],
    [
      'https://search.google.com/local/writereview?placeid=ChIJ_abc-123',
      'https://search.google.com/local/writereview?placeid=ChIJ_abc-123',
    ],
  ])('normalizes supported URL %s', (input, output) =>
    expect(normalizeReviewUrl(input)).toBe(output),
  );
  it.each([
    'http://g.page/r/code/review',
    'https://g.page.evil.com/r/code/review',
    'https://g.page./r/code/review',
    'https://user@g.page/r/code/review',
    'https://g.page:444/r/code/review',
    'https://g.page/r/code/review#',
    'https://g.page/r/code/review?',
    'https://g.page/r/code/review?x=1',
    'https://g.page/r/%63ode/review',
    'https://g.page/r/code%2Freview',
    'https://g.page/x/../r/code/review',
    'https://g.page\\r\\code\\review',
    'https://maps.app.goo.gl/code',
    'https://goo.gl/maps/code',
    'https://www.google.com/maps/place/code',
    'https://search.google.com/local/writereview?placeid=a&placeid=b',
    'https://search.google.com/local/writereview?placeid=a&x=b',
    'https://search.google.com/local/writereview?placeid=a%2fb',
    ' https://g.page/r/code/review',
    'https://g.page/r/code/review\n',
    'https://127.0.0.1/r/code/review',
    'https://g.page/r/😀/review',
  ])('rejects unsupported or ambiguous URL %s', (input) =>
    expect(() => normalizeReviewUrl(input)).toThrow(),
  );
});
describe('credentials and body validation', () => {
  it('rejects unknown fields, nulls and numeric PINs; preserves leading zero', () => {
    expect(() => parseBody('createOwnerSession', { token: opaque(16), pin: 1234 })).toThrow();
    expect(() => parseBody('createBatch', { label: null, quantity: 1 })).toThrow();
    expect(() => parseBody('updateOwnerQr', { store_name: 'Store', token: opaque(16) })).toThrow();
    expect(() => parseBody('updateOwnerQr', {})).toThrow();
    expect(parseBody('createOwnerSession', { token: opaque(16), pin: '0042' }).pin).toBe('0042');
    expect(parseBody('createBatch', { label: '  Batch  ', quantity: 500 }).label).toBe('Batch');
    expect(() => parseBody('createBatch', { label: 'Batch', quantity: 501 })).toThrow();
    expect(parseBody('createBatch', { label: '😀'.repeat(120), quantity: 1 }).label).toBe(
      '😀'.repeat(120),
    );
    expect(() => parseBody('createBatch', { label: '😀'.repeat(121), quantity: 1 })).toThrow();
  });
  it('requires matching PIN confirmation', () => {
    expect(() =>
      parseBody('claimPinReset', {
        grant_token: opaque(),
        new_pin: '0042',
        new_pin_confirmation: '0043',
      }),
    ).toThrow(expect.objectContaining({ code: 'PIN_CONFIRMATION_MISMATCH' }));
  });
  it('rejects image options on secret exports and future sales', () => {
    expect(() => parseBody('createExport', { kind: 'ACTIVATION_CODES', size_px: 1024 })).toThrow();
    expect(() =>
      parseBody('recordSale', {
        reference: 'Sale',
        sold_at: new Date(Date.now() + 100000).toISOString(),
      }),
    ).toThrow();
  });
  it('generates independent printable credentials', () => {
    for (let i = 0; i < 100; i++) {
      expect(activationCode()).toMatch(/^[A-Z2-7]{16}$/);
      expect(opaque(16)).toMatch(/^[A-Za-z0-9_-]{22}$/);
    }
  });
  it('salts and peppers PIN hashes and checks exact string', async () => {
    const one = await hashPin(config, '0042'),
      two = await hashPin(config, '0042');
    expect(one).not.toBe(two);
    expect(one).not.toContain('0042');
    expect(await verifyPin(config, '0042', one)).toBe(true);
    expect(await verifyPin(config, '0043', one)).toBe(false);
    expect(
      await verifyPin(
        { ...config, PIN_PEPPER: Buffer.alloc(32, 4).toString('base64') },
        '0042',
        one,
      ),
    ).toBe(false);
    expect(await verifyPin(config, '0042', null)).toBe(false);
  });
  it('authenticates encrypted data and purpose', () => {
    const encrypted = encrypt(config, { secret: 'do-not-store-plaintext' }, 'batch:test');
    expect(encrypted.toString()).not.toContain('do-not-store-plaintext');
    expect(decrypt(config, encrypted, 'batch:test')).toEqual({ secret: 'do-not-store-plaintext' });
    expect(() => decrypt(config, encrypted, 'batch:other')).toThrow();
  });
  it('excludes HEAD, known bots and authenticated deployment traffic; public test query still counts', () => {
    expect(shouldCount(new Request('https://qr.test/r/token?test=true'), config)).toBe(true);
    expect(shouldCount(new Request('https://qr.test/r/token', { method: 'HEAD' }), config)).toBe(
      false,
    );
    expect(
      shouldCount(
        new Request('https://qr.test/r/token', { headers: { 'User-Agent': 'Googlebot' } }),
        config,
      ),
    ).toBe(false);
    expect(
      shouldCount(
        new Request('https://qr.test/r/token', {
          headers: { 'x-deployment-test': 'deployment-secret' },
        }),
        config,
      ),
    ).toBe(false);
    expect(
      shouldCount(
        new Request('https://qr.test/r/token', { headers: { 'x-deployment-test': 'fake' } }),
        config,
      ),
    ).toBe(true);
  });
});
