import { GrantClaim } from '@/components/grant-claim';
import { PublicShell } from '@/components/public-shell';
export default function TransferPage() {
  return (
    <PublicShell>
      <GrantClaim transfer />
    </PublicShell>
  );
}
