import Link from 'next/link';
import { CircleHelp, KeyRound, Store, ArrowRight, ExternalLink } from 'lucide-react';
import { PublicShell } from '@/components/public-shell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Panduan dan bantuan' };
export default async function HelpPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const { returnTo } = await searchParams;
  const back =
    typeof returnTo === 'string' && /^\/admin(?:\/[a-zA-Z0-9/_-]*)?$/.test(returnTo)
      ? returnTo
      : '/';

  return (
    <PublicShell wide back={back}>
      <div className="mb-8">
        <p className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Panduan penggunaan
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Bantuan untuk QR toko.</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Aktivasi, pengelolaan, dan pemulihan akses dalam beberapa langkah.
        </p>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <CardHeader>
            <Store className="mb-2 size-6 text-muted-foreground" />
            <CardTitle className="text-lg">Mengaktifkan unit baru</CardTitle>
            <CardDescription>Siapkan kartu kode aktivasi dan link review bisnis.</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="list-decimal space-y-3 pl-5 text-sm leading-relaxed text-muted-foreground">
              <li>
                Siapkan QR dan kode aktivasi yang diberikan penjual. Penjualan tercatat otomatis
                setelah aktivasi berhasil.
              </li>
              <li>Pindai QR pada unit. Halaman aktivasi akan terbuka.</li>
              <li>Isi kode dari kartu rahasia, nama toko, dan link review Google.</li>
              <li>Buka tombol uji tujuan untuk memastikan bisnisnya benar.</li>
              <li>Tentukan PIN empat digit dan konfirmasi. Pemilik memilih PIN sendiri.</li>
            </ol>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <KeyRound className="mb-2 size-6 text-muted-foreground" />
            <CardTitle className="text-lg">Mengelola QR yang aktif</CardTitle>
            <CardDescription>Gunakan token dan PIN, tanpa membuat akun baru.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <p className="text-sm leading-relaxed text-muted-foreground">
              Buka halaman kelola, masukkan token atau alamat QR lengkap, lalu PIN Anda. Token bisa
              ditemukan pada alamat QR: bagian setelah <code>/r/</code>.
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Anda dapat mengubah nama toko, mengganti link review dan PIN, serta melihat jumlah
              kunjungan QR.
            </p>
            <Button asChild variant="outline" className="w-full justify-between">
              <Link href="/manage">
                Buka halaman kelola
                <ArrowRight />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
      <Card className="mt-6">
        <CardHeader>
          <CircleHelp className="mb-2 size-5 text-muted-foreground" />
          <CardTitle className="text-lg">Pertanyaan umum</CardTitle>
        </CardHeader>
        <CardContent>
          <Accordion type="single" collapsible>
            <AccordionItem value="forgot">
              <AccordionTrigger>Lupa PIN atau kehilangan kode aktivasi?</AccordionTrigger>
              <AccordionContent className="text-sm leading-relaxed text-muted-foreground">
                Hubungi penjual atau admin melalui kontak pada nota pembelian. Siapkan referensi
                penjualan dan bukti kepemilikan. Admin dapat menerbitkan tautan pemulihan setelah
                verifikasi. Token atau nama toko saja belum cukup untuk membuktikan kepemilikan.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="review">
              <AccordionTrigger>Link review Google seperti apa yang didukung?</AccordionTrigger>
              <AccordionContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">
                <p>
                  Gunakan <code className="break-all text-xs">https://g.page/r/kode/review</code>{' '}
                  atau{' '}
                  <code className="break-all text-xs">
                    https://search.google.com/local/writereview?placeid=ID
                  </code>
                  . Link pendek Maps belum didukung. Minta bantuan penjual bila Anda belum
                  mendapatkan link yang sesuai.
                </p>
                <a
                  href="https://support.google.com/business/answer/16816815?hl=id"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-foreground underline underline-offset-4"
                >
                  Panduan Google
                  <ExternalLink className="size-3" />
                </a>
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="visits">
              <AccordionTrigger>Apakah angka kunjungan berarti ulasan terkirim?</AccordionTrigger>
              <AccordionContent className="text-sm leading-relaxed text-muted-foreground">
                Jumlah kunjungan menunjukkan akses ke QR yang aktif. Angka ini tidak menunjukkan
                orang unik, ulasan yang terkirim, atau rating Google. Scan berulang dapat ikut
                terhitung.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="suspend">
              <AccordionTrigger>QR ditangguhkan atau tidak lagi digunakan?</AccordionTrigger>
              <AccordionContent className="text-sm leading-relaxed text-muted-foreground">
                Hubungi penjual untuk mengetahui status unit. Ketika ditangguhkan, pemilik masih
                bisa masuk untuk melihat data dan informasi bantuan, tetapi tidak dapat mengubah
                pengaturan. Unit yang dinonaktifkan permanen tidak bisa digunakan kembali.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="transfer">
              <AccordionTrigger>Bagaimana memindahkan QR ke pemilik baru?</AccordionTrigger>
              <AccordionContent className="text-sm leading-relaxed text-muted-foreground">
                Minta bantuan admin untuk memeriksa kepemilikan dan menerbitkan tautan transfer.
                Pemilik baru menentukan data toko dan PIN sendiri. Riwayat tetap tercatat, sementara
                statistik pemilik baru dimulai dari awal.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>
    </PublicShell>
  );
}
