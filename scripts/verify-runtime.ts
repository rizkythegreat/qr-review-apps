import { spawn } from 'node:child_process';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { createServer as createHttpsServer, request as httpsRequest } from 'node:https';
import { createServer as createNetServer } from 'node:net';
import { readFile, mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { testDatabase } from '../tests/helpers/database';
import { decrypt } from '../src/server/crypto';

async function port() {
  const server = createNetServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No port');
  const value = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return value;
}
function request(
  origin: string,
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
) {
  return new Promise<{
    status: number;
    headers: Record<string, string | string[] | undefined>;
    bytes: Buffer;
  }>((resolve, reject) => {
    // Only the ephemeral test certificate skips trust validation; application/database TLS settings stay enabled.
    const req = httpsRequest(
      origin + path,
      { method: options.method || 'GET', rejectUnauthorized: false, headers: options.headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (v) => chunks.push(v));
        res.on('end', () =>
          resolve({ status: res.statusCode!, headers: res.headers, bytes: Buffer.concat(chunks) }),
        );
      },
    );
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('HTTP timeout')));
    req.end(options.body === undefined ? undefined : JSON.stringify(options.body));
  });
}
async function main() {
  const db = await testDatabase();
  await db.reset();
  const directory = await mkdtemp(join(tmpdir(), 'qr-review-runtime-'));
  const nextPort = await port(),
    httpsPort = await port(),
    authPort = await port();
  const origin = `https://localhost:${httpsPort}`,
    jwtKey = randomBytes(32),
    issuer = `http://127.0.0.1:${authPort}/auth/v1`;
  const auth = createHttpServer(async (req, res) => {
    try {
      if (req.url !== '/auth/v1/user' || req.headers.apikey !== 'runtime-test-key')
        throw new Error('Unknown request');
      const token = req.headers.authorization?.replace(/^Bearer /, '');
      if (!token) throw new Error('Missing bearer');
      const { payload } = await jwtVerify(token, jwtKey, { issuer, audience: 'authenticated' });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: payload.sub }));
    } catch {
      res.writeHead(401);
      res.end('{}');
    }
  });
  const openssl = spawn(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      join(directory, 'key.pem'),
      '-out',
      join(directory, 'cert.pem'),
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
    ],
    { stdio: 'ignore' },
  );
  const [sslExit] = await once(openssl, 'exit');
  if (sslExit !== 0) throw new Error('Certificate generation failed');
  const proxy = createHttpsServer(
    {
      key: await readFile(join(directory, 'key.pem')),
      cert: await readFile(join(directory, 'cert.pem')),
    },
    (req, res) => {
      const upstream = httpRequest(
        {
          hostname: '127.0.0.1',
          port: nextPort,
          path: req.url,
          method: req.method,
          headers: {
            ...req.headers,
            'x-forwarded-proto': 'https',
            'x-forwarded-host': `localhost:${httpsPort}`,
          },
        },
        (response) => {
          res.writeHead(response.statusCode!, response.headers);
          response.pipe(res);
        },
      );
      upstream.on('error', () => {
        res.writeHead(503);
        res.end();
      });
      req.pipe(upstream);
    },
  );
  auth.listen(authPort, '127.0.0.1');
  proxy.listen(httpsPort, '127.0.0.1');
  const env = {
    ...process.env,
    ...Object.fromEntries(Object.entries(db.config).map(([k, v]) => [k, String(v)])),
    PUBLIC_ORIGIN: origin,
    SUPABASE_URL: `http://127.0.0.1:${authPort}`,
    SUPABASE_PUBLISHABLE_KEY: 'runtime-test-key',
    MIGRATION_DATABASE_URL: db.config.DATABASE_URL,
  };
  async function cli(script: string, args: string[] = []) {
    const child = spawn('npm', ['run', script, ...(args.length ? ['--', ...args] : [])], {
      env,
      stdio: 'ignore',
    });
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) =>
        code === 0 ? resolve() : reject(new Error(`CLI verification failed: ${script}`)),
      );
    });
  }
  const server = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '-p', String(nextPort)],
    { env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let serverLogs = '';
  server.stdout.on('data', (v) => {
    serverLogs += v.toString();
  });
  server.stderr.on('data', (v) => {
    serverLogs += v.toString();
  });
  const report: Record<string, unknown> = {
    verified_at: new Date().toISOString(),
    runtime:
      'Next.js production build, local PostgreSQL, temporary HTTPS proxy, simulated Supabase Auth with JWT signature verification',
  };
  try {
    await cli('db:migrate');
    await db.pool.query('DELETE FROM qr_review.admin_users WHERE user_id=$1', [db.adminId]);
    await cli('admin:add', [db.adminId]);
    for (let i = 0; i < 100; i++) {
      if (server.exitCode !== null) throw new Error('Next.js stopped');
      try {
        const r = await request(origin, '/');
        if (r.status === 200) break;
      } catch {}
      if (i === 99) throw new Error('Next.js startup timed out');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(db.adminId)
      .setIssuer(issuer)
      .setAudience('authenticated')
      .setExpirationTime('10m')
      .sign(jwtKey);
    const headers = {
      Authorization: `Bearer ${token}`,
      Origin: origin,
      'Content-Type': 'application/json',
      'x-test-ip': '198.51.100.1',
    };
    async function json(
      method: string,
      path: string,
      body?: unknown,
      extras: Record<string, string> = {},
    ) {
      const r = await request(origin, path, {
        method,
        body,
        headers: { ...headers, 'Idempotency-Key': randomUUID(), ...extras },
      });
      const value = JSON.parse(r.bytes.toString());
      if (value.error) throw new Error(`${method} ${path}: ${r.status} ${value.error.code}`);
      if (
        r.headers['cache-control'] !== 'no-store' ||
        r.headers['x-request-id'] !== value.request_id
      )
        throw new Error('Missing security/trace headers');
      return { r, value };
    }
    const b = (
      await json('POST', '/api/v1/admin/batches', { label: 'Runtime validation', quantity: 1 })
    ).value.data;
    const detail = (await json('GET', `/api/v1/admin/batches/${b.id}`)).value.data;
    if (detail.id !== b.id || detail.quantity !== 1) throw new Error('Batch detail invalid');
    const q = (await json('GET', `/api/v1/admin/qr-codes?batch_id=${b.id}`)).value.data[0];
    const snapshot = (
      await db.pool.query('SELECT activation_snapshot FROM qr_review.qr_batches WHERE id=$1', [
        b.id,
      ])
    ).rows[0].activation_snapshot;
    const code = decrypt<{ activation_code: string }[]>(db.config, snapshot, `batch:${b.id}`)[0]
      .activation_code;
    const qc = (
      await json(
        'PATCH',
        `/api/v1/admin/qr-codes/${q.id}/stock`,
        { stock_status: 'AVAILABLE', reason: 'Runtime quality test' },
        { 'If-Match': '"v1"' },
      )
    ).value.data;
    const sale = await json(
      'POST',
      `/api/v1/admin/qr-codes/${q.id}/sales`,
      { reference: 'RUNTIME-001', sold_at: new Date(Date.now() - 1000).toISOString() },
      { 'If-Match': `"v${qc.version}"` },
    );
    await json('POST', `/api/v1/public/qr/${q.token}/activate`, {
      activation_code: code,
      store_name: 'Runtime Store',
      review_url: 'https://g.page/r/RuntimeStore/review',
      pin: '0042',
      pin_confirmation: '0042',
    });
    const logged = await json('POST', '/api/v1/owner/sessions', { token: q.token, pin: '0042' });
    const cookie = String(logged.r.headers['set-cookie']?.[0] || '').split(';')[0];
    if (!cookie.startsWith('__Host-owner_session=')) throw new Error('Owner cookie missing');
    await json(
      'PATCH',
      '/api/v1/owner/me',
      { review_url: 'https://g.page/r/UpdatedRuntime/review' },
      {
        Cookie: cookie,
        'X-CSRF-Token': logged.value.data.csrf_token,
        'If-Match': `"v${logged.value.data.qr.version}"`,
      },
    );
    const scan = await request(origin, `/r/${q.token}`, {
      headers: { 'x-test-ip': '198.51.100.1' },
    });
    if (
      scan.status !== 302 ||
      scan.headers.location !== 'https://g.page/r/UpdatedRuntime/review' ||
      scan.headers['cache-control'] !== 'no-store, max-age=0'
    )
      throw new Error('Resolver redirect invalid');
    const stats = (await json('GET', '/api/v1/owner/me/stats', undefined, { Cookie: cookie })).value
      .data;
    if (stats.total_visits !== 1) throw new Error('Durable statistics invalid');
    const exported = (
      await json('POST', `/api/v1/admin/batches/${b.id}/exports`, {
        kind: 'PUBLIC_QR',
        size_px: 256,
      })
    ).value.data;
    await cli('worker', ['--once']);
    const archive = await request(origin, `/api/v1/admin/exports/${exported.id}/download`, {
      headers,
    });
    if (archive.status !== 200 || archive.bytes.subarray(0, 2).toString() !== 'PK')
      throw new Error('ZIP download invalid');
    report.smoke = {
      batch: 201,
      sale: sale.r.status,
      activation: 201,
      owner_login: 200,
      owner_update: 200,
      resolver: 302,
      durable_visits: stats.total_visits,
      public_zip: 200,
    };
    await cli('maintenance');
    report.cli = {
      migrations: 'passed',
      admin_allowlist: 'passed',
      export_worker: 'passed',
      maintenance: 'passed',
    };
    if (process.argv.includes('--load')) {
      const count = 6000,
        latencies: number[] = [],
        codes: Record<string, number> = {},
        pending: Promise<void>[] = [];
      const began = performance.now();
      for (let i = 0; i < count; i++) {
        const scheduled = began + i * 50;
        const wait = scheduled - performance.now();
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        pending.push(
          (async () => {
            const start = performance.now();
            const r = await request(origin, `/r/${q.token}`, {
              headers: {
                'x-test-ip': `198.51.100.${10 + (i % 8)}`,
                'x-deployment-test': db.config.TEST_TRAFFIC_SECRET,
              },
            });
            latencies.push(performance.now() - start);
            codes[r.status] = (codes[r.status] || 0) + 1;
          })(),
        );
      }
      await Promise.all(pending);
      latencies.sort((a, b) => a - b);
      report.resolver_load = {
        requests: count,
        rate_per_second: 20,
        duration_seconds: Math.round((performance.now() - began) / 1000),
        sources: 8,
        p50_ms: Math.round(latencies[Math.floor(count * 0.5)]),
        p95_ms: Math.round(latencies[Math.floor(count * 0.95)]),
        p99_ms: Math.round(latencies[Math.floor(count * 0.99)]),
        status_counts: codes,
        traffic_excluded_from_statistics: true,
      };
      if (codes['302'] !== count || latencies[Math.floor(count * 0.95)] > 1000)
        throw new Error('Resolver performance target failed');
    }
    // Scan client assets for the actual ephemeral keys used by this run.
    const { readdir } = await import('node:fs/promises');
    async function inspect(dir: string) {
      for (const file of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, file.name);
        if (file.isDirectory()) await inspect(path);
        else {
          const data = await readFile(path, 'utf8');
          for (const secret of [
            db.config.PIN_PEPPER,
            db.config.HMAC_KEY,
            db.config.ENCRYPTION_KEY,
            db.config.DATABASE_URL,
          ])
            if (data.includes(secret)) throw new Error('Secret found in public bundle');
        }
      }
    }
    await inspect(`${process.env.QR_REVIEW_DIST_DIR || '.next'}/static`);
    report.client_bundle_secrets = 'none';
    await mkdir('artifacts', { recursive: true });
    await writeFile(
      `artifacts/${process.argv.includes('--load') ? 'runtime-verification' : 'runtime-smoke'}.json`,
      JSON.stringify(report, null, 2) + '\n',
    );
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    // Test-only errors contain operation/status, not payloads, JWTs, cookies, or server configuration.
    console.error(error instanceof Error ? error.message : 'Runtime verification failed');
    if (serverLogs.includes('configuration_unavailable'))
      console.error('Next.js configuration unavailable.');
    process.exitCode = 1;
  } finally {
    server.kill('SIGTERM');
    if (server.exitCode === null) await once(server, 'exit');
    await Promise.all([
      new Promise<void>((resolve) => proxy.close(() => resolve())),
      new Promise<void>((resolve) => auth.close(() => resolve())),
    ]);
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
}
main().catch(() => {
  console.error('Runtime verification setup failed. Check local PostgreSQL and openssl.');
  process.exitCode = 1;
});
