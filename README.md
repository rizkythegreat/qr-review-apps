# QR Review — MVP

Implementasi Next.js berdasarkan [PRD](PRD_Akrilik_QR_Review_MVP.md) dan [OpenAPI v0.1](openapi-qr-review-v0.1.yaml). Semua 32 operasi API aplikasi serta GET/HEAD resolver tersedia. UI menggunakan Tailwind CSS v4 dan komponen shadcn/ui, dengan adaptasi blocks resmi `login-04` dan `dashboard-01`. Halaman admin, aktivasi, kelola pemilik, dan dukungan terhubung ke API aplikasi.

Next.js menjalankan API di Node.js. Database adalah PostgreSQL Supabase melalui koneksi server `pg`, sehingga perubahan stok, aktivasi, audit, sesi, dan grant dapat memakai satu transaksi. Supabase Auth memverifikasi bearer admin; allowlist admin tersimpan di database. Pemilik memakai PIN dan sesi opaque tanpa akun Supabase. Aplikasi tidak memerlukan service-role key di browser maupun untuk akses PostgreSQL.

## Menjalankan aplikasi

Gunakan Node.js 20.19+ dan PostgreSQL 15+ atau database Supabase.

```sh
npm ci
cp .env.example .env.local
```

Isi `.env.local`:

- `PUBLIC_ORIGIN`: origin HTTPS yang akan dicetak ke QR, misalnya `https://qr.domain-anda.id`.
- `DATABASE_URL`: koneksi PostgreSQL dari dashboard Supabase. Koneksi direct, session pooler, atau transaction pooler didukung; query runtime tidak memakai named prepared statements.
- `MIGRATION_DATABASE_URL`: opsional, akun pemilik schema untuk migrasi dan provisioning admin.
- `DATABASE_SSL=true` untuk Supabase. Sertifikat diverifikasi; isi `DATABASE_SSL_CA` bila CA project dibutuhkan. PostgreSQL lokal dapat memakai `false`.
- `SUPABASE_URL` dan `SUPABASE_PUBLISHABLE_KEY`: project URL dan publishable/legacy anon key untuk verifikasi Auth.
- `PIN_PEPPER`, `HMAC_KEY`, `ENCRYPTION_KEY`: tiga nilai berbeda, masing-masing 32 byte acak dalam base64. Jalankan `openssl rand -base64 32` untuk setiap nilai. Gunakan nilai yang sama pada server dan worker.
- `TRUSTED_IP_HEADER`: header IP tunggal yang diganti oleh reverse proxy tepercaya. Misalnya `x-vercel-forwarded-for` di deployment Vercel. Jika kosong/invalid, limiter memakai bucket sumber bersama. Header proxy yang dipilih harus disanitasi di ingress.

Jika migrasi melaporkan sertifikat SSL tidak dipercaya, unduh CA melalui **Database settings → SSL Configuration → Download certificate** di Supabase, lalu isi `DATABASE_SSL_CA` dengan isi sertifikat PEM. Newline dapat ditulis sebagai `\n` di dalam nilai yang dibungkus tanda petik ganda. Pertahankan `DATABASE_SSL=true` agar sertifikat dan hostname database tetap diverifikasi. Hindari parameter `sslmode`, `sslrootcert`, `sslcert`, atau `sslkey` pada connection string ketika memakai konfigurasi SSL aplikasi; node-postgres mengganti objek SSL jika parameter tersebut ada.

Migrasi dikelola oleh script aplikasi dengan ledger `qr_review.schema_migrations`; SQL disimpan di `supabase/migrations`.

```sh
npm run db:migrate
npm run admin:add -- UUID_USER_SUPABASE_AUTH
npm run dev
```

Daftarkan user email/password admin di Supabase Auth terlebih dahulu dan tambahkan UUID-nya dengan `admin:add`. Buka `/admin/login` untuk masuk. Login/refresh/logout admin memakai SDK Supabase Auth; token sesi disimpan SDK di browser dan API tetap memeriksa allowlist database. Role `user_metadata` tidak digunakan.

Setelah server dan worker berjalan, gunakan urutan berikut:

1. Buka `/admin`, buat batch, lalu siapkan dan unduh ZIP QR publik serta ZIP kode aktivasi secara terpisah.
2. Buka detail QR, tandai lolos QC, lalu catat penjualan.
3. Pindai QR atau buka `/r/TOKEN`. Pemilik mengisi kode aktivasi, nama toko, link review Google dan PIN empat digit.
4. Pemilik membuka `/manage` menggunakan token dan PIN untuk memperbarui link, melihat kunjungan atau mengganti PIN.
5. Admin menggunakan tab Dukungan di detail QR untuk reset PIN, transfer, rotasi kode, suspend/resume atau penonaktifan permanen. Bantuan penggunaan tersedia di `/help`.

