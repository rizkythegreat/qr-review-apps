import { Application } from './application';
import { ConfigurationError, readConfig } from './config';
import { createPool } from './db';
import { errorResponse, fallback } from './http';
import { logFailure, unavailable } from './errors';
import { randomUUID } from 'node:crypto';
import { recordVisit } from './statistics';

let application: Application | undefined;
export function getApplication() {
  if (!application) {
    const config = readConfig();
    const statisticsPool = createPool(config, {
      max: 2,
      connectionTimeoutMillis: config.STATISTICS_TIMEOUT_MS,
      statement_timeout: config.STATISTICS_TIMEOUT_MS,
      application_name: 'qr-review-statistics',
    });
    application = new Application({
      config,
      pool: createPool(config),
      recordVisit: (visit) => recordVisit(statisticsPool, visit, config.STATISTICS_TIMEOUT_MS),
    });
  }
  return application;
}
export async function handleApi(request: Request, scheduleExport?: (id: string) => void) {
  try {
    return await getApplication().handle(request, scheduleExport);
  } catch (error) {
    const id = randomUUID();
    logFailure(
      'configuration_unavailable',
      id,
      error instanceof ConfigurationError ? error.fields : undefined,
    );
    return errorResponse(unavailable(), id);
  }
}
export async function handleResolver(request: Request, token: string) {
  try {
    return await getApplication().resolve(request, token);
  } catch (error) {
    const id = randomUUID();
    logFailure(
      'configuration_unavailable',
      id,
      error instanceof ConfigurationError ? error.fields : undefined,
    );
    return fallback(
      503,
      'Layanan sementara tidak tersedia. Coba lagi.',
      id,
      request.method === 'HEAD',
      5,
    );
  }
}
