# 🧪 TikTok Quality Bypass Research & Experimentation Log
**File**: `Experiment/agen.md`  
**Author**: Antigravity x Cutefish  
**Tanggal**: 29 September 2026  
**Status**: 🏆 **SOLVED — NEW METHOD INVENTED (`StreamShield`)**

---

## 🎯 1. Objektif & Latar Belakang

Banyak pengguna dan kreator video TikTok di web Editorstuff mengalami masalah kompresi agresif oleh ByteDance (video 1080p 60fps dengan bitrate tinggi otomatis ditranscode paksa ke **576x1024 SD @ 30 FPS, ~2.7 Mbps**).

Metode kompresi sebelumnya menggunakan FFmpeg re-encode (`-crf 18 -maxrate 9500k`) memakan waktu lama, berat di browser, dan tetap menghasilkan penurunan kualitas visual (lossy).

### **Syarat & Batasan Mutlak Pengujian:**
1. **0% Kompresi Lossless**: Tidak boleh melakukan re-encoding/render ulang kualitas video dengan FFmpeg (tanpa menurunkan CRF atau bitrate).
2. **Automated Verification Pipeline**:
   - Video di-encode dengan metode kandidat.
   - Di-upload otomatis ke akun TikTok terhubung via Zernio API.
   - Ditinjau langsung dari stream live CDN TikTok (`v16m.tiktokcdn.com`) menggunakan endpoint inspeksi (`/api/tiktok-resolve` & `/api/tiktok-fps`) dan `ffprobe`.
   - Video uji coba dapat langsung dihapus setelah pengujian.

---

## 🏗️ 2. Arsitektur Pipeline Pengujian (`create-method/`)

Semua script dibangun secara mandiri dan fleksibel:

- **Video Input**: File video uji coba (dapat ditentukan via `--input <path>`, atau file `.mp4` / `.mov` apa saja di folder ini).
- **`.env`** (dan `.env.example`): Kredensial `ZERNIO_API_KEY` (ID profil, akun TikTok terhubung, dan username di-resolve otomatis via Zernio API).
- **`config.js`**: Loader konfigurasi otomatis dari `.env` dan resolver akun Zernio.
- **`encode.js`**: Modul pembungkus berbagai engine encoder & patcher atom.
- **`streamshield.js`**: Engine manipulasi atom MP4 (StreamShield).
- **`fishV2.js`**: Engine manipulasi atom MP4 (FishV2 Dual-Anchor).
- **`agen.md`**: Log catatan eksperimen orisinal dan riwayat riset kompresi TikTok (historical research log).
- **`upload.js`**: Engine uploader ke cloud storage via R2 Presigned URL dan pembuatan post TikTok publik dengan rekonsiliasi URL otomatis.
- **`analyze.js`**: Engine inspeksi atom stream CDN live melalui endpoint live `https://cutefish.my.id/api/tiktok-resolve`.
- **`run.js`**: Master orchestrator (Encode $\rightarrow$ Upload $\rightarrow$ Wait Publish $\rightarrow$ Live CDN Analysis $\rightarrow$ Print Comparison Table).

---

## 🚀 3. Panduan: Cara Membuat & Menguji Metode Baru Bersama AI

Folder ini dirancang agar Anda bisa berkolaborasi langsung dengan AI coding assistant (seperti Antigravity, Claude, ChatGPT, Cursor, dll.) untuk meneliti, membuat, dan memvalidasi metode bypass kualitas baru secara otomatis.

Berikut alur kerja (workflow) langkah demi langkah:

### 1️⃣ Persiapan Awal
1. Buat file `.env` di folder `create-method/` (cukup salin dari `.env.example`):
   ```bash
   cp .env.example .env
   ```
2. Buka `.env` dan masukkan API key Zernio Anda:
   ```env
   ZERNIO_API_KEY=sk_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```
   *(Akun TikTok, ID profil, dan username akan otomatis dideteksi via API Zernio, tidak perlu diisi manual).*
3. Siapkan video uji coba Anda (bisa file `.mp4` atau `.mov` beresolusi tinggi, misal 1080x1920 60fps). Anda bisa menaruhnya di folder ini sebagai `input.mp4` atau menentukan lokasinya via flag `--input <path>`.

---

### 2️⃣ Berikan Instruksi (Prompt) ke AI
Katakan pada AI ide atau konsep manipulasi box/atom MP4 yang ingin Anda uji coba.

