'use client';

import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowRightLeft,
  Check,
  CirclePause,
  CirclePlay,
  KeyRound,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
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
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CopyButton, FormError, InputField, SubmitButton } from '@/components/common';
import { useAdminApi } from '@/components/providers';
import { useAction } from '@/hooks/use-action';
import { dateTime } from '@/lib/format';
import type { AdminQr, SupportGrant } from '@/lib/types';

type ActionName = 'reset' | 'transfer' | 'rotate' | 'suspend' | 'resume' | 'retire';
type Result = SupportGrant | { qr_id: string; activation_code: string; version: number } | AdminQr;
const definitions: Record<
  ActionName,
  { title: string; description: string; path: string; verify?: boolean; dangerous?: boolean }
> = {
  reset: {
    title: 'Buat tautan reset PIN',
    description:
      'Periksa bukti kepemilikan terlebih dahulu. Pemilik menentukan PIN baru melalui tautan sekali pakai; link review tetap berlaku.',
    path: 'pin-reset-grants',
    verify: true,
  },
  transfer: {
    title: 'Pindahkan kepemilikan',
    description:
      'Periksa bukti kepemilikan dan pemilik baru. QR ditangguhkan sampai tautan transfer digunakan. Sesi lama berakhir dan statistik pemilik baru dimulai dari awal.',
    path: 'transfer-grants',
    verify: true,
  },
  rotate: {
    title: 'Rotasi kode aktivasi',
    description:
      'Kode lama menjadi tidak berlaku. Ganti label atau kartu rahasia pada unit. Paket kode batch juga tidak lagi berlaku.',
    path: 'activation-code/rotate',
  },
  suspend: {
    title: 'Tangguhkan layanan QR',
    description:
      'QR berhenti mengarahkan pelanggan ke link review. Sesi pemilik berakhir; pemilik dapat masuk kembali untuk melihat data tanpa mengubah pengaturan.',
    path: 'suspend',
  },
  resume: {
    title: 'Lanjutkan layanan QR',
    description:
      'QR kembali mengarahkan pelanggan ke link review yang tersimpan. Pemilik perlu masuk kembali untuk mengelola QR.',
    path: 'resume',
  },
  retire: {
    title: 'Nonaktifkan QR permanen',
    description:
      'QR ini tidak bisa diaktifkan atau digunakan kembali. Stok yang sudah terjual tetap tercatat terjual. Tindakan ini tidak dapat dibatalkan.',
    path: 'retire',
    dangerous: true,
  },
};
export function SupportActions({ qr, etag }: { qr: AdminQr; etag: string | null }) {
  const [selection, setSelection] = useState<{
    action: ActionName;
    qr: AdminQr;
    etag: string | null;
  } | null>(null);
  const owned = ['ACTIVE', 'SUSPENDED'].includes(qr.status);
  function select(action: ActionName) {
    setSelection({ action, qr, etag });
  }
  return (
    <div className="space-y-5">
      <Alert>
        <ShieldCheck />
        <AlertDescription>
          Verifikasi referensi penjualan dan bukti kepemilikan sebelum membantu pemulihan atau
          transfer. Token dan nama toko saja belum cukup.
        </AlertDescription>
      </Alert>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <KeyRound className="mb-2 size-5 text-muted-foreground" />
            <CardTitle className="text-base">Pemulihan PIN</CardTitle>
            <CardDescription>
              Berikan tautan sekali pakai agar pemilik menentukan PIN baru.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => select('reset')} disabled={!owned}>
              <KeyRound />
              Buat tautan reset PIN
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <ArrowRightLeft className="mb-2 size-5 text-muted-foreground" />
            <CardTitle className="text-base">Pemindahan pemilik</CardTitle>
            <CardDescription>
              Pindahkan QR ke toko atau pemilik baru setelah pemeriksaan bukti.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => select('transfer')} disabled={!owned}>
              <ArrowRightLeft />
              Pindahkan kepemilikan
            </Button>
          </CardContent>
        </Card>
      </div>
      {qr.status === 'UNACTIVATED' && (
        <Card>
          <CardHeader>
            <RefreshCw className="mb-2 size-5 text-muted-foreground" />
            <CardTitle className="text-base">Kode aktivasi hilang</CardTitle>
            <CardDescription>
              Rotasi hanya tersedia untuk unit yang belum aktif. Kode lama perlu diganti pada
              kemasan unit.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => select('rotate')}>
              <RefreshCw />
              Rotasi kode aktivasi
            </Button>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Status layanan QR</CardTitle>
          <CardDescription>
            Setiap perubahan memerlukan alasan dan masuk ke riwayat tindakan.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          {qr.status === 'ACTIVE' && (
            <Button variant="outline" onClick={() => select('suspend')}>
              <CirclePause />
              Tangguhkan QR
            </Button>
          )}
          {qr.status === 'SUSPENDED' && (
            <Button variant="outline" onClick={() => select('resume')}>
              <CirclePlay />
              Lanjutkan layanan
            </Button>
          )}
          {qr.status !== 'RETIRED' ? (
            <Button variant="destructive" onClick={() => select('retire')}>
              <ShieldAlert />
              Nonaktifkan permanen
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">Unit ini sudah dinonaktifkan permanen.</p>
          )}
        </CardContent>
      </Card>
      {selection && (
        <SupportDialog
          action={selection.action}
          qr={selection.qr}
          etag={selection.etag}
          onClose={() => setSelection(null)}
        />
      )}
    </div>
  );
}
function SupportDialog({
  action: name,
  qr,
  etag,
  onClose,
}: {
  action: ActionName;
  qr: AdminQr;
  etag: string | null;
  onClose: () => void;
}) {
  const definition = definitions[name];
  const api = useAdminApi();
  const queries = useQueryClient();
  const [result, setResult] = useState<Result | null>(null);
  const mutation = useAction((body: { reason: string; verification_reference?: string }, key) =>
    api<Result>(`/api/v1/admin/qr-codes/${qr.id}/${definition.path}`, {
      method: 'POST',
      body,
      key,
      etag,
    }),
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await mutation.run({
      reason: String(form.get('reason')).trim(),
      ...(definition.verify
        ? { verification_reference: String(form.get('verification_reference')).trim() }
        : {}),
    });
    if (!response) return;
    setResult(response.data);
    void queries.invalidateQueries({ queryKey: ['admin'] });
    toast.success('Tindakan berhasil dicatat.');
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.pending) onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-lg"
        onInteractOutside={(event) => {
          if (mutation.pending || result) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{result ? 'Tindakan berhasil' : definition.title}</DialogTitle>
          <DialogDescription>
            {result
              ? 'Simpan hasil yang diperlukan sebelum menutup halaman ini.'
              : definition.description}
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="space-y-5">
            <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
              <Check className="size-6" />
            </span>
            {'claim_url' in result ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="claim-link">Tautan untuk pemilik</Label>
                  <Textarea
                    id="claim-link"
                    value={result.claim_url}
                    readOnly
                    rows={3}
                    className="break-all font-mono text-xs"
                    onFocus={(event) => event.currentTarget.select()}
                  />
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Tautan berlaku hingga {dateTime(result.expires_at)} dan hanya dapat digunakan
                  sekali. Berikan kepada pemilik yang telah diverifikasi.
                </p>
                <CopyButton
                  value={result.claim_url}
                  label="Salin tautan pemilik"
                  className="w-full"
                />
              </>
            ) : 'activation_code' in result ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="rotated-code">Kode aktivasi baru</Label>
                  <Input
                    id="rotated-code"
                    value={result.activation_code}
                    readOnly
                    className="text-center font-mono tracking-widest"
                    onFocus={(event) => event.currentTarget.select()}
                  />
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Simpan kode ini untuk mengganti kartu atau label pada unit. Kode tidak ditampilkan
                  lagi setelah dialog ditutup.
                </p>
                <CopyButton
                  value={result.activation_code}
                  label="Salin kode aktivasi"
                  className="w-full"
                />
              </>
            ) : (
              <p className="text-center text-sm text-muted-foreground">
                Status QR sudah diperbarui. Perubahan tercatat dalam riwayat.
              </p>
            )}
            <Button type="button" className="w-full" onClick={onClose}>
              Selesai
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-5">
            <fieldset disabled={mutation.pending} className="space-y-5">
              <div className="grid gap-2">
                <Label htmlFor="support-reason">Alasan tindakan</Label>
                <Textarea
                  id="support-reason"
                  name="reason"
                  minLength={5}
                  maxLength={500}
                  required
                  placeholder="Jelaskan alasan permintaan dan pemeriksaan yang dilakukan…"
                />
              </div>
              {definition.verify && (
                <InputField
                  label="Referensi verifikasi"
                  name="verification_reference"
                  minLength={5}
                  maxLength={200}
                  placeholder="SUPPORT-20261002-001"
                  required
                  help="Referensi pemeriksaan bukti dan penjualan. Hindari menulis data pribadi atau isi dokumen."
                  error={mutation.error}
                />
              )}
            </fieldset>
            <FormError error={mutation.error} cooldown={mutation.cooldown} />
            {definition.dangerous && (
              <Alert variant="destructive">
                <ShieldAlert />
                <AlertDescription>Penonaktifan permanen tidak dapat dibatalkan.</AlertDescription>
              </Alert>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={mutation.pending} onClick={onClose}>
                Batal
              </Button>
              {definition.dangerous ? (
                <Button
                  type="submit"
                  variant="destructive"
                  disabled={mutation.pending || mutation.cooldown > 0}
                >
                  {mutation.pending ? 'Memproses…' : 'Konfirmasi penonaktifan'}
                </Button>
              ) : (
                <SubmitButton pending={mutation.pending} cooldown={mutation.cooldown}>
                  Konfirmasi tindakan
                </SubmitButton>
              )}
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
