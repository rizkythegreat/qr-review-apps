# PRD Aplikasi Akrilik QR Review Toko

Product Requirements Document  •  MVP v0.1  •  2 Oktober 2026

Produk ini menghubungkan akrilik dengan QR unik ke halaman ulasan Google milik toko. QR dibuat sebelum toko diketahui, dicetak massal, lalu diaktifkan saat penjualan. Setelah aktif, pelanggan cukup memindai QR untuk membuka tujuan ulasan toko.

PRD ini menjadi dasar flow produk, desain database, dan API contract berikutnya. Detail baru dalam dokumen merupakan usulan MVP, bukan keputusan yang sudah dikonfirmasi. Stack awal yang diusulkan adalah Next.js dan Supabase.

## **1 Masalah dan tujuan produk**

Penjualan langsung ke toko membutuhkan stok akrilik yang siap dibawa tanpa cetak ulang untuk setiap pelanggan. Pemilik toko perlu mengganti link setelah pembelian tanpa mengganti QR fisik. Pengelola produk perlu mengetahui unit yang dibuat, tersedia, terjual, dan aktif.

* Admin dapat menghasilkan 100 QR unik dalam satu batch dan mengekspor bahan produksi.  
* Sales dapat membantu aktivasi di lokasi; pemilik memilih PIN sendiri.  
* Scan setelah aktivasi mengarah ke link toko terbaru.  
* Pemilik dapat mengubah nama toko, link, dan PIN tanpa akun aplikasi.

## **2 Pengguna dan kewenangan**

| Peran | Kebutuhan dan akses |
| :---- | :---- |
| Admin | Login; buat batch, catat stok dan penjualan, bantuan pemulihan, suspend dan retire QR. |
| Sales | Membawa stok dan membantu setup. Pada MVP, pencatatan penjualan dilakukan admin; akun sales terpisah ditunda. |
| Pemilik toko | Aktivasi dengan kode rahasia; kelola hanya QR terkait melalui PIN. |
| Pelanggan toko | Scan dan membuka halaman review; tidak perlu akun aplikasi. |

## **3 Batas layanan**

MVP memakai penjualan sekali bayar dengan setup. Harga, lama dukungan, dan biaya operasional belum ditetapkan. Jangan menjanjikan QR berlaku selamanya: scan bergantung pada keberlangsungan domain, hosting, dan layanan. Aplikasi mempermudah akses ulasan; jumlah atau rating ulasan tidak dijamin.

# **4 Ruang lingkup MVP**

| ID | Fitur wajib | Hasil yang diharapkan |
| :---- | :---- | :---- |
| FR01 | Admin dan batch | Login admin dan pembuatan batch 1 sampai 500 unit. |
| FR02 | Ekspor produksi | PNG atau SVG QR, daftar token, serta kode aktivasi terpisah. |
| FR03 | Stok dan penjualan | Tracking sederhana tersedia, terjual, rusak; waktu dan referensi penjualan. |
| FR04 | Aktivasi | Kode sekali pakai, nama toko, URL, PIN dan konfirmasi PIN. |
| FR05 | Scan publik | Status QR menentukan halaman aktivasi, redirect, atau fallback. |
| FR06 | Kelola pemilik | Login dengan token dan PIN; edit nama, URL, PIN; logout. |
| FR07 | Statistik dasar | Total kunjungan dan waktu kunjungan terakhir setelah aktif. |
| FR08 | Dukungan admin | Reset PIN, pengalihan kepemilikan, suspend, resume dan retire dengan audit. |

## **Fitur setelah MVP**

* Akun sales dan assignment stok per sales; manajemen toko dengan beberapa outlet.  
* Subscription, payment gateway, komisi sales, dan invoice otomatis.  
* Grafik kunjungan harian, unique visitors, integrasi ulasan Google, dan laporan otomatis.  
* Tujuan selain Google Review, NFC, branding per toko, menu digital, dan aplikasi mobile.

## **Asumsi implementasi**

Satu unit akrilik memiliki satu token dan satu konfigurasi toko. Toko boleh membeli beberapa unit, tetapi setiap QR diaktifkan dan dikelola sendiri pada MVP. Token dan URL publik tidak berubah setelah dicetak. QR tidak memuat kode aktivasi atau PIN.

