'use client';

import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { AppSidebar } from '@/components/app-sidebar';
import { SiteHeader } from '@/components/site-header';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { ErrorState, Loading } from '@/components/common';
import { useAdminAuth } from '@/components/providers';
import { useAdminResource } from '@/hooks/use-admin-resource';

export function AdminShell({ children }: { children: ReactNode }) {
  const { session, loading, client } = useAdminAuth();
  const router = useRouter();
  const pathname = usePathname();
  const access = useAdminResource<{ user_id: string; role: 'ADMIN' }>('/api/v1/admin/me');
  useEffect(() => {
    if (!loading && !session) router.replace(`/admin/login?next=${encodeURIComponent(pathname)}`);
  }, [loading, session, pathname, router]);
  if (loading || !session || access.isPending) return <Loading label="Memeriksa akses admin…" />;
  if (access.isError)
    return (
      <div className="mx-auto max-w-xl space-y-4 px-6 py-24">
        <ErrorState error={access.error} retry={() => void access.refetch()} />
        <Button variant="outline" onClick={() => void client?.auth.signOut({ scope: 'local' })}>
          Keluar dari akun
        </Button>
      </div>
    );
  return (
    <SidebarProvider
      style={{ '--sidebar-width': '17rem', '--header-height': '4rem' } as CSSProperties}
    >
      <AppSidebar variant="inset" />
      <SidebarInset className="min-w-0">
        <SiteHeader />
        <div className="@container/main mx-auto flex w-full max-w-7xl flex-1 flex-col gap-7 px-4 py-7 sm:px-6 lg:px-8">
          {children}
        </div>
        <footer className="border-t px-6 py-4 text-xs text-muted-foreground">
          QR Review · Ruang kerja admin
        </footer>
      </SidebarInset>
    </SidebarProvider>
  );
}
