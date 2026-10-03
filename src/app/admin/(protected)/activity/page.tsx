import { PageHeading } from '@/components/common';
import { ActivityLog } from '@/components/admin/activity-log';

export default function ActivityPage() {
  return (
    <>
      <PageHeading
        eyebrow="Riwayat"
        title="Log Aktivitas"
        description="Perubahan stok, penjualan, aktivasi, dan tindakan dukungan untuk seluruh QR."
      />
      <ActivityLog />
    </>
  );
}