Pemilik tidak harus membuat akun Supabase Auth. Auth digunakan untuk admin; akses pemilik diberikan melalui sesi server setelah verifikasi PIN. Produksi, pembayaran, dan pengiriman fisik dilakukan di luar aplikasi dan dicatat secara sederhana.

## **Permintaan review**

Gunakan ajakan netral seperti “Scan untuk beri ulasan”. Pelanggan langsung menuju Google tanpa penyaringan berdasarkan kepuasan. Aplikasi tidak membuat ulasan, memberi insentif, atau meminta rating tertentu. Prioritaskan link permintaan review dari Google Business Profile; link Maps lokasi saja dapat membuka lokasi tanpa formulir review.

# **5 Flow produksi dan aktivasi**

## **Dari batch sampai unit terjual**

1. Admin masuk, menetapkan jumlah, dan membuat batch dengan token unik serta kode aktivasi rahasia per unit.  
2. Admin mengunduh QR publik untuk vendor cetak. Kode aktivasi dikemas terpisah sebagai label tersegel atau kartu tertutup; tidak dicetak terbuka di muka akrilik.  
3. Setiap hasil cetak diuji scan dan dicocokkan dengan token. Unit lolos pemeriksaan dicatat AVAILABLE; unit gagal dicatat DAMAGED.  
4. Sales membawa unit tersedia. Saat toko membeli, admin mencatat penjualan dan kontak dukungan opsional sebelum aktivasi.  
5. Sales membantu mengambil link review yang benar. Pemilik scan QR, mengisi kode aktivasi, nama toko, link review, PIN empat digit dan konfirmasinya.  
6. Server memvalidasi input dan penjualan, lalu mengaktifkan satu unit secara atomik. Setelah berhasil, pemilik memperoleh token dan alamat halaman kelola.  
7. Sales dan pemilik mencoba scan ulang dan memeriksa nama bisnis tujuan. Unit diletakkan di kasir setelah hasil sesuai.

## **Flow saat QR dipindai**

![][image1]

Saat belum terjual, halaman belum aktif tampil tanpa mengizinkan aktivasi. Jika token tidak dikenal atau layanan gagal, tampilkan pesan yang sesuai dan tombol coba lagi. Kegagalan layanan tidak boleh diperlakukan sebagai QR belum aktif.

# **6 Status dan aturan bisnis**

## **Status layanan QR**

| Status | Perilaku scan | Perubahan yang diizinkan |
| :---- | :---- | :---- |
| UNACTIVATED | Informasi belum aktif; form jika sudah terjual. | Aktivasi ke ACTIVE; admin dapat RETIRE. |
| ACTIVE | Redirect sementara 302 ke review\_url. | Pemilik edit data; admin SUSPEND atau RETIRE. |
| SUSPENDED | Halaman layanan sementara tidak tersedia. | Admin resume ke ACTIVE atau RETIRE; owner dapat menghubungi dukungan. |
| RETIRED | Halaman unit tidak lagi digunakan. | Terminal; token tidak dipakai ulang. |

## **Status stok fisik**

Stock state terpisah dari status layanan: GENERATED setelah batch dibuat, AVAILABLE setelah QC, SOLD setelah transaksi, dan DAMAGED untuk unit gagal. Jalur normal GENERATED → AVAILABLE → SOLD. GENERATED atau AVAILABLE dapat menjadi DAMAGED; unit DAMAGED tidak dapat dijual atau diaktifkan. Kerusakan unit terjual ditangani melalui retire dan unit pengganti.

## **Aturan yang berlaku pada semua flow**

* Aktivasi membutuhkan status UNACTIVATED dan stok SOLD. Dua aktivasi bersamaan menghasilkan satu pemenang; permintaan lain ditolak tanpa menimpa konfigurasi.  
* Kode aktivasi dikonsumsi setelah berhasil. Scan pertama hanya membuka flow; tidak otomatis menetapkan pemilik.  
* PIN tepat empat digit termasuk kemungkinan nol di awal. PIN baru selalu membutuhkan konfirmasi; perubahan PIN membutuhkan sesi valid dan PIN lama.  
* Update link berlaku pada scan berikutnya. Redirect dan pembacaan status tidak boleh tersimpan dalam cache browser atau CDN sebagai tujuan permanen.  
* Perubahan nama, URL, atau PIN tidak mengganti token. QR yang sudah dicetak tidak dihapus atau tokennya didaur ulang.  
* Akun admin dapat mengatur status dan bantuan kepemilikan, tetapi tidak dapat membaca PIN atau kode aktivasi dari hash.

