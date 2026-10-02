'use client';

import { useCallback, useMemo, useState, useSyncExternalStore, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileArchive, KeyRound, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { FormError, InputField, SubmitButton } from '@/components/common';
import { useAdminApi, useAdminAuth } from '@/components/providers';
import { useAction } from '@/hooks/use-action';
import { useClock } from '@/hooks/use-clock';
import { apiBlob, ApiFailure, saveBlob } from '@/lib/api';
import { dateTime } from '@/lib/format';
import type { Batch, ExportJob } from '@/lib/types';

const changedEvent = 'qr-review-export-jobs';
function subscribe(listener: () => void) {
  window.addEventListener('storage', listener);
  window.addEventListener(changedEvent, listener);
  return () => {
    window.removeEventListener('storage', listener);
    window.removeEventListener(changedEvent, listener);
  };
}
export function BatchExports({ batch }: { batch: Batch }) {
  const api = useAdminApi();
  const { session } = useAdminAuth();
  const storageKey = `qr-review:exports:${session?.user.id}:${batch.id}`;
  const getSnapshot = useCallback(() => {
    try {
      return localStorage.getItem(storageKey) || '[]';
    } catch {
      return '[]';
    }
  }, [storageKey]);
  const saved = useSyncExternalStore(subscribe, getSnapshot, () => '[]');
  const [volatile, setVolatile] = useState<string[]>([]);
  const ids = useMemo(() => {
    try {
      const parsed: unknown = JSON.parse(saved);
      return [
        ...new Set([
          ...(Array.isArray(parsed)
            ? parsed.filter(
                (id): id is string => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id),
              )
            : []),
          ...volatile,
        ]),
      ].slice(-12);
    } catch {
      return volatile;
    }
  }, [saved, volatile]);
  const [format, setFormat] = useState('png');
  const action = useAction(
    (
      body: { kind: 'PUBLIC_QR' | 'ACTIVATION_CODES'; image_format?: string; size_px?: number },
      key,
    ) => api<ExportJob>(`/api/v1/admin/batches/${batch.id}/exports`, { method: 'POST', body, key }),
  );
  const now = useClock(30000);
  const expired = new Date(batch.activation_codes_expires_at).getTime() <= now;
  async function create(body: {
    kind: 'PUBLIC_QR' | 'ACTIVATION_CODES';
    image_format?: string;
    size_px?: number;
  }) {
    const result = await action.run(body);
    if (!result) return;
    const next = [...new Set([...ids, result.data.id])].slice(-12);
    setVolatile(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      window.dispatchEvent(new Event(changedEvent));
    } catch {
      /* The live page still tracks the job when storage is unavailable. */
    }
    toast.success('Ekspor masuk antrean. Status akan diperbarui otomatis.');
  }
  async function publicExport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await create({
      kind: 'PUBLIC_QR',
      image_format: format,
      size_px: Number(new FormData(event.currentTarget).get('size_px')),
    });
  }
  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <span className="mb-2 flex size-10 items-center justify-center rounded-lg border bg-muted">
              <FileArchive className="size-5" />
            </span>
            <CardTitle className="text-base">QR publik untuk produksi</CardTitle>
            <CardDescription>
              Gambar QR dan daftar token. Bagikan paket ini kepada vendor cetak.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={publicExport} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="export-format">Format gambar</Label>
                  <Select value={format} onValueChange={setFormat}>
                    <SelectTrigger id="export-format" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="png">PNG</SelectItem>
                      <SelectItem value="svg">SVG</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <InputField
                  label="Ukuran (px)"
                  name="size_px"
                  type="number"
                  min={256}
                  max={2048}
                  step={1}
                  defaultValue={1024}
                  required
                />
              </div>
              <SubmitButton pending={action.pending} cooldown={action.cooldown} className="w-full">
                Siapkan QR publik
              </SubmitButton>
            </form>
          </CardContent>
        </Card>
        <Card className="border-amber-200 bg-amber-50/30">
          <CardHeader>
            <span className="mb-2 flex size-10 items-center justify-center rounded-lg border border-amber-200 bg-amber-50 text-amber-800">
              <KeyRound className="size-5" />
            </span>
            <CardTitle className="text-base">Kode aktivasi rahasia</CardTitle>
            <CardDescription>
              Simpan terpisah dari QR publik, lalu kemas sebagai kartu tertutup untuk pemilik.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs leading-relaxed text-muted-foreground">
              {expired
                ? 'Masa ekspor kode aktivasi sudah berakhir.'
                : `Tersedia hingga ${dateTime(batch.activation_codes_expires_at)}. Unduh sebelum unit pertama dalam batch diaktifkan; setelah itu paket kode batch tidak tersedia lagi.`}
            </p>
            <Button
              variant="outline"
              className="w-full border-amber-300 bg-background"
              disabled={expired || action.pending || action.cooldown > 0}
              onClick={() => void create({ kind: 'ACTIVATION_CODES' })}
            >
              <ShieldCheck />
              Siapkan kode aktivasi
            </Button>
          </CardContent>
        </Card>
      </div>
      <FormError error={action.error} cooldown={action.cooldown} />
      {ids.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Status dan unduhan ekspor</CardTitle>
            <CardDescription>
              Paket publik dan rahasia dibuat serta diunduh secara terpisah.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {[...ids].reverse().map((id) => (
              <ExportItem key={id} id={id} batchId={batch.id} />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
function ExportItem({ id, batchId }: { id: string; batchId: string }) {
  const api = useAdminApi();
  const { client, session } = useAdminAuth();
  const query = useQuery({
    queryKey: ['admin', session?.user.id, 'export', id],
    queryFn: ({ signal }) => api<ExportJob>(`/api/v1/admin/exports/${id}`, { signal }),
    refetchInterval: (query) =>
      ['QUEUED', 'RUNNING'].includes(query.state.data?.data.status || '') ? 2500 : false,
  });
  const download = useAction<Record<string, never>, boolean>(async () => {
    const { data } = client ? await client.auth.getSession() : { data: { session: null } };
    if (!data.session) throw new ApiFailure('UNAUTHENTICATED', 'Silakan masuk kembali.', 401);
    const job = query.data?.data;
    if (!job?.download_path) throw new ApiFailure('EXPORT_NOT_READY', 'Ekspor belum siap.', 409);
    const blob = await apiBlob(job.download_path, { bearer: data.session.access_token });
    saveBlob(
      blob,
      `${job.kind === 'PUBLIC_QR' ? 'qr-publik' : 'kode-aktivasi-rahasia'}-${batchId}.zip`,
    );
    return true;
  });
  const job = query.data?.data;
  const labels = {
    QUEUED: 'Dalam antrean',
    RUNNING: 'Diproses',
    READY: 'Siap diunduh',
    FAILED: 'Gagal',
    EXPIRED: 'Kedaluwarsa',
  };
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          {job?.kind === 'ACTIVATION_CODES' ? (
            <KeyRound className="size-5 text-amber-700" />
          ) : (
            <FileArchive className="size-5 text-muted-foreground" />
          )}
          <div>
            <p className="text-sm font-medium">
              {job?.kind === 'ACTIVATION_CODES' ? 'Kode aktivasi rahasia' : 'QR publik'}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {job ? dateTime(job.created_at) : 'Memuat status…'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {job && (
            <Badge variant={job.status === 'READY' ? 'default' : 'outline'}>
              {['QUEUED', 'RUNNING'].includes(job.status) && (
                <Loader2 className="size-3 animate-spin" />
              )}
              {labels[job.status]}
            </Badge>
          )}
          <Button
            variant="ghost"
            size="icon"
            aria-label="Perbarui status ekspor"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCw className={query.isFetching ? 'animate-spin' : ''} />
          </Button>
          {job?.status === 'READY' && (
            <Button size="sm" disabled={download.pending} onClick={() => void download.run({})}>
              {download.pending ? <Loader2 className="animate-spin" /> : <Download />}Unduh ZIP
            </Button>
          )}
        </div>
      </div>
      {job?.status === 'READY' && (
        <p className="text-xs text-muted-foreground">
          Unduhan berlaku hingga {dateTime(job.expires_at)}.
        </p>
      )}
      {job?.status === 'FAILED' && (
        <Alert variant="destructive">
          <AlertDescription>
            Ekspor gagal disiapkan. Periksa ketersediaan kode, lalu buat ekspor baru.
          </AlertDescription>
        </Alert>
      )}
      {job?.status === 'EXPIRED' && (
        <p className="text-xs text-muted-foreground">
          Paket ini tidak lagi berlaku. Buat ekspor baru bila masih tersedia.
        </p>
      )}
      <FormError error={query.error || download.error} />
    </div>
  );
}
