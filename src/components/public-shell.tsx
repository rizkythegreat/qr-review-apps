import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowLeft, CircleHelp, ShieldCheck } from 'lucide-react';
import { Brand } from '@/components/common';
import { Button } from '@/components/ui/button';
import { CreatorCredit } from '@/components/creator-credit';

export function PublicShell({
  children,
  wide = false,
  back,
}: {
  children: ReactNode;
  wide?: boolean;
  back?: string;
}) {
  return (
    <div className="flex min-h-svh flex-col bg-muted/35">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-20 max-w-6xl items-center justify-between px-5 sm:px-8">
          <Brand />
          <Button asChild variant="ghost" size="sm">
            <Link href="/help">
              <CircleHelp />
              Bantuan
            </Link>
          </Button>
        </div>
      </header>
      <main
        className={`mx-auto w-full flex-1 px-5 py-8 sm:px-8 sm:py-12 ${wide ? 'max-w-5xl' : 'max-w-xl'}`}
      >
        {back && (
          <Link
            href={back}
            className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Kembali
          </Link>
        )}
        {children}
      </main>
      <footer className="border-t bg-background px-5 py-5">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 text-xs text-muted-foreground sm:flex-row">
          <p>
            QR Review · <CreatorCredit />
          </p>
          <p className="flex items-center gap-1.5">
            <ShieldCheck className="size-3.5" />
            Simpan kode aktivasi dan PIN untuk diri sendiri.
          </p>
        </div>
      </footer>
    </div>
  );
}
