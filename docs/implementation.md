# Pemetaan PRD dan kontrak

Scope saat ini mencakup backend Next.js, database PostgreSQL untuk Supabase dan UI shadcn/ui + Tailwind. [Pemetaan UI dan pengujiannya](ui-implementation.md) melengkapi bukti backend di bawah. Uji cetak fisik, setup toko pilot dan restore pada paket hosting produksi tetap dilakukan pada environment tersebut.

| Requirement          | Implementasi                                                                 | Bukti                                                                               |
| -------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| FR01 Admin/batch     | Auth server Supabase + allowlist, batch atomik 1–500                         | Tes admin, 100 token unik, batch 500, replay dan rollback                           |
| FR02 Ekspor produksi | Worker PostgreSQL, ZIP publik manifest/PNG/SVG dan ZIP kode terpisah         | Decode PNG ke origin/token, periksa isi ZIP, invalidasi dan TTL                     |
| FR03 Stok/penjualan  | State terpisah, QC, sale unik per unit, `sold_at` tidak di masa depan        | Transaksi sale/replay, If-Match, DAMAGED → RETIRED terminal                         |
| FR04 Aktivasi        | SOLD + UNACTIVATED + hash kode; PIN scrypt+salt+pepper; kode dikonsumsi      | Aktivasi salah ditolak dan dua aktivasi hanya satu menang                           |
| FR05 Scan publik     | GET/HEAD status HTML atau 302, no-store, DB error 503                        | Status unknown/unactivated/suspend/retire, perubahan URL dan gangguan pencatatan    |
| FR06 Pemilik         | Cookie satu QR/ownership/generation, CSRF, edit, PIN change, logout          | Isolasi QR, expiry 30 menit, readonly saat suspend, pencabutan sesi                 |
| FR07 Statistik       | Event dan agregat ditulis atomik; periode hasil resolve digunakan            | HEAD/bot/traffic uji dikecualikan, transfer mulai nol, old-period event tetap benar |
| FR08 Dukungan        | Grant sekali pakai 15 menit, rotasi kode, reset/transfer/status dengan audit | Replay/tombstone, expired/revoked/wrong-kind grant, sesi lama dicabut               |

| AC   | Bukti teknis backend                                                                                                                     |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| AC01 | Batch 100/500, token unik, retry identik tidak membuat batch baru, in-progress diberi Retry-After                                        |
| AC02 | Decoder membaca PNG dari ZIP, manifest sesuai URL/token, secret ZIP terpisah dan ciphertext at rest                                      |
| AC03 | Kode salah/belum SOLD ditolak, hash dan konfigurasi tetap utuh                                                                           |
| AC04 | Aktivasi bersamaan menghasilkan satu commit, satu ownership, data pemenang dan replay utuh                                               |
| AC05 | 302 no-store ke URL terbaru setelah edit tanpa perubahan token                                                                           |
| AC06 | Lima kegagalan persisten + cooldown lintas instance, cookie/CSRF terisolasi satu QR                                                      |
| AC07 | Suspend/retire tidak redirect, gangguan DB memberi 503 tanpa membuka aktivasi                                                            |
| AC08 | Grant perlu verification reference, klaim mencabut sesi, audit tercatat dan statistik periode baru nol                                   |
| AC09 | Gagal/timeout pencatatan tidak menggagalkan 302; metric QR_VISITS menyatakan bukan review terkirim                                       |
| AC10 | Schema privat, grants ditutup dan RLS tanpa policy browser; tes role ditolak/zero rows; scan bundle runtime tidak menemukan kunci server |

Sumber implementasi utama: `src/server/application.ts` (pipeline HTTP), `domain.ts` (mutasi transaksi), `idempotency.ts`, `auth.ts`, `rate-limit.ts`, `exports.ts`, `statistics.ts`, dan `supabase/migrations/202610020001_initial.sql`. Semua 31 operasi API dibandingkan dengan OpenAPI dalam tes. Response JSON integrasi divalidasi menggunakan schema dari kontrak asli, termasuk error dan pagination.

Timestamp untuk resource yang dipaginasi memakai `timestamptz(3)`, sehingga cursor Date JavaScript tidak kehilangan presisi mikrodetik. Urutan `(created_at DESC,id DESC)` dan filter HMAC terikat cursor. Token bersifat case-sensitive, random 128 bit, dan immutable. Kode aktivasi berisi random independen 80 bit. Session/grant random 256 bit hanya disimpan sebagai HMAC; PIN menggunakan scrypt N=32768,r=8,p=3 dengan salt per PIN dan pepper terpisah.

Setiap mutasi domain memperbarui version dan audit dalam transaksi yang sama. Penerbitan grant juga menaikkan version. Sesi login, ekspor, dan analytics tidak menaikkan version. Suspend/resume/retire/PIN/claim meningkatkan generation sesuai pencabutan akses. Resume mencabut akses readonly dan grant tertunda agar tidak menghidupkan credential lama.

Statistik memakai pool runtime terpisah dan budget waktu 150 ms agar kegagalan pencatatan tidak menahan resolver. Hanya kunjungan yang berhasil ditulis durable masuk agregat; kegagalan dapat menyebabkan undercount. Query publik `test=true` tidak mengecualikan hitungan; hanya header trafik uji dengan secret deployment yang valid dapat melakukannya.

Ekspor kode ditolak setelah snapshot 24 jam, aktivasi, retire/DAMAGED, atau rotasi kode pada salah satu unit batch. Pengecekan dilakukan saat antre, saat membuat arsip, saat polling, dan saat download. Worker finalisasi mengunci batch sebelum job; invalidasi snapshot dan perubahan status tidak mengirimkan arsip kedaluwarsa sebagai READY.
