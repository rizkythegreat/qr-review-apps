'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { EmptyState, ErrorState, Loading } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAdminList } from '@/hooks/use-admin-resource';
import { auditActions } from '@/lib/audit';
import type { ActivityEvent } from '@/lib/types';

const emptyFilters = { search: '', action: 'ALL', from: '', to: '' };
const timeFormat = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Jakarta',
});

export function ActivityLog() {
  const [draft, setDraft] = useState(emptyFilters);
  const [filters, setFilters] = useState(emptyFilters);
  const params = new URLSearchParams();
  if (filters.search) params.set('search', filters.search);
  if (filters.action !== 'ALL') params.set('action', filters.action);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  const query = useAdminList<ActivityEvent>(
    `/api/v1/admin/audit-events${params.size ? `?${params}` : ''}`,
  );
  const rows = query.data?.pages.flatMap((page) => page.data) || [];
  function submit(event: FormEvent) {
    event.preventDefault();
    setFilters({ ...draft, search: draft.search.trim() });
  }
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="text-base">Riwayat seluruh QR</CardTitle>
            <CardDescription>
              Terbaru lebih dahulu. Waktu dan filter tanggal menggunakan WIB.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCw className={query.isFetching ? 'animate-spin' : ''} />
            Perbarui aktivitas
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="min-w-0 space-y-2">
              <Label htmlFor="activity-search">Cari QR atau toko</Label>
              <Input
                id="activity-search"
                value={draft.search}
                maxLength={120}
                placeholder="Token, ID QR, atau nama toko"
                onChange={(event) => setDraft({ ...draft, search: event.target.value })}
              />
            </div>
            <div className="min-w-0 space-y-2">
              <Label htmlFor="activity-action">Tindakan</Label>
              <Select
                value={draft.action}
                onValueChange={(action) => setDraft({ ...draft, action })}
              >
                <SelectTrigger id="activity-action" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Semua tindakan</SelectItem>
                  {Object.entries(auditActions)
                    .filter(([action]) => !['SUSPENDED', 'RESUMED', 'RETIRED'].includes(action))
                    .map(([action, label]) => (
                      <SelectItem key={action} value={action}>
                        {label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0 space-y-2">
              <Label htmlFor="activity-from">Dari tanggal</Label>
              <Input
                id="activity-from"
                type="date"
                value={draft.from}
                max={draft.to || undefined}
                onChange={(event) => setDraft({ ...draft, from: event.target.value })}
              />
            </div>
            <div className="min-w-0 space-y-2">
              <Label htmlFor="activity-to">Sampai tanggal</Label>
              <Input
                id="activity-to"
                type="date"
                value={draft.to}
                min={draft.from || undefined}
                onChange={(event) => setDraft({ ...draft, to: event.target.value })}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit">Terapkan filter</Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setDraft(emptyFilters);
                setFilters(emptyFilters);
              }}
            >
              Hapus filter
            </Button>
          </div>
        </form>
        {query.isPending ? (
          <Loading />
        ) : query.isError && !rows.length ? (
          <ErrorState error={query.error} retry={() => void query.refetch()} />
        ) : !rows.length ? (
          <EmptyState
            title={params.size ? 'Tidak ada aktivitas yang cocok' : 'Belum ada aktivitas'}
            description={
              params.size
                ? 'Ubah atau hapus filter untuk melihat riwayat lainnya.'
                : 'Riwayat akan muncul setelah QR dibuat atau diperbarui.'
            }
          />
        ) : (
          <>
            <ol className="divide-y">
              {rows.map((row) => (
                <li key={row.id} className="space-y-3 py-5 first:pt-0">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      <p className="text-sm font-medium">
                        {auditActions[row.action] || row.action}
                      </p>
                      <Link
                        href={`/admin/qr-codes/${row.qr_id}?tab=audit`}
                        className="break-all text-sm text-primary underline-offset-4 hover:underline"
                      >
                        {row.store_name || 'QR belum diaktifkan'} ·{' '}
                        <span className="font-mono text-xs">{row.qr_token}</span>
                      </Link>
                    </div>
                    <time dateTime={row.created_at} className="text-xs text-muted-foreground">
                      {timeFormat.format(new Date(row.created_at))} WIB
                    </time>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {row.actor_type === 'ADMIN'
                      ? 'Admin'
                      : row.actor_type === 'OWNER'
                        ? 'Pemilik'
                        : 'Sistem'}
                  </p>
                  {row.reason && (
                    <p className="break-words text-sm text-muted-foreground">{row.reason}</p>
                  )}
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground">
                      Lihat perubahan
                    </summary>
                    <pre className="mt-2 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-3">
                      {JSON.stringify(row.changes, null, 2)}
                    </pre>
                  </details>
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <p className="text-xs text-muted-foreground">{rows.length} aktivitas ditampilkan</p>
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
          </>
        )}
        {query.isError && rows.length > 0 && (
          <ErrorState
            error={query.error}
            retry={() =>
              void (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch())
            }
          />
        )}
      </CardContent>
    </Card>
  );
}
