import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { transaction } from './db';
import type { Config } from './config';
import { equal } from './crypto';

export interface Visit {
  qr_id: string;
  ownership_id: string;
  visited_at: Date;
}
export function shouldCount(request: Request, config: Config) {
  if (request.method !== 'GET') return false;
  if (
    /bot\b|crawler|spider|slurp|facebookexternalhit|preview|headless/i.test(
      request.headers.get('user-agent') || '',
    )
  )
    return false;
  if (
    config.TEST_TRAFFIC_SECRET &&
    equal(request.headers.get('x-deployment-test') || '', config.TEST_TRAFFIC_SECRET)
  )
    return false;
  return true;
}
export async function recordVisit(pool: Pool, visit: Visit, timeoutMs: number) {
  await transaction(pool, async (db) => {
    await db.query("SELECT set_config('statement_timeout',$1,true)", [`${timeoutMs}ms`]);
    await db.query(
      `WITH inserted AS (
      INSERT INTO qr_review.scan_events(id,qr_id,ownership_id,visited_at) VALUES($1,$2,$3,$4) RETURNING ownership_id,visited_at
    ) UPDATE qr_review.ownership_periods SET total_visits=total_visits+1,
      last_visited_at=GREATEST(last_visited_at,inserted.visited_at) FROM inserted WHERE id=inserted.ownership_id`,
      [randomUUID(), visit.qr_id, visit.ownership_id, visit.visited_at],
    );
  });
}
