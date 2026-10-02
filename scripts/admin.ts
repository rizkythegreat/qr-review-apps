import { z } from 'zod';
import { migrationPool } from './migrate';

async function main() {
  const id = z.uuid().parse(process.argv[2]);
  const pool = migrationPool();
  try {
    await pool.query(
      'INSERT INTO qr_review.admin_users(user_id) VALUES($1) ON CONFLICT DO NOTHING',
      [id],
    );
    console.log('Admin allowlist updated.');
  } finally {
    await pool.end();
  }
}
main().catch(() => {
  console.error('Usage: npm run admin:add -- <Supabase Auth user UUID>. Migrate database first.');
  process.exitCode = 1;
});
