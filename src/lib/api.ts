import type { ApiResponse } from './types';

export class ApiFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 0,
    readonly details: { field: string; message: string }[] = [],
    readonly retryAfter = 0,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiFailure';
  }
}
export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
  bearer?: string;
  etag?: string | null;
  csrf?: string;
  key?: string;
  signal?: AbortSignal;
}
async function apiFetch(path: string, options: ApiOptions) {
  const headers = new Headers({ Accept: 'application/json' });
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  if (options.bearer) headers.set('Authorization', `Bearer ${options.bearer}`);
  if (options.etag) headers.set('X-QR-If-Match', options.etag);
  if (options.csrf) headers.set('X-CSRF-Token', options.csrf);
  if (options.key) headers.set('Idempotency-Key', options.key);
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method || 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'same-origin',
      cache: 'no-store',
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(20000)])
        : AbortSignal.timeout(20000),
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiFailure(
      'NETWORK_ERROR',
      'Koneksi terputus atau terlalu lama. Periksa koneksi dan coba lagi.',
    );
  }
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new ApiFailure(
      result?.error?.code || 'SERVICE_UNAVAILABLE',
      result?.error?.message || 'Layanan sementara tidak tersedia. Coba lagi.',
      response.status,
      result?.error?.details || [],
      Number(response.headers.get('Retry-After')) || 0,
      result?.request_id,
    );
  }
  return response;
}
export async function apiRequest<T>(
  path: string,
  options: ApiOptions = {},
): Promise<ApiResponse<T>> {
  const response = await apiFetch(path, options);
  if (response.status === 204)
    return { data: null as T, request_id: response.headers.get('X-Request-Id') || '', etag: null };
  const result = await response.json();
  // QR versions are concurrency tokens. A proxy can change the representation ETag,
  // so use the version returned in the same payload for subsequent If-Match requests.
  const version = result.data?.version ?? result.data?.qr?.version;
  const etag =
    Number.isSafeInteger(version) && version > 0 ? `"v${version}"` : response.headers.get('ETag');
  return { ...result, etag };
}
export async function apiBlob(path: string, options: ApiOptions = {}) {
  return (await apiFetch(path, options)).blob();
}
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const errorMessages: Record<string, string> = {
  INVALID_CREDENTIALS: 'Token atau PIN tidak sesuai. Periksa kembali keduanya.',
  INVALID_ACTIVATION_CODE: 'Kode aktivasi tidak sesuai. Periksa kode pada kartu rahasia.',
  SESSION_EXPIRED: 'Sesi berakhir. Masuk kembali dengan token dan PIN.',
  UNAUTHENTICATED: 'Silakan masuk kembali untuk melanjutkan.',
  FORBIDDEN: 'Akun ini belum memiliki akses admin. Hubungi pengelola aplikasi.',
  VERSION_MISMATCH: 'Data berubah sejak halaman dibuka. Muat ulang data sebelum menyimpan kembali.',
  QR_STATE_CHANGED: 'Status QR sudah berubah. Muat ulang untuk melihat kondisi terbaru.',
  QR_NOT_SOLD: 'QR ini belum tercatat terjual. Hubungi penjual untuk melanjutkan aktivasi.',
  QR_ALREADY_ACTIVE: 'QR sudah aktif. Gunakan token dan PIN untuk membuka halaman kelola.',
  QR_SUSPENDED: 'QR sedang ditangguhkan. Hubungi penjual atau admin untuk bantuan.',
  QR_RETIRED: 'Unit QR ini sudah tidak digunakan.',
  GRANT_INVALID_OR_EXPIRED:
    'Tautan tidak valid, sudah digunakan, atau kedaluwarsa. Minta tautan baru dari admin.',
  ACTIVATION_CODE_UNAVAILABLE:
    'Salinan kode tidak lagi tersedia. Gunakan kode yang telah diunduh atau rotasi kode melalui tab Dukungan untuk unit yang belum aktif.',
  ACTIVATION_EXPORT_UNAVAILABLE:
    'Kode batch tidak lagi tersedia. Rotasi kode pada unit yang belum aktif bila diperlukan.',
  EXPORT_EXPIRED:
    'Ekspor sudah kedaluwarsa atau tidak berlaku. Buat ekspor baru bila masih tersedia.',
  EXPORT_NOT_READY: 'Ekspor sedang disiapkan. Tunggu hingga statusnya siap.',
  SECRET_REPLAY_EXPIRED:
    'Hasil rahasia sudah kedaluwarsa. Periksa kondisi QR sebelum membuat tindakan baru.',
  QR_TRANSITION_INVALID: 'Tindakan ini tidak tersedia pada status QR sekarang. Muat ulang data.',
  STOCK_TRANSITION_INVALID: 'Perubahan stok tidak tersedia pada kondisi unit sekarang.',
  UNSUPPORTED_REVIEW_URL:
    'Gunakan link g.page/r/…/review atau search.google.com/local/writereview?placeid=….',
  REQUEST_IN_PROGRESS:
    'Permintaan masih diproses. Tunggu sebentar, lalu coba lagi dengan isian yang sama.',
  RATE_LIMITED: 'Terlalu banyak percobaan. Tunggu sebelum mencoba lagi.',
};
export function failureMessage(error: unknown) {
  return error instanceof ApiFailure
    ? errorMessages[error.code] || error.message
    : 'Terjadi kendala. Silakan coba lagi.';
}
