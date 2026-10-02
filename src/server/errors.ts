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
export function logFailure(
  event: string,
  requestId?: string,
  invalidFields?: readonly (keyof Config)[],
) {
  // Never log request bodies, URLs with fragments, SQL parameters, cookies, or raw exception objects.
  console.error(
    JSON.stringify({
      event,
      request_id: requestId,
      time: new Date().toISOString(),
      ...(invalidFields ? { invalid_fields: invalidFields } : {}),
    }),
  );
}
import type { Config } from './config';
