import { QrDetail } from '@/components/admin/qr-detail';
export default async function QrDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const tab =
    typeof query.tab === 'string' && ['overview', 'sales', 'audit', 'support'].includes(query.tab)
      ? query.tab
      : 'overview';
  return <QrDetail key={`${id}:${tab}`} id={id} initialTab={tab} />;
}
