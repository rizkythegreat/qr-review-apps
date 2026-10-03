export const siteTitle = 'QR Review — Kelola QR toko';
export const siteDescription =
  'Produksi QR, aktivasi toko, dan kelola link Google Review tanpa mencetak ulang QR.';
export const siteOrigin = new URL(
  process.env.PUBLIC_ORIGIN ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : 'https://qr-review-apps.vercel.app'),
);
