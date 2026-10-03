import { spawn, type ChildProcess } from 'node:child_process';
import { createServer as httpServer, request as httpRequest } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { createServer as netServer } from 'node:net';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { chromium, expect, type Browser, type Page } from '@playwright/test';
import JSZip from 'jszip';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import { testDatabase } from '../tests/helpers/database';
import { decrypt } from '../src/server/crypto';

// Every database write targets an ephemeral local database. No .env.local credentials are read.
function fieldLabel(label: string) {
  return new RegExp('^' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\*?$');
}
async function freePort() {
  const server = netServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const value = server.address();
  if (!value || typeof value === 'string') throw new Error('Port unavailable');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return value.port;
}
async function main() {
  const db = await testDatabase();
  const directory = await mkdtemp(join(tmpdir(), 'qr-review-ui-'));
  let browser: Browser | undefined;
  let next: ChildProcess | undefined;
  let stage = 'setup';
  const checks: string[] = [];
  const consoleErrors: string[] = [];
  const mark = (name: string) => {
    checks.push(name);
    console.log(`PASS ${name}`);
    stage = name;
  };
  const [nextPort, tlsPort, authPort] = await Promise.all([freePort(), freePort(), freePort()]);
  const origin = `https://localhost:${tlsPort}`;
  const authUrl = `http://127.0.0.1:${authPort}`;
  const jwtKey = randomBytes(32);
  const outsideId = randomUUID();
  const user = {
    id: db.adminId,
    email: 'admin@ui.test',
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    created_at: new Date().toISOString(),
    identities: [],
  };
  async function session(id = db.adminId) {
    return {
      access_token: await new SignJWT({ role: 'authenticated', email: user.email })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(id)
        .setIssuer(`${authUrl}/auth/v1`)
        .setAudience('authenticated')
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(jwtKey),
      token_type: 'bearer',
      expires_in: 3600,
      refresh_token: 'ephemeral-refresh',
      user: { ...user, id },
    };
  }
  const auth = httpServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader(
      'Access-Control-Allow-Headers',
      req.headers['access-control-request-headers'] ||
        'authorization,apikey,content-type,x-client-info,x-supabase-api-version',
    );
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    try {
      if (req.headers.apikey !== 'ui-test-key') throw new Error('Invalid key');
      if (req.url?.startsWith('/auth/v1/token')) {
        let raw = '';
        for await (const part of req) raw += part.toString();
        const body = JSON.parse(raw);
        if (
          !body.refresh_token &&
          (![user.email, 'outside@ui.test'].includes(body.email) ||
            body.password !== 'ui-test-password')
        ) {
          res.writeHead(400);
          res.end(JSON.stringify({ code: 'invalid_credentials', msg: 'Invalid credentials' }));
          return;
        }
        res.end(
          JSON.stringify(await session(body.email === 'outside@ui.test' ? outsideId : db.adminId)),
        );
        return;
      }
      const token = req.headers.authorization?.replace(/^Bearer /, '');
      if (!token) throw new Error('Bearer missing');
      const { payload } = await jwtVerify(token, jwtKey, {
        issuer: `${authUrl}/auth/v1`,
        audience: 'authenticated',
      });
      if (req.url?.startsWith('/auth/v1/logout')) {
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.url === '/auth/v1/user') {
        res.end(JSON.stringify({ ...user, id: payload.sub }));
        return;
      }
      throw new Error('Unknown endpoint');
    } catch {
      res.writeHead(401);
      res.end('{}');
    }
  });
  const ssl = spawn(
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
  if ((await once(ssl, 'exit'))[0] !== 0) throw new Error('Test certificate unavailable');
  const proxy = httpsServer(
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
            'x-forwarded-host': `localhost:${tlsPort}`,
          },
        },
        (response) => {
          res.writeHead(response.statusCode!, response.headers);
          response.pipe(res);
        },
      );
      upstream.on('error', () => {
        if (!res.headersSent) res.writeHead(503);
        res.end();
      });
      req.pipe(upstream);
    },
  );
  try {
    await db.reset();
    await mkdir('artifacts/ui', { recursive: true });
    await Promise.all([
      new Promise<void>((resolve) => auth.listen(authPort, '127.0.0.1', resolve)),
      new Promise<void>((resolve) => proxy.listen(tlsPort, '127.0.0.1', resolve)),
    ]);
    const env = {
      ...process.env,
      ...Object.fromEntries(Object.entries(db.config).map(([key, value]) => [key, String(value)])),
      PUBLIC_ORIGIN: origin,
      SUPABASE_URL: authUrl,
      SUPABASE_PUBLISHABLE_KEY: 'ui-test-key',
      DATABASE_SSL_CA: '',
      MIGRATION_DATABASE_URL: db.config.DATABASE_URL,
      QR_REVIEW_DIST_DIR: process.env.QR_REVIEW_DIST_DIR || '.next-ui-verification',
    };
    next = spawn(
      process.execPath,
      [
        'node_modules/next/dist/bin/next',
        'start',
        '--hostname',
        '127.0.0.1',
        '-p',
        String(nextPort),
      ],
      { env, stdio: process.env.UI_DEBUG === 'true' ? ['ignore', 'pipe', 'pipe'] : 'ignore' },
    );
    if (process.env.UI_DEBUG === 'true')
      next.stderr?.on('data', (chunk) =>
        console.error('Test Next:', chunk.toString().slice(0, 2000)),
      );
    browser = await chromium.launch();
    const adminContext = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 1440, height: 1000 },
      extraHTTPHeaders: { 'x-test-ip': '198.51.100.51' },
    });
    const admin = await adminContext.newPage();
    const ownerContext = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 390, height: 844 },
      extraHTTPHeaders: { 'x-test-ip': '198.51.100.52' },
    });
    const owner = await ownerContext.newPage();
    for (const page of [admin, owner]) {
      page.on('pageerror', (error) => consoleErrors.push(error.name));
    }
    const apiToken = (await session()).access_token;
    async function api(path: string, method = 'GET', data?: unknown, etag?: string) {
      const response = await adminContext.request.fetch(origin + path, {
        method,
        data,
        headers: {
          Authorization: `Bearer ${apiToken}`,
          Origin: origin,
          'Idempotency-Key': randomUUID(),
          ...(etag ? { 'If-Match': etag } : {}),
        },
      });
      expect(response.ok(), `API ${method} ${path}`).toBeTruthy();
      return response.json();
    }
    async function screenshot(page: Page, name: string) {
      await page.screenshot({ path: `artifacts/ui/${name}.png`, fullPage: true });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `${name}: mobile overflow`,
      ).toBeTruthy();
    }
    async function ownerLogin(pin: string, token: string) {
      await owner.goto(`${origin}/manage?token=${token}`);
      await owner.getByLabel(fieldLabel('Token atau alamat QR')).fill(`${origin}/r/${token}`);
      await owner.getByLabel(fieldLabel('PIN pemilik')).fill(pin);
      await owner.getByRole('button', { name: 'Masuk ke kelola QR', exact: true }).click();
      await expect(owner.getByText('Informasi toko dan tujuan QR', { exact: true })).toBeVisible();
    }
    async function logoutOwner() {
      await owner.getByRole('button', { name: 'Keluar', exact: true }).click();
      await expect(owner.getByLabel(fieldLabel('PIN pemilik'))).toBeVisible();
    }
    async function support(
      qrId: string,
      label: string,
      verify = false,
      secret?: string,
      lostResponse = false,
    ) {
      await admin.goto(`${origin}/admin/qr-codes/${qrId}?tab=support`);
      await admin.getByRole('button', { name: label, exact: true }).click();
      const dialog = admin.getByRole('dialog');
      await dialog
        .getByLabel(fieldLabel('Alasan tindakan'))
        .fill('Bukti dan kondisi unit telah diperiksa untuk pengujian UI');
      if (verify) await dialog.getByLabel(fieldLabel('Referensi verifikasi')).fill('UI-PROOF-001');
      const retries: { key: string; etag: string; body: string }[] = [];
      const retryPath = `**/api/v1/admin/qr-codes/${qrId}/pin-reset-grants`;
      if (lostResponse)
        await admin.route(retryPath, async (route) => {
          const headers = route.request().headers();
          retries.push({
            key: headers['idempotency-key'],
            etag: headers['x-qr-if-match'],
            body: route.request().postData() || '',
          });
          if (retries.length === 1) {
            await route.fetch();
            await route.abort('failed');
          } else await route.continue();
        });
      await dialog
        .getByRole('button', {
          name:
            label === 'Nonaktifkan permanen' ? 'Konfirmasi penonaktifan' : 'Konfirmasi tindakan',
          exact: true,
        })
        .click();
      if (lostResponse) {
        await expect(
          dialog.getByText('Koneksi terputus atau terlalu lama. Periksa koneksi dan coba lagi.', {
            exact: true,
          }),
        ).toBeVisible();
        await dialog.getByRole('button', { name: 'Konfirmasi tindakan', exact: true }).click();
        await expect.poll(() => retries.length).toBe(2);
        expect(retries[1]).toEqual(retries[0]);
        await admin.unroute(retryPath);
      }
      await expect(dialog.getByText('Tindakan berhasil', { exact: true })).toBeVisible();
      const result = secret ? await dialog.getByLabel(secret, { exact: true }).inputValue() : '';
      await dialog.getByRole('button', { name: 'Selesai', exact: true }).click();
      return result;
    }
    for (let retry = 0; retry < 100; retry++) {
      try {
        if ((await adminContext.request.get(origin)).status() === 200) break;
      } catch {}
      if (next.exitCode !== null || retry === 99) throw new Error('Next startup failed');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    stage = 'admin authentication';
    await admin.goto(origin + '/admin');
    await expect(admin).toHaveURL(/\/admin\/login/);
    await expect(admin.getByLabel(fieldLabel('Email'))).toBeEnabled();
    await screenshot(admin, 'login-desktop');
    await admin.getByLabel(fieldLabel('Email')).fill(user.email);
    await admin.getByLabel(fieldLabel('Password')).fill('wrong-test-password');
    await admin.getByRole('button', { name: 'Masuk ke dashboard', exact: true }).click();
    await expect(
      admin.getByText('Email atau password tidak sesuai.', { exact: true }),
    ).toBeVisible();
    await admin.getByLabel(fieldLabel('Email')).fill('outside@ui.test');
    await admin.getByLabel(fieldLabel('Password')).fill('ui-test-password');
    await admin.getByRole('button', { name: 'Masuk ke dashboard', exact: true }).click();
    await expect(
      admin.getByText('Akun ini belum memiliki akses admin. Hubungi pengelola aplikasi.', {
        exact: true,
      }),
    ).toBeVisible();
    await admin.getByLabel(fieldLabel('Email')).fill(user.email);
    await admin.getByLabel(fieldLabel('Password')).fill('ui-test-password');
    await admin.getByRole('button', { name: 'Masuk ke dashboard', exact: true }).click();
    await expect(admin).toHaveURL(origin + '/admin');
    await expect(
      admin.getByRole('button', { name: 'Buat batch', exact: true }).first(),
    ).toBeVisible();
    await expect(admin.getByText('Mulai batch pertama', { exact: true })).toBeVisible();
    mark(
      'Admin login, invalid credentials/allowlist, protected-route redirect and empty dashboard',
    );

    stage = 'batch retry';
    const attempts: { key: string; data: string }[] = [];
    await admin.route('**/api/v1/admin/batches', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      attempts.push({
        key: route.request().headers()['idempotency-key'],
        data: route.request().postData() || '',
      });
      if (attempts.length === 1) {
        await route.fetch();
        await route.abort('failed');
      } else await route.continue();
    });
    await admin.getByRole('button', { name: 'Buat batch', exact: true }).first().click();
    const dialog = admin.getByRole('dialog');
    await dialog.getByLabel(fieldLabel('Nama batch')).fill('Produksi uji UI');
    await dialog.getByLabel(fieldLabel('Jumlah unit')).fill('23');
    await dialog.getByRole('button', { name: 'Buat batch', exact: true }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(dialog.getByLabel(fieldLabel('Nama batch'))).toHaveValue('Produksi uji UI');
    await dialog.getByRole('button', { name: 'Buat batch', exact: true }).click();
    await expect(admin).toHaveURL(/\/admin\/batches\/[a-f0-9-]+$/);
    expect(attempts.length).toBe(2);
    expect(attempts[1]).toEqual(attempts[0]);
    expect(
      Number((await db.pool.query('SELECT count(*) FROM qr_review.qr_batches')).rows[0].count),
    ).toBe(1);
    await admin.unroute('**/api/v1/admin/batches');
    const batchId = admin.url().split('/').at(-1)!;
    const qrs = (await api(`/api/v1/admin/qr-codes?batch_id=${batchId}&limit=100`)).data;
    const [qr, rotatedQr, damagedQr] = qrs;
    const snapshot = (
      await db.pool.query('SELECT activation_snapshot FROM qr_review.qr_batches WHERE id=$1', [
        batchId,
      ])
    ).rows[0].activation_snapshot;
    const codes = decrypt<{ token: string; activation_code: string }[]>(
      db.config,
      snapshot,
      `batch:${batchId}`,
    );
    mark('Create batch: committed response lost, identical retry, one batch only');

    stage = 'exports';
    await admin.getByLabel(fieldLabel('Ukuran (px)')).fill('256');
    await admin.getByRole('button', { name: 'Siapkan QR publik', exact: true }).click();
    await admin.getByRole('button', { name: 'Siapkan kode aktivasi', exact: true }).click();
    await expect
      .poll(async () =>
        Number((await db.pool.query('SELECT count(*) FROM qr_review.export_jobs')).rows[0].count),
      )
      .toBe(2);
    await expect(admin.getByRole('button', { name: 'Unduh ZIP', exact: true })).toHaveCount(2, {
      timeout: 15000,
    });
    const publicDownload = admin.waitForEvent('download');
    await admin.getByRole('button', { name: 'Unduh ZIP', exact: true }).last().click();
    const publicZip = await JSZip.loadAsync(await readFile((await (await publicDownload).path())!));
    expect(
      Object.keys(publicZip.files).some(
        (name) => name.endsWith('.csv') && name.includes('activation'),
      ),
    ).toBeFalsy();
    const pngEntry = Object.values(publicZip.files).find((entry) => entry.name.endsWith('.png'))!;
    const png = PNG.sync.read(await pngEntry.async('nodebuffer'));
    const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
    expect(decoded?.data.startsWith(origin + '/r/')).toBeTruthy();
    const secretDownload = admin.waitForEvent('download');
    await admin.getByRole('button', { name: 'Unduh ZIP', exact: true }).first().click();
    const secretZip = await JSZip.loadAsync(await readFile((await (await secretDownload).path())!));
    expect(
      Object.values(secretZip.files).some((entry) => entry.name.endsWith('.csv')),
    ).toBeTruthy();
    expect(Object.keys(secretZip.files).some((name) => name.endsWith('.png'))).toBeFalsy();
    await screenshot(admin, 'batch-desktop');
    mark('Separate public/secret exports, background polling, ZIP download and PNG decode');

    stage = 'QR pagination and filters';
    await admin.getByRole('button', { name: /Muat/ }).click();
    await expect(admin.locator('tbody tr')).toHaveCount(23);
    await admin
      .getByRole('textbox', { name: 'Cari token atau nama toko', exact: true })
      .fill(qr.token);
    await admin.getByRole('button', { name: 'Terapkan', exact: true }).click();
    await expect(admin.locator('tbody tr')).toHaveCount(1);
    mark('QR search and cursor pagination');

    stage = 'automatic sales';
    await owner.goto(`${origin}/r/${qr.token}`);
    await expect(owner.getByLabel(fieldLabel('Kode aktivasi'))).toBeVisible();
    await admin.goto(`${origin}/admin/qr-codes/${qr.id}`);
    const unitCode = codes.find((item) => item.token === qr.token)!.activation_code;
    await expect(admin.getByText(unitCode, { exact: true })).toHaveCount(0);
    await admin.getByRole('button', { name: 'Lihat kode aktivasi', exact: true }).click();
    await expect(admin.getByText(unitCode, { exact: true })).toBeVisible();
    await admin.getByRole('button', { name: 'Sembunyikan kode aktivasi', exact: true }).click();
    await expect(admin.getByText(unitCode, { exact: true })).toHaveCount(0);
    await admin.getByRole('button', { name: 'Lihat kode aktivasi', exact: true }).click();
    await expect(admin.getByText(unitCode, { exact: true })).toBeVisible();
    await admin.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(admin.getByText(unitCode, { exact: true })).toHaveCount(0);
    await expect(admin.getByRole('button', { name: 'Catat penjualan', exact: true })).toHaveCount(
      0,
    );
    await expect(
      admin.getByRole('button', { name: 'Lolos QC · siap dijual', exact: true }),
    ).toHaveCount(0);
    await admin.getByRole('tab', { name: 'Penjualan', exact: true }).click();
    await expect(admin.getByText('Menunggu aktivasi pemilik', { exact: true })).toBeVisible();
    await admin.getByRole('tab', { name: 'Ringkasan', exact: true }).click();
    const svgDownload = admin.waitForEvent('download');
    await admin.getByRole('button', { name: 'SVG', exact: true }).click();
    expect(
      (await readFile((await (await svgDownload).path())!, 'utf8')).includes('<svg'),
    ).toBeTruthy();
    await screenshot(admin, 'qr-unit-desktop');
    mark(
      'Masked activation code, on-demand reveal/hide/blur, activation available immediately, automatic sale pending and SVG download',
    );

    stage = 'activation';
    const response = await owner.goto(`${origin}/r/${qr.token}`);
    expect(response?.status()).toBe(200);
    expect(new URL(owner.url()).pathname).toBe(`/r/${qr.token}`);
    await owner.getByLabel(fieldLabel('Kode aktivasi')).fill(
      codes
        .find((item) => item.token === qr.token)!
        .activation_code.toLowerCase()
        .match(/.{1,4}/g)!
        .join(' '),
    );
    await owner.getByLabel(fieldLabel('Nama toko')).fill('Kopi Bahagia');
    await owner
      .getByLabel(fieldLabel('Link review Google'))
      .fill('https://maps.app.goo.gl/unsupported');
    await owner.getByLabel(fieldLabel('Buat PIN')).fill('0123');
    await owner.getByLabel(fieldLabel('Konfirmasi PIN')).fill('0124');
    await owner.getByRole('button', { name: 'Aktifkan QR toko', exact: true }).click();
    await expect(
      owner.getByText('Gunakan link Google Review yang didukung. Lihat panduan di bawah isian.', {
        exact: true,
      }),
    ).toBeVisible();
    await owner
      .getByLabel(fieldLabel('Link review Google'))
      .fill('https://g.page/r/ui-store/review');
    await owner.getByRole('button', { name: 'Aktifkan QR toko', exact: true }).click();
    await expect(owner.getByText('Konfirmasi PIN tidak sama.', { exact: true })).toBeVisible();
    await owner.getByLabel(fieldLabel('Konfirmasi PIN')).fill('0123');
    await screenshot(owner, 'activation-mobile');
    await owner.getByRole('button', { name: 'Aktifkan QR toko', exact: true }).click();
    await expect(owner.getByText('QR toko sudah aktif!', { exact: true })).toBeVisible();
    await admin.reload();
    await expect(
      admin.getByText('Kode sudah digunakan saat aktivasi.', { exact: true }),
    ).toBeVisible();
    await expect(
      admin.getByRole('button', { name: 'Lihat kode aktivasi', exact: true }),
    ).toHaveCount(0);
    await admin.getByRole('tab', { name: 'Penjualan', exact: true }).click();
    await expect(admin.getByText('Penjualan tercatat', { exact: true })).toBeVisible();
    await expect(admin.getByText(/^ACT-[0-9a-f-]{36}$/)).toBeVisible();
    await expect(
      admin
        .getByText('Toko pembeli', { exact: true })
        .locator('..')
        .getByText('Kopi Bahagia', { exact: true }),
    ).toBeVisible();
    await screenshot(admin, 'qr-desktop');

    mark('Printed /r URL renders activation, link/PIN field validation, leading-zero PIN');

    stage = 'owner settings';
    await ownerLogin('0123', qr.token);
    await owner.getByLabel(fieldLabel('Nama toko')).fill('Kopi Bahagia Baru');
    await owner.getByLabel(fieldLabel('Link review Google')).fill('https://g.page/r/ui-new/review');
    const editRequest = owner.waitForRequest(
      (request) => request.url().endsWith('/api/v1/owner/me') && request.method() === 'PATCH',
    );
    await owner.getByRole('button', { name: 'Simpan perubahan', exact: true }).click();
    const editHeaders = (await editRequest).headers();
    expect(editHeaders['x-csrf-token']).toBeTruthy();
    expect(editHeaders['x-qr-if-match']).toMatch(/^"v\d+"$/);
    await expect(
      owner.getByRole('heading', { name: 'Kopi Bahagia Baru', exact: true }),
    ).toBeVisible();
    const scan = await ownerContext.request.get(`${origin}/r/${qr.token}`, {
      maxRedirects: 0,
      headers: { 'User-Agent': 'Mozilla/5.0 QRReviewUITest' },
    });
    expect(scan.status()).toBe(302);
    expect(scan.headers().location).toBe('https://g.page/r/ui-new/review');
    const head = await ownerContext.request.head(`${origin}/r/${qr.token}`, { maxRedirects: 0 });
    expect(head.status()).toBe(302);
    expect((await head.body()).length).toBe(0);
    await owner.getByRole('button', { name: 'Perbarui statistik', exact: true }).click();
    await expect
      .poll(async () => {
        const stats = await ownerContext.request.get(origin + '/api/v1/owner/me/stats');
        return (await stats.json()).data.total_visits;
      })
      .toBe(1);
    await screenshot(owner, 'owner-mobile');
    await owner.setViewportSize({ width: 1440, height: 1000 });
    await screenshot(owner, 'owner-desktop');
    await owner.setViewportSize({ width: 390, height: 844 });
    mark('Owner cookie login, CSRF/ETag profile update, immediate resolver redirect, HEAD, visits');

    stage = 'owner version conflict';
    await owner.getByLabel(fieldLabel('Nama toko')).fill('Draft pemilik tetap tersimpan');
    await db.pool.query(
      'UPDATE qr_review.qr_codes SET store_name=$2,version=version+1 WHERE id=$1',
      [qr.id, 'Perubahan dari halaman lain'],
    );
    await owner.getByRole('button', { name: 'Simpan perubahan', exact: true }).click();
    await expect(owner.getByText('Data toko sudah berubah', { exact: true })).toBeVisible();
    await expect(owner.getByLabel(fieldLabel('Nama toko'))).toHaveValue(
      'Draft pemilik tetap tersimpan',
    );
    await expect(
      owner.getByRole('button', { name: 'Simpan perubahan', exact: true }),
    ).toBeDisabled();
    await owner.getByRole('button', { name: 'Gunakan data terbaru', exact: true }).click();
    await expect(owner.getByLabel(fieldLabel('Nama toko'))).toHaveValue(
      'Perubahan dari halaman lain',
    );
    const longName = 'Kopi' + 'a'.repeat(110);
    await owner.getByLabel(fieldLabel('Nama toko')).fill(longName);
    await owner.getByRole('button', { name: 'Simpan perubahan', exact: true }).click();
    await expect(owner.getByRole('heading', { name: longName, exact: true })).toBeVisible();
    expect(
      await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    await owner.getByLabel(fieldLabel('Nama toko')).fill('Kopi Bahagia Baru');
    await owner.getByRole('button', { name: 'Simpan perubahan', exact: true }).click();
    await expect(
      owner.getByRole('heading', { name: 'Kopi Bahagia Baru', exact: true }),
    ).toBeVisible();
    mark('Version conflict preserves draft, explicit refresh, long store name fits mobile');

    stage = 'PIN change';
    await owner.getByRole('button', { name: 'Ganti PIN', exact: true }).click();
    await owner.getByLabel(fieldLabel('PIN saat ini')).fill('0123');
    await owner.getByLabel(fieldLabel('PIN baru')).fill('0456');
    await owner.getByLabel(fieldLabel('Konfirmasi PIN baru')).fill('0456');
    await owner
      .getByRole('dialog')
      .getByRole('button', { name: 'Simpan PIN baru', exact: true })
      .click();
    await expect(owner.getByLabel(fieldLabel('PIN pemilik'))).toBeVisible();
    await owner.getByLabel(fieldLabel('PIN pemilik')).fill('0123');
    await owner.getByRole('button', { name: 'Masuk ke kelola QR', exact: true }).click();
    await expect(
      owner.getByText('Token atau PIN tidak sesuai. Periksa kembali keduanya.', { exact: true }),
    ).toBeVisible();
    await ownerLogin('0456', qr.token);
    await logoutOwner();
    mark('PIN change revokes session, old PIN rejected, new PIN login and logout');

    stage = 'reset PIN and grant privacy';
    const resetLink = await support(
      qr.id,
      'Buat tautan reset PIN',
      true,
      'Tautan untuk pemilik',
      true,
    );
    expect(
      Number(
        (
          await db.pool.query('SELECT count(*) FROM qr_review.support_grants WHERE qr_id=$1', [
            qr.id,
          ])
        ).rows[0].count,
      ),
    ).toBe(1);
    const grant = new URLSearchParams(new URL(resetLink).hash.slice(1)).get('grant')!;
    const requestedUrls: string[] = [];
    owner.on('request', (request) => requestedUrls.push(request.url()));
    await owner.goto(resetLink);
    await expect(owner.getByLabel(fieldLabel('PIN baru'))).toBeVisible();
    expect(new URL(owner.url()).hash).toBe('');
    expect(requestedUrls.some((url) => url.includes(grant))).toBeFalsy();
    expect(
      await owner.evaluate(
        (secret) =>
          [...Object.values(localStorage), ...Object.values(sessionStorage)].some((value) =>
            value.includes(secret),
          ),
        grant,
      ),
    ).toBeFalsy();
    await owner.getByLabel(fieldLabel('PIN baru')).fill('0789');
    await owner.getByLabel(fieldLabel('Konfirmasi PIN baru')).fill('0789');
    await owner.getByRole('button', { name: 'Simpan PIN baru', exact: true }).click();
    await expect(owner.getByText('PIN berhasil diperbarui', { exact: true })).toBeVisible();
    await ownerLogin('0789', qr.token);
    await logoutOwner();
    await owner.goto(origin + '/pin-reset');
    await expect(owner.getByText('Tautan belum lengkap', { exact: true })).toBeVisible();
    mark(
      'Verified PIN reset, secret fragment scrubbed before requests, no secret storage, incomplete link',
    );

    stage = 'transfer';
    const transferLink = await support(
      qr.id,
      'Pindahkan kepemilikan',
      true,
      'Tautan untuk pemilik',
    );
    await ownerLogin('0789', qr.token);
    await expect(owner.getByText('QR sedang ditangguhkan', { exact: true })).toBeVisible();
    await expect(owner.getByLabel(fieldLabel('Nama toko'))).toBeDisabled();
    await logoutOwner();
    await owner.goto(transferLink);
    await owner.getByLabel(fieldLabel('Nama toko baru')).fill('Toko Pemilik Baru');
    await owner
      .getByLabel(fieldLabel('Link review Google'))
      .fill('https://g.page/r/ui-transfer/review');
    await owner.getByLabel(fieldLabel('PIN baru')).fill('0987');
    await owner.getByLabel(fieldLabel('Konfirmasi PIN baru')).fill('0987');
    await owner.getByRole('button', { name: 'Konfirmasi pemindahan', exact: true }).click();
    await expect(
      owner.getByText('Kepemilikan berhasil dipindahkan', { exact: true }),
    ).toBeVisible();
    await ownerLogin('0987', qr.token);
    const newStats = await ownerContext.request.get(origin + '/api/v1/owner/me/stats');
    expect((await newStats.json()).data.total_visits).toBe(0);
    await logoutOwner();
    mark('Transfer grant, suspended read-only owner, new owner PIN/store and isolated statistics');

    stage = 'suspend resume retire';
    await support(qr.id, 'Tangguhkan QR');
    const suspended = await ownerContext.request.get(`${origin}/r/${qr.token}`, {
      maxRedirects: 0,
    });
    expect(suspended.status()).toBe(200);
    expect((await suspended.text()).includes('ditangguhkan')).toBeTruthy();
    await ownerLogin('0987', qr.token);
    await expect(owner.getByLabel(fieldLabel('Link review Google'))).toBeDisabled();
    await logoutOwner();
    await support(qr.id, 'Lanjutkan layanan');
    expect(
      (await ownerContext.request.get(`${origin}/r/${qr.token}`, { maxRedirects: 0 })).status(),
    ).toBe(302);
    await support(qr.id, 'Nonaktifkan permanen');
    expect(
      (await ownerContext.request.get(`${origin}/r/${qr.token}`, { maxRedirects: 0 })).status(),
    ).toBe(410);
    await admin.getByRole('tab', { name: 'Riwayat', exact: true }).click();
    await expect(admin.getByText('QR dinonaktifkan', { exact: true })).toBeVisible();
    mark('Suspend fallback/read-only, resume redirect, irreversible retire and audit trail');

    stage = 'global activity log';
    await admin.getByRole('link', { name: 'Log Aktivitas', exact: true }).click();
    await expect(admin.getByRole('heading', { name: 'Log Aktivitas', exact: true })).toBeVisible();
    await expect(
      admin.getByRole('button', { name: 'Muat lebih banyak', exact: true }),
    ).toBeVisible();
    const activityCount = await admin.locator('ol > li').count();
    await admin.getByRole('button', { name: 'Muat lebih banyak', exact: true }).click();
    await expect.poll(() => admin.locator('ol > li').count()).toBeGreaterThan(activityCount);
    await admin.getByLabel('Cari QR atau toko', { exact: true }).fill(qr.token);
    await admin.getByRole('combobox', { name: 'Tindakan', exact: true }).click();
    await admin.getByRole('option', { name: 'QR dinonaktifkan', exact: true }).click();
    const todayWib = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(
      new Date(),
    );
    await admin.getByLabel('Dari tanggal', { exact: true }).fill(todayWib);
    await admin.getByLabel('Sampai tanggal', { exact: true }).fill(todayWib);
    await admin.getByRole('button', { name: 'Terapkan filter', exact: true }).click();
    await expect(admin.locator('ol > li')).toHaveCount(1);
    await expect(admin.locator('ol').getByText('QR dinonaktifkan', { exact: true })).toBeVisible();
    await admin.getByText('Lihat perubahan', { exact: true }).click();
    await expect(admin.locator('pre')).toContainText('RETIRED');
    const closeToast = admin.locator('[data-sonner-toast] [data-close-button]');
    if (await closeToast.count()) await closeToast.first().click();
    await screenshot(admin, 'activity-desktop');
    await admin.setViewportSize({ width: 820, height: 1180 });
    await screenshot(admin, 'activity-ipad');
    await admin.setViewportSize({ width: 390, height: 844 });
    await screenshot(admin, 'activity-mobile');
    await admin.getByLabel('Cari QR atau toko', { exact: true }).fill('not-found');
    await admin.getByRole('button', { name: 'Terapkan filter', exact: true }).click();
    await expect(
      admin.getByRole('heading', { name: 'Tidak ada aktivitas yang cocok', exact: true }),
    ).toBeVisible();
    await admin.getByRole('button', { name: 'Hapus filter', exact: true }).click();
    await expect(admin.locator('ol > li').first()).toBeVisible();
    await admin.getByRole('button', { name: 'Perbarui aktivitas', exact: true }).click();
    await admin.locator(`a[href="/admin/qr-codes/${qr.id}?tab=audit"]`).first().click();
    await expect(admin.getByRole('tab', { name: 'Riwayat', exact: true })).toHaveAttribute(
      'data-state',
      'active',
    );
    await admin.setViewportSize({ width: 1440, height: 1000 });
    mark(
      'Global activity, pagination, QR/action/WIB dates, details, empty/reset/refresh, QR history link and responsive layouts',
    );

    stage = 'rotation and damage';
    const rotatedCode = await support(
      rotatedQr.id,
      'Rotasi kode aktivasi',
      false,
      'Kode aktivasi baru',
    );
    expect(rotatedCode).toMatch(/^[A-Z2-7]{16}$/);
    await admin.goto(`${origin}/admin/qr-codes/${damagedQr.id}`);
    await admin.getByRole('button', { name: 'Tandai rusak', exact: true }).click();
    await admin
      .getByLabel(fieldLabel('Catatan pemeriksaan'))
      .fill('Hasil produksi rusak dan tidak layak dijual');
    await admin.getByRole('button', { name: 'Konfirmasi unit rusak', exact: true }).click();
    await expect(
      admin.getByText('Unit ditandai rusak dan tidak lagi digunakan.', { exact: true }),
    ).toBeVisible();
    expect((await api(`/api/v1/admin/qr-codes/${damagedQr.id}`)).data.status).toBe('RETIRED');
    const secretJob = (
      await db.pool.query("SELECT id FROM qr_review.export_jobs WHERE kind='ACTIVATION_CODES'")
    ).rows[0].id;
    const expired = await adminContext.request.get(
      `${origin}/api/v1/admin/exports/${secretJob}/download`,
      { headers: { Authorization: `Bearer ${apiToken}` } },
    );
    expect(expired.status()).toBe(410);
    mark('Activation code rotation, damaged stock retirement, secret export invalidation');

    stage = 'rotated activation and expired session';
    const currentQr = (await api(`/api/v1/admin/qr-codes/${rotatedQr.id}`)).data;
    await api(
      `/api/v1/admin/qr-codes/${rotatedQr.id}/sales`,
      'POST',
      { reference: 'UI-SALE-ROTATE', sold_at: new Date(Date.now() - 1000).toISOString() },
      `"v${currentQr.version}"`,
    );
    await owner.goto(`${origin}/r/${rotatedQr.token}`);
    await owner
      .getByLabel(fieldLabel('Kode aktivasi'))
      .fill(codes.find((item) => item.token === rotatedQr.token)!.activation_code);
    await owner.getByLabel(fieldLabel('Nama toko')).fill('Unit rotasi');
    await owner
      .getByLabel(fieldLabel('Link review Google'))
      .fill('https://g.page/r/ui-rotate/review');
    await owner.getByLabel(fieldLabel('Buat PIN')).fill('0007');
    await owner.getByLabel(fieldLabel('Konfirmasi PIN')).fill('0007');
    await owner.getByRole('button', { name: 'Aktifkan QR toko', exact: true }).click();
    await expect(
      owner.getByText('Kode aktivasi tidak sesuai. Periksa kode pada kartu rahasia.', {
        exact: true,
      }),
    ).toBeVisible();
    await owner.getByLabel(fieldLabel('Kode aktivasi')).fill(rotatedCode);
    await owner.getByRole('button', { name: 'Aktifkan QR toko', exact: true }).click();
    await expect(owner.getByText('QR toko sudah aktif!', { exact: true })).toBeVisible();
    await ownerLogin('0007', rotatedQr.token);
    await expect(
      owner.getByRole('button', { name: 'Perbarui statistik', exact: true }),
    ).toBeEnabled();
    await db.pool.query(
      "UPDATE qr_review.owner_sessions SET expires_at=now()-interval '1 second' WHERE qr_id=$1",
      [rotatedQr.id],
    );
    await owner.getByRole('button', { name: 'Perbarui statistik', exact: true }).click();
    await expect(owner.getByLabel(fieldLabel('PIN pemilik'))).toBeVisible();
    await expect(
      owner.getByText('Sesi berakhir atau akses berubah. Masuk kembali untuk melanjutkan.', {
        exact: true,
      }),
    ).toBeVisible();
    mark('Rotated code activates, old code rejected, expired session returns to login');

    stage = 'credential cooldown';
    // A fresh source isolates this probe from earlier intentionally invalid activation/PIN attempts.
    await ownerContext.setExtraHTTPHeaders({ 'x-test-ip': '198.51.100.53' });
    for (let attempt = 0; attempt < 5; attempt++) {
      const failure = await ownerContext.request.post(origin + '/api/v1/owner/sessions', {
        headers: { Origin: origin },
        data: { token: rotatedQr.token, pin: '1111' },
      });
      expect(failure.status()).toBe(401);
    }
    await owner.getByLabel(fieldLabel('PIN pemilik')).fill('0007');
    await owner.getByRole('button', { name: 'Masuk ke kelola QR', exact: true }).click();
    await expect(
      owner.getByText('Terlalu banyak percobaan. Tunggu sebelum mencoba lagi.', { exact: true }),
    ).toBeVisible();
    await expect(owner.getByRole('button', { name: /Tunggu \d+ detik/ })).toBeDisabled();
    mark('Persisted credential rate limit displays countdown and disables submit');

    stage = 'API failure and retry';
    await admin.route('**/api/v1/admin/dashboard', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Layanan sementara tidak tersedia. Coba lagi.',
          },
          request_id: randomUUID(),
        }),
      }),
    );
    await admin.goto(origin + '/admin');
    await expect(
      admin.getByText('Layanan sementara tidak tersedia. Coba lagi.', { exact: true }),
    ).toBeVisible();
    await admin.unroute('**/api/v1/admin/dashboard');
    await admin.getByRole('button', { name: 'Coba lagi', exact: true }).click();
    await expect(admin.getByText('Status layanan QR', { exact: true })).toBeVisible();
    mark('Service unavailable state and successful manual retry');

    stage = 'mobile, errors and session expiry';
    await admin.goto(origin + '/admin');
    await expect(admin.getByText('Status layanan QR', { exact: true })).toBeVisible();
    await screenshot(admin, 'dashboard-desktop');
    await admin.setViewportSize({ width: 390, height: 844 });
    await screenshot(admin, 'dashboard-mobile');
    await admin.getByRole('button', { name: 'Buka navigasi', exact: true }).click();
    await expect(admin.getByRole('link', { name: 'Dukungan', exact: true })).toBeVisible();
    await admin.getByRole('link', { name: 'Dukungan', exact: true }).click();
    await expect(admin.getByRole('dialog')).toHaveCount(0);
    await expect(
      admin.getByRole('textbox', { name: 'Cari token atau nama toko', exact: true }),
    ).toBeVisible();
    await screenshot(admin, 'support-mobile');
    await admin.getByRole('combobox', { name: 'Filter status QR', exact: true }).click();
    await admin.getByRole('option', { name: 'Aktif', exact: true }).click();
    await admin.getByRole('combobox', { name: 'Filter stok', exact: true }).click();
    await admin.getByRole('option', { name: 'Terjual', exact: true }).click();
    await admin.getByRole('button', { name: 'Terapkan', exact: true }).click();
    await expect(admin.locator('tbody tr')).toHaveCount(1);
    await expect(admin.getByRole('cell', { name: 'Unit rotasi', exact: true })).toBeVisible();
    await expect(admin.getByRole('link', { name: 'Halaman pemilik', exact: true })).toBeVisible();
    await owner.goto(origin + '/r/AAAAAAAAAAAAAAAAAAAAAA');
    await expect(
      owner.getByRole('heading', { name: 'QR tidak ditemukan', exact: true }),
    ).toBeVisible();
    await screenshot(owner, 'fallback-mobile');
    await owner.goto(origin + '/help');
    await screenshot(owner, 'help-mobile');
    await owner.goto(origin + '/');
    await screenshot(owner, 'home-mobile');
    mark('Responsive desktop/mobile, mobile sidebar closes, unknown QR/help/home');

    stage = 'installed admin navigation';
    await expect(owner.getByRole('link', { name: 'Kembali ke admin', exact: true })).toHaveCount(0);
    const installed = await adminContext.newPage();
    await installed.setViewportSize({ width: 390, height: 844 });
    installed.on('pageerror', (error) => consoleErrors.push(error.name));
    await installed.addInitScript(() => {
      Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    });
    for (const path of ['/manage', '/help', '/']) {
      stage = `installed admin return ${path}`;
      await installed.goto(origin + path);
      await expect(
        installed.getByRole('link', { name: 'Kembali ke admin', exact: true }),
      ).toBeVisible();
      expect(
        await installed.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      ).toBe(true);
    }
    await installed.getByRole('link', { name: 'Kembali ke admin', exact: true }).click();
    await expect(installed).toHaveURL(origin + '/admin');
    const ownerLink = installed.getByRole('link', { name: 'Halaman pemilik', exact: true });
    await expect(ownerLink).toBeVisible();
    const opened = installed.waitForEvent('popup');
    await ownerLink.click();
    const ownerWindow = await opened;
    await ownerWindow.waitForURL(origin + '/manage');
    await expect(installed).toHaveURL(origin + '/admin');
    await ownerWindow.close();
    await installed.close();
    mark(
      'Installed admin retains its page when opening owner view, public pages provide return to admin, ordinary browser hides admin shortcut',
    );

    stage = 'admin logout';
    await admin.getByRole('button', { name: 'Buka navigasi', exact: true }).click();
    await admin.getByRole('button', { name: /Administrator/ }).click();
    await admin.getByRole('menuitem', { name: 'Keluar', exact: true }).click();
    await expect(admin).toHaveURL(/\/admin\/login/);
    await admin.goto(origin + '/admin');
    await expect(admin).toHaveURL(/\/admin\/login/);
    mark('Admin logout removes session and protected data');

    expect(consoleErrors).toEqual([]);
    const report = {
      verified_at: new Date().toISOString(),
      runtime:
        'Real production Next.js, temporary local PostgreSQL, signature-verified Auth simulation, Chromium desktop and mobile',
      checks,
      browser_page_errors: consoleErrors.length,
      screenshots: 'artifacts/ui/*.png',
      real_supabase_data_modified: false,
    };
    await writeFile('artifacts/ui-verification.json', JSON.stringify(report, null, 2) + '\n');
    console.log(`UI verification complete: ${checks.length} scenarios.`);
  } catch (error) {
    // Report only a fixed stage and error type; Playwright details can contain test secrets.
    console.error(
      `UI verification failed at ${stage} (${error instanceof Error ? error.name : 'unknown error'}).`,
    );
    if (process.env.UI_DEBUG === 'true' && error instanceof Error) {
      console.error(error.message);
      for (const context of browser?.contexts() || []) {
        const page = context.pages()[0];
        if (page) console.error((await page.locator('body').innerText()).slice(0, 2500));
      }
      console.error('Browser page error types:', consoleErrors);
    }
    process.exitCode = 1;
  } finally {
    await browser?.close();
    if (next && next.exitCode === null) {
      next.kill('SIGTERM');
      await once(next, 'exit');
    }
    await Promise.all([
      new Promise<void>((resolve) => proxy.close(() => resolve())),
      new Promise<void>((resolve) => auth.close(() => resolve())),
    ]);
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
}
main().catch(() => {
  console.error('UI verification setup failed. Check local PostgreSQL and openssl.');
  process.exitCode = 1;
});
