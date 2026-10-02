'use client';

import Link from 'next/link';
import { ArrowLeft, ArrowUpRight, Loader2, Package, CalendarClock } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState, ErrorState, Loading, PageHeading } from '@/components/common';
import { CreateBatch } from './create-batch';
import { QrList } from './qr-list';
import { BatchExports } from './exports';
import { useAdminList, useAdminResource } from '@/hooks/use-admin-resource';
import { dateTime, number } from '@/lib/format';
import type { Batch } from '@/lib/types';

export function BatchList() {
  const query = useAdminList<Batch>('/api/v1/admin/batches');
  const rows = query.data?.pages.flatMap((page) => page.data) || [];
  return (
    <>
      <PageHeading
        eyebrow="Produksi"
        title="Batch produksi"
        description="Buat QR unik dan unduh paket untuk produksi serta aktivasi toko."
        action={<CreateBatch />}
      />
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : !rows.length ? (
        <EmptyState
          title="Belum ada batch produksi"
          description="Mulai dengan satu batch. Setiap unit akan memiliki token QR dan kode aktivasi yang berbeda."
          action={<CreateBatch />}
        />
      ) : (
        <Card className="gap-0 overflow-hidden py-0">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/35">
                  <TableHead className="pl-6">Nama batch</TableHead>
                  <TableHead>Jumlah unit</TableHead>
                  <TableHead>Dibuat</TableHead>
                  <TableHead>Batas ekspor kode</TableHead>
                  <TableHead className="w-14" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((batch) => (
                  <TableRow key={batch.id}>
                    <TableCell className="pl-6">
                      <Link
                        href={`/admin/batches/${batch.id}`}
                        className="flex items-center gap-3 font-medium hover:underline"
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/40">
                          <Package className="size-4 text-muted-foreground" />
                        </span>
                        {batch.label}
                      </Link>
                    </TableCell>
                    <TableCell>{number(batch.quantity)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {dateTime(batch.created_at)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {dateTime(batch.activation_codes_expires_at)}
                    </TableCell>
                    <TableCell className="pr-6">
                      <Button
                        asChild
                        size="icon"
                        variant="ghost"
                        aria-label={`Detail batch ${batch.label}`}
                      >
                        <Link href={`/admin/batches/${batch.id}`}>
                          <ArrowUpRight />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex items-center justify-between border-t px-6 py-4">
              <p className="text-xs text-muted-foreground">{rows.length} batch ditampilkan</p>
              {query.hasNextPage && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={query.isFetchingNextPage}
                  onClick={() => void query.fetchNextPage()}
                >
                  {query.isFetchingNextPage && <Loader2 className="animate-spin" />}Muat lebih
                  banyak
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
export function BatchDetail({ id }: { id: string }) {
  const query = useAdminResource<Batch>(`/api/v1/admin/batches/${id}`);
  const batch = query.data?.data;
  if (query.isPending) return <Loading />;
  if (query.isError || !batch)
    return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  return (
    <>
      <Link
        href="/admin/batches"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Semua batch
      </Link>
      <PageHeading
        eyebrow="Detail produksi"
        title={batch.label}
        description={`${number(batch.quantity)} unit · Dibuat ${dateTime(batch.created_at)}`}
      />
      <div className="flex items-start gap-2 rounded-lg border bg-muted/30 p-4 text-xs leading-relaxed text-muted-foreground">
        <CalendarClock className="mt-0.5 size-4 shrink-0" />
        Unduh paket kode aktivasi sebelum {dateTime(batch.activation_codes_expires_at)} dan sebelum
        aktivasi unit pertama. Simpan terpisah dari paket QR publik.
      </div>
      <BatchExports batch={batch} />
      <QrList batchId={id} title="Unit dalam batch" />
    </>
  );
}
