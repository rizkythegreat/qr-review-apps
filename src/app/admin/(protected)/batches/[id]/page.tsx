import { BatchDetail } from '@/components/admin/batches';
export default async function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  return <BatchDetail id={(await params).id} />;
}
