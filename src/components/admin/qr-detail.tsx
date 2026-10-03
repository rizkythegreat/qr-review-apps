'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowUpRight,
  ClipboardCheck,
  Download,
  ExternalLink,
  Loader2,
  ShoppingBag,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  CopyButton,
  ErrorState,
  FormError,
  InputField,
  Loading,
  PageHeading,
  StatusBadge,
  SubmitButton,
} from '@/components/common';
import { useAdminApi, useAdminAuth, useAdminBlob } from '@/components/providers';
import { useAdminList, useAdminResource } from '@/hooks/use-admin-resource';
import { useAction } from '@/hooks/use-action';
import { dateTime } from '@/lib/format';
import { auditActions } from '@/lib/audit';
import { saveBlob } from '@/lib/api';
import { SupportActions } from './support-actions';
import type { AdminQr, AuditEvent, Sale } from '@/lib/types';

export function QrDetail({ id, initialTab = 'overview' }: { id: string; initialTab?: string }) {
  const query = useAdminResource<AdminQr>(`/api/v1/admin/qr-codes/${id}`);
  const qr = query.data?.data;
  const [tab, setTab] = useState(initialTab);
  if (query.isPending) return <Loading />;
  if (query.isError || !qr)
    return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const etag = query.data?.etag || null;
  return (
    <>
      <Link
        href="/admin/qr-codes"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Daftar QR
      </Link>
      <PageHeading
        eyebrow="Detail unit"
        title={qr.store_name || 'QR belum diaktifkan'}
        description="Kelola stok, penjualan, dan layanan untuk unit ini."
        action={
          <>
            <StatusBadge value={qr.status} />
            <StatusBadge value={qr.stock_status} stock />
          </>
        }
      />
      <Tabs value={tab} onValueChange={setTab} className="gap-6">
        <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
          <TabsTrigger value="overview">Ringkasan</TabsTrigger>
          <TabsTrigger value="sales">Penjualan</TabsTrigger>
          <TabsTrigger value="audit">Riwayat</TabsTrigger>
          <TabsTrigger value="support">Dukungan</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="space-y-5">
          <div className="grid gap-5 lg:grid-cols-3">
            <QrPreview qr={qr} />
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Informasi unit</CardTitle>
                <CardDescription>Token dan alamat QR tetap sama setelah dicetak.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Token QR</p>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <code className="break-all text-sm">{qr.token}</code>
                    <CopyButton value={qr.token} label="Salin token" />
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Alamat QR publik</p>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <a
                      href={qr.public_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all text-sm underline underline-offset-4"
                    >
                      {qr.public_url}
                    </a>
                    <CopyButton value={qr.public_url} label="Salin link" />
                  </div>
                </div>
                <div className="grid gap-5 border-t pt-5 sm:grid-cols-2">
                  <Detail label="Dibuat" value={dateTime(qr.created_at)} />
                  <Detail label="Aktivasi" value={dateTime(qr.activated_at)} />
                  <Detail label="Terakhir diubah" value={dateTime(qr.updated_at)} />
                  <div>
                    <p className="mb-2 text-xs text-muted-foreground">Batch produksi</p>
                    <Link
                      href={`/admin/batches/${qr.batch_id}`}
                      className="inline-flex items-center gap-1 text-sm font-medium hover:underline"
                    >
                      Lihat batch
                      <ArrowUpRight className="size-3.5" />
                    </Link>
                  </div>
                </div>
                {qr.review_url && (
                  <div className="border-t pt-5">
                    <p className="mb-2 text-xs text-muted-foreground">Tujuan review</p>
                    <a
                      href={qr.review_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 break-all text-sm underline underline-offset-4"
                    >
                      {qr.review_url}
                      <ExternalLink className="size-3.5 shrink-0" />
                    </a>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
          {qr.status === 'UNACTIVATED' && ['GENERATED', 'AVAILABLE'].includes(qr.stock_status) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Stok dan penjualan</CardTitle>
                <CardDescription>
                  Catat penjualan untuk mengizinkan pemilik mengaktifkan QR.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-3">
                <Button onClick={() => setTab('sales')}>
                  <ShoppingBag />
                  Catat penjualan
                </Button>
                <DamageAction qr={qr} etag={etag} />
              </CardContent>
            </Card>
          )}
        </TabsContent>
        <TabsContent value="sales">
          <Sales qr={qr} etag={etag} />
        </TabsContent>
        <TabsContent value="audit">
          <AuditLog qrId={qr.id} />
        </TabsContent>
        <TabsContent value="support">
          <SupportActions qr={qr} etag={etag} />
        </TabsContent>
      </Tabs>
    </>
  );
}
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="mb-2 text-xs text-muted-foreground">{label}</p>
      <p className="text-sm">{value}</p>
    </div>
  );
}
function QrPreview({ qr }: { qr: AdminQr }) {
  const blob = useAdminBlob();
  const { session } = useAdminAuth();
  const image = useQuery({
    queryKey: ['admin', session?.user.id, 'image', qr.id],
    queryFn: async ({ signal }) => {
      const bytes = await blob(`/api/v1/admin/qr-codes/${qr.id}/image?format=png&size_px=256`, {
        signal,
      });
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Image unavailable'));
        reader.readAsDataURL(bytes);
      });
    },
    staleTime: Infinity,
  });
  const download = useAction(async (format: 'png' | 'svg') => {
    saveBlob(
      await blob(`/api/v1/admin/qr-codes/${qr.id}/image?format=${format}&size_px=1024`),
      `qr-${qr.token}.${format}`,
    );
    return true;
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">QR publik</CardTitle>
        <CardDescription>Hanya memuat alamat publik unit.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {image.isPending ? (
          <Loading label="Memuat QR…" />
        ) : image.isError ? (
          <ErrorState error={image.error} retry={() => void image.refetch()} />
        ) : (
          <div className="mx-auto flex aspect-square max-w-64 items-center justify-center rounded-xl border bg-white p-4">
            <Image
              src={image.data}
              width={256}
              height={256}
              unoptimized
              alt={`QR publik ${qr.token}`}
            />
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            disabled={download.pending}
            onClick={() => void download.run('png')}
          >
            <Download />
            PNG
          </Button>
          <Button
            variant="outline"
            disabled={download.pending}
            onClick={() => void download.run('svg')}
          >
            <Download />
            SVG
          </Button>
        </div>
        <FormError error={download.error} />
      </CardContent>
    </Card>
  );
}
function DamageAction({ qr, etag }: { qr: AdminQr; etag: string | null }) {
  const [open, setOpen] = useState(false);
  const [openedEtag, setOpenedEtag] = useState(etag);
  const api = useAdminApi();
  const queries = useQueryClient();
  const action = useAction((body: { stock_status: 'DAMAGED'; reason: string }) =>
    api<AdminQr>(`/api/v1/admin/qr-codes/${qr.id}/stock`, {
      method: 'PATCH',
      body,
      etag: openedEtag,
    }),
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await action.run({
      stock_status: 'DAMAGED',
      reason: String(new FormData(event.currentTarget).get('reason')).trim(),
    });
    if (!result) return;
    setOpen(false);
    toast.success('Unit ditandai rusak dan tidak lagi digunakan.');
    void queries.invalidateQueries({ queryKey: ['admin'] });
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!action.pending) {
          if (value) setOpenedEtag(etag);
          setOpen(value);
          action.clearError();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <ClipboardCheck />
          Tandai rusak
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tandai unit rusak</DialogTitle>
          <DialogDescription>
            Unit akan dinonaktifkan dan tidak dapat dijual atau diaktifkan. Paket kode batch juga
            tidak lagi berlaku.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-5">
          <div className="grid gap-2">
            <Label htmlFor="stock-reason-damaged">Catatan pemeriksaan</Label>
            <Textarea
              id="stock-reason-damaged"
              name="reason"
              minLength={5}
              maxLength={500}
              required
              placeholder="Tuliskan hasil pemeriksaan unit…"
            />
          </div>
          <FormError error={action.error} />
          <SubmitButton pending={action.pending}>Konfirmasi unit rusak</SubmitButton>
        </form>
      </DialogContent>
    </Dialog>
  );
}
function Sales({ qr, etag }: { qr: AdminQr; etag: string | null }) {
  if (qr.stock_status === 'SOLD') return <SaleInformation qrId={qr.id} />;
  if (!['GENERATED', 'AVAILABLE'].includes(qr.stock_status) || qr.status !== 'UNACTIVATED')
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Penjualan belum tersedia</CardTitle>
          <CardDescription>
            Penjualan hanya dapat dicatat untuk unit baru atau siap dijual yang belum diaktifkan.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  return <SaleForm qr={qr} etag={etag} />;
}
function SaleForm({ qr, etag }: { qr: AdminQr; etag: string | null }) {
  const api = useAdminApi();
  const queries = useQueryClient();
  const [when] = useState(() => {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const action = useAction(
    (
      body: { reference: string; sold_at: string; buyer_name?: string; support_contact?: string },
      key,
    ) => api<Sale>(`/api/v1/admin/qr-codes/${qr.id}/sales`, { method: 'POST', body, etag, key }),
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const buyer_name = String(form.get('buyer_name')).trim();
    const support_contact = String(form.get('support_contact')).trim();
    const result = await action.run({
      reference: String(form.get('reference')).trim(),
      sold_at: new Date(String(form.get('sold_at'))).toISOString(),
      ...(buyer_name ? { buyer_name } : {}),
      ...(support_contact ? { support_contact } : {}),
    });
    if (result) {
      toast.success('Penjualan tercatat. Pemilik dapat mengaktifkan QR.');
      void queries.invalidateQueries({ queryKey: ['admin'] });
    }
  }
  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <ShoppingBag className="mb-2 size-6 text-muted-foreground" />
        <CardTitle>Catat penjualan</CardTitle>
        <CardDescription>
          Setelah tercatat terjual, pemilik dapat mengaktifkan QR menggunakan kode pada kartu.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <InputField
              label="Referensi penjualan"
              name="reference"
              placeholder="SALE-20261002-001"
              maxLength={100}
              required
              error={action.error}
            />
            <InputField
              label="Waktu penjualan"
              name="sold_at"
              type="datetime-local"
              defaultValue={when}
              required
              error={action.error}
            />
            <InputField
              label="Nama pembeli (opsional)"
              name="buyer_name"
              maxLength={120}
              placeholder="Nama pada nota penjualan"
              error={action.error}
            />
            <InputField
              label="Kontak dukungan (opsional)"
              name="support_contact"
              maxLength={120}
              placeholder="Kontak untuk referensi dukungan"
              error={action.error}
            />
          </div>
          <FormError error={action.error} cooldown={action.cooldown} />
          <SubmitButton pending={action.pending} cooldown={action.cooldown}>
            Simpan penjualan
          </SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
function SaleInformation({ qrId }: { qrId: string }) {
  const query = useAdminResource<Sale>(`/api/v1/admin/qr-codes/${qrId}/sales`);
  if (query.isPending) return <Loading />;
  if (query.isError || !query.data)
    return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const sale = query.data.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Penjualan tercatat</CardTitle>
        <CardDescription>
          Referensi ini membantu pemeriksaan permintaan dukungan pemilik.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 sm:grid-cols-2">
        <Detail label="Referensi penjualan" value={sale.reference} />
        <Detail label="Waktu penjualan" value={dateTime(sale.sold_at)} />
        <Detail label="Pembeli" value={sale.buyer_name || 'Tidak diisi'} />
        <Detail label="Kontak dukungan" value={sale.support_contact || 'Tidak diisi'} />
      </CardContent>
    </Card>
  );
}
export function AuditLog({ qrId }: { qrId: string }) {
  const query = useAdminList<AuditEvent>(`/api/v1/admin/qr-codes/${qrId}/audit-events`);
  const rows = query.data?.pages.flatMap((page) => page.data) || [];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Riwayat tindakan</CardTitle>
        <CardDescription>
          Penjualan, aktivasi, perubahan toko, dan dukungan untuk unit ini.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {query.isPending ? (
          <Loading />
        ) : query.isError && !rows.length ? (
          <ErrorState error={query.error} retry={() => void query.refetch()} />
        ) : (
          <div className="space-y-0">
            {rows.map((row) => (
              <div key={row.id} className="relative flex gap-4 border-l pb-7 pl-6 last:pb-0">
                <span className="absolute -left-1.5 top-1 size-3 rounded-full border-2 border-background bg-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap justify-between gap-2">
                    <p className="text-sm font-medium">{auditActions[row.action] || row.action}</p>
                    <p className="text-xs text-muted-foreground">{dateTime(row.created_at)}</p>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {row.actor_type === 'ADMIN'
                      ? 'Admin'
                      : row.actor_type === 'OWNER'
                        ? 'Pemilik'
                        : 'Sistem'}
                  </p>
                  {row.reason && <p className="mt-2 text-sm text-muted-foreground">{row.reason}</p>}
                  <details className="mt-2 text-xs">
                    <summary className="cursor-pointer text-muted-foreground">
                      Lihat perubahan
                    </summary>
                    <pre className="mt-2 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-3">
                      {JSON.stringify(row.changes, null, 2)}
                    </pre>
                  </details>
                </div>
              </div>
            ))}
            {query.hasNextPage && (
              <Button
                variant="outline"
                className="mt-6"
                onClick={() => void query.fetchNextPage()}
                disabled={query.isFetchingNextPage}
              >
                {query.isFetchingNextPage && <Loader2 className="animate-spin" />}Riwayat berikutnya
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
