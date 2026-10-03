import { after } from 'next/server';
import { getApplication, handleApi } from '@/server/runtime';
import { processOneExport } from '@/server/exports';
import { logFailure } from '@/server/errors';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function handle(request: Request) {
  return handleApi(request, (jobId) => {
    after(async () => {
      try {
        const app = getApplication();
        await processOneExport(app.pool, app.config, {
          jobId,
          maxDurationMs: 240_000,
          maxArtifactBytes: 4_000_000,
        });
      } catch (error) {
        logFailure('export_background_failed', undefined, undefined, error);
      }
    });
  });
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
