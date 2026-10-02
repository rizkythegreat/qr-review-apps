'use client';

// Real inventory metrics replace the examples in dashboard-01.
import Link from 'next/link';
import { QrCode, PackageCheck, CircleCheck, ShoppingBag, ArrowUpRight } from 'lucide-react';
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { Dashboard } from '@/lib/types';
import { number } from '@/lib/format';

export function SectionCards({ data }: { data: Dashboard }) {
  const cards = [
    {
      label: 'Total unit QR',
      value: data.total_units,
      icon: QrCode,
      note: 'Seluruh unit yang diproduksi',
      href: '/admin/qr-codes',
    },
    {
      label: 'Siap dijual',
      value: data.stock_counts.AVAILABLE,
      icon: PackageCheck,
      note: 'Lolos QC dan tersedia di stok',
      href: '/admin/qr-codes?stock_status=AVAILABLE',
    },
    {
      label: 'QR aktif',
      value: data.qr_counts.ACTIVE,
      icon: CircleCheck,
      note: 'Siap mengarahkan pelanggan',
      href: '/admin/qr-codes?status=ACTIVE',
    },
    {
      label: 'Unit terjual',
      value: data.stock_counts.SOLD,
      icon: ShoppingBag,
      note: 'Sudah tercatat penjualannya',
      href: '/admin/qr-codes?stock_status=SOLD',
    },
  ];
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((item) => (
        <Card key={item.label} className="gap-5 shadow-none">
          <CardHeader>
            <CardDescription>{item.label}</CardDescription>
            <CardTitle className="mt-1 text-3xl font-semibold tabular-nums tracking-tight">
              {number(item.value)}
            </CardTitle>
            <CardAction>
              <span className="flex size-9 items-center justify-center rounded-lg border bg-muted/40 text-muted-foreground">
                <item.icon className="size-4" />
              </span>
            </CardAction>
          </CardHeader>
          <CardFooter>
            <Link
              href={item.href}
              className="flex w-full items-center justify-between gap-2 text-xs text-muted-foreground hover:text-foreground"
            >
              {item.note}
              <ArrowUpRight className="size-3.5 shrink-0" />
            </Link>
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}
