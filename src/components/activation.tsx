'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CircleHelp, LockKeyhole, QrCode, Store } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FormError, InputField, Loading, ErrorState, SuccessState } from '@/components/common';
import { SubmitButton } from '@/components/common';
import { ReviewLinkHelp } from '@/components/review-link-help';
import { useAction } from '@/hooks/use-action';
import { apiRequest } from '@/lib/api';
import { normalizeActivationCode } from '@/lib/format';
import { fieldFailure, validatePins, validateStore } from '@/lib/form-validation';
import type { ActivationResult, PublicQr } from '@/lib/types';

export function Activation({ token, initial }: { token: string; initial?: PublicQr }) {
  const valid = /^[A-Za-z0-9_-]{22}$/.test(token);
  const query = useQuery({
    queryKey: ['public', token],
    queryFn: ({ signal }) => apiRequest<PublicQr>(`/api/v1/public/qr/${token}`, { signal }),
    enabled: valid,
    refetchOnWindowFocus: false,
    initialData: initial ? { data: initial, request_id: '', etag: null } : undefined,
  });
  const [result, setResult] = useState<ActivationResult | null>(null);
  if (!valid)
    return (
      <PublicStatus
        title="QR tidak ditemukan"
        description="Alamat atau token QR tidak valid. Pindai ulang QR pada unit Anda."
      />
    );
  if (result)
    return (
      <Card>
        <CardContent className="p-7">
          <SuccessState
            title="QR toko sudah aktif!"
            description={`QR untuk ${result.store_name} siap mengarahkan pelanggan ke halaman ulasan Google.`}
          >
            <div className="space-y-3">
              <Button asChild className="w-full">
                <Link href={`/manage?token=${token}`}>
                  Kelola QR toko
                  <ArrowRight />
                </Link>
              </Button>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Masuk menggunakan PIN yang baru Anda buat. Kode aktivasi sudah digunakan dan tidak
                diperlukan lagi.
              </p>
            </div>
          </SuccessState>
        </CardContent>
      </Card>
    );
  if (query.isPending) return <Loading label="Memeriksa QR…" />;
  if (query.isError || !query.data)
    return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const qr = query.data.data;
  if (qr.status === 'ACTIVE')
    return (
      <PublicStatus
        title="QR ini sudah aktif"
        description="Gunakan token dan PIN pemilik untuk melihat atau memperbarui data toko."
        token={token}
      />
    );
  if (qr.status === 'SUSPENDED')
    return (
      <PublicStatus
        title="Layanan QR ditangguhkan"
        description="Hubungi penjual untuk bantuan. Pemilik tetap dapat masuk untuk melihat informasi QR."
        token={token}
      />
    );
  if (qr.status === 'RETIRED')
    return (
      <PublicStatus
        title="Unit QR tidak lagi digunakan"
        description="Unit ini sudah dinonaktifkan. Hubungi penjual jika Anda membutuhkan unit pengganti."
      />
    );
  if (!qr.activation_allowed)
    return (
      <PublicStatus
        title="QR belum siap diaktifkan"
        description="QR belum aktif dan belum tercatat terjual. Hubungi penjual untuk menyelesaikan pencatatan unit sebelum aktivasi."
      />
    );
  return (
    <ActivationForm token={token} onSuccess={setResult} refresh={() => void query.refetch()} />
  );
}
function ActivationForm({
  token,
  onSuccess,
  refresh,
}: {
  token: string;
  onSuccess: (result: ActivationResult) => void;
  refresh: () => void;
}) {
  const [review, setReview] = useState('');
  const action = useAction(
    async (
      body: {
        activation_code: string;
        store_name: string;
        review_url: string;
        pin: string;
        pin_confirmation: string;
      },
      key,
    ) => {
      if (!/^[A-Z2-7]{16}$/.test(body.activation_code))
        fieldFailure('activation_code', 'Kode harus berisi 16 karakter dari kartu aktivasi.');
      validateStore(body.store_name, body.review_url);
      validatePins(body.pin, body.pin_confirmation);
      return apiRequest<ActivationResult>(`/api/v1/public/qr/${token}/activate`, {
        method: 'POST',
        body,
        key,
      });
    },
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await action.run({
      activation_code: normalizeActivationCode(String(form.get('activation_code'))),
      store_name: String(form.get('store_name')).trim(),
      review_url: review.trim(),
      pin: String(form.get('pin')),
      pin_confirmation: String(form.get('pin_confirmation')),
    });
    if (result) onSuccess(result.data);
  }
  return (
    <div className="space-y-6">
      <div>
        <Badge variant="outline" className="mb-4 bg-background">
          <Store className="size-3" />
          Setup toko
        </Badge>
        <h1 className="text-3xl font-semibold tracking-tight">Aktifkan QR toko.</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Hubungkan QR dengan halaman ulasan bisnis Anda. Pemilik toko menentukan PIN sendiri.
        </p>
      </div>
      <Card>
        <CardHeader className="border-b">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <QrCode className="size-4" />
            <span className="break-all font-mono">{token}</span>
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          <form onSubmit={submit} className="space-y-6">
            <fieldset disabled={action.pending} className="space-y-5">
              <InputField
                label="Kode aktivasi"
                name="activation_code"
                autoComplete="off"
                placeholder="XXXX XXXX XXXX XXXX"
                maxLength={32}
                required
                error={action.error}
                help="16 karakter pada kartu rahasia. Spasi atau tanda hubung boleh disertakan."
                className="font-mono uppercase tracking-wider"
              />
              <InputField
                label="Nama toko"
                name="store_name"
                placeholder="Contoh: Kopi Bahagia"
                required
                error={action.error}
                help="Gunakan nama toko yang dikenali pelanggan, maksimal 120 karakter."
              />
              <div className="space-y-2">
                <InputField
                  label="Link review Google"
                  name="review_url"
                  type="url"
                  placeholder="https://g.page/r/…/review"
                  value={review}
                  onChange={(event) => setReview(event.target.value)}
                  maxLength={2048}
                  required
                  error={action.error}
                />
                <ReviewLinkHelp value={review.trim()} />
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <InputField
                  label="Buat PIN"
                  name="pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  pattern="[0-9]{4}"
                  minLength={4}
                  maxLength={4}
                  placeholder="4 digit angka"
                  required
                  error={action.error}
                />
                <InputField
                  label="Konfirmasi PIN"
                  name="pin_confirmation"
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  pattern="[0-9]{4}"
                  minLength={4}
                  maxLength={4}
                  placeholder="Ulangi PIN"
                  required
                  error={action.error}
                />
              </div>
              <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                <LockKeyhole className="mt-0.5 size-4 shrink-0" />
                Simpan PIN untuk mengelola QR. Jangan membagikan PIN atau kode aktivasi kepada
                pelanggan.
              </p>
            </fieldset>
            <FormError error={action.error} cooldown={action.cooldown} />
            <SubmitButton pending={action.pending} cooldown={action.cooldown} className="w-full">
              Aktifkan QR toko
            </SubmitButton>
            {action.error ? (
              <Button type="button" variant="ghost" className="w-full" onClick={refresh}>
                Periksa status QR terbaru
              </Button>
            ) : null}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
export function PublicStatus({
  title,
  description,
  token,
}: {
  title: string;
  description: string;
  token?: string;
}) {
  return (
    <Card>
      <CardHeader className="items-center pt-8 text-center">
        <span className="mb-4 flex size-14 items-center justify-center rounded-full bg-muted">
          <QrCode className="size-7 text-muted-foreground" />
        </span>
        <CardTitle className="text-2xl tracking-tight">{title}</CardTitle>
        <CardDescription className="max-w-sm pt-2 leading-relaxed">{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 pb-8">
        {token && (
          <Button asChild>
            <Link href={`/manage?token=${token}`}>
              Masuk ke kelola QR
              <ArrowRight />
            </Link>
          </Button>
        )}
        <Button asChild variant="outline">
          <Link href="/help">
            <CircleHelp />
            Panduan dan bantuan
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
