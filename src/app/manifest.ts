import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'QR Review',
    short_name: 'QR Review',
    description: 'Produksi, aktivasi, dan kelola QR untuk akses ulasan toko.',
    lang: 'id',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#fafafa',
    theme_color: '#171717',
    prefer_related_applications: false,
    icons: [
      { src: '/icons/app-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/app-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/app-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
