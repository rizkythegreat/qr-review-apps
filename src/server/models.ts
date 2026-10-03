import type { Config } from './config';

export type QrStatus = 'UNACTIVATED' | 'ACTIVE' | 'SUSPENDED' | 'RETIRED';
export type StockStatus = 'GENERATED' | 'AVAILABLE' | 'SOLD' | 'DAMAGED';
export interface Qr {
  id: string;
  batch_id: string;
  token: string;
  activation_hash: string | null;
  status: QrStatus;
  stock_status: StockStatus;
  store_name: string | null;
  review_url: string | null;
  pin_hash: string | null;
  version: number;
  auth_generation: number;
  ownership_id: string | null;
  activated_at: Date | null;
  created_at: Date;
  updated_at: Date;
}
export function activationAllowed(q: Pick<Qr, 'status' | 'stock_status'>) {
  return q.status === 'UNACTIVATED' && ['GENERATED', 'AVAILABLE', 'SOLD'].includes(q.stock_status);
}
export interface Batch {
  id: string;
  label: string;
  quantity: number;
  created_at: Date;
  activation_codes_expires_at: Date;
  activation_snapshot: Buffer | null;
  snapshot_valid: boolean;
}
export interface Session {
  session_hash: string;
  qr_id: string;
  ownership_id: string;
  auth_generation: number;
  csrf_token: string;
  expires_at: Date;
  revoked_at: Date | null;
}
export interface Grant {
  id: string;
  qr_id: string;
  kind: 'PIN_RESET' | 'OWNERSHIP_TRANSFER';
  token_hash: string;
  auth_generation: number;
  ownership_id: string;
  expires_at: Date;
  consumed_at: Date | null;
  revoked_at: Date | null;
}
export interface ExportJob {
  id: string;
  batch_id: string;
  kind: 'PUBLIC_QR' | 'ACTIVATION_CODES';
  image_format: 'png' | 'svg';
  size_px: number;
  status: 'QUEUED' | 'RUNNING' | 'READY' | 'FAILED' | 'EXPIRED';
  created_at: Date;
  expires_at: Date;
  failure_code: string | null;
  artifact: Buffer | null;
  lease_id: string | null;
}
export function batchView(b: Batch) {
  return {
    id: b.id,
    label: b.label,
    quantity: b.quantity,
    created_at: b.created_at,
    activation_codes_expires_at: b.activation_codes_expires_at,
  };
}
export function ownerView(q: Qr) {
  return {
    id: q.id,
    token: q.token,
    status: q.status,
    store_name: q.store_name,
    review_url: q.review_url,
    version: q.version,
    ownership_id: q.ownership_id,
    activated_at: q.activated_at,
    updated_at: q.updated_at,
  };
}
export function adminView(c: Config, q: Qr) {
  return {
    ...ownerView(q),
    batch_id: q.batch_id,
    public_url: `${c.PUBLIC_ORIGIN}/r/${q.token}`,
    stock_status: q.stock_status,
    created_at: q.created_at,
  };
}
export function exportView(j: ExportJob) {
  return {
    id: j.id,
    batch_id: j.batch_id,
    kind: j.kind,
    status: j.status,
    created_at: j.created_at,
    expires_at: j.expires_at,
    download_path: j.status === 'READY' ? `/api/v1/admin/exports/${j.id}/download` : null,
    failure_code: j.failure_code,
  };
}
export function guardView(q: Qr) {
  return { status: q.status, ownership_id: q.ownership_id, auth_generation: q.auth_generation };
}
