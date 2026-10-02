'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { ArrowRight, ArrowRightLeft, KeyRound } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FormError, InputField, Loading, SubmitButton, SuccessState } from '@/components/common';
import { PublicStatus } from '@/components/activation';
import { ReviewLinkHelp } from '@/components/review-link-help';
import { useGrant } from '@/hooks/use-grant';
import { useAction } from '@/hooks/use-action';
import { apiRequest } from '@/lib/api';
import { validatePins, validateStore } from '@/lib/form-validation';
import type { ClaimResult } from '@/lib/types';

export function GrantClaim({ transfer = false }: { transfer?: boolean }) {
  const token = useGrant(transfer ? '/ownership-transfer' : '/pin-reset');
  if (token === undefined) return <Loading label="Membuka tautan pemulihan…" />;
  if (!/^[A-Za-z0-9_-]{43}$/.test(token))
    return (
      <PublicStatus
        title="Tautan belum lengkap"
        description="Buka kembali tautan lengkap yang diberikan admin. Jika tautan sudah kedaluwarsa atau digunakan, minta tautan baru melalui penjual."
      />
    );
  return <ClaimForm key={token} token={token} transfer={transfer} />;
}
function ClaimForm({ token, transfer }: { token: string; transfer: boolean }) {
  const [review, setReview] = useState('');
  const [result, setResult] = useState<ClaimResult | null>(null);
  const action = useAction(
    async (
      body: {
        grant_token: string;
        new_pin: string;
        new_pin_confirmation: string;
        store_name?: string;
        review_url?: string;
      },
      key,
    ) => {
      validatePins(body.new_pin, body.new_pin_confirmation, 'new_pin', 'new_pin_confirmation');
      if (transfer) validateStore(body.store_name || '', body.review_url || '');
      return apiRequest<ClaimResult>(
        `/api/v1/public/${transfer ? 'ownership-transfer' : 'pin-reset'}/claim`,
        { method: 'POST', body, key },
      );
    },
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await action.run({
      grant_token: token,
      new_pin: String(form.get('new_pin')),
      new_pin_confirmation: String(form.get('new_pin_confirmation')),
      ...(transfer
        ? { store_name: String(form.get('store_name')).trim(), review_url: review.trim() }
        : {}),
    });
    if (response) setResult(response.data);
  }
  if (result)
    return (
      <Card>
        <CardContent className="p-7">
          <SuccessState
            title={transfer ? 'Kepemilikan berhasil dipindahkan' : 'PIN berhasil diperbarui'}
            description={
              result.status === 'SUSPENDED'
                ? 'PIN baru sudah tersimpan. QR masih ditangguhkan; hubungi penjual untuk melanjutkan layanan.'
                : 'Gunakan PIN baru untuk membuka halaman kelola. Sesi pemilik sebelumnya sudah berakhir.'
            }
          >
            <Button asChild className="w-full">
              <Link href={`/manage?token=${result.token}`}>
                Masuk ke kelola QR
                <ArrowRight />
              </Link>
            </Button>
          </SuccessState>
        </CardContent>
      </Card>
    );
  return (
    <div className="space-y-6">
      <div>
        <Badge variant="outline" className="mb-4 bg-background">
          {transfer ? <ArrowRightLeft className="size-3" /> : <KeyRound className="size-3" />}
          Bantuan pemilik
        </Badge>
        <h1 className="text-3xl font-semibold tracking-tight">
          {transfer ? 'Siapkan QR untuk pemilik baru.' : 'Tentukan PIN baru.'}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {transfer
            ? 'Isi informasi bisnis baru dan pilih PIN sendiri. Statistik kunjungan dimulai dari awal setelah pemindahan berhasil.'
            : 'Tautan ini hanya dapat digunakan sekali. Link review toko tetap sama setelah PIN diperbarui.'}
        </p>
      </div>
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={submit} className="space-y-5">
            <fieldset disabled={action.pending} className="space-y-5">
              {transfer && (
                <>
                  <InputField
                    label="Nama toko baru"
                    name="store_name"
                    required
                    error={action.error}
                  />
                  <div className="space-y-2">
                    <InputField
                      label="Link review Google"
                      name="review_url"
                      type="url"
                      value={review}
                      onChange={(event) => setReview(event.target.value)}
                      required
                      maxLength={2048}
                      error={action.error}
                    />
                    <ReviewLinkHelp value={review.trim()} />
                  </div>
                </>
              )}
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
            <SubmitButton pending={action.pending} cooldown={action.cooldown} className="w-full">
              {transfer ? 'Konfirmasi pemindahan' : 'Simpan PIN baru'}
            </SubmitButton>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
