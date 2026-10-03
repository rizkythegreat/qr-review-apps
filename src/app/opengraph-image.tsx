import { ImageResponse } from 'next/og';
import QRCode from 'qrcode';
import { siteOrigin } from '@/lib/site-metadata';

export const alt = 'QR Review — Produksi, aktivasi, dan kelola QR toko untuk Google Review.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OpenGraphImage() {
  const qr = await QRCode.toDataURL(siteOrigin.origin, {
    width: 240,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: { dark: '#171717', light: '#ffffff' },
  });
  return new ImageResponse(
    <div
      style={{
        display: 'flex',
        width: '100%',
        height: '100%',
        background: '#0a0a0a',
        color: '#fafafa',
        padding: 64,
        flexDirection: 'column',
        fontFamily: 'sans-serif',
        border: '1px solid #262626',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <div style={{ display: 'flex', padding: 12, borderRadius: 16, background: '#fafafa' }}>
          <svg
            width={36}
            height={36}
            viewBox="0 0 64 64"
            fill="none"
            stroke="#171717"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="8" y="8" width="18" height="18" rx="2" />
            <rect x="38" y="8" width="18" height="18" rx="2" />
            <rect x="8" y="38" width="18" height="18" rx="2" />
            <path d="M38 38h9v9h9v9M38 56v-9M56 38h.01" />
          </svg>
        </div>
        <div style={{ display: 'flex', fontSize: 38, fontWeight: 700 }}>
          QR<span style={{ color: '#a3a3a3', marginLeft: 9, fontWeight: 400 }}>Review</span>
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flex: 1,
          gap: 40,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', width: 680 }}>
          <div
            style={{
              display: 'flex',
              color: '#6ee7b7',
              fontSize: 18,
              letterSpacing: 3,
              marginBottom: 22,
            }}
          >
            QR UNTUK GOOGLE REVIEW
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              fontSize: 64,
              fontWeight: 700,
              letterSpacing: -2,
              lineHeight: 1.15,
            }}
          >
            <span>Kelola QR toko.</span>
            <span style={{ color: '#a3a3a3' }}>Tanpa cetak ulang.</span>
          </div>
          <div
            style={{
              display: 'flex',
              color: '#d4d4d4',
              fontSize: 25,
              lineHeight: 1.5,
              marginTop: 26,
              maxWidth: 610,
            }}
          >
            Dari produksi dan aktivasi, hingga pengelolaan link ulasan toko.
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: 18,
            borderRadius: 24,
            background: '#ffffff',
            color: '#171717',
            width: 276,
            flexShrink: 0,
          }}
        >
          <img src={qr} width={240} height={240} alt="QR menuju beranda aplikasi" />
          <div
            style={{
              display: 'flex',
              fontSize: 17,
              marginTop: 10,
              marginBottom: 6,
              color: '#525252',
            }}
          >
            Scan untuk membuka
          </div>
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderTop: '1px solid #262626',
          paddingTop: 22,
          fontSize: 20,
          color: '#a3a3a3',
        }}
      >
        <span>Produksi · Aktivasi · Kelola</span>
        <span>{siteOrigin.hostname}</span>
      </div>
    </div>,
    size,
  );
}
