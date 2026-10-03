import { randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import QRCode from 'qrcode';
import type { Pool, PoolClient } from 'pg';
import type { Config } from './config';
import { decrypt, encrypt } from './crypto';
import { transaction } from './db';
import { ApiError, conflict, logFailure, missing } from './errors';
import { batchView, exportView, type Batch, type ExportJob, type Qr } from './models';
import type { BodyOf } from './validation';

export async function qrImage(origin: string, token: string, format: 'png' | 'svg', size: number) {
  const options = {
    width: size,
    margin: 4,
    errorCorrectionLevel: 'M' as const,
    color: { dark: '#000000', light: '#ffffff' },
  };
  if (format === 'png') return QRCode.toBuffer(`${origin}/r/${token}`, { ...options, type: 'png' });
  const svg = await QRCode.toString(`${origin}/r/${token}`, { ...options, type: 'svg' });
  const grid = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  if (!grid || grid[1] !== grid[2]) throw new Error('Unexpected QR SVG grid');
  // Keep the generated QR paths, scaling their module grid into the contracted pixel viewBox.
  return Buffer.from(
    svg
      .replace(grid[0], `viewBox="0 0 ${size} ${size}"`)
      .replace('<path', `<g transform="scale(${size / Number(grid[1])})"><path`)
      .replace('</svg>', '</g></svg>'),
  );
}
export async function getBatch(db: Pool | PoolClient, id: string, lock = false) {
  const b = (
    await db.query<Batch>(
      `SELECT * FROM qr_review.qr_batches WHERE id=$1 ${lock ? 'FOR UPDATE' : ''}`,
      [id],
    )
  ).rows[0];
  if (!b) missing();
  return b;
}
export async function snapshotAvailable(db: Pool | PoolClient, b: Batch) {
  if (
    !b.snapshot_valid ||
    !b.activation_snapshot ||
    b.activation_codes_expires_at.getTime() <= Date.now()
  )
    return false;
  return !(
    await db.query(
      `SELECT 1 FROM qr_review.qr_codes WHERE batch_id=$1 AND
    (status<>'UNACTIVATED' OR activation_hash IS NULL) LIMIT 1`,
      [b.id],
    )
  ).rowCount;
}
export async function createExport(db: PoolClient, id: string, b: BodyOf<'createExport'>) {
  const batch = await getBatch(db, id, true);
  if (b.kind === 'ACTIVATION_CODES' && !(await snapshotAvailable(db, batch)))
    conflict('ACTIVATION_EXPORT_UNAVAILABLE');
  const job = (
    await db.query<ExportJob>(
      `INSERT INTO qr_review.export_jobs(id,batch_id,kind,image_format,size_px,expires_at)
    VALUES($1,$2,$3,$4,$5,LEAST(now()+interval '24 hours',$6::timestamptz)) RETURNING *`,
      [
        randomUUID(),
        id,
        b.kind,
        b.image_format || 'png',
        b.size_px || 1024,
        b.kind === 'ACTIVATION_CODES'
          ? batch.activation_codes_expires_at
          : new Date(Date.now() + 86400000),
      ],
    )
  ).rows[0];
  return { result: { status: 202, data: exportView(job) } };
}
export async function inspectExport(db: PoolClient, id: string) {
  const initial = (
    await db.query<ExportJob>('SELECT * FROM qr_review.export_jobs WHERE id=$1', [id])
  ).rows[0];
  if (!initial) missing();
  // Lock ordering is batch -> export everywhere, including worker finalization and snapshot invalidation.
  const batch = await getBatch(db, initial.batch_id, true);
  let job = (
    await db.query<ExportJob>('SELECT * FROM qr_review.export_jobs WHERE id=$1 FOR UPDATE', [id])
  ).rows[0];
  const invalid = job.kind === 'ACTIVATION_CODES' && !(await snapshotAvailable(db, batch));
  if (job.expires_at.getTime() <= Date.now() || invalid) {
    job = (
      await db.query<ExportJob>(
        `UPDATE qr_review.export_jobs SET status='EXPIRED',artifact=NULL,
      failure_code=$2 WHERE id=$1 RETURNING *`,
        [id, invalid ? 'ACTIVATION_EXPORT_UNAVAILABLE' : null],
      )
    ).rows[0];
  }
  return job;
}
export function download(config: Config, job: ExportJob) {
  if (job.status === 'EXPIRED')
    throw new ApiError(410, 'EXPORT_EXPIRED', 'Arsip kedaluwarsa atau snapshot sudah tidak valid.');
  if (job.status !== 'READY' || !job.artifact) conflict('EXPORT_NOT_READY');
  const body =
    job.kind === 'ACTIVATION_CODES'
      ? Buffer.from(decrypt<string>(config, job.artifact, `export:${job.id}`), 'base64')
      : job.artifact;
  return {
    body,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${job.kind === 'PUBLIC_QR' ? 'qr-public' : 'activation-codes'}-${job.id}.zip"`,
    },
  };
}
export interface ExportProcessingOptions {
  jobId?: string;
  maxDurationMs?: number;
  maxArtifactBytes?: number;
}
class ExportLimitError extends Error {
  constructor(readonly code: 'EXPORT_TIME_LIMIT' | 'EXPORT_TOO_LARGE') {
    super(code);
  }
}
export async function processOneExport(
  pool: Pool,
  config: Config,
  options: ExportProcessingOptions = {},
) {
  const deadline = Date.now() + (options.maxDurationMs ?? Infinity);
  function checkTime() {
    if (Date.now() >= deadline) throw new ExportLimitError('EXPORT_TIME_LIMIT');
  }
  const job = await transaction(pool, async (db) => {
    const row = (
      await db.query<ExportJob>(
        `SELECT * FROM qr_review.export_jobs WHERE
      ($1::uuid IS NULL OR id=$1) AND
      (status='QUEUED' OR (status='RUNNING' AND started_at<now()-interval '5 minutes'))
      ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1`,
        [options.jobId ?? null],
      )
    ).rows[0];
    if (!row) return undefined;
    return (
      await db.query<ExportJob>(
        `UPDATE qr_review.export_jobs SET status='RUNNING',started_at=now(),lease_id=$2 WHERE id=$1 RETURNING *`,
        [row.id, randomUUID()],
      )
    ).rows[0];
  });
  if (!job) return false;
  try {
    checkTime();
    const batch = await getBatch(pool, job.batch_id);
    if (
      job.expires_at.getTime() <= Date.now() ||
      (job.kind === 'ACTIVATION_CODES' && !(await snapshotAvailable(pool, batch)))
    ) {
      await pool.query(
        "UPDATE qr_review.export_jobs SET status='EXPIRED',artifact=NULL WHERE id=$1 AND lease_id=$2",
        [job.id, job.lease_id],
      );
      return true;
    }
    const zip = new JSZip();
    if (job.kind === 'ACTIVATION_CODES') {
      const codes = decrypt<{ token: string; activation_code: string }[]>(
        config,
        batch.activation_snapshot!,
        `batch:${batch.id}`,
      );
      zip.file(
        'activation-codes.csv',
        'token,activation_code\r\n' +
          codes.map((c) => `${c.token},${c.activation_code}`).join('\r\n') +
          '\r\n',
      );
    } else {
      const units = (
        await pool.query<Qr>('SELECT * FROM qr_review.qr_codes WHERE batch_id=$1 ORDER BY token', [
          batch.id,
        ])
      ).rows;
      zip.file(
        'manifest.csv',
        'token,public_url,filename\r\n' +
          units
            .map(
              (q) =>
                `${q.token},${config.PUBLIC_ORIGIN}/r/${q.token},qr/${q.token}.${job.image_format}`,
            )
            .join('\r\n') +
          '\r\n',
      );
      // Sequential generation bounds memory/CPU; durable jobs can survive application restarts.
      for (const q of units) {
        checkTime();
        zip.file(
          `qr/${q.token}.${job.image_format}`,
          await qrImage(config.PUBLIC_ORIGIN, q.token, job.image_format, job.size_px),
        );
      }
    }
    checkTime();
    const bytes = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 3 },
    });
    checkTime();
    if (options.maxArtifactBytes !== undefined && bytes.length > options.maxArtifactBytes)
      throw new ExportLimitError('EXPORT_TOO_LARGE');
    await transaction(pool, async (db) => {
      const current = await inspectExport(db, job.id);
      if (current.status !== 'RUNNING' || current.lease_id !== job.lease_id) return;
      const artifact =
        job.kind === 'ACTIVATION_CODES'
          ? encrypt(config, bytes.toString('base64'), `export:${job.id}`)
          : bytes;
      await db.query(
        "UPDATE qr_review.export_jobs SET status='READY',artifact=$2,failure_code=NULL WHERE id=$1",
        [job.id, artifact],
      );
    });
  } catch (error) {
    logFailure('export_failed');
    await pool.query(
      "UPDATE qr_review.export_jobs SET status='FAILED',failure_code=$3,artifact=NULL WHERE id=$1 AND lease_id=$2 AND status='RUNNING'",
      [
        job.id,
        job.lease_id,
        error instanceof ExportLimitError ? error.code : 'EXPORT_GENERATION_FAILED',
      ],
    );
  }
  return true;
}
export { batchView };
