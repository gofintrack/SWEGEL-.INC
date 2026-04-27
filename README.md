# Landing Page + MongoDB + Master Key Panel

## Fitur
- Landing page background hitam.
- Tombol `Buy Now` red glow + efek klik + redirect ke `https://t.me/SweGeL_Corps`.
- Efek `network particle` dan tetesan darah.
- Navbar dropdown:
  - `Tools > Sender > Shortlink > Validator`
  - `Script > Xfinity > Chase > TopperPay`
- Panel kontrol terkoneksi MongoDB.
- Panel kontrol untuk menambahkan product ke dropdown `Tools`/`Script` beserta link redirect.
- Gate `master key` yang digenerate 1x saat startup pertama (tanpa login/register).

## Jalankan Lokal
1. Copy `.env.example` menjadi `.env`.
2. Isi `MONGO_URI` dan `SESSION_SECRET`.
3. Jalankan:
   ```bash
   npm install
   npm start
   ```
4. Buka `http://localhost:3000`.

## Master Key
- Saat startup pertama, server akan print `MASTER KEY` di console.
- Key hanya ditampilkan satu kali (simpan dengan aman).
- Untuk membuka akses panel, masuk ke `/setup-key` lalu input key.

## Deploy ke Render
1. Push project ke GitHub.
2. Di Render, buat `New + > Blueprint` lalu pilih repo ini (karena sudah ada `render.yaml`).
3. Isi environment variable:
   - `MONGO_URI` (disarankan MongoDB Atlas)
   - `SESSION_SECRET` (random string panjang)
4. Deploy.
5. Cek log startup dan simpan `MASTER KEY` pertama yang muncul.

## Catatan Keamanan
- Master key disimpan dalam bentuk hash (`bcrypt`).
- Session disimpan di MongoDB (`connect-mongo`).
- Menggunakan `helmet` dan `rate limit` basic.
- Endpoint panel terlindungi di `/panel` dan wajib unlock lewat `/setup-key`.
