import { PageHeading } from '@/components/common';
import { QrList } from '@/components/admin/qr-list';
import { CreateBatch } from '@/components/admin/create-batch';
export default async function QrPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const status =
    typeof params.status === 'string' &&
    ['UNACTIVATED', 'ACTIVE', 'SUSPENDED', 'RETIRED'].includes(params.status)
      ? params.status
      : 'ALL';
  const stock_status =
    typeof params.stock_status === 'string' &&
    ['GENERATED', 'AVAILABLE', 'SOLD', 'DAMAGED'].includes(params.stock_status)
      ? params.stock_status
      : 'ALL';
  const initial = {
    search: typeof params.search === 'string' ? params.search.slice(0, 120) : '',
    status,
    stock_status,
  };
  return (
    <>
      <PageHeading
        eyebrow="Inventori"
        title="Daftar QR"
        description="Cari unit, periksa stok, dan kelola status layanan QR."
        action={<CreateBatch />}
      />
      <QrList key={JSON.stringify(initial)} initial={initial} />
    </>
  );
}
