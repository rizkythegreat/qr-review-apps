'use client';

// Adapted from the official shadcn/ui dashboard-01 block.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ComponentProps } from 'react';
import {
  LayoutDashboard,
  Package,
  QrCode,
  ShieldQuestion,
  CircleHelp,
  History,
} from 'lucide-react';
import { NavMain } from '@/components/nav-main';
import { NavUser } from '@/components/nav-user';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { useAdminAuth } from '@/components/providers';

export function AppSidebar(props: ComponentProps<typeof Sidebar>) {
  const { session } = useAdminAuth();
  const pathname = usePathname();
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="py-5">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg">
              <Link href="/admin">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                  <QrCode className="size-5" />
                </span>
                <span className="text-lg font-semibold tracking-tight">
                  QR <span className="font-normal text-muted-foreground">Review</span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Ruang kerja</SidebarGroupLabel>
          <SidebarGroupContent>
            <NavMain
              items={[
                { title: 'Dashboard', url: '/admin', icon: <LayoutDashboard /> },
                { title: 'Batch produksi', url: '/admin/batches', icon: <Package /> },
                { title: 'Daftar QR', url: '/admin/qr-codes', icon: <QrCode /> },
                { title: 'Log Aktivitas', url: '/admin/activity', icon: <History /> },
                { title: 'Dukungan', url: '/admin/support', icon: <ShieldQuestion /> },
              ]}
            />
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup className="mt-auto">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="Panduan penggunaan">
                  <Link href={{ pathname: '/help', query: { returnTo: pathname } }}>
                    <CircleHelp />
                    <span>Panduan penggunaan</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t py-3">
        <NavUser email={session?.user.email || 'Admin'} />
      </SidebarFooter>
    </Sidebar>
  );
}
