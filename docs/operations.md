# Operasional dan pemulihan

Konfigurasikan koneksi PostgreSQL Supabase melalui environment server, lalu jalankan migrasi pada project yang dipilih. Schema `qr_review` bersifat privat, tidak perlu diekspos melalui Data API. `anon`, `authenticated`, dan PUBLIC tidak mendapat privileges maupun policies ke tabel sensitif. Secret database dan kunci aplikasi hanya berada pada environment server/worker.

Domain `PUBLIC_ORIGIN` menjadi bagian URL yang dicetak. Tetapkan domain produksi sebelum ekspor untuk vendor. Jalankan Next.js di belakang ingress HTTPS yang mengganti forwarded protocol/source headers. Gunakan bypass cache untuk seluruh API dan resolver; perubahan URL berlaku pada GET berikutnya. Cookie pemilik harus tetap HttpOnly/Secure/SameSite=Strict tanpa Domain.

Worker `npm run worker` harus hidup terpisah dari lifecycle request Next.js. Lebih dari satu worker dapat dijalankan karena claim job memakai row lock `SKIP LOCKED`. Lease job RUNNING dipulihkan setelah lima menit; finalisasi memeriksa lease agar worker lama tidak menimpa hasil worker pengganti. Job gagal ditandai FAILED dan batch tetap ada. Retry ekspor yang gagal memakai Idempotency-Key baru.

Scheduler menjalankan `npm run maintenance` setiap menit. TTL diperiksa juga pada endpoint dan worker, sehingga response expired ditolak walau scheduler terlambat. Pencabutan/aktivasi/rotasi menghapus snapshot batch dan secret archive segera. Riwayat scan mentah disimpan 90 hari; statistik ownership tidak terhapus oleh cleanup. Audit dan sale tidak dihapus otomatis sambil menunggu keputusan retensi 12 bulan dari PRD.

Log kegagalan memuat event, request ID, dan timestamp. Kegagalan validasi konfigurasi juga memuat `invalid_fields`, yaitu nama variabel environment yang belum diisi atau tidak valid, tanpa nilainya. Event `api_failed`, `resolver_failed`, `statistics_recording_failed`, `export_failed`, dan `configuration_unavailable` dapat dihubungkan ke alert hosting. Jangan aktifkan logger request body/cookie/Authorization di ingress; secret grant dikirim melalui POST dan berada di fragment support URL. Pantau job QUEUED/RUNNING yang menumpuk dan failure_code; `/api/v1/admin/dashboard` menyediakan hitungan stok/status untuk dukungan.

Default limiter adalah 120 API request/menit per admin atau sumber, dan 300 resolver request/menit per sumber. Lima kegagalan credential per token+sumber dalam 15 menit memicu cooldown 15 menit. Ada batas tambahan 50 kegagalan per sumber dan 30 per token/grant lintas sumber. Semua bucket disimpan di PostgreSQL. Sumber disimpan sebagai HMAC, tanpa IP mentah dalam analytics. Pilot dengan shared NAT perlu mengukur kembali default resolver ini.

Pilih mekanisme backup pada paket Supabase/hosting yang mendukung target PRD: backup harian, RPO 24 jam, dan RTO empat jam. Simpan kunci aplikasi secara terpisah dan aman bersama prosedur recovery; ciphertext snapshot dan hash PIN bergantung pada kunci tersebut. Nilai kunci harus konsisten antar replica. Pergantian pepper/HMAC membutuhkan prosedur pemulihan credential, bukan sekadar mengganti environment.

Restore drill dilakukan di project/database baru yang terisolasi:

1. Catat waktu backup terakhir, mulai recovery timer, dan restore schema/data dari backup.
2. Pulihkan environment kunci yang sesuai backup, origin sementara HTTPS, serta konfigurasi Supabase Auth. Allowlist admin memuat UUID Supabase Auth; cocokkan dengan user Auth project pemulihan.
3. Cabut sesi dan grant hasil restore melalui server/admin database, jalankan maintenance untuk secret/event expired, lalu verifikasi schema/RLS/grants.
4. Verifikasi batch/QC/sale, token historis, resolver ke tujuan terbaru, login/edit/PIN, grant baru, dan statistik ownership. Periksa audit untuk QR sampel.
5. Catat kehilangan data terhadap backup (RPO) dan waktu layanan pulih (RTO). Pemindahan domain ke environment pemulihan mengikuti proses deployment hosting yang dipilih.

Restore produksi dan login UI Supabase Auth asli belum diuji. Migrasi dan koneksi database project lokal telah diverifikasi; pengujian otomatis UI memakai database sementara dan Auth simulasi. Uji cetak akrilik dan pilot 10 toko tetap tahap berikutnya. Laporan pengujian di `artifacts/` membuktikan perilaku aplikasi dan target performa di mesin lokal.

## UI dan sesi

Admin masuk melalui `/admin/login` dengan akun email/password Supabase Auth yang UUID-nya ada dalam allowlist. SDK menyimpan sesi admin di browser dan memperbarui access token otomatis. Logout membersihkan sesi SDK dan cache admin. Tidak ada service-role key atau koneksi PostgreSQL di browser.

Pemilik memakai `/manage` dengan token dan PIN, cookie Secure/HttpOnly dan CSRF. Dev server perlu HTTPS. Reset/transfer dibuka melalui tautan lengkap berisi fragment; halaman segera menghapus fragment dan menyimpan grant hanya dalam memori. Jika halaman dimuat ulang sebelum claim, pemilik perlu membuka kembali tautan lengkap. Dukungan harus mengirimkan tautan hanya kepada pemilik yang telah diperiksa buktinya.

Paket kode aktivasi diunduh terpisah dari paket publik. UI menyimpan ID job ekspor agar polling dapat dilanjutkan setelah halaman dibuka ulang; isi kode, PIN dan grant tidak disimpan di localStorage atau query cache. Ingat bahwa file ZIP yang sudah diunduh tetap perlu disimpan dengan aman oleh admin.

## Pilihan deployment

Vercel merupakan pilihan paling dekat dengan implementasi Node.js saat ini: import repository GitHub, gunakan framework Next.js, dan build `npm run build`. Tambahkan environment dari `.env.example` melalui pengaturan project, tanpa memasukkan `.env.local` ke Git. Gunakan origin produksi HTTPS sebagai `PUBLIC_ORIGIN` serta database Supabase dan kunci aplikasi yang sesuai dengan data tersebut. [Dokumentasi Next.js pada Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs).

Deployment web belum menjalankan loop `npm run worker` atau scheduler CLI secara otomatis. Sediakan proses Node.js terpisah untuk worker dan jadwal maintenance setiap menit, atau adaptasikan keduanya menjadi job terjadwal/antrean sebelum produksi. Function Vercel memiliki batas durasi. Unduhan ZIP besar juga perlu diuji: batas payload response Function adalah 4,5 MB; strategi penyimpanan/unduhan perlu disesuaikan bila arsip melebihi batas. [Batas Vercel Functions](https://vercel.com/docs/functions/limitations).

Cloudflare Workers mendukung aplikasi Next.js melalui adaptasi runtime. Dokumentasi saat ini merekomendasikan vinext, yang masih beta, dan menyediakan jalur OpenNext untuk kebutuhan kompatibilitas tertentu. Project ini belum memiliki konfigurasi atau hasil pengujian Workers. Uji adapter, PostgreSQL/TLS, hashing PIN, proxy resolver, ekspor, dan job terjadwal sebelum memilihnya. Cloudflare Pages static export tidak mencakup API dan sesi aplikasi ini. [Panduan Next.js pada Cloudflare](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/).
