import type { Pool } from 'pg';
import { transaction } from './db';

export async function maintenance(pool: Pool) {
  return transaction(pool, async (db) => {
    const expiredSnapshots =
      await db.query(`UPDATE qr_review.qr_batches SET activation_snapshot=NULL,snapshot_valid=false
      WHERE activation_codes_expires_at<=now() AND activation_snapshot IS NOT NULL`);
    const exports = await db.query(`UPDATE qr_review.export_jobs SET status='EXPIRED',artifact=NULL
      WHERE expires_at<=now() AND status<>'EXPIRED'`);
    const responses = await db.query(
      'UPDATE qr_review.idempotency_records SET response=NULL WHERE response_expires_at<=now() AND response IS NOT NULL',
    );
    await db.query('DELETE FROM qr_review.idempotency_records WHERE expires_at<=now()');
    await db.query(
      'DELETE FROM qr_review.owner_sessions WHERE expires_at<=now() OR revoked_at IS NOT NULL',
    );
    await db.query(
      "DELETE FROM qr_review.support_grants WHERE expires_at<now()-interval '24 hours'",
    );
    await db.query(
      "DELETE FROM qr_review.rate_limits WHERE updated_at<now()-interval '1 hour' AND (blocked_until IS NULL OR blocked_until<=now())",
    );
    const scans = await db.query(
      "DELETE FROM qr_review.scan_events WHERE visited_at<now()-interval '90 days'",
    );
    return {
      expired_snapshots: expiredSnapshots.rowCount,
      expired_exports: exports.rowCount,
      expired_responses: responses.rowCount,
      deleted_raw_visits: scans.rowCount,
    };
  });
}
