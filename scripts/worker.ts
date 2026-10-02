import { readConfig } from '../src/server/config';
import { createPool } from '../src/server/db';
import { processOneExport } from '../src/server/exports';

async function main() {
  const config = readConfig(),
    pool = createPool(config);
  let running = true;
  process.on('SIGTERM', () => {
    running = false;
  });
  process.on('SIGINT', () => {
    running = false;
  });
  try {
    do {
      const processed = await processOneExport(pool, config);
      if (process.argv.includes('--once')) break;
      if (!processed) await new Promise((resolve) => setTimeout(resolve, 2000));
    } while (running);
  } finally {
    await pool.end();
  }
}
main().catch(() => {
  console.error('Export worker stopped. Check server configuration and database connectivity.');
  process.exitCode = 1;
});
