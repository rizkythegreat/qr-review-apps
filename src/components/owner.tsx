'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  ArrowRight,
  CircleHelp,
  Clock,
  KeyRound,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Store,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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
import { ReviewLinkHelp } from '@/components/review-link-help';
import { useAction } from '@/hooks/use-action';
import { useClock } from '@/hooks/use-clock';
import { useOwnerApi } from '@/hooks/use-owner-api';
import { apiRequest, ApiFailure } from '@/lib/api';
import { parsePublicToken, dateTime, number } from '@/lib/format';
import { fieldFailure, validatePins, validateStore } from '@/lib/form-validation';
import type { ApiResponse, OwnerQr, OwnerSession, OwnerStats } from '@/lib/types';

const meKey = ['owner', 'me'];
export function OwnerArea({ initialToken = '' }: { initialToken?: string }) {
  const queries = useQueryClient();
  const query = useQuery<ApiResponse<OwnerSession> | null>({
    queryKey: meKey,
    queryFn: ({ signal }) => apiRequest<OwnerSession>('/api/v1/owner/me', { signal }),
    refetchInterval: 60000,
    staleTime: 0,
  });
  const now = useClock();
  const [notice, setNotice] = useState('');
  const [remembered, setRemembered] = useState(initialToken);
  const session = query.data?.data;
  const expired = session && new Date(session.expires_at).getTime() <= now;
  async function login(result: ApiResponse<OwnerSession>) {
    await queries.cancelQueries({ queryKey: ['owner'] });
    queries.removeQueries({ queryKey: ['owner', 'stats'] });
    queries.setQueryData(meKey, result);
    setRemembered(result.data.qr.token);
    setNotice('');
    void queries.invalidateQueries({ queryKey: meKey });
  }
  async function signedOut(message: string) {
    await queries.cancelQueries({ queryKey: ['owner'] });
    if (session) setRemembered(session.qr.token);
    queries.setQueryData(meKey, null);
    queries.removeQueries({ queryKey: ['owner', 'stats'] });
    setNotice(message);
  }
  if (query.isPending) return <Loading label="Memeriksa sesi pemilik…" />;
  if (query.isError && !(query.error instanceof ApiFailure && query.error.status === 401))
    return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  if (!session || expired || query.isError)
    return (
      <div className="mx-auto max-w-lg">
        <OwnerLogin
          initialToken={remembered || session?.qr.token || initialToken}
          notice={
            notice ||
            (session ? 'Sesi berakhir atau akses berubah. Masuk kembali untuk melanjutkan.' : '')
          }
          onSuccess={login}
        />
      </div>
    );
  return (
    <OwnerDashboard
      key={`${session.qr.id}:${session.qr.ownership_id}`}
      session={session}
      etag={query.data?.etag || `"v${session.qr.version}"`}
      now={now}
      onSignOut={signedOut}
    />
  );
}
function OwnerLogin({
  initialToken,
  notice,
  onSuccess,
}: {
  initialToken: string;
  notice: string;
  onSuccess: (session: ApiResponse<OwnerSession>) => void;
}) {
  const action = useAction(async (body: { token: string; pin: string }) => {
    if (!/^[A-Za-z0-9_-]{22}$/.test(body.token))
      fieldFailure('token', 'Masukkan token 22 karakter atau alamat QR lengkap.');
    if (!/^[0-9]{4}$/.test(body.pin))
      fieldFailure('pin', 'PIN harus terdiri dari empat digit angka.');
    return apiRequest<OwnerSession>('/api/v1/owner/sessions', { method: 'POST', body });
  });
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await action.run({
      token: parsePublicToken(String(form.get('token'))) || '',
      pin: String(form.get('pin')),
    });
    if (result) onSuccess(result);
  }
  return (
    <div className="space-y-6">
      <div>
        <Badge variant="outline" className="mb-4 bg-background">
          <Store className="size-3" />
          Area pemilik
        </Badge>
        <h1 className="text-3xl font-semibold tracking-tight">Kelola QR toko.</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Masuk dengan token QR dan PIN untuk mengubah data toko serta melihat kunjungan.
        </p>
      </div>
      {notice && (
        <Alert>
          <ShieldCheck />
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={submit} className="space-y-5">
            <fieldset disabled={action.pending} className="space-y-5">
              <InputField
                label="Token atau alamat QR"
                name="token"
                defaultValue={initialToken}
                placeholder="Token 22 karakter atau https://…/r/…"
                maxLength={2048}
                required
                autoComplete="off"
                error={action.error}
                help="Token adalah bagian setelah /r/ pada alamat QR Anda."
              />
              <InputField
                label="PIN pemilik"
                name="pin"
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                pattern="[0-9]{4}"
                minLength={4}
                maxLength={4}
                required
                placeholder="4 digit angka"
                error={action.error}
              />
            </fieldset>
            <FormError error={action.error} cooldown={action.cooldown} />
            <SubmitButton pending={action.pending} cooldown={action.cooldown} className="w-full">
              Masuk ke kelola QR
            </SubmitButton>
            <p className="text-center text-xs text-muted-foreground">
              Lupa PIN?{' '}
              <Link
                href="/help"
                className="font-medium text-foreground underline underline-offset-4"
              >
                Hubungi penjual untuk bantuan
              </Link>
              .
            </p>
          </form>
        </CardContent>
      </Card>
      <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <KeyRound className="size-3.5" />
        Pemilik tidak perlu membuat akun baru.
      </p>
    </div>
  );
}
function OwnerDashboard({
  session,
  etag,
  now,
  onSignOut,
}: {
  session: OwnerSession;
  etag: string;
  now: number;
  onSignOut: (notice: string) => void;
}) {
  const { qr } = session;
  const api = useOwnerApi();
  const stats = useQuery({
    queryKey: ['owner', 'stats', qr.ownership_id],
    queryFn: ({ signal }) => api<OwnerStats>('/api/v1/owner/me/stats', { signal }),
    refetchInterval: 60000,
  });
  const logout = useAction<Record<string, never>, ApiResponse<null>>(() =>
    api<null>('/api/v1/owner/session/logout', { method: 'POST', csrf: session.csrf_token }),
  );
  async function signOut() {
    if (await logout.run({})) onSignOut('Anda sudah keluar.');
  }
  return (
    <div className="space-y-7">
      <PageHeading
        eyebrow="Area pemilik"
        title={qr.store_name || 'QR toko Anda'}
        description="Perbarui tujuan QR dan lihat kunjungan toko Anda."
        action={
          <>
            <StatusBadge value={qr.status} />
            <Button
              variant="outline"
              size="sm"
              disabled={logout.pending}
              onClick={() => void signOut()}
            >
              <LogOut />
              Keluar
            </Button>
          </>
        }
      />
      <FormError error={logout.error} />
      {session.read_only && (
        <Alert className="border-amber-200 bg-amber-50">
          <CircleHelp />
          <AlertTitle>QR sedang ditangguhkan</AlertTitle>
          <AlertDescription>
            Anda dapat melihat informasi, tetapi perubahan pengaturan dinonaktifkan.{' '}
            <Link href="/help" className="font-medium underline">
              Hubungi penjual untuk bantuan.
            </Link>
          </AlertDescription>
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="shadow-none">
          <CardHeader>
            <CardDescription className="flex items-center gap-2">
              <Activity className="size-4" />
              Total kunjungan QR
            </CardDescription>
            <CardTitle className="text-3xl font-semibold tabular-nums">
              {stats.data ? number(stats.data.data.total_visits) : stats.isPending ? '…' : '—'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Jumlah akses QR selama kepemilikan Anda, bukan ulasan yang terkirim.
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardHeader>
            <CardDescription className="flex items-center gap-2">
              <Clock className="size-4" />
              Kunjungan terakhir
            </CardDescription>
            <CardTitle className="text-lg font-medium">
              {stats.data
                ? dateTime(stats.data.data.last_visited_at)
                : stats.isPending
                  ? 'Memuat…'
                  : 'Belum tersedia'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Button
              variant="ghost"
              size="sm"
              className="-ml-3 text-xs"
              onClick={() => void stats.refetch()}
              disabled={stats.isFetching}
            >
              <RefreshCw className={stats.isFetching ? 'animate-spin' : ''} />
              Perbarui statistik
            </Button>
          </CardContent>
        </Card>
      </div>
      {stats.isError && <ErrorState error={stats.error} retry={() => void stats.refetch()} />}
      <OwnerProfile session={session} etag={etag} />
      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Akses dan keamanan</CardTitle>
            <CardDescription>PIN digunakan untuk mengelola unit ini.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs leading-relaxed text-muted-foreground">
              Sesi berakhir dalam{' '}
              {Math.min(
                30,
                Math.max(1, Math.ceil((new Date(session.expires_at).getTime() - now) / 60000)),
              )}{' '}
              menit. Mengganti PIN akan mengakhiri sesi dan meminta Anda masuk kembali.
            </p>
            {!session.read_only && (
              <ChangePin
                session={session}
                etag={etag}
                onSuccess={() => onSignOut('PIN diperbarui. Masuk kembali menggunakan PIN baru.')}
              />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Token QR Anda</CardTitle>
            <CardDescription>Simpan token untuk membuka halaman kelola kembali.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border bg-muted/30 p-3">
              <code className="break-all text-sm">{qr.token}</code>
            </div>
            <CopyButton value={qr.token} label="Salin token" />
          </CardContent>
        </Card>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-background p-4">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CircleHelp className="size-4" />
          Perlu bantuan PIN atau pemindahan pemilik?
        </p>
        <Button asChild variant="ghost" size="sm">
          <Link href="/help">
            Buka panduan
            <ArrowRight />
          </Link>
        </Button>
      </div>
    </div>
  );
}
function OwnerProfile({ session, etag }: { session: OwnerSession; etag: string }) {
  const api = useOwnerApi();
  const queries = useQueryClient();
  const [baseline, setBaseline] = useState({ qr: session.qr, etag });
  const [name, setName] = useState(session.qr.store_name || '');
  const [review, setReview] = useState(session.qr.review_url || '');
  const changed =
    name.trim() !== baseline.qr.store_name || review.trim() !== baseline.qr.review_url;
  const newer = session.qr.version > baseline.qr.version;
  const action = useAction(async (body: { store_name?: string; review_url?: string }) => {
    validateStore(name.trim(), review.trim());
    return api<OwnerQr>('/api/v1/owner/me', {
      method: 'PATCH',
      body,
      etag: baseline.etag,
      csrf: session.csrf_token,
    });
  });
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!changed || session.read_only) return;
    const body = {
      ...(name.trim() !== baseline.qr.store_name ? { store_name: name.trim() } : {}),
      ...(review.trim() !== baseline.qr.review_url ? { review_url: review.trim() } : {}),
    };
    const result = await action.run(body);
    if (!result) return;
    setBaseline({ qr: result.data, etag: result.etag || `"v${result.data.version}"` });
    setName(result.data.store_name || '');
    setReview(result.data.review_url || '');
    queries.setQueryData<ApiResponse<OwnerSession> | null>(meKey, (current) =>
      current
        ? { ...current, etag: result.etag, data: { ...current.data, qr: result.data } }
        : current,
    );
    toast.success('Data toko berhasil diperbarui.');
  }
  function reload() {
    setBaseline({ qr: session.qr, etag });
    setName(session.qr.store_name || '');
    setReview(session.qr.review_url || '');
    action.clearError();
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Informasi toko dan tujuan QR</CardTitle>
        <CardDescription>
          Perubahan link berlaku pada scan berikutnya. QR yang dicetak tetap sama.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-5">
          {newer && (
            <Alert>
              <RefreshCw />
              <AlertTitle>Data toko sudah berubah</AlertTitle>
              <AlertDescription>
                Isian Anda tetap disimpan di halaman ini. Muat data terbaru sebelum menyimpan
                kembali.
                <Button type="button" size="sm" variant="outline" className="mt-3" onClick={reload}>
                  Gunakan data terbaru
                </Button>
              </AlertDescription>
            </Alert>
          )}
          <fieldset disabled={action.pending || session.read_only} className="space-y-5">
            <InputField
              label="Nama toko"
              name="store_name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              error={action.error}
            />
            <InputField
              label="Link review Google"
              name="review_url"
              type="url"
              value={review}
              onChange={(event) => setReview(event.target.value)}
              maxLength={2048}
              required
              error={action.error}
            />
          </fieldset>
          <ReviewLinkHelp value={review.trim()} />
          <FormError error={action.error} />
          {!session.read_only && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
              <p className="text-xs text-muted-foreground">
                Terakhir diubah {dateTime(baseline.qr.updated_at)}.
              </p>
              <Button type="submit" disabled={!changed || newer || action.pending}>
                {action.pending ? <RefreshCw className="animate-spin" /> : <ShieldCheck />}Simpan
                perubahan
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
function ChangePin({
  session,
  etag,
  onSuccess,
}: {
  session: OwnerSession;
  etag: string;
  onSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);
  const api = useOwnerApi();
  const action = useAction(
    async (body: { current_pin: string; new_pin: string; new_pin_confirmation: string }) => {
      validatePins(body.new_pin, body.new_pin_confirmation, 'new_pin', 'new_pin_confirmation');
      if (body.current_pin === body.new_pin)
        fieldFailure('new_pin', 'PIN baru harus berbeda dengan PIN saat ini.');
      return api<null>('/api/v1/owner/me/pin', {
        method: 'POST',
        body,
        etag,
        csrf: session.csrf_token,
      });
    },
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await action.run({
      current_pin: String(form.get('current_pin')),
      new_pin: String(form.get('new_pin')),
      new_pin_confirmation: String(form.get('new_pin_confirmation')),
    });
    if (result) {
      setOpen(false);
      onSuccess();
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!action.pending) {
          setOpen(value);
          action.clearError();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <KeyRound />
          Ganti PIN
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ganti PIN pemilik</DialogTitle>
          <DialogDescription>
            Semua sesi akan berakhir setelah PIN diperbarui. Masuk kembali dengan PIN baru.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-5">
          <fieldset disabled={action.pending} className="space-y-4">
            <InputField
              label="PIN saat ini"
              name="current_pin"
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              pattern="[0-9]{4}"
              minLength={4}
              maxLength={4}
              required
              error={action.error}
            />
            <InputField
              label="PIN baru"
              name="new_pin"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              pattern="[0-9]{4}"
              minLength={4}
              maxLength={4}
              required
              error={action.error}
            />
            <InputField
              label="Konfirmasi PIN baru"
              name="new_pin_confirmation"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              pattern="[0-9]{4}"
              minLength={4}
              maxLength={4}
              required
              error={action.error}
            />
          </fieldset>
          <FormError error={action.error} cooldown={action.cooldown} />
          <SubmitButton pending={action.pending} cooldown={action.cooldown}>
            Simpan PIN baru
          </SubmitButton>
        </form>
      </DialogContent>
    </Dialog>
  );
}