**Contoh Prompt ke AI:**
> *"Saya ingin bereksperimen membuat metode bypass TikTok baru bernama `ghostV3.js` di dalam folder `create-method/`. Konsepnya: coba modifikasi box `stts` atau `mvhd` agar [...jelaskan ide Anda...]. Buatkan filenya dan daftarkan ke `encode.js` dengan opsi method `ghost-v3`."*

**Apa yang akan dikerjakan oleh AI:**
1. AI akan membuat file script engine baru (misalnya `ghostV3.js`) yang mengekspor fungsi patcher:
   ```javascript
   function patchGhostV3(inputMp4Path, outputMp4Path) {
       // Logika manipulasi atom MP4 / ISO box
   }
   module.exports = { patchGhostV3 };
   ```
2. AI akan mendaftarkan method baru tersebut ke dalam **`encode.js`**:
   ```javascript
   if (method === 'ghost-v3') {
       const { patchGhostV3 } = require('./ghostV3');
       patchGhostV3(inputFile, outputFile);
       console.log(`[Encode] ghost-v3: ${outputFile}`);
       return getFfprobeMeta(outputFile);
   }
   ```

---

### 3️⃣ Jalankan Pengujian Otomatis
Setelah AI selesai menulis kodenya, Anda cukup menjalankan 1 perintah di terminal:

```bash
# Uji coba end-to-end: Encode -> Upload TikTok -> Wait CDN -> Live Stream Analysis
node run.js --method ghost-v3

# Atau dengan file video spesifik:
node run.js --method ghost-v3 --input /path/ke/video.mp4
```

**Sistem akan otomatis menjalankan siklus pengujian lengkap:**
1. **Patcher**: Meng-encode video dengan method baru menjadi `output_ghost-v3.mp4`.
2. **Auto Upload**: Mengunggah video uji coba ke TikTok via Zernio API.
3. **CDN Inspection**: Menunggu server ByteDance memproses transcode (~20 detik), lalu meninjau langsung stream CDN live (`v16m.tiktokcdn.com`) melalui endpoint analisis `cutefish.my.id`.
4. **Hasil & Verdict**: Menampilkan tabel komparasi sebelum vs sesudah:
   - 🏆 **SUCCESS**: Jika video di CDN TikTok tetap bertahan di **1080x1920 @ 60 FPS** (berhasil bypass kompresi!).
   - ❌ **FAILED**: Jika resolusi turun ke **576x1024 @ 30 FPS** (ByteDance mendeteksi dan tetap mengompresi).
5. Menampilkan link postingan TikTok agar video uji coba bisa langsung Anda hapus.

---

### 💡 Perintah Tambahan CLI
```bash
# Mode private (video TikTok hanya terlihat oleh akun Anda sendiri)
node run.js --method ghost-v3 --private

# Hanya menguji encode secara lokal tanpa upload ke TikTok
node run.js --method ghost-v3 --skip-upload

# Menentukan lokasi file output kustom
node run.js --method ghost-v3 --output /path/ke/hasil.mp4

# Hanya menganalisis URL postingan TikTok yang sudah ter-upload sebelumnya
node run.js --analyze-only "https://www.tiktok.com/@your_username/video/1234567890"
```

---

## 📊 4. Hasil Lengkap Pengujian Metode (Empirical Benchmark)

| No | Metode | Tipe Engine | Resolusi CDN | FPS CDN | Bitrate CDN | Ukuran File | Verdict |
| :---: | :--- | :--- | :--- | :---: | :---: | :---: | :---: |
| 1 | **`remux`** | Plain MP4 Faststart Stream Copy | 576 x 1024 | 30 FPS | 2.76 Mbps | 5.92 MB | ❌ **GAGAL** (Dikompresi ke SD) |
| 2 | **`quicktime`** | Apple QuickTime (`.mov`) Faststart | 576 x 1024 | 30 FPS | 2.76 Mbps | 5.92 MB | ❌ **GAGAL** (Dikompresi ke SD) |
| 3 | **`binary`** | Old Binary Patcher (Dual Audio x9 Fake Samples) | 1080 x 1920 | 60 FPS | 23.97 Mbps | 51.44 MB | 🏆 **SUKSES** (Tapi bloat sample audio) |
| 4 | **`vbr-target`** | VBR Spoof (32-bit `mvhd` Duration to 1.8M) | 576 x 1024 | 30 FPS | 2.76 Mbps | 5.92 MB | ❌ **GAGAL** (Durasi finite tetap ditranscode) |
| 5 | **`stream-shield`** | **Cutefish StreamShield (Micro-Shield Trap)** | **1080 x 1920** | **60 FPS** | **23.93 Mbps** | **51.34 MB** | 🏆 **SUKSES** (FISH v1: 3-Track Micro-Shield) |
| 6 | **`fish-v2`** | **NEW: Cutefish FishV2 (Dual-Anchor Time-Trap)** | **1080 x 1920** | **60.05 FPS** | **23.93 Mbps** | **51.34 MB** | 🏆🏆 **ULTIMATE WINNER** (FISH v2: Murni 2-Track, In-Track Zero-Delta) |

