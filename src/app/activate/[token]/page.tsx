import { Activation } from '@/components/activation';
import { PublicShell } from '@/components/public-shell';
import { getApplication } from '@/server/runtime';
import { getQr } from '@/server/domain';
import type { PublicQr } from '@/lib/types';
export default async function ActivationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let initial: PublicQr | undefined;
  if (/^[A-Za-z0-9_-]{22}$/.test(token)) {
    try {
      const qr = await getQr(getApplication().pool, token, true);
      initial = {
        token,
        status: qr.status,
        activation_allowed: qr.status === 'UNACTIVATED' && qr.stock_status === 'SOLD',
        manage_path: '/manage',
        supported_review_link_policy: 'GOOGLE_REVIEW_V1',
      };
    } catch {
      /* The client shows the API's precise error; database failures never become activation forms. */
    }
  }
  return (
    <PublicShell>
      <Activation token={token} initial={initial} />
    </PublicShell>
  );
}
