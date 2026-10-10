# OpenFishTools Web Tools

Koleksi library tool video processing, konversi animasi, analitik media, dan AI vision berbasis client-side murni untuk web browser modern.

Semua tool di repository ini dibangun dengan arsitektur **Universal / Headless / Schema-Driven**:
- **Zero DOM Lock-in**: Tool tidak memaksa struktur HTML atau DOM ID tertentu. Developer bebas mendesain UI sendiri (Tailwind, Bootstrap, React, Vue, Svelte, dsb).
- **Declarative Input Schema**: Setiap parameter input (file, dropdown, slider, segmented pill, toggle, url) didefinisikan secara deklaratif di `tool.schema.inputs`.
- **Pure Execution Function**: Pemrosesan dijalankan melalui fungsi `async run(inputs, context)` yang menerima nilai raw dan memancarkan callback real-time (`onProgress`, `onLog`, `onPreview`).
- **Standardized Output**: Tool mengembalikan data output terstruktur (`type: 'file'` atau `type: 'data'`).

---

## Daftar Isi
1. [Arsitektur Tool](#arsitektur-tool)
2. [Spesifikasi Schema Input](#spesifikasi-schema-input)
3. [Spesifikasi Context & Callback](#spesifikasi-context--callback)
4. [Format Output](#format-output)
5. [Panduan Integrasi ke Web](#panduan-integrasi-ke-web)
   - [Contoh Integrasi Vanilla JavaScript](#contoh-integrasi-vanilla-javascript)
   - [Contoh Integrasi React](#contoh-integrasi-react)
6. [Katalog Tools](#katalog-tools)
7. [Dependensi dan Resource Runtime](#dependensi-dan-resource-runtime)
8. [Lisensi](#lisensi)

---

## Arsitektur Tool

Setiap file tool mengekspor object konfigurasi yang didaftarkan ke sistem melalui `window.AppTools.register(tool)` atau tersedia langsung di namespace global (misal: `window.VideoCompressorTool`).

Struktur anatomi tool:

```javascript
{
    id: 'tool-video-compressor',
    version: '1.2.0',
    title: 'Video Compressor',
    desc: 'H.264 MP4 WebAssembly Compressor',
    icon: 'compress',
    category: ['Video', 'Tools'],
    features: [ ... ],
    specs: [ ... ],

    // 1. Declarative Schema
    schema: {
        inputs: [
            {
                name: 'videoFile',
                type: 'file',
                label: 'Video File',
                accept: 'video/*',
                required: true
            },
            {
                id: 'preset',
                name: 'preset',
                type: 'select',
                label: 'Preset',
                default: 'medium',
                options: [
                    { label: 'Small', value: 'small' },
                    { label: 'Balanced', value: 'medium' },
                    { label: 'Quality', value: 'high' }
                ]
            }
        ]
    },

    // 2. Pure Headless Runner
    run: async function(inputs, context) {
        // Logika pemrosesan client-side
        // context.onProgress(percent, statusText)
        // context.onLog(logMessage)
        return {
            type: 'file',
            data: blob,
            filename: 'compressed_video.mp4'
        };
    }
}
```

---

## Spesifikasi Schema Input

Input di dalam `tool.schema.inputs` adalah array of object dengan atribut berikut:

| Tipe Input (`type`) | Properti Tambahan | Keterangan |
|---|---|---|
| `file` | `accept`, `required` | Input file / drag-drop. Nilai yang dikirim berupa `File` atau `Blob`. |
| `select` | `options: [{ label, value }]`, `default` | Dropdown selector. |
| `segmented` | `options: [{ label, value }]`, `default` | Segmented pill button selector. |
| `slider` | `min`, `max`, `step`, `unit`, `default` | Range slider untuk nilai numerik. |
| `number` | `min`, `max`, `step`, `default` | Input angka dengan batasan. |
| `toggle` | `default: boolean` | Switch on/off. |
| `url` | `placeholder`, `validate: Function` | Input teks URL dengan validasi format. |
| `textarea` | `placeholder`, `rows`, `default` | Input teks multi-baris. |

---

## Spesifikasi Context & Callback

Ketika memanggil `tool.run(inputs, context)`, parameter `context` menyediakan callback untuk memantau proses:

```javascript
const context = {
    // Dipanggil saat persentase progres berubah (0 - 100)
    onProgress: (percent, statusText) => {
        console.log(`Progress: ${percent}% - ${statusText}`);
    },

    // Dipanggil saat tool menghasilkan baris log teknis (FFmpeg stdout, ONNX steps)
    onLog: (message) => {
        console.log(`[Log] ${message}`);
    },

    // Dipanggil jika tool mengekstrak metadata pratinjau (misal: thumbnail cover TikTok)
    onPreview: (previewData) => {
        // { cover: string, author: string, title: string }
    },

    // AbortSignal opsional untuk membatalkan proses
    signal: abortController.signal
};
```

---

## Format Output

Fungsi `tool.run(inputs, context)` mengembalikan Promise yang me-resolve object bertipe salah satu dari dua format:

### 1. Output Berupa File (`type: 'file'`)
Digunakan oleh compressor, converter, upscaler, background remover, patcher, downloader:
```javascript
{
    type: 'file',
    data: Blob,                // Objek Blob binary hasil render
    filename: 'output.mp4',    // Rekomendasi nama file saat didownload
    mimeType: 'video/mp4'      // MIME type file
}
```

### 2. Output Berupa Data Terstruktur (`type: 'data'`)
Digunakan oleh tool analitik atau metadata scanner (misal: TikTok Statistics):
```javascript
{
    type: 'data',
    data: {
        preview: {
            cover: 'https://...',
            author: 'Creator Name',
            title: 'Video Title'
        },
        items: [
            { label: 'Resolution', value: '1080 x 1920' },
            { label: 'FPS', value: '60 fps' },
            { label: 'Bitrate', value: '4.50 Mbps' },
            { label: 'Views', value: '1,250,000' }
        ]
    }
}
```

---

## Panduan Integrasi ke Web

### Contoh Integrasi Vanilla JavaScript

Berikut adalah implementasi lengkap cara memuat tool dan merender form input secara dinamis tanpa library tambahan:

```html
<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <title>Integrasi OpenFishTools</title>
    <style>
        .form-group { margin-bottom: 12px; }
        .progress-bar { width: 100%; height: 8px; background: #eee; border-radius: 4px; overflow: hidden; }
        .progress-fill { height: 100%; width: 0%; background: #0066cc; transition: width 0.2s; }
        .log-box { background: #111; color: #0f0; padding: 8px; font-family: monospace; font-size: 12px; max-height: 120px; overflow-y: auto; }
    </style>
</head>
<body>
    <h2>Demo Integrasi Tool Universal</h2>

    <div id="dynamic-inputs"></div>

    <button id="btn-process" disabled>Proses</button>

    <div style="margin-top: 16px;">
        <div class="progress-bar"><div id="progress-fill" class="progress-fill"></div></div>
        <p id="progress-text">Menunggu input...</p>
    </div>

    <pre id="log-box" class="log-box"></pre>

    <!-- 1. Load library pendukung (jika tool membutuhkan FFmpeg) -->
    <script src="https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/umd/ffmpeg.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/umd/index.js"></script>

    <!-- 2. Load script tool yang diinginkan -->
    <script src="https://cdn.jsdelivr.net/gh/openfishtools/web-tools@main/video/video-compressor-tool.js"></script>

    <script>
        document.addEventListener('DOMContentLoaded', () => {
            const tool = window.VideoCompressorTool;
            const container = document.getElementById('dynamic-inputs');
            const btnProcess = document.getElementById('btn-process');
            const progressFill = document.getElementById('progress-fill');
            const progressText = document.getElementById('progress-text');
            const logBox = document.getElementById('log-box');

            const formValues = {};

            // Render input kontrol berdasarkan tool.schema.inputs
            tool.schema.inputs.forEach(inputDef => {
                const group = document.createElement('div');
                group.className = 'form-group';

                const label = document.createElement('label');
                label.textContent = inputDef.label + (inputDef.required ? ' *' : '');
                group.appendChild(label);
                group.appendChild(document.createElement('br'));

                if (inputDef.type === 'file') {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = inputDef.accept || '*/*';
                    input.onchange = (e) => {
                        formValues[inputDef.name] = e.target.files[0];
                        btnProcess.disabled = !formValues[inputDef.name];
                    };
                    group.appendChild(input);
                } else if (inputDef.type === 'select' || inputDef.type === 'segmented') {
                    const select = document.createElement('select');
                    inputDef.options.forEach(opt => {
                        const option = document.createElement('option');
                        option.value = opt.value;
                        option.textContent = opt.label;
                        if (opt.value === inputDef.default) option.selected = true;
                        select.appendChild(option);
                    });
                    formValues[inputDef.name] = select.value;
                    select.onchange = (e) => { formValues[inputDef.name] = e.target.value; };
                    group.appendChild(select);
                }

                container.appendChild(group);
            });

            // Eksekusi pemrosesan saat tombol ditekan
            btnProcess.onclick = async () => {
                btnProcess.disabled = true;
                logBox.textContent = '';

                const context = {
                    onProgress: (percent, status) => {
                        progressFill.style.width = percent + '%';
                        progressText.textContent = `${percent}% - ${status}`;
                    },
                    onLog: (msg) => {
                        logBox.textContent += msg + '\n';
                        logBox.scrollTop = logBox.scrollHeight;
                    }
                };

                try {
                    const result = await tool.run(formValues, context);

                    if (result.type === 'file') {
                        // Otomatis download file hasil
                        const url = URL.createObjectURL(result.data);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = result.filename;
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                        URL.revokeObjectURL(url);
                        progressText.textContent = 'Selesai! File berhasil diunduh.';
                    }
                } catch (err) {
                    alert('Gagal: ' + err.message);
                    progressText.textContent = 'Error: ' + err.message;
                } finally {
                    btnProcess.disabled = false;
                }
            };
        });
    </script>
</body>
</html>
```

---

### Contoh Integrasi React

```jsx
import React, { useState, useEffect } from 'react';

export function ToolRunner({ toolScriptUrl }) {
    const [tool, setTool] = useState(null);
    const [selectedFile, setSelectedFile] = useState(null);
    const [progress, setProgress] = useState(0);
    const [status, setStatus] = useState('Idle');
    const [isProcessing, setIsProcessing] = useState(false);

    useEffect(() => {
        const script = document.createElement('script');
        script.src = toolScriptUrl;
        script.onload = () => {
            // Mengambil instance tool dari global window
            setTool(window.VideoCompressorTool || window.AppTools?.getAll()?.[0]);
        };
        document.body.appendChild(script);
        return () => { script.remove(); };
    }, [toolScriptUrl]);

    const handleRun = async () => {
        if (!tool || !selectedFile) return;
        setIsProcessing(true);

        const inputs = {
            videoFile: selectedFile,
            preset: 'medium'
        };

        const context = {
            onProgress: (p, s) => {
                setProgress(p);
                setStatus(s);
            },
            onLog: (msg) => console.log('[Tool Log]', msg)
        };

        try {
            const result = await tool.run(inputs, context);
            if (result.type === 'file') {
                const url = URL.createObjectURL(result.data);
                const a = document.createElement('a');
                a.href = url;
                a.download = result.filename;
                a.click();
                URL.revokeObjectURL(url);
            }
        } catch (err) {
            alert('Proses gagal: ' + err.message);
        } finally {
            setIsProcessing(false);
        }
    };

    if (!tool) return <div>Memuat komponen tool...</div>;

    return (
        <div className="card">
            <h3>{tool.title} (v{tool.version})</h3>
            <p>{tool.desc}</p>

            <input
                type="file"
                accept="video/*"
                onChange={(e) => setSelectedFile(e.target.files[0])}
                disabled={isProcessing}
            />

            <button onClick={handleRun} disabled={!selectedFile || isProcessing}>
                {isProcessing ? 'Memproses...' : 'Jalankan Tool'}
            </button>

            {isProcessing && (
                <div>
                    <div style={{ width: `${progress}%`, height: 4, background: '#0066cc' }} />
                    <p>{progress}% - {status}</p>
                </div>
            )}
        </div>
    );
}
```

---

## Katalog Tools

| Folder | File Tool | Deskripsi | Input Utama | Output |
|---|---|---|---|---|
| `video/` | `video-compressor-tool.js` | Kompresi video MP4 berbasis WebAssembly libx264. | `videoFile`, `preset`, `threadMode` | MP4 File |
| `video/` | `audio-extractor-tool.js` | Ekstraksi track audio MP3 lossy/lossless dari video. | `videoFile` | MP3 File |
| `video/` | `image-sequence-tool.js` | Mengubah sekumpulan gambar dalam ZIP menjadi video. | `zipFile`, `fps`, `bitrate`, `audioFile` | MP4 File |
| `video/` | `video-interpolation-tool.js` | AI Frame rate upscaler 2X/4X/8X menggunakan model RIFE v4.7 WebGPU. | `videoFile`, `multiplier` | MP4 File |
| `converters/` | `ae-to-am-beatmark-tool.js` | Konversi keyframe marker After Effects ke format Alight Motion XML. | `file` (JSX), `title`, `fps` | XML File |
| `converters/` | `fivemb-generator-tool.js` | Optimasi file Alight Motion XML menjadi di bawah 5MB dengan penggantian placeholder media. | `xmlFile`, `replaceMode` | XML File |
| `tiktok/` | `tiktok-downloader-tool.js` | Download video TikTok HD tanpa watermark melalui API resolver. | `url` | MP4 File |
| `tiktok/` | `tiktok-stats-tool.js` | Analisis metadata video TikTok (FPS riil, resolusi, bitrate stream, engagement rate, shadowban check). | `url` | Structured Data |
| `tiktok/` | `tiktok-quality-tool.js` | Patcher header & container video (FISH, Binary, StreamShield, WMV, 60fps slowmo) agar tidak dikompresi server TikTok saat diupload. | `videoFile`, `method`, `compress` | MP4 File |
| `ai/` | `rembg-tool.js` | Penghapus latar belakang gambar dan video menggunakan AI neural segmentation (MediaPipe, RVM, MODNet). | `file`, `model`, `bg`, `device` | PNG / WebP / MOV |
| `ai/` | `upscale-tool.js` | AI super resolution dan shader filter enhancer (Cartoonist, Human Detail, Smooth Face) berbasis WebGL/WebGPU. | `file`, `preset`, `timing`, `normalise` | PNG / JPG / MP4 |

---

## Dependensi dan Resource Runtime

Tool yang menggunakan pemrosesan berat secara otomatis memuat dependensi runtime dari CDN secara dinamis jika belum tersedia di halaman:

1. **FFmpeg WebAssembly**:
   - `@ffmpeg/ffmpeg@0.12.10` dan `@ffmpeg/util@0.12.1`
   - Mendukung akselerasi multi-thread (`@ffmpeg/core-mt`) jika `SharedArrayBuffer` dan `crossOriginIsolated` aktif, dengan fallback otomatis ke single-thread (`@ffmpeg/core`).
2. **ONNX Runtime Web**:
   - `onnxruntime-web` untuk eksekusi model AI (RIFE, MediaPipe, RVM, MODNet) via WebGPU / WebAssembly.
3. **JSZip**:
   - Digunakan oleh `image-sequence-tool` untuk membaca arsip ZIP gambar.

---

## Lisensi

Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0).  
Lihat file [LICENSE](LICENSE) untuk ketentuan lengkap penggunaan non-komersial dan atribusi.