Development memakai HTTPS agar cookie `__Host-owner_session` berfungsi. Next.js dapat membuat sertifikat development. Jika ingin memakai sertifikat lokal sendiri:

```sh
mkdir -p certificates
openssl req -x509 -newkey rsa:2048 -nodes -keyout certificates/key.pem -out certificates/cert.pem -days 30 -subj '/CN=localhost'
npm run dev -- --experimental-https-key=certificates/key.pem --experimental-https-cert=certificates/cert.pem
```

`npm run build` dan `npm start` menjalankan build produksi. Gunakan ingress HTTPS yang mengganti forwarded headers dan menonaktifkan cache untuk `/api/v1/*` dan `/r/*`. API memeriksa HTTPS dan mengirim `Cache-Control: no-store`; resolver juga memakai `max-age=0`.

## Ekspor dan maintenance

Jalankan worker sebagai proses Node.js terpisah dengan environment database/origin/kunci yang sama:

```sh
npm run worker
```

`npm run worker -- --once` memproses satu job. Job tersimpan di PostgreSQL, memakai lease dan `SKIP LOCKED`, dan dapat dilanjutkan setelah worker terhenti. Ekspor publik berisi manifest dan PNG/SVG; ekspor kode aktivasi menggunakan ZIP terpisah. Snapshot dan ZIP rahasia terenkripsi AES-256-GCM di database. Worker serta endpoint status/download memeriksa ulang TTL dan validitas snapshot.

Jadwalkan `npm run maintenance` **setiap menit** melalui scheduler hosting. Script menghapus ciphertext yang kedaluwarsa, sesi lama, grant lama, bucket rate limit, dan raw scan events lebih dari 90 hari. Agregat kunjungan per kepemilikan dipertahankan. Akses secret tetap ditolak tepat setelah TTL walau job cleanup terlambat. Retensi audit/penjualan 12 bulan masih keputusan draft PRD dan tidak dihapus otomatis.

## Memakai API

Body JSON maksimal 16 KiB; field tambahan dan `null` yang tidak diizinkan ditolak. PIN berupa string empat digit, termasuk nol awal. URL review hanya menerima policy `GOOGLE_REVIEW_V1`: `https://g.page/r/{code}/review` atau `https://search.google.com/local/writereview?placeid={id}`. Server tidak fetch/resolve short-link Google.

Mutasi yang ditandai kontrak memerlukan UUID `Idempotency-Key`. Retry jaringan memakai key, payload, dan `If-Match` yang sama. Setelah memperbaiki payload akibat 4xx, gunakan key baru; fingerprint kegagalan tetap terikat key tanpa menyimpan PIN/kode mentah. Replay sukses dievaluasi sebelum state/version, dan replay publik ditolak bila generation/kepemilikan/status berubah. Rahasia dukungan/rotasi direplay maksimal 15 menit dengan tombstone 24 jam.

Gunakan ETag dari GET QR admin atau GET `/owner/me` sebagai `If-Match`, misalnya `"v3"`. Mutasi pemilik memerlukan cookie sesi, `Origin` persis `PUBLIC_ORIGIN`, dan `X-CSRF-Token` dari login atau GET `/owner/me`. Aktivasi dan claim grant juga memerlukan Origin, dan tidak otomatis membuat sesi. Setelah berhasil, pemilik login lewat `/api/v1/owner/sessions`.

Alur produksi: buat batch → ekspor publik/rahasia → QC `AVAILABLE` → catat penjualan `SOLD` → aktivasi dengan kode dan PIN. Dukungan reset/transfer memerlukan alasan dan referensi verifikasi oleh admin; pemeriksaan bukti dilakukan di luar aplikasi. Link claim memuat secret pada fragment, bukan query. UI menghapus fragment sebelum inisialisasi Auth, menyimpan grant hanya di memori halaman, lalu mengirimnya melalui POST. Membuka ulang halaman tanpa fragment memerlukan tautan lengkap dari admin.

Rincian endpoint, payload, kode error, serta aturan bisnis tetap merujuk OpenAPI. [Pemetaan implementasi dan pengujian](docs/implementation.md) menjelaskan bukti backend untuk setiap acceptance criterion. [Runbook deployment dan pemulihan](docs/operations.md) memuat pengaturan worker, monitoring, serta backup.

## Verifikasi

