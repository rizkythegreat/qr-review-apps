import type { ReactNode } from 'react';
import './globals.css';
import { Geist } from 'next/font/google';
import { cn } from '@/lib/utils';
import type { Metadata } from 'next';
import Script from 'next/script';
import { Providers } from '@/components/providers';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' });
const captureGrant = `(function(){var p=location.pathname;if((p==='/pin-reset'||p==='/ownership-transfer')&&location.hash){window.__qrReviewGrant={path:p,token:new URLSearchParams(location.hash.slice(1)).get('grant')||''};history.replaceState(history.state,'',p+location.search)}})();`;

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: { default: 'QR Review — Kelola QR toko', template: '%s · QR Review' },
  description: 'Produksi, aktivasi, dan kelola QR untuk akses ulasan toko.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id" className={cn('font-sans', geist.variable)}>
      <body>
        <Script id="qr-review-grant" strategy="beforeInteractive">
          {captureGrant}
        </Script>
        <Providers
          supabaseUrl={process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''}
          publishableKey={
            process.env.SUPABASE_PUBLISHABLE_KEY ||
            process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
            ''
          }
        >
          <TooltipProvider>
            {children}
            <Toaster theme="light" richColors closeButton position="top-right" />
          </TooltipProvider>
        </Providers>
      </body>
    </html>
  );
}
