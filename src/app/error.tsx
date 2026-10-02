'use client';
import { PublicShell } from '@/components/public-shell';
import { ErrorState } from '@/components/common';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <PublicShell>
      <ErrorState error={null} retry={reset} />
    </PublicShell>
  );
}