```sh
npm run typecheck
npm run lint
npm test
npm run test:integration
npm run build
npm run verify:runtime
npx playwright install chromium
npm run verify:ui
# Target resolver PRD: 20 req/detik selama 5 menit
npm run verify:runtime -- --load
```

Tes integrasi, runtime, dan browser membuat database sementara lalu menghapusnya, tanpa mengubah database aplikasi. Default memakai PostgreSQL lokal dan user OS. Set `TEST_DATABASE_URL` ke database kontrol khusus pengujian dengan izin create/drop database dan create/drop role untuk tes RLS. Runtime memerlukan `openssl`, build Next.js, dan port localhost bebas; menggunakan sertifikat HTTPS sementara dan Auth simulasi yang memverifikasi signature JWT. Tidak memasang sertifikat ke trust store OS. Browser verifier memakai Chromium desktop/mobile dan default build `.next-ui-verification`; buat dengan `QR_REVIEW_DIST_DIR=.next-ui-verification npm run build`. Untuk memakai build biasa, jalankan `QR_REVIEW_DIST_DIR=.next npm run verify:ui`.

Uji mencakup aktivasi paralel, retry, version conflict, isolasi sesi, CSRF, shared rate limit, reset/transfer, pemisahan statistik, RLS, decode PNG, invalidasi ekspor, TTL, gangguan statistik, serta batas batch 500. Laporan lokal tersimpan di `artifacts/*.json` dan tangkapan UI di `artifacts/ui/`. [Cakupan UI](docs/ui-implementation.md) memuat rincian. Login UI dengan akun Supabase asli, deployment hosting, pemulihan produksi dan pilot fisik tetap memerlukan pengujian pada environment tersebut; tes lokal memakai Auth simulasi.

Referensi implementasi: [Next.js Route Handlers](https://nextjs.org/docs/app/api-reference/file-conventions/route), [koneksi PostgreSQL Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres), [verifikasi user Supabase Auth](https://supabase.com/docs/reference/javascript/auth-getuser), [keamanan API Supabase](https://supabase.com/docs/guides/api/securing-your-api), dan [parameter scrypt OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt).

### Log aktivitas admin

Buka **Log Aktivitas** di sidebar admin (`/admin/activity`) untuk melihat riwayat seluruh QR. Filter tersedia untuk token/ID QR atau nama toko saat ini, jenis tindakan, dan tanggal inklusif dalam WIB. Setiap entri menampilkan waktu, jenis pelaku, alasan bila ada, detail perubahan, serta tautan ke tab Riwayat QR. Riwayat lama langsung tersedia; login dan kunjungan scan tidak termasuk log ini. API: `GET /api/v1/admin/audit-events`, memakai autentikasi dan allowlist admin yang sama.

Jalankan `npm run db:migrate` sebelum deploy pembaruan ini untuk menambahkan indeks pagination log aktivitas. Migrasi tidak mengubah atau menghapus riwayat yang sudah ada.

### Mulai ulang data aplikasi

Untuk mengosongkan seluruh data operasional, jalankan isi [reset-app-data.sql](scripts/sql/reset-app-data.sql) secara manual di Supabase SQL Editor sebagai pemilik schema, saat aplikasi dan worker tidak sedang digunakan. SQL menghapus seluruh batch, QR, penjualan, kepemilikan, kunjungan, log aktivitas, sesi pemilik, grant dukungan, ekspor, idempotency, dan rate limit. Setelah commit, QR dan link lama tidak berlaku lagi; simpan backup bila data masih diperlukan.

Akun Supabase Auth, allowlist admin, ledger migrasi, struktur tabel, indeks, RLS, constraint, dan trigger dipertahankan. Setelah reset, admin tetap dapat login dan membuat batch baru. File reset berada di luar direktori migrasi dan tidak dijalankan saat deploy.

### Install ke home screen

Aplikasi menyediakan `/manifest.webmanifest`, ikon PNG 192/512 px, ikon maskable, dan metadata Apple. Aplikasi yang diinstal terbuka dalam mode standalone dengan nama **QR Review**, mulai dari beranda. Gunakan URL HTTPS production untuk instalasi; data tetap memerlukan koneksi internet.

Tombol **Install** tersedia di header halaman publik dan admin. Chrome/Edge membuka prompt instalasi ketika browser menyediakannya; jika belum tersedia, tombol menampilkan petunjuk melalui menu browser. Di iPhone/iPad, buka di Safari, pilih **Bagikan → Tambahkan ke Layar Utama**, aktifkan **Buka sebagai App** jika tersedia, lalu **Tambah**. Tombol disembunyikan saat aplikasi dibuka dalam mode standalone.