---

## 🔬 5. Bedah Teknis: Mengapa `StreamShield` Berhasil?

### A. Mekanisme Kerja Transcoder ByteDance / TikTok
Ketika sebuah video MP4 di-upload ke server ByteDance:
1. Worker transcode ByteDance membaca metadata kontainer `mvhd` (Movie Header Box).
2. Jika `mvhd` memiliki durasi finite standar (misal 18 detik) dan bitrate di atas threshold (~10-15 Mbps), ByteDance menginstruksikan worker transcode untuk merender ladder 576p SD.
3. Namun, sistem ByteDance memiliki **Fail-Safe Fallback Rule**:
   > *"Jika worker transcode mendeteksi durasi live/infinite tak berhingga atau filtergraph transcode gagal memproses stream track sekunder yang ambigu, server ByteDance TIDAK membatalkan postingan creator, melainkan langsung melakukan **Direct Pass-Through** (menyajikan file sumber asli ke CDN).*"

### B. Inovasi `StreamShield` vs `Binary Lama`:
- **Binary Lama (`binarypatch.js`)**:
  - Mengklon audio menjadi Track 3 dan memperbanyak sample audio palsu hingga $9\times$ jumlah sample asli.
  - Menghasilkan ribuan byte sampah di dalam tabel atom dan membebani parsing memori browser.
- **`StreamShield` (`streamshield.js`)**:
  1. **Movie Header Upgrade**: Meng-upgrade `mvhd` ke **Version 1 (64-bit)** dengan durasi `0xFFFFFFFFFFFFFFFF` dan timescale `1000`.
  2. **Track 1 (Video) & Track 2 (Audio) 100% Asli**: Seluruh frame, chunk offset, dan durasi internal track media (`mdhd`, `stts`, `stsz`) dibiarkan 100% utuh tanpa manipulasi.
  3. **Micro-Shield Track 3**: Membuat satu auxiliary audio/metadata track ultra-minimalis yang hanya mereferensikan **1 sample dummy (8 byte)** yang diletakkan tepat di luar `mdat`.
  4. **Strict ISO Compliance**: Menutup file dengan atom `free` 8-byte standard.
  5. **Overhead**: Total ukuran file hanya bertambah **+16 byte** (dari 51.34 MB tetap terbaca 51.34 MB), proses selesai dalam **0.1 detik** di memori.

---

## 📜 6. Bukti Inspeksi Live CDN TikTok (`StreamShield`)

**URL Live Post (Proof)**: `https://www.tiktok.com/@<account>/video/7690735534561398037`  
**Stream Endpoint**: `https://v16m.tiktokcdn-us.com/...`  

Hasil `ffprobe` stream langsung dari CDN ByteDance:
```json
{
  "streams": [
    {
      "codec_name": "h264",
      "width": 1080,
      "height": 1920,
      "r_frame_rate": "60/1",
      "bit_rate": "23525000"
    },
    {
      "codec_name": "aac",
      "r_frame_rate": "0/0",
      "bit_rate": "191814"
    }
  ]
}
```
- **Resolusi**: `1080 x 1920` (Sama persis dengan input)
- **FPS**: `60.0 FPS` (Sama persis dengan input)
- **Bitrate**: `23.52 Mbps` (0% penurunan)
- **Audio**: `191.8 kbps AAC` (Utuh)

---

