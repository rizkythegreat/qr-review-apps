'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useStandalone } from '@/hooks/use-standalone';

export function ReturnToAdmin() {
  const isStandalone = useStandalone();
  if (!isStandalone) return null;
  return (
    <Button asChild variant="ghost" size="sm">
      <Link href="/admin" aria-label="Kembali ke admin">
        <ArrowLeft />
        Admin
      </Link>
    </Button>
  );
}
