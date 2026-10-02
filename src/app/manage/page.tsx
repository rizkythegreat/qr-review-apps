import type { Metadata } from 'next';
import { OwnerArea } from '@/components/owner';
import { PublicShell } from '@/components/public-shell';
export const metadata: Metadata = { title: 'Kelola QR toko' };
export default async function ManagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return (
    <PublicShell wide>
      <OwnerArea
        initialToken={typeof params.token === 'string' ? params.token.slice(0, 2048) : ''}
      />
    </PublicShell>
  );
}
