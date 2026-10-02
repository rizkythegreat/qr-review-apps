import type { Config } from './config';
import { X509Certificate } from 'node:crypto';

export class ApiError extends Error {
  preserveIdempotency = false;
  constructor(
    public status: number,
    public code: string,
    message = 'Permintaan tidak dapat diproses.',
    public details?: { field: string; code: string; message: string }[],
    public retryAfter?: number,
  ) {
    super(message);
  }
}
export function missing(): never {
  throw new ApiError(404, 'RESOURCE_NOT_FOUND', 'Data tidak ditemukan.');
}
export function conflict(code = 'STATE_CONFLICT'): never {
  throw new ApiError(409, code, 'Status unit tidak mengizinkan tindakan ini.');
}
export function unavailable(): ApiError {
  return new ApiError(
    503,
    'SERVICE_UNAVAILABLE',
    'Layanan sementara tidak tersedia. Coba lagi.',
    undefined,
    5,
  );
}

const safeFailureCodes = new Set([
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'ERR_OSSL_PEM_NO_START_LINE',
  'ERR_SSL_PEM_NO_START_LINE',
  'ERR_INVALID_URL',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENETUNREACH',
  'EHOSTUNREACH',
  '28000',
  '28P01',
  '3D000',
  '3F000',
  '42501',
  '42P01',
  '53300',
  '57014',
  '57P03',
]);

export function failureCode(error: unknown): string {
  const seen = new Set<Error>();
  function inspect(failure: unknown, depth: number): string | undefined {
    if (!(failure instanceof Error) || depth > 5 || seen.has(failure)) return;
    seen.add(failure);
    const code = (failure as Error & { code?: unknown }).code;
    if (typeof code === 'string' && safeFailureCodes.has(code)) return code;
    const causeCode = inspect(failure.cause, depth + 1);
    if (causeCode) return causeCode;
    if (failure instanceof AggregateError) {
      for (const nested of failure.errors.slice(0, 8)) {
        const nestedCode = inspect(nested, depth + 1);
        if (nestedCode) return nestedCode;
      }
    }
    if (failure.message.includes('Tenant or user not found'))
      return 'DATABASE_POOLER_USER_NOT_FOUND';
    if (/connection timeout|timeout exceeded when trying to connect/i.test(failure.message))
      return 'DATABASE_CONNECTION_TIMEOUT';
  }
  return inspect(error, 0) || 'UNKNOWN_FAILURE';
}

export function logFailure(
  event: string,
  requestId?: string,
  invalidFields?: readonly (keyof Config)[],
  error?: unknown,
  config?: Config,
) {
  // Never log request bodies, URLs with fragments, SQL parameters, cookies, or raw exception objects.
  console.error(
    JSON.stringify({
      event,
      request_id: requestId,
      time: new Date().toISOString(),
      ...(invalidFields ? { invalid_fields: invalidFields } : {}),
      ...(error === undefined ? {} : { error_code: failureCode(error) }),
      ...(config && error !== undefined && failureCode(error) === 'SELF_SIGNED_CERT_IN_CHAIN'
        ? { database_tls: databaseTlsDiagnostics(config) }
        : {}),
    }),
  );
}

export function databaseTlsDiagnostics(config: Config) {
  const ca = config.DATABASE_SSL_CA?.replace(/\\n/g, '\n').trim();
  const blocks = ca?.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) || [];
  const fingerprints: string[] = [];
  let valid = blocks.length > 0;
  for (const block of blocks) {
    try {
      fingerprints.push(new X509Certificate(block).fingerprint256);
    } catch {
      valid = false;
    }
  }
  let urlOverridesSsl = false;
  try {
    const url = new URL(config.DATABASE_URL);
    urlOverridesSsl = ['sslmode', 'sslcert', 'sslkey', 'sslrootcert'].some((key) =>
      url.searchParams.has(key),
    );
  } catch {
    // Never print a malformed connection string.
  }
  return {
    enabled: config.DATABASE_SSL === 'true',
    ca_present: Boolean(ca),
    ca_valid: valid,
    ca_fingerprints_sha256: fingerprints,
    url_overrides_ssl: urlOverridesSsl,
  };
}
