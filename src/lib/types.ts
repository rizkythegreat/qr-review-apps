export type QrStatus = 'UNACTIVATED' | 'ACTIVE' | 'SUSPENDED' | 'RETIRED';
export type StockStatus = 'GENERATED' | 'AVAILABLE' | 'SOLD' | 'DAMAGED';
export interface OwnerQr {
  id: string;
  token: string;
  status: QrStatus;
  store_name: string | null;
  review_url: string | null;
  version: number;
  ownership_id: string | null;
  activated_at: string | null;
  updated_at: string;
}
export interface AdminQr extends OwnerQr {
  batch_id: string;
  public_url: string;
  stock_status: StockStatus;
  created_at: string;
}
export interface Batch {
  id: string;
  label: string;
  quantity: number;
  created_at: string;
  activation_codes_expires_at: string;
}
export interface Dashboard {
  total_units: number;
  qr_counts: Record<QrStatus, number>;
  stock_counts: Record<StockStatus, number>;
  as_of: string;
}
export interface ExportJob {
  id: string;
  batch_id: string;
  kind: 'PUBLIC_QR' | 'ACTIVATION_CODES';
  status: 'QUEUED' | 'RUNNING' | 'READY' | 'FAILED' | 'EXPIRED';
  created_at: string;
  expires_at: string | null;
  download_path: string | null;
  failure_code: string | null;
}
export interface OwnerSession {
  qr: OwnerQr;
  expires_at: string;
  csrf_token: string;
  read_only: boolean;
}
export interface OwnerStats {
  ownership_id: string;
  total_visits: number;
  last_visited_at: string | null;
  as_of: string;
  metric: 'QR_VISITS';
  counts_submitted_reviews: false;
}
export interface PublicQr {
  token: string;
  status: QrStatus;
  activation_allowed: boolean;
  manage_path: string;
  supported_review_link_policy: 'GOOGLE_REVIEW_V1';
}
export interface ActivationResult {
  token: string;
  status: 'ACTIVE';
  store_name: string;
  manage_url: string;
  activated_at: string;
}
export interface Sale {
  id: string;
  qr_id: string;
  reference: string;
  sold_at: string;
  buyer_name: string | null;
  support_contact: string | null;
  created_at: string;
}
export interface SupportGrant {
  id: string;
  qr_id: string;
  kind: 'PIN_RESET' | 'OWNERSHIP_TRANSFER';
  expires_at: string;
  claim_url: string;
  qr_version: number;
}
export interface ClaimResult {
  token: string;
  status: QrStatus;
  manage_url: string;
  completed_at: string;
}
export interface AuditEvent {
  id: string;
  qr_id: string;
  action: string;
  actor_type: 'ADMIN' | 'OWNER' | 'SYSTEM';
  actor_id: string | null;
  created_at: string;
  reason: string | null;
  changes: Record<string, unknown>;
}
export interface ActivityEvent extends AuditEvent {
  qr_token: string;
  store_name: string | null;
}
export interface ApiResponse<T> {
  data: T;
  request_id: string;
  pagination?: { limit: number; next_cursor: string | null };
  etag: string | null;
}
