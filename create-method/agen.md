# 🧪 TikTok Quality Bypass Research & Experimentation Log
**File**: `create-method/agen.md`  
**Author**: Antigravity x Cutefish  
**Tanggal**: 29 September 2026 (Updated: Oktober 2026)  
**Status**: 🏆 **SOLVED & STANDARDIZED — PRODUCTION READY (`FishV2` & `StreamShield`)**

---

## 🎯 1. Objektif & Latar Belakang

Banyak pengguna dan kreator video TikTok di web OpenFishTools (`cutefish.my.id`) mengalami masalah kompresi agresif oleh ByteDance (video 1080p 60fps dengan bitrate tinggi otomatis ditranscode paksa ke **576x1024 SD @ 30 FPS, ~2.7 Mbps**).

Metode kompresi sebelumnya menggunakan FFmpeg re-encode (`-crf 18 -maxrate 9500k`) memakan waktu lama, berat di browser, dan tetap menghasilkan penurunan kualitas visual (lossy).

### **Syarat & Batasan Mutlak Pengujian (Non-Negotiable Constraints):**
1. **0% Kompresi Lossless**: Tidak boleh melakukan re-encoding/render ulang kualitas video dengan FFmpeg (tanpa menurunkan CRF atau bitrate).
2. **Universal Playback**: Video hasil patch harus dapat diputar normal di semua media player (QuickTime, VLC, browser HTML5, TikTok in-app player).
3. **Automated Verification Pipeline**:
   - Video di-encode dengan metode kandidat.
   - Di-upload otomatis ke akun TikTok via Zernio API (akun dan profile terdeteksi otomatis via `.env`).
   - Ditinjau langsung dari stream live CDN TikTok (`v16m.tiktokcdn-us.com` / `v16m.tiktokcdn.com`) menggunakan scraper resolusi & framerate (`/api/tiktok-resolve` & `/api/tiktok-fps`) dan `ffprobe`.
   - Video uji coba dapat segera dihapus setelah pengujian.

---

## 🤖 2. Pedoman untuk AI Assistant (AI Invariants & Consistency Directives)

Jika Anda adalah agen AI yang diminta untuk **menganalisis, memodifikasi, atau membuat metode patcher baru**, patuhi panduan dan konvensi mutlak berikut:

### A. Aturan Desain Metode Baru (Engineering Rules)
1. **Container-Level Manipulation Only**: Modifikasi HANYA boleh dilakukan pada box/atom kontainer ISOBMFF (`ftyp`, `moov`, `mvhd`, `trak`, `tkhd`, `stbl`, `mdat`), **BUKAN** re-encoding stream video H.264/HEVC.
2. **Minimal Overhead Budget**: Total pertambahan ukuran file dari modifikasi atom harus sekecil mungkin (ideal: `< 500 byte`). Jangan membuat ribuan sample dummy audio/video yang menyebabkan memory bloat.
3. **Penyelarasan Clock & Durasi**:
   - `mvhd` harus di-upgrade ke Version 1 (64-bit) dengan durasi tak terhingga `0xFFFFFFFFFFFFFFFF`.
   - Timescale harus diselaraskan secara akurat (misal `48000` disesuaikan dengan audio clock).
4. **Faststart Requirement**: Seluruh file MP4 harus berada dalam mode `faststart` (atom `moov` diletakkan sebelum atom `mdat`).
5. **Arsip Metode (`result/` vs `result/Patched/`)**:
   - Semua metode yang **WORK** disimpan di dalam folder `create-method/result/<methodName>.js`.
   - Jika sebuah metode sudah ke-patch oleh server ByteDance (gagal mempertahankan kualitas di CDN), pindahkan file metode tersebut ke dalam folder `create-method/result/Patched/<methodName>.js`.

### B. Konvensi Penulisan Kode (Modularity Standards)
1. **File Script Mandiri**: Buat file baru di dalam `create-method/result/<methodName>.js` (atau pindahkan ke `create-method/result/Patched/<methodName>.js` apabila sudah ke-patch).
2. **Standard Exports**:
   ```javascript
   function patchMyMethod(inputMp4Path, outputMp4Path) { ... }
   function patchMyMethodBuffer(inputBuffer) { ... } // Rekomendasi: fungsi in-memory buffer
   module.exports = { patchMyMethod, patchMyMethodBuffer };
   ```
