import Link from 'next/link';
import { ArrowRight, Link2, QrCode, ShieldCheck } from 'lucide-react';
import { PublicShell } from '@/components/public-shell';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export default function Home() {
  return (
    <PublicShell wide>
      <section className="grid items-center gap-12 py-5 md:grid-cols-[1.4fr_1fr] md:py-12">
        <div>
          <Badge variant="outline" className="mb-6 bg-background">
            <span className="mr-1 size-1.5 rounded-full bg-emerald-600" />
            QR untuk ulasan toko
          </Badge>
          <h1 className="text-4xl font-semibold leading-[1.12] tracking-tight sm:text-5xl">
            Dari satu scan,
            <br />
            <span className="text-muted-foreground">ke ulasan toko.</span>
          </h1>
          <p className="mt-5 max-w-md text-sm leading-7 text-muted-foreground sm:text-base">
            Hubungkan QR di meja toko dengan halaman ulasan Google. Perbarui link tujuan tanpa
            mencetak ulang QR.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href="/manage">
                Kelola QR toko
                <ArrowRight />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/help">Panduan aktivasi</Link>
            </Button>
          </div>
          <p className="mt-5 flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="size-4" />
            Pemilik mengelola toko menggunakan token dan PIN.
          </p>
        </div>
        <div className="relative mx-auto flex aspect-square w-full max-w-sm items-center justify-center rounded-3xl border bg-[#eaf0e9] p-10">
          <div className="absolute inset-0 rounded-3xl opacity-30 [background-image:radial-gradient(#a0ada0_1px,transparent_1px)] [background-size:18px_18px]" />
          <div className="relative w-48 rotate-[-5deg] rounded-2xl border border-white bg-white/65 p-5 shadow-xl shadow-stone-900/10 backdrop-blur">
            <div className="rounded-xl bg-white p-4">
              <QrCode
                className="size-28 text-[#243829]"
                strokeWidth={1.5}
                aria-label="Ilustrasi QR"
              />
            </div>
            <p className="mt-4 text-center text-xs font-semibold">Review toko Anda</p>
            <p className="mt-1 text-center text-[10px] text-muted-foreground">
              Scan untuk membuka ulasan
            </p>
          </div>
          <div className="absolute bottom-7 right-4 flex items-center gap-2 rounded-xl border bg-background px-4 py-3 shadow-sm">
            <span className="flex size-7 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
              <Link2 className="size-3.5" />
            </span>
            <span className="text-xs font-medium">Link dapat diperbarui</span>
          </div>
        </div>
      </section>
    </PublicShell>
  );
}
