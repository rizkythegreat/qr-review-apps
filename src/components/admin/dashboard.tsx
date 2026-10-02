'use client';

import Link from 'next/link';
import { ArrowRight, Package, Clock, ShieldQuestion } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState, ErrorState, Loading, PageHeading, qrLabels } from '@/components/common';
import { SectionCards } from '@/components/section-cards';
import { CreateBatch } from './create-batch';
import { useAdminResource } from '@/hooks/use-admin-resource';
import { dateTime, number } from '@/lib/format';
import type { Batch, Dashboard, QrStatus } from '@/lib/types';

export function AdminDashboard() {
  const dashboard = useAdminResource<Dashboard>('/api/v1/admin/dashboard');
  const batches = useAdminResource<Batch[]>('/api/v1/admin/batches?limit=5');
  const data = dashboard.data?.data;
  return (
    <>
      <PageHeading
        eyebrow="Ruang kerja"
        title="Dashboard"
        description="Pantau produksi, stok, dan QR yang sudah digunakan toko."
        action={<CreateBatch />}
      />
      {dashboard.isPending ? (
        <Loading />
      ) : dashboard.isError || !data ? (
        <ErrorState error={dashboard.error} retry={() => void dashboard.refetch()} />
      ) : (
        <>
          <SectionCards data={data} />
          <div className="grid gap-5 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Status layanan QR</CardTitle>
                <CardDescription>Aktivasi dilakukan setelah unit tercatat terjual.</CardDescription>
              </CardHeader>
              <CardContent>
                <div
                  className="mb-6 flex h-3 overflow-hidden rounded-full bg-muted"
                  aria-hidden="true"
                >
                  {(Object.keys(qrLabels) as QrStatus[]).map((status, i) => (
                    <div
                      key={status}
                      className={
                        ['bg-stone-300', 'bg-emerald-600', 'bg-amber-400', 'bg-rose-400'][i]
                      }
                      style={{
                        width: `${data.total_units ? (data.qr_counts[status] / data.total_units) * 100 : 0}%`,
                      }}
                    />
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
                  {(Object.entries(qrLabels) as [QrStatus, string][]).map(([status, label], i) => (
                    <Link
                      key={status}
                      href={`/admin/qr-codes?status=${status}`}
                      className="space-y-2"
                    >
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span
                          className={`size-2 rounded-full ${['bg-stone-300', 'bg-emerald-600', 'bg-amber-400', 'bg-rose-400'][i]}`}
                        />
                        {label}
                      </div>
                      <p className="text-xl font-semibold tabular-nums">
                        {number(data.qr_counts[status])}
                      </p>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
            <Card className="bg-muted/35">
              <CardHeader>
                <Clock className="mb-2 size-5 text-muted-foreground" />
                <CardTitle className="text-base">Siapkan unit berikutnya</CardTitle>
                <CardDescription>
                  {number(data.stock_counts.GENERATED)} unit menunggu pemeriksaan kualitas.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="mb-5 text-sm leading-relaxed text-muted-foreground">
                  Periksa hasil cetak, lalu tandai unit layak sebagai siap dijual.
                </p>
                <Button asChild variant="outline" className="w-full justify-between">
                  <Link href="/admin/qr-codes?stock_status=GENERATED">
                    Lihat antrean QC
                    <ArrowRight />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </div>
          <p className="-mt-3 text-xs text-muted-foreground">
            Data diperbarui {dateTime(data.as_of)}.
          </p>
        </>
      )}
      <Card className="gap-0 overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between pb-5">
          <div>
            <CardTitle className="text-base">Batch terbaru</CardTitle>
            <CardDescription className="mt-1.5">
              Produksi terbaru dan jumlah unitnya.
            </CardDescription>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/admin/batches">
              Lihat semua
              <ArrowRight />
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {batches.isPending ? (
            <Loading />
          ) : batches.isError ? (
            <div className="px-6 pb-6">
              <ErrorState error={batches.error} retry={() => void batches.refetch()} />
            </div>
          ) : !batches.data?.data.length ? (
            <div className="px-6 pb-6">
              <EmptyState
                title="Mulai batch pertama"
                description="Buat QR unik, unduh bahan produksi, lalu catat unit yang sudah terjual."
                action={<CreateBatch />}
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/35">
                  <TableHead className="pl-6">Nama batch</TableHead>
                  <TableHead>Jumlah unit</TableHead>
                  <TableHead>Dibuat</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.data.data.map((batch) => (
                  <TableRow key={batch.id}>
                    <TableCell className="pl-6">
                      <Link
                        href={`/admin/batches/${batch.id}`}
                        className="inline-flex items-center gap-2 font-medium hover:underline"
                      >
                        <Package className="size-4 text-muted-foreground" />
                        {batch.label}
                      </Link>
                    </TableCell>
                    <TableCell>{number(batch.quantity)} unit</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {dateTime(batch.created_at)}
                    </TableCell>
                    <TableCell className="pr-6">
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/admin/batches/${batch.id}`}>
                          <ArrowRight />
                          <span className="sr-only">Detail {batch.label}</span>
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <div className="flex items-center gap-3 rounded-xl border bg-muted/20 p-4 text-sm">
        <ShieldQuestion className="size-5 shrink-0 text-muted-foreground" />
        <p className="flex-1 text-muted-foreground">Pemilik lupa PIN atau ingin memindahkan QR?</p>
        <Button asChild size="sm" variant="ghost">
          <Link href="/admin/support">
            Buka dukungan
            <ArrowRight />
          </Link>
        </Button>
      </div>
    </>
  );
}
