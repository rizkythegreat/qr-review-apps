'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronsUpDown, LogOut, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { useAdminAuth } from '@/components/providers';

export function NavUser({ email }: { email: string }) {
  const { isMobile } = useSidebar();
  const { client } = useAdminAuth();
  const router = useRouter();
  const queries = useQueryClient();
  const [pending, setPending] = useState(false);
  async function logout() {
    setPending(true);
    const result = await client?.auth.signOut({ scope: 'local' });
    setPending(false);
    if (result?.error) {
      toast.error('Belum berhasil keluar. Periksa koneksi dan coba lagi.');
      return;
    }
    queries.removeQueries({ queryKey: ['admin'] });
    router.replace('/admin/login');
  }
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
              <Avatar className="size-8 rounded-lg">
                <AvatarFallback className="rounded-lg bg-primary/10 text-xs font-semibold">
                  {email.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="grid min-w-0 flex-1 text-left text-sm">
                <span className="font-medium">Administrator</span>
                <span className="truncate text-xs text-muted-foreground">{email}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side={isMobile ? 'top' : 'right'} align="end" className="w-64">
            <DropdownMenuLabel className="grid gap-1">
              <span className="flex items-center gap-2">
                <ShieldCheck className="size-4" />
                Akun admin
              </span>
              <span className="truncate text-xs font-normal text-muted-foreground">{email}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void logout()} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : <LogOut />}Keluar
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
