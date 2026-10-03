'use client';

import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { AlertCircle, ArrowRight, Check, Copy, Loader2, QrCode, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiFailure, failureMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { QrStatus, StockStatus } from '@/lib/types';

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      href="/"
      className="inline-flex items-center gap-2.5 font-semibold tracking-tight"
      aria-label="QR Review — beranda"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
        <QrCode className="size-5" />
      </span>
      {!compact && (
        <span className="text-lg">
          QR<span className="font-normal text-muted-foreground"> Review</span>
        </span>
      )}
    </Link>
  );
}
export function Loading({ label = 'Memuat data…' }: { label?: string }) {
  return (
    <div
      role="status"
      className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground"
    >
      <Loader2 className="size-4 animate-spin" />
      {label}
    </div>
  );
}
export function FormError({ error, cooldown = 0 }: { error: unknown; cooldown?: number }) {
  if (!error) return null;
  return (
    <Alert variant="destructive" role="alert">
      <AlertCircle />
      <AlertTitle>Periksa kembali</AlertTitle>
      <AlertDescription>
        <p>{failureMessage(error)}</p>
        {cooldown > 0 && (
          <p className="mt-1">
            Coba lagi dalam {Math.ceil(cooldown / 60)} menit ({cooldown} detik).
          </p>
        )}
        {error instanceof ApiFailure && error.requestId && (
          <p className="mt-2 break-all text-xs opacity-70">Kode bantuan: {error.requestId}</p>
        )}
      </AlertDescription>
    </Alert>
  );
}
export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertCircle className="size-6" />
        </span>
        <div className="max-w-md">
          <h2 className="font-semibold">Data belum dapat dimuat</h2>
          <p className="mt-2 text-sm text-muted-foreground">{failureMessage(error)}</p>
        </div>
        {retry && (
          <Button variant="outline" onClick={retry}>
            <RefreshCw />
            Coba lagi
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed px-6 py-14 text-center">
      <span className="flex size-12 items-center justify-center rounded-xl border bg-background text-muted-foreground">
        <QrCode className="size-6" />
      </span>
      <div className="max-w-sm">
        <h3 className="font-semibold">{title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-2 text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground">
            {eyebrow}
          </p>
        )}
        <h1 className="text-2xl font-semibold tracking-tight [overflow-wrap:anywhere] md:text-3xl">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {action && <div className="flex shrink-0 flex-wrap gap-2">{action}</div>}
    </div>
  );
}
export const qrLabels: Record<QrStatus, string> = {
  UNACTIVATED: 'Belum aktif',
  ACTIVE: 'Aktif',
  SUSPENDED: 'Ditangguhkan',
  RETIRED: 'Tidak digunakan',
};
export const stockLabels: Record<StockStatus, string> = {
  GENERATED: 'Unit baru',
  AVAILABLE: 'Siap dijual',
  SOLD: 'Terjual',
  DAMAGED: 'Rusak',
};
export function StatusBadge({
  value,
  stock = false,
}: {
  value: QrStatus | StockStatus;
  stock?: boolean;
}) {
  const labels: Record<string, string> = stock ? stockLabels : qrLabels;
  return (
    <Badge
      variant="outline"
      className={cn(
        'gap-1.5 whitespace-nowrap font-normal',
        ['ACTIVE', 'AVAILABLE'].includes(value) &&
          'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
        ['SUSPENDED', 'GENERATED'].includes(value) &&
          'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200',
        ['RETIRED', 'DAMAGED'].includes(value) &&
          'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200',
        value === 'SOLD' &&
          'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200',
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {labels[value]}
    </Badge>
  );
}
export function InputField({
  label,
  help,
  error,
  ...props
}: ComponentProps<'input'> & { label: string; help?: ReactNode; error?: unknown }) {
  const id = props.id || props.name;
  const message =
    error instanceof ApiFailure
      ? error.details.find((detail) => detail.field === props.name)?.message
      : null;
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>
        {label}
        {props.required && (
          <span className="text-destructive" aria-hidden="true">
            *
          </span>
        )}
      </Label>
      <Input
        {...props}
        id={id}
        aria-invalid={Boolean(message)}
        aria-describedby={message || help ? `${id}-help` : undefined}
      />
      {(message || help) && (
        <p
          id={`${id}-help`}
          className={cn(
            'text-xs leading-relaxed',
            message ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {message || help}
        </p>
      )}
    </div>
  );
}
export function SubmitButton({
  pending,
  cooldown = 0,
  children,
  className,
}: {
  pending: boolean;
  cooldown?: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Button type="submit" disabled={pending || cooldown > 0} className={className}>
      {pending ? <Loader2 className="animate-spin" /> : <ArrowRight />}
      {pending ? 'Memproses…' : cooldown > 0 ? `Tunggu ${cooldown} detik` : children}
    </Button>
  );
}
export function CopyButton({
  value,
  label = 'Salin',
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      toast.success('Berhasil disalin.');
    } catch {
      toast.error('Tidak bisa menyalin otomatis. Pilih dan salin teks secara manual.');
    }
  }
  return (
    <Button type="button" variant="outline" size="sm" className={className} onClick={copy}>
      <Copy />
      {label}
    </Button>
  );
}
export function SuccessState({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="space-y-6 py-4 text-center">
      <span className="mx-auto flex size-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200">
        <Check className="size-8" />
      </span>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}
