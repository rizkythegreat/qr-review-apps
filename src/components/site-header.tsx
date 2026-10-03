'use client';

import { ThemeToggle } from '@/components/theme-toggle';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { InstallApp } from '@/components/install-app';

export function SiteHeader() {
  const pathname = usePathname();
  const title = pathname.startsWith('/admin/batches')
    ? 'Batch produksi'
    : pathname.startsWith('/admin/qr-codes')
      ? 'Daftar QR'
      : pathname.startsWith('/admin/support')
        ? 'Dukungan'
        : pathname.startsWith('/admin/activity')
          ? 'Log Aktivitas'
          : 'Dashboard';
  return (
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-2 border-b bg-background/95 backdrop-blur">
      <div className="flex w-full items-center gap-2 px-4 lg:px-6">
        <SidebarTrigger className="-ml-1" aria-label="Buka navigasi" />
        <Separator orientation="vertical" className="mx-2 data-[orientation=vertical]:h-4" />
        <span className="text-sm font-medium">{title}</span>
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <InstallApp />
          <Button asChild variant="ghost" size="sm">
            <Link
              href="/manage"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Halaman pemilik"
            >
              <ExternalLink />
              <span className="hidden sm:inline">Halaman pemilik</span>
            </Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
