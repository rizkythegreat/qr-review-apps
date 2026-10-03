'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { ArrowUpRight, Loader2, Search, SlidersHorizontal, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  EmptyState,
  ErrorState,
  Loading,
  StatusBadge,
  qrLabels,
  stockLabels,
} from '@/components/common';
import { CreateBatch } from '@/components/admin/create-batch';
import { useAdminList } from '@/hooks/use-admin-resource';
import { date } from '@/lib/format';
import type { AdminQr } from '@/lib/types';

interface Filters {
  search: string;
  status: string;
  stock_status: string;
}
const emptyFilters: Filters = { search: '', status: 'ALL', stock_status: 'ALL' };
export function QrList({
  batchId,
  initial = emptyFilters,
  title = 'Daftar QR',
  support = false,
}: {
  batchId?: string;
  initial?: Filters;
  title?: string;
  support?: boolean;
}) {
  const [draft, setDraft] = useState<Filters>(initial);
  const [filters, setFilters] = useState<Filters>(initial);
  const params = new URLSearchParams();
  if (batchId) params.set('batch_id', batchId);
  if (filters.search.trim()) params.set('search', filters.search.trim());
  if (filters.status !== 'ALL') params.set('status', filters.status);
  if (filters.stock_status !== 'ALL') params.set('stock_status', filters.stock_status);
  const query = useAdminList<AdminQr>(`/api/v1/admin/qr-codes${params.size ? `?${params}` : ''}`);
  const rows = query.data?.pages.flatMap((page) => page.data) || [];
  const filtered = filters.search || filters.status !== 'ALL' || filters.stock_status !== 'ALL';
  function submit(event: FormEvent) {
    event.preventDefault();
    setFilters({ ...draft, search: draft.search.trim() });
  }
  return (
    <Card className="gap-0 overflow-hidden">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">{title}</CardTitle>
          <span className="text-xs text-muted-foreground">Terbaru lebih dahulu</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 px-0 pb-0">
        <form onSubmit={submit} className="flex flex-col gap-3 px-6 lg:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              name="search"
              aria-label="Cari token atau nama toko"
              value={draft.search}
              maxLength={120}
              onChange={(event) => setDraft({ ...draft, search: event.target.value })}
              placeholder="Cari token atau nama toko…"
              className="pl-9"
            />
          </div>
          <Select value={draft.status} onValueChange={(status) => setDraft({ ...draft, status })}>
            <SelectTrigger className="w-full lg:w-44" aria-label="Filter status QR">
              <SelectValue placeholder="Status QR" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Semua status QR</SelectItem>
              {Object.entries(qrLabels).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={draft.stock_status}
            onValueChange={(stock_status) => setDraft({ ...draft, stock_status })}
          >
            <SelectTrigger className="w-full lg:w-44" aria-label="Filter stok">
              <SelectValue placeholder="Status stok" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Semua stok</SelectItem>
              {Object.entries(stockLabels).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="submit" variant="outline">
            <SlidersHorizontal />
            Terapkan
          </Button>
          {filtered && (
            <Button
              type="button"
              variant="ghost"
              aria-label="Hapus filter"
              onClick={() => {
                setDraft(emptyFilters);
                setFilters(emptyFilters);
              }}
            >
              <X />
            </Button>
          )}
        </form>
        {query.isPending ? (
          <Loading />
        ) : query.isError && !rows.length ? (
          <div className="px-6 pb-6">
            <ErrorState error={query.error} retry={() => void query.refetch()} />
          </div>
        ) : !rows.length ? (
          <div className="px-6 pb-6">
            <EmptyState
              title={filtered ? 'Tidak ada QR yang cocok' : 'Belum ada QR'}
              description={
                filtered
                  ? 'Ubah kata pencarian atau filter untuk melihat unit lainnya.'
                  : 'Buat batch pertama untuk memulai produksi QR toko.'
              }
              action={!filtered && !batchId ? <CreateBatch /> : undefined}
            />
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/35">
                  <TableHead className="pl-6">Token QR</TableHead>
                  <TableHead>Nama toko</TableHead>
                  <TableHead>Status QR</TableHead>
                  <TableHead>Stok</TableHead>
                  <TableHead>Dibuat</TableHead>
                  <TableHead className="w-12">
                    <span className="sr-only">Detail</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((qr) => (
                  <TableRow key={qr.id}>
                    <TableCell className="pl-6">
                      <Link
                        href={`/admin/qr-codes/${qr.id}${support ? '?tab=support' : ''}`}
                        className="font-mono text-xs font-medium underline-offset-4 hover:underline"
                      >
                        {qr.token}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <span className={!qr.store_name ? 'text-muted-foreground' : 'font-medium'}>
                        {qr.store_name || 'Belum diaktifkan'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <StatusBadge value={qr.status} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge value={qr.stock_status} stock />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {date(qr.created_at)}
                    </TableCell>
                    <TableCell className="pr-6">
                      <Button
                        asChild
                        size="icon"
                        variant="ghost"
                        aria-label={`Detail QR ${qr.token}`}
                      >
                        <Link href={`/admin/qr-codes/${qr.id}${support ? '?tab=support' : ''}`}>
                          <ArrowUpRight />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex items-center justify-between gap-3 border-t px-6 py-4">
              <p className="text-xs text-muted-foreground">{rows.length} unit ditampilkan</p>
              {query.hasNextPage ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={query.isFetchingNextPage}
                  onClick={() => void query.fetchNextPage()}
                >
                  {query.isFetchingNextPage && <Loader2 className="animate-spin" />}Muat lebih
                  banyak
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">Semua hasil sudah ditampilkan</span>
              )}
            </div>
            {query.isFetchNextPageError && (
              <div className="px-6 pb-4">
                <ErrorState error={query.error} retry={() => void query.fetchNextPage()} />
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