## **Penggantian dan pengalihan kepemilikan**

Lupa PIN ditangani admin setelah pemeriksaan referensi penjualan dan bukti kepemilikan. Token publik atau nama toko saja bukan bukti cukup. Admin menerbitkan tautan reset sekali pakai yang kedaluwarsa, lalu pemilik menentukan PIN baru. Sesi lama dicabut; link toko tetap berlaku.

Pindah pemilik melalui dukungan admin, bukan reset publik. Admin mencatat alasan, menangguhkan QR, memverifikasi pemilik baru, lalu memperbarui toko dan PIN. Riwayat audit tetap ada; statistik untuk kepemilikan baru dimulai pada periode baru. MVP tidak mengembalikan unit terjual ke stok umum.

# **7 Kebutuhan layar dan validasi**

## **Halaman dan navigasi**

| Area | Layar | Isi utama |
| :---- | :---- | :---- |
| Admin | Login dan dashboard | Jumlah QR, stok, aktif; pencarian token atau toko. |
| Admin | Batch dan detail QR | Buat batch, status ekspor, detail unit, catat penjualan, audit dan tindakan dukungan. |
| Publik | /r/{token} | Resolver QR; aktivasi atau fallback sesuai status. |
| Pemilik | Aktivasi dan hasil | Kode, nama, URL, PIN, konfirmasi; hasil dan akses kelola. |
| Pemilik | /manage | Token dan PIN; tautan bantuan jika lupa PIN. |
| Pemilik | Detail kelola | Nama, URL, tes tujuan, total kunjungan, waktu terakhir, ganti PIN, logout. |

## **Input aktivasi dan perubahan data**

* Nama toko wajib, 1 sampai 120 karakter setelah trim. PIN berupa string empat digit; jangan dikonversi ke angka.  
* URL wajib HTTPS, maksimal 2.048 karakter, tanpa kredensial URL. Server memeriksa hostname dan bentuk path melalui daftar pola Google yang disetujui; kecocokan tidak boleh hanya berupa substring “google”.  
* MVP memprioritaskan link review g.page dan pola permintaan review Google yang disetujui saat implementasi. Link pendek Maps hanya diterima melalui prosedur normalisasi aman yang ditetapkan pada API contract.  
* Sediakan petunjuk mendapatkan link review dan tombol uji tujuan. Pemilik/sales harus memastikan tujuan menunjuk bisnis yang tepat; validasi format tidak membuktikan kepemilikan bisnis.  
* Jika server perlu mengikuti short-link, setiap hop harus HTTPS ke host yang disetujui, dengan batas hop, timeout dan larangan alamat privat. Jika belum diimplementasikan, minta link review yang didukung.

## **Keadaan gagal dan pemulihan**

Tampilkan kesalahan per field dan pertahankan input nama/URL. PIN dan kode aktivasi tidak ditulis ke log. Aktivasi gagal tidak mengonsumsi kode; permintaan ulang setelah timeout harus dapat mengetahui status terakhir. Kode salah dan PIN salah menghasilkan pesan umum. Pembatasan percobaan memberi informasi kapan boleh mencoba lagi.

Jika QR sudah aktif, halaman aktivasi menyatakan sudah aktif dan menawarkan akses kelola. Jika sedang suspend, owner masih dapat mengakses informasi dan dukungan tetapi tidak mengubah konfigurasi. Tujuan Google yang tidak dapat dibuka diperbaiki owner melalui halaman kelola; aplikasi tidak memantau kesehatan semua link secara otomatis pada MVP.

# **8 Keamanan data dan arsitektur**

## **Stack awal yang diusulkan**

Browser membuka Next.js. Route server Next.js menjalankan batch generation, aktivasi, validasi PIN, update, dan resolver QR. Supabase menyediakan PostgreSQL dan Auth admin. QR dibuat on demand dari URL publik; tidak wajib menyimpan gambar secara permanen. Detail endpoint dan payload disusun pada API contract berikutnya.