3. **Registrasi ke `tools/encode.js`**:
   Tambahkan blok switch case di `tools/encode.js`:
   ```javascript
   if (method === 'my-method') {
       const { patchMyMethod } = require(resolveMethodModule('myMethod.js'));
       patchMyMethod(inputFile, outputFile);
       return getFfprobeMeta(outputFile);
   }
   ```
4. **Credential & Config**:
   Selalu gunakan modul bersama `tools/config.js` (`const config = require('./config');`).
   HANYA butuh satu variabel `ZERNIO_API_KEY` di dalam `.env`. Semua data akun (profile ID, account ID, username) di-resolve otomatis via `config.resolveTikTokAccount()`.

---

## 🏗️ 3. Arsitektur Folder & Pipeline Pengujian (`create-method/`)

```text
create-method/
├── .env                        # Kredensial ZERNIO_API_KEY (rahasia)
├── .env.example                # Template kredensial
├── README.md                   # Dokumentasi penggunaan
├── agen.md                     # Pedoman AI & log riset teknis
├── run.js                      # Master CLI Orchestrator
├── input/                      # Folder khusus video uji coba (input.mp4)
├── output/                     # Folder khusus hasil video ter-patch (output_<method>.mp4)
├── tools/                      # Modul utilitas pipeline
│   ├── config.js               # Auto-loader .env & Zernio account resolver
│   ├── encode.js               # Engine wrapper & resolver method
│   ├── upload.js               # Cloud storage & TikTok publisher via Zernio API
│   └── analyze.js              # Live CDN stream inspector (/api/tiktok-resolve & /api/tiktok-fps)
└── result/                     # Folder kumpulan method
    ├── fishV3.js               # ACTIVE WORKING METHOD (FishV3)
    └── Patched/                # Arsip method yang sudah ke-patch oleh ByteDance
        ├── fishV2.js           # Legacy FishV2 (Patched)
        └── streamshield.js     # Legacy StreamShield / FishV1 (Patched)
```

---

## 📊 4. Hasil Lengkap Pengujian Metode (Empirical Benchmark)

Berikut data empiris dari hasil pengujian nyata terhadap pipeline server ByteDance:

| No | Metode | Tipe Engine | Resolusi CDN | FPS CDN | Bitrate CDN | Ukuran File | Verdict |
| :---: | :--- | :--- | :--- :---: | :---: | :---: | :---: | :---: |
| 1 | **`remux`** | Plain MP4 Faststart Stream Copy | 576 x 1024 | 30 FPS | 2.76 Mbps | 5.92 MB | ❌ **GAGAL** (Dikompresi ke SD) |
| 2 | **`quicktime`** | Apple QuickTime (`.mov`) Faststart | 576 x 1024 | 30 FPS | 2.76 Mbps | 5.92 MB | ❌ **GAGAL** (Dikompresi ke SD) |
| 3 | **`binary`** | Old Binary Patcher (Dual Audio x9 Fake Samples) | 1080 x 1920 | 60 FPS | 23.97 Mbps | 51.44 MB | 🏆 **SUKSES** (Tapi bloat sample audio) |
| 4 | **`vbr-target`** | VBR Spoof (32-bit `mvhd` Duration to 1.8M) | 576 x 1024 | 30 FPS | 2.76 Mbps | 5.92 MB | ❌ **GAGAL** (Durasi finite tetap ditranscode) |
| 5 | **`stream-shield`** | **Cutefish StreamShield (`streamshield.js.patched`)** | 1080 x 1920 | 60 FPS | 23.93 Mbps | 51.34 MB | ❌ **PATCHED** (FISH v1: 3-Track Micro-Shield) |
| 6 | **`fish-v2`** | **Cutefish FishV2 (`fishV2.js.patched`)** | 1080 x 1920 | 60.05 FPS | 23.93 Mbps | 51.34 MB | ❌ **PATCHED** (FISH v2: Murni 2-Track, In-Track Zero-Delta) |
| 7 | **`fish-v3`** | **NEW: Cutefish FishV3 (`fishV3.js`)** | **1080 x 1920** | **60.055 FPS** | **17.69 Mbps** | **37.97 MB** | 🏆🏆 **ULTIMATE WINNER** (FISH v3: Rescaled 48k Clock + Zero-Offset CTTS + Track 3 Trap) |

