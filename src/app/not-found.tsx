import { PublicShell } from '@/components/public-shell';
import { PublicStatus } from '@/components/activation';
export default function NotFound() {
  return (
    <PublicShell>
      <PublicStatus
        title="Halaman tidak ditemukan"
        description="Periksa alamat halaman atau buka panduan untuk melanjutkan."
      />
    </PublicShell>
  );
}