## **Kontrol akses dan kredensial**

* Semua operasi sensitif melalui server; request wajib diperiksa autentikasi dan otorisasinya. Secret atau service role key Supabase hanya di server. RLS dan grants menutup akses browser langsung ke data QR dan hash; akses server dengan key istimewa tetap membutuhkan pemeriksaan aplikasi.  
* Token publik menggunakan random kriptografis sekurangnya 128 bit. Kode aktivasi rahasia memiliki sekurangnya 80 bit entropi dan disimpan sebagai hash. Keduanya berbeda dan tidak dapat diturunkan satu sama lain.  
* PIN di-hash menggunakan algoritma password yang sesuai dengan salt dan pepper server. Ruang PIN hanya 10.000 kombinasi; hashing harus disertai pembatasan percobaan online.  
* Usulan rate limit: lima kegagalan PIN atau kode per kombinasi token dan sumber dalam 15 menit, lalu cooldown 15 menit; tambah limit per sumber dan deteksi serangan lintas sumber. Hindari penguncian permanen QR yang dapat dipicu orang lain.  
* Sesi pemilik terikat satu QR dan versi kepemilikan, cookie HttpOnly, Secure dan SameSite; usulan masa berlaku 30 menit. Mutasi memakai proteksi CSRF/origin. Ganti PIN, reset, transfer dan suspend mencabut sesi lama.

## **Ekspor produksi dan audit**

Paket QR publik dipisahkan dari paket kode rahasia. Kode hanya ditampilkan saat pembuatan; jika perlu ekspor ulang, paket rahasia terenkripsi disimpan maksimal 24 jam dan hanya dapat diunduh admin. Setelah dihapus, kode hilang harus dirotasi sebelum aktivasi dan label diganti. Jangan memberi vendor akses ke dashboard atau seluruh data penjualan.

Audit mencatat aktor, token, jenis tindakan, waktu dan perubahan nonrahasia untuk penjualan, aktivasi, update URL, bantuan PIN, transfer dan status. PIN, kode, secret key, serta token sesi/reset tidak masuk log. Usulan retensi audit dan data penjualan 12 bulan perlu ditinjau sebelum peluncuran.

## **Entitas konseptual**

qr\_batches mengelompokkan produksi; qr\_codes memuat token, hash, toko, URL dan status; sales\_records mencatat penjualan; ownership\_periods memisahkan statistik antar pemilik; scan\_events mencatat kunjungan; audit\_events merekam tindakan. Admin memakai Supabase Auth. Sesi pemilik, reset token dan rate limit disimpan di server/shared store, bukan hanya memori satu instance.

# **9 Statistik dan kualitas layanan**

## **Arti statistik**

Kunjungan dihitung ketika resolver menerima GET untuk QR ACTIVE yang lolos pengecualian trafik uji, HEAD dan bot yang dikenali. Angka menunjukkan kunjungan ke QR, bukan orang unik, review terkirim, atau rating Google. Pemindaian berulang dan bot yang tidak dikenali masih dapat ikut terhitung. Scan aktivasi serta kunjungan saat suspend tidak masuk statistik owner.

Simpan waktu, QR, dan periode kepemilikan; IP mentah tidak dibutuhkan untuk statistik. Metadata sumber yang dibutuhkan rate limit memiliki retensi singkat. Total dan waktu terakhir dihitung dari sumber data yang konsisten; jika ada agregat, gunakan update atomik dan rekonsiliasi. Usulan retensi event mentah 90 hari dan agregat selama kepemilikan berlangsung.

## **Target teknis untuk validasi MVP**

| Area | Target usulan | Cara memeriksa |
| :---- | :---- | :---- |
| Resolver | p95 waktu respons server ≤ 1 detik. | Uji 20 request per detik selama 5 menit; latency Google dikecualikan. |
| Batch | 500 QR tercatat ≤ 30 detik; paket siap ≤ 2 menit. | Uji batas batch dan retry tanpa token atau unit duplikat. |
| Ketahanan | Gangguan statistik tidak menghambat redirect. | Simulasikan pencatatan gagal; redirect tetap berhasil dan error tercatat. |
| Mobile | Form nyaman pada lebar 360 px. | Uji Android Chrome dan iPhone Safari; keyboard PIN dan pesan validasi. |
| Pemulihan | Backup harian; usulan RPO 24 jam dan RTO 4 jam. | Pilih dukungan backup sesuai paket dan lakukan restore drill. |

