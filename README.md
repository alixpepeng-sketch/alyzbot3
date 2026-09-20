# Bot Alyz Web

Bot WhatsApp Node.js (ESM) dengan Baileys, web pairing code, dan deploy ke Render.

## Struktur

```
index.js              entry point (server + bot)
src/config.js         pengaturan (owner, delay, rate limit, batas video)
src/bot.js            koneksi Baileys, reconnect 3 detik, pairing code
src/handler.js        semua perintah + reaksi
src/ffmpeg.js         konversi video (ffmpeg-static)
src/server.js         express: /pair, /status, /health
src/selfmode.js       baca/tulis database/selfmode.json
public/               halaman web (index.html, style.css, script.js)
database/selfmode.json   default self mode ON
```

## Perintah

| Perintah | Fungsi |
| --- | --- |
| `.menu` | Daftar perintah |
| `.kickall` | Keluarkan anggota grup. Khusus admin grup, bot harus admin. Balasan: `kick all berhasil <jumlah>` |
| `.toptv` | Video dengan caption `.toptv` (atau reply video) jadi video note |
| `.fotolive` | Video dengan caption `.fotolive` (atau reply video) jadi foto live |
| `.self` / `.selfmode on` | Hanya owner yang bisa memakai bot (default) |
| `.public` / `.selfmode off` | Semua orang bisa memakai bot |

Semua perintah memakai reaksi 🚀 saat diproses dan ✅ saat selesai (❌ bila gagal).

## Jalankan lokal

```bash
npm install
npm start
```

Buka `http://localhost:3000`, masukkan nomor, lalu masukkan kode di WhatsApp
(Perangkat tertaut > Tautkan dengan nomor telepon).

## Deploy di Render

1. Push repo ke GitHub, lalu buat Web Service baru dari repo tersebut (atau pakai `render.yaml`).
2. Build command `npm install`, start command `npm start`.
3. Environment: `NODE_VERSION=20`, `OWNER_NUMBER=6283176204764`.
4. Sesi WhatsApp tersimpan di folder `session/`. Filesystem Render gratis bersifat sementara,
   jadi sesi hilang saat redeploy/restart dan perlu pairing ulang. Untuk sesi permanen, pakai
   persistent disk (paket berbayar), mount ke `/var/data`, lalu set `SESSION_DIR=/var/data/session`.

## Pengaturan penting (src/config.js)

- `reconnectDelayMs`: 3000, jeda sebelum menyambung ulang saat koneksi tertutup
- `pairCooldownMs`: 10000, rate limit pairing per IP
- `kickAdmins`: `false`, admin lain tidak ikut dikeluarkan oleh `.kickall`
- `maxVideoMb`: 40, batas ukuran video untuk `.toptv` dan `.fotolive`
