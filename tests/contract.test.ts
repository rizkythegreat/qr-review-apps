import { readFileSync } from 'node:fs';
import YAML from 'yaml';
import { it, expect } from 'vitest';
import { routes, idempotentOperations, versionOperations } from '../src/server/routes';

const spec = YAML.parse(readFileSync('openapi-qr-review-v0.1.yaml', 'utf8'));
it('implements every contracted API operation, method and path', () => {
  const expected = Object.entries(spec.paths).flatMap(([path, methods]) =>
    Object.entries(methods as Record<string, { operationId: string }>)
      .filter(([, op]) => op.operationId && !path.startsWith('/r/'))
      .map(([method, op]) => [method.toUpperCase(), path, op.operationId]),
  );
  expect([...routes].sort()).toEqual(expected.sort());
});
it('matches contract requirements for idempotency and optimistic concurrency', () => {
  for (const [method, path, id] of routes) {
    const parameters = spec.paths[path][method.toLowerCase()].parameters || [];
    expect(idempotentOperations.has(id)).toBe(
      parameters.some((p: { $ref?: string }) => p.$ref?.endsWith('/IdempotencyKey')),
    );
    expect(versionOperations.has(id)).toBe(
      parameters.some((p: { $ref?: string }) => p.$ref?.endsWith('/IfMatch')),
    );
  }
});
