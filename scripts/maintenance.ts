import { readConfig } from '../src/server/config';
import { createPool } from '../src/server/db';
import { maintenance } from '../src/server/maintenance';

async function main() {
  const pool = createPool(readConfig());
  try {
    console.log(JSON.stringify(await maintenance(pool)));
  } finally {
    await pool.end();
  }
}
main().catch(() => {
  console.error('Maintenance failed. Check server configuration and database connectivity.');
  process.exitCode = 1;
});
