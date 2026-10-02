import { isIP } from 'node:net';
import type { Config } from './config';
import { ApiError } from './errors';
import { hmac } from './crypto';
import type { Result } from './idempotency';

export async function readJson(request: Request) {
  const length = request.headers.get('content-length');
  if (length && /^\d+$/.test(length) && Number(length) > 16384)
    throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Body maksimal 16 KiB.');
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || ''))
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Gunakan application/json.');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'MALFORMED_JSON', 'JSON tidak valid.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 16384) {
      await reader.cancel();
      throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Body maksimal 16 KiB.');
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch {
    throw new ApiError(400, 'MALFORMED_JSON', 'JSON tidak valid.');
  }
}
export function source(config: Config, request: Request) {
  const header = config.TRUSTED_IP_HEADER ? request.headers.get(config.TRUSTED_IP_HEADER) : null;
  // A trusted proxy must overwrite the header. Multiple addresses/invalid values fail into a shared bucket.
  return hmac(config, 'source', header && isIP(header.trim()) ? header.trim() : 'unknown');
}
export function headers(requestId: string, resolver = false) {
  return {
    'Cache-Control': resolver ? 'no-store, max-age=0' : 'no-store',
    'X-Request-Id': requestId,
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Strict-Transport-Security': 'max-age=31536000',
  };
}
export function respond(result: Result, requestId: string) {
  const common = { ...headers(requestId), ...result.headers };
  if (result.status === 204) return new Response(null, { status: 204, headers: common });
  if (result.body !== undefined)
    return new Response(
      Buffer.isBuffer(result.body) ? new Uint8Array(result.body) : (result.body as string | null),
      { status: result.status || 200, headers: common },
    );
  return Response.json(
    {
      data: result.data,
      ...(result.pagination ? { pagination: result.pagination } : {}),
      request_id: requestId,
    },
    { status: result.status || 200, headers: common },
  );
}
export function errorResponse(error: ApiError, requestId: string) {
  return Response.json(
    {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
      request_id: requestId,
    },
    {
      status: error.status,
      headers: {
        ...headers(requestId),
        ...(error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {}),
      },
    },
  );
}
export function fallback(
  status: number,
  message: string,
  requestId: string,
  head = false,
  retryAfter?: number,
) {
  const safeMessage = message.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );
  const body = `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QR Review</title><meta name="robots" content="noindex,nofollow"><style>*{box-sizing:border-box}body{margin:0;background:#f8f9f6;color:#192720;font:16px/1.6 system-ui,sans-serif}header,footer{padding:24px;max-width:1000px;margin:auto}header a{font-weight:700;text-decoration:none;color:inherit}main{max-width:520px;margin:clamp(24px,9vh,100px) auto;padding:0 20px}.card{background:white;border:1px solid #e1e5df;border-radius:16px;padding:32px;box-shadow:0 2px 5px #19272005}.icon{display:grid;place-items:center;width:48px;height:48px;border-radius:12px;background:#eef2eb;font-size:24px}h1{font-size:26px;line-height:1.3;letter-spacing:-.5px;margin-top:24px}p{color:#5a665e}nav{display:flex;flex-wrap:wrap;gap:12px;margin-top:28px}button,a.button{border:1px solid #d9dfd7;border-radius:8px;padding:10px 16px;font:inherit;text-decoration:none;cursor:pointer;color:#192720;background:white}button{background:#192720;color:white;border-color:#192720}footer{font-size:12px;color:#677169;text-align:center}</style></head><body><header><a href="/">▦ &nbsp;QR Review</a></header><main><section class="card"><span class="icon" aria-hidden="true">▦</span><h1>${status === 404 ? 'QR tidak ditemukan' : status === 410 ? 'Unit sudah dinonaktifkan' : status === 429 ? 'Tunggu sebentar' : status === 503 ? 'Layanan belum tersedia' : 'Informasi QR'}</h1><p>${safeMessage}</p><nav>${retryAfter ? '<button type="button" onclick="location.reload()">Coba lagi</button>' : ''}<a class="button" href="/help">Buka bantuan</a>${status === 200 ? '<a class="button" href="/manage">Kelola QR toko</a>' : ''}</nav></section></main><footer>Simpan kode aktivasi dan PIN Anda dengan aman.</footer></body></html>`;
  return new Response(head ? null : body, {
    status,
    headers: {
      ...headers(requestId, true),
      'Content-Type': 'text/html; charset=utf-8',
      ...(retryAfter ? { 'Retry-After': String(retryAfter) } : {}),
    },
  });
}