Target ini bukan hasil pengujian atau SLA yang dijanjikan kepada pembeli. Hosting harus mendukung redirect, job ekspor, shared rate limit, monitoring dan backup. Siapkan alert error server serta daftar QR yang perlu dibantu.

## **Ukuran keberhasilan pilot**

Pilot usulan: produksi 100 unit dan uji penjualan awal di 10 toko. Catat berapa unit lolos QC, terjual, berhasil diaktifkan, dan memiliki kunjungan. Tetapkan harga dan margin dari biaya nyata akrilik, cetak, pengiriman, waktu setup, serta operasional domain/hosting.

* 100 dari 100 token dalam batch unik dan QR yang lolos QC dapat dibaca.  
* Sekurangnya 9 dari 10 setup selesai dalam 5 menit setelah link tersedia.  
* Semua toko pilot dapat mengganti tujuan tanpa mencetak ulang QR.  
* Catat kendala aktivasi dan pertanyaan pembeli untuk menentukan perbaikan; belum ada target kenaikan ulasan.

# **10 Acceptance criteria dan rencana rilis**

| ID | Skenario | Kriteria lulus |
| :---- | :---- | :---- |
| AC01 | Generate dan retry batch | N unit unik tersimpan; retry request yang sama tidak menciptakan batch kedua. |
| AC02 | Ekspor dan stok | QR decode ke token sesuai manifest; kode rahasia tidak ada pada QR publik. |
| AC03 | Aktivasi salah atau belum terjual | Ditolak; status dan konfigurasi tidak berubah. |
| AC04 | Aktivasi valid bersamaan | Hanya satu aktivasi sukses; kode dikonsumsi sekali; data pemenang utuh. |
| AC05 | Scan aktif dan edit URL | 302 ke tujuan terbaru; perubahan berlaku pada scan berikutnya tanpa cache stale. |
| AC06 | PIN dan isolasi akses | PIN salah dibatasi; sesi QR A tidak dapat mengubah QR B. |
| AC07 | Status dan layanan gagal | Suspend/retire tidak redirect; DB gagal memberi error retry, tidak membuka aktivasi. |
| AC08 | Reset dan transfer | Pemilik diverifikasi, sesi lama dicabut, audit ada; periode statistik dipisahkan. |
| AC09 | Gangguan statistik | Google tetap terbuka ketika recording gagal; total tidak dianggap jumlah review. |
| AC10 | Data sensitif | Akses browser langsung ditolak; secret tidak ada di bundle atau log. |

## **Urutan implementasi**

Tahap 1 menyelesaikan API contract, schema, state transitions dan aturan akses. Tahap 2 membangun admin, batch, ekspor dan pencatatan penjualan. Tahap 3 membangun aktivasi, resolver, halaman kelola serta rate limit. Tahap 4 menyelesaikan audit, statistik, pemulihan, uji cetak dan pilot toko. Estimasi waktu ditetapkan setelah API contract dan pembagian pekerjaan tersedia.

## **Keputusan yang masih perlu ditetapkan**

Nama produk dan domain; ukuran/desain akrilik; harga dan durasi dukungan; admin yang membantu penjualan di lapangan; bukti kepemilikan yang diterima dukungan; aturan link Google yang didukung; paket hosting/Supabase dan strategi backup. Aturan SOLD sebelum aktivasi, ekspor rahasia 24 jam, serta batas sesi/rate limit adalah default draft yang dapat disesuaikan.

## **Referensi resmi**

Google Business Profile — Create a Google link or QR code to request reviews: https\://support.google.com/business/answer/16816815

Supabase — Securing your data: https\://supabase.com/docs/guides/database/secure-data

Supabase — Row Level Security: https\://supabase.com/docs/guides/database/postgres/row-level-security

Referensi diperiksa 2 Oktober 2026\. Pilihan produk dan target dalam PRD merupakan usulan untuk aplikasi ini.

[image1]: <data:image/png;base64,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>