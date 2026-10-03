'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';

export function NavMain({ items }: { items: { title: string; url: string; icon: ReactNode }[] }) {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <SidebarMenu className="gap-2">
      {items.map((item) => (
        <SidebarMenuItem key={item.url}>
          <SidebarMenuButton
            asChild
            tooltip={item.title}
            isActive={item.url === '/admin' ? pathname === item.url : pathname.startsWith(item.url)}
          >
            <Link
              href={item.url}
              onClick={() => {
                if (isMobile) setOpenMobile(false);
              }}
            >
              {item.icon}
              <span>{item.title}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
}
