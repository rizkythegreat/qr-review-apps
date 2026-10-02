'use client';

// Adapted from the official shadcn/ui login-04 block.
import Link from 'next/link';
import { useEffect, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowUpRight, QrCode, ShieldCheck, Star } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { FieldGroup, FieldDescription } from '@/components/ui/field';
import { FormError, InputField, Loading, SubmitButton } from '@/components/common';
import { useAdminAuth } from '@/components/providers';
import { useAdminResource } from '@/hooks/use-admin-resource';
import { useAction } from '@/hooks/use-action';
import { apiRequest, ApiFailure } from '@/lib/api';

export function LoginForm() {
  const { client, session, loading } = useAdminAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next');
  const destination =
    next?.startsWith('/admin/') && !next.startsWith('/admin/login') && !/[\\\r\n]/.test(next)
      ? next
      : '/admin';
  const access = useAdminResource<{ user_id: string; role: 'ADMIN' }>('/api/v1/admin/me');
  useEffect(() => {
    if (access.data) router.replace(destination);
  }, [access.data, destination, router]);
  const action = useAction(async (credentials: { email: string; password: string }) => {
    if (!client)
      throw new ApiFailure(
        'SERVICE_UNAVAILABLE',
        'Login admin belum tersedia. Hubungi pengelola aplikasi.',
        503,
      );
    const { data, error } = await client.auth.signInWithPassword(credentials);
    if (error || !data.session)
      throw new ApiFailure(
        'LOGIN_FAILED',
        error?.status === 429
          ? 'Terlalu banyak percobaan login. Tunggu sebentar.'
          : 'Email atau password tidak sesuai.',
        error?.status || 401,
        [],
        error?.status === 429 ? 60 : 0,
      );
    try {
      await apiRequest('/api/v1/admin/me', { bearer: data.session.access_token });
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.status === 403)
        await client.auth.signOut({ scope: 'local' });
      throw failure;
    }
    router.replace(destination);
    return true;
  });
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const password = form.elements.namedItem('password') as HTMLInputElement;
    const payload = {
      email: String(values.get('email')).trim(),
      password: String(values.get('password')),
    };
    password.value = '';
    await action.run(payload);
  }
  if (loading || (session && access.isFetching && !access.error))
    return <Loading label="Memeriksa akses admin…" />;
  return (
    <div className="flex flex-col gap-6">
      <Card className="overflow-hidden p-0 shadow-sm">
        <CardContent className="grid p-0 md:grid-cols-2">
          <form onSubmit={submit} className="p-7 sm:p-10">
            <FieldGroup className="gap-6">
              <div className="mb-2">
                <p className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  Area admin
                </p>
                <h1 className="text-3xl font-semibold tracking-tight">Selamat datang kembali.</h1>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  Masuk untuk mengelola produksi, stok, dan QR toko.
                </p>
              </div>
              <InputField
                label="Email"
                name="email"
                type="email"
                placeholder="admin@contoh.id"
                autoComplete="username"
                required
                error={action.error}
              />
              <InputField
                label="Password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                error={action.error}
              />
              <FormError error={action.error || access.error} cooldown={action.cooldown} />
              {!client && (
                <p className="text-sm text-destructive">
                  Login admin belum tersedia. Hubungi pengelola aplikasi.
                </p>
              )}
              <SubmitButton pending={action.pending} cooldown={action.cooldown} className="w-full">
                Masuk ke dashboard
              </SubmitButton>
              <FieldDescription className="text-center">
                Untuk pemilik toko, gunakan{' '}
                <Link
                  href="/manage"
                  className="font-medium text-foreground underline underline-offset-4"
                >
                  token dan PIN
                </Link>
                .
              </FieldDescription>
            </FieldGroup>
          </form>
          <div className="relative hidden overflow-hidden bg-[#192720] p-10 text-white md:flex md:flex-col md:justify-between">
            <div className="pointer-events-none absolute inset-0 opacity-10 [background-image:radial-gradient(#ffffff_1px,transparent_1px)] [background-size:20px_20px]" />
            <p className="relative inline-flex items-center gap-2 text-xs text-emerald-100/70">
              <ShieldCheck className="size-4" />
              Satu tempat untuk setiap QR toko
            </p>
            <div className="relative py-10">
              <div className="mx-auto w-48 rotate-[-6deg] rounded-2xl border border-white/30 bg-white/10 p-5 shadow-2xl backdrop-blur-sm">
                <div className="rounded-xl bg-white p-4 text-[#192720]">
                  <QrCode className="size-28" strokeWidth={1.5} />
                </div>
                <div className="mt-4 flex justify-center gap-1 text-amber-200">
                  {Array.from({ length: 5 }, (_, i) => (
                    <Star key={i} className="size-3 fill-current" />
                  ))}
                </div>
                <p className="mt-2 text-center text-xs font-medium">Scan. Beri ulasan. Selesai.</p>
              </div>
            </div>
            <div className="relative">
              <h2 className="text-2xl font-medium leading-snug tracking-tight">
                Dari meja toko,
                <br />
                langsung ke ulasan.
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-emerald-100/65">
                Kelola QR sejak produksi hingga aktif di toko. Link tujuan bisa diperbarui kapan
                saja.
              </p>
              <ArrowUpRight className="mt-5 size-5 text-emerald-100/60" />
            </div>
          </div>
        </CardContent>
      </Card>
      <p className="text-center text-xs text-muted-foreground">
        Akses hanya tersedia untuk akun admin yang telah didaftarkan.
      </p>
    </div>
  );
}
