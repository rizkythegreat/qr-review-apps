-- RESET SELURUH DATA OPERASIONAL QR REVIEW.
-- Jalankan manual di Supabase SQL Editor sebagai pemilik schema (misalnya postgres).
-- Batch, QR, penjualan, kepemilikan, kunjungan, riwayat, sesi pemilik,
-- tautan dukungan, ekspor, idempotency, dan rate limit akan dikosongkan.
-- Setelah COMMIT, QR/link yang lama tidak berlaku lagi. Simpan backup bila diperlukan.
-- Akun Supabase Auth, allowlist admin, ledger migrasi, tabel, indeks, RLS,
-- constraint, dan trigger tetap dipertahankan.
-- Jalankan saat aplikasi/worker tidak sedang dipakai untuk membuat data baru.
-- File ini sengaja berada di luar supabase/migrations: bukan migrasi deployment.

BEGIN;

-- Batalkan jika tabel masih dipakai transaksi lain terlalu lama.
SET LOCAL lock_timeout = '5s';

-- Satu TRUNCATE mencakup seluruh relasi, termasuk FK kepemilikan yang melingkar.
-- RESTRICT mencegah ikut mengosongkan tabel lain yang tidak tercantum.
-- TRUNCATE tidak menjalankan trigger DELETE immutable_qr; trigger tetap aktif.
TRUNCATE TABLE
  qr_review.scan_events,
  qr_review.audit_events,
  qr_review.owner_sessions,
  qr_review.support_grants,
  qr_review.sales_records,
  qr_review.idempotency_records,
  qr_review.export_jobs,
  qr_review.qr_codes,
  qr_review.ownership_periods,
  qr_review.qr_batches,
  qr_review.rate_limits
CONTINUE IDENTITY RESTRICT;

COMMIT;

-- Ketiga hitungan ini harus 0 setelah reset, sebelum ada aktivitas baru.
SELECT
  (SELECT count(*) FROM qr_review.qr_batches) AS total_batches,
  (SELECT count(*) FROM qr_review.qr_codes) AS total_qr,
  (SELECT count(*) FROM qr_review.audit_events) AS total_activity;