---

## 🔬 5. Bedah Teknis: Mengapa Direct Pass-Through Berhasil?

### A. Mekanisme Kerja Transcoder ByteDance / TikTok
Ketika sebuah video MP4 di-upload ke server ByteDance:
1. Worker transcode ByteDance membaca metadata kontainer `mvhd` (Movie Header Box).
2. Jika `mvhd` memiliki durasi finite standar (misal 18 detik) dan bitrate di atas threshold (~10-15 Mbps), ByteDance menginstruksikan worker transcode untuk merender ladder 576p SD.
3. Namun, sistem ByteDance memiliki **Fail-Safe Fallback Rule**:
   > *"Jika worker transcode mendeteksi durasi live/infinite tak berhingga atau filtergraph transcode gagal memproses sinkronisasi relasi waktu/stream tanpa memicu error korupsi fatal, server ByteDance TIDAK membatalkan postingan creator, melainkan langsung melakukan **Direct Pass-Through** (menyajikan file sumber asli ke CDN).*"

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

Contoh hasil stream metadata langsung dari CDN ByteDance saat pengujian metode:
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

## 🔬 7. Komparasi Riset Teknis Atom: Infinite MVHD vs Ghost Index Bloat

Dari hasil riset lanjutan terhadap variasi manipulasi container MP4 industri:

### A. Varian 1: Infinite MVHD Standalone
- **Struktur**: Meng-upgrade header kontainer (`mvhd`) ke Version 1 (64-bit) dengan durasi `0xFFFFFFFFFFFFFFFF` dan timescale `48000`.
- **Media Track**: Track video dan audio dibiarkan 100% utuh tanpa modifikasi sample.
- **Karakteristik**: Overhead minimal (< 200 byte), eksekusi instan.

### B. Varian 2: Ghost Sample Index Bloat
- **Struktur**: Mengombinasikan Infinite `mvhd` dengan payload data *ghost* 256-byte di akhir atom `mdat`.
- **Index Tables**: Mengisi tabel `stsz` (Sample Sizes) dan `stco` (Chunk Offsets) track video dengan ~13.000 entri dummy (`delta = 0`) yang semuanya mengarah ke offset payload ghost 256-byte.
- **Karakteristik**: Menghasilkan overhead `moov` yang besar (+105 KB bloat) untuk memicu fail-safe parser worker.

### C. Keunggulan Arsitektur Cutefish (`StreamShield` & `FishV2`)
- **Zero Bloat (+16 hingga +24 Byte Saja)**: Dibandingkan metode yang membengkakkan tabel index hingga ribuan entri, pendekatan Cutefish hanya mereferensikan 1 sample dummy/anchor 8-byte.
- **100% Mandiri & Client-Side**: Berjalan murni di browser tanpa ketergantungan API server pihak ketiga mana pun.
- **Identitas & Branding**: Seluruh implementasi dan inovasi terikat secara mutlak pada **cutefish.my.id / OpenFishTools** (UI: **FISH**).

---

## 🏆 8. Inovasi Baru: Cutefish FishV2 (Dual-Anchor Time-Trap)

Metode paling mutakhir yang terbukti **100% Work Pass-Through**:

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

---

## 🛠️ 9. Panduan Replikasi & Perintah Eksekusi CLI

Jalankan perintah berikut di terminal folder `create-method/`:

```bash
# 1. Jalankan benchmark end-to-end (Encode -> Upload -> CDN Analysis)
node run.js --method fish-v2

# 2. Uji coba metode StreamShield
node run.js --method stream-shield

# 3. Hanya encode file tanpa mengunggah ke TikTok
node run.js --method fish-v2 --skip-upload

# 4. Hanya menganalisa URL postingan TikTok publik
node run.js --analyze-only "https://www.tiktok.com/@<account>/video/<video_id>"
```