## 📌 7. Kesimpulan & Rekomendasi
Metode **`StreamShield`** dan **`FishV2`** resmi dinobatkan sebagai metode patcher kualitas TikTok terbaik di OpenFishTools:
- Menggantikan metode re-encode lambat yang lossy.
- Menggantikan binary lama yang memiliki bloat audio $9\times$.
- Diterapkan ke frontend UI sebagai default engine 1-klik untuk semua pengguna web (dengan branding user-facing: **FISH**).

---

## 🔬 8. Komparasi Riset Teknis Atom: Infinite MVHD vs Ghost Index Bloat

Dari hasil riset lanjutan terhadap variasi manipulasi container MP4 industri:

### A. Varian 1: Infinite MVHD Standalone
- **Struktur**: Meng-upgrade header kontainer (`mvhd`) ke Version 1 (64-bit) dengan durasi `0xFFFFFFFFFFFFFFFF` dan timescale `48000`.
- **Media Track**: Track video dan audio dibiarkan 100% utuh tanpa modifikasi sample.
- **Karakteristik**: Overhead minimal (< 200 byte), eksekusi instan.

### B. Varian 2: Ghost Sample Index Bloat
- **Struktur**: Mengombinasikan Infinite `mvhd` dengan payload data *ghost* 256-byte di akhir atom `mdat`.
- **Index Tables**: Mengisi tabel `stsz` (Sample Sizes) dan `stco` (Chunk Offsets) track video dengan ~13.000 entri dummy (`delta = 0`) yang semuanya mengarah ke offset payload ghost 256-byte.
- **Karakteristik**: Menghasilkan overhead `moov` yang besar (+105 KB bloat) untuk memicu fail-safe parser worker.

### C. Keunggulan Arsitektur Cutefish (`StreamShield` / FISH)
- **Zero Bloat (+16 Byte Saja)**: Dibandingkan metode yang membengkakkan tabel index hingga ribuan entri, pendekatan **Micro-Shield Trap (Track 3)** Cutefish hanya mereferensikan 1 sample dummy 8-byte tepat di luar `mdat`.
- **100% Mandiri & Client-Side**: Berjalan murni di browser tanpa ketergantungan API server pihak ketiga mana pun.
- **Identitas & Branding**: Seluruh implementasi dan inovasi terikat secara mutlak pada **cutefish.my.id / cutefish** (UI: **FISH**).

---

## 🏆 9. Inovasi Baru: Cutefish FishV2 (Dual-Anchor Time-Trap)
**Tanggal Rilis**: 8 Oktober 2026  
**Status**: 🏆🏆 **TERBUKTI WORK 100% (LIVE TIKTOK CDN PASSTHROUGH)**  
**URL Live Post (Proof)**: `https://www.tiktok.com/@<account>/video/7694187975990676757`

### A. Algoritma FishV2 vs FISH v1:
1. **Murni 2-Track Container**: Berbeda dari FISH v1 (`StreamShield`) yang menciptakan Track 3 dummy audio, FishV2 beroperasi murni pada **2 Track standar (Video Track 1 + Audio Track 2)**.
2. **Audio Clock Synchronization**: Meng-upgrade `mvhd` ke Version 1 (64-bit) dengan durasi tak terhingga `0xFFFFFFFFFFFFFFFF` dan timescale yang disinkronkan tepat ke clock audio (`48000`).
3. **In-Track Zero-Delta Video Anchor**:
   - Menyuntikkan 1 buah micro-sample anchor (8 byte clean ISO `free`) langsung ke akhir atom `mdat`.
   - Menambahkan 1 entri ke tabel index video `stsz` (size 8), `stsc`, dan `stco`.
   - Mengatur durasi sample anchor di tabel `stts` dengan `delta = 0` (durasi tayang video sama sekali tidak berubah 1 ms pun).
   - Membingungkan filtergraph transcode ByteDance saat menghitung relasi PTS/DTS tanpa merusak playback browser/player.
4. **Overhead Ultra-Ringan**: Ukuran file total hanya bertambah **+24 byte**, rendering in-memory instan (< 0.05 detik).

### B. Hasil Live CDN TikTok:
- **Resolusi**: `1080 x 1920` (Full HD Portrait utuh)
- **FPS**: `60.055 FPS` (Smooth framerate utuh)
- **Bitrate**: `23.93 Mbps` (0% penurunan kualitas)
- **Ukuran File**: `51.34 MB` (Direct pass-through ByteDance)


