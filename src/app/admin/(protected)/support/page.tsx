import { PageHeading } from '@/components/common';
import { QrList } from '@/components/admin/qr-list';
export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const initial = {
    search: typeof params.search === 'string' ? params.search.slice(0, 120) : '',
    status: 'ALL',
    stock_status: 'ALL',
  };
  return (
    <>
      <PageHeading
        eyebrow="Bantuan pemilik"
        title="Dukungan QR toko"
        description="Cari unit yang membutuhkan bantuan, lalu buka detail untuk reset PIN, transfer kepemilikan, atau perubahan status layanan."
      />
      <QrList key={initial.search} initial={initial} support />
    </>
  );
}
