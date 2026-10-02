# Implementasi UI

UI dibuat berurutan sesuai PRD: admin, aktivasi, kelola pemilik, lalu dukungan admin.

## Komponen dan blocks

Tailwind CSS v4 dan komponen shadcn/ui dari registry resmi, preset Radix Nova. Block [login-04](https://ui.shadcn.com/blocks/login) menjadi dasar login; block [dashboard-01](https://ui.shadcn.com/blocks) dan sidebar menjadi dasar navigasi admin. Struktur blocks disesuaikan dengan kebutuhan QR Review dan seluruh data contoh diganti data API. Ikon memakai Lucide dan tipografi Geist.

## Cakupan

- Admin: login/logout Supabase, verifikasi allowlist, dashboard, pencarian/filter/paginasi QR, daftar/detail/buat batch, ekspor publik dan kode aktivasi terpisah, polling job, unduhan PNG/SVG/ZIP, QC stok dan pencatatan penjualan.
- Publik: halaman awal, aktivasi sesuai status, validasi link dan PIN, hasil sukses, fallback resolver untuk QR tidak dikenal, belum terjual, suspend, retire, rate limit dan gangguan layanan.
- Pemilik: token/link QR dan PIN, sesi cookie, profil toko, statistik kunjungan, uji tujuan, update dengan ETag/CSRF, ganti PIN, logout, sesi berakhir dan tampilan read-only ketika suspend.
- Dukungan: reset PIN dan transfer dengan alasan/referensi verifikasi, claim melalui fragment yang segera dihapus, rotasi kode aktivasi, suspend/resume/retire dan audit.
- Semua layar: bahasa Indonesia, mobile, keadaan loading/kosong/gagal, pesan per field, pencegahan submit ganda dan retry operasi yang mendukung idempotency dengan key yang sama setelah kegagalan jaringan.

## Verifikasi

Build produksi, typecheck dan lint berhasil. Tes backend: 45 unit + 29 integrasi. [Laporan browser](../artifacts/ui-verification.json) merekam 18 skenario yang lulus tanpa error JavaScript; Chromium memakai viewport desktop 1440 × 1000 dan mobile 390 × 844. Tes berjalan terhadap server Next.js produksi dengan database PostgreSQL sementara dan Auth simulasi yang memverifikasi signature JWT. Kredensial Supabase lokal tidak digunakan untuk mengubah data produksi saat pengujian. Login memakai akun Supabase asli tetap perlu dicoba oleh admin pada project tersebut.

| Tahap / kebutuhan | Bukti browser                                                                                                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin             | Redirect halaman terlindungi, password salah, penolakan allowlist, dashboard kosong, buat batch, logout dan akses ditolak kembali                                                        |
| Batch/produksi    | Paginasi 23 unit, pencarian token, ekspor ZIP publik dan kode terpisah, polling worker, decode PNG ke URL publik, unduh SVG, QC dan sale                                                 |
| Aktivasi          | `/r/TOKEN` tetap menjadi alamat halaman, blok sebelum SOLD, error link review dan konfirmasi PIN tanpa kehilangan isian, kode dinormalisasi, PIN dengan nol awal                         |
| Pemilik           | Cookie HTTPS, CSRF dan If-Match, perubahan link langsung dipakai 302, HEAD tanpa hitungan, kunjungan durable, konflik version mempertahankan draft dan meminta refresh eksplisit         |
| PIN/sesi          | Ganti PIN mencabut sesi, PIN lama ditolak, login PIN baru, logout, expiry mengembalikan login, lima kegagalan memberi countdown dan menonaktifkan submit                                 |
| Dukungan          | Reset/transfer dengan referensi verifikasi, grant sekali pakai, fragment dihapus sebelum request dan tidak disimpan di browser, transfer memisahkan statistik                            |
| Status unit       | Suspend menghasilkan fallback dan owner read-only, resume menghasilkan redirect, retire terminal 410, riwayat dengan label manusia, rotasi menolak kode lama, DAMAGED menonaktifkan unit |
| Retry jaringan    | Response batch dan grant sudah commit sengaja diputus; retry memakai payload/key/If-Match awal dan menghasilkan satu batch/grant                                                         |
| Gangguan / mobile | API 503 dengan retry berhasil, unknown QR, home/help, sidebar mobile menutup setelah navigasi, nama toko panjang tanpa overflow halaman                                                  |

Tangkapan layar: [login](../artifacts/ui/login-desktop.png), [dashboard desktop](../artifacts/ui/dashboard-desktop.png), [dashboard mobile](../artifacts/ui/dashboard-mobile.png), [batch](../artifacts/ui/batch-desktop.png), [detail QR](../artifacts/ui/qr-desktop.png), [aktivasi mobile](../artifacts/ui/activation-mobile.png), [pemilik mobile](../artifacts/ui/owner-mobile.png), dan [dukungan mobile](../artifacts/ui/support-mobile.png). Data pada tangkapan berasal dari database pengujian yang sudah dihapus.

Resolver memakai proxy Node.js untuk mempertahankan status/headers terminal dan redirect ACTIVE; unit UNACTIVATED diteruskan ke halaman React di alamat cetaknya tanpa rewrite ke host lain. [Uji runtime](../artifacts/runtime-verification.json): seluruh 6.000 request menghasilkan 302 pada 20 request/detik selama 300 detik, p95 9 ms di mesin lokal. Trafik load test dikecualikan dari statistik.

```sh
npx playwright install chromium
QR_REVIEW_DIST_DIR=.next-ui-verification npm run build
npm run verify:ui
QR_REVIEW_DIST_DIR=.next-ui-verification npm run verify:runtime -- --load
```

Build terpisah menjaga server dev yang berjalan di port 3000. Setelah menghapus/mengganti route, jalankan `node node_modules/next/dist/bin/next typegen` untuk memperbarui tipe route dev sebelum build verifikasi; tipe lama dari `.next` dapat merujuk file yang sudah tidak ada.
