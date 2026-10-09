# OpenFishTools Web-Tools Suite

Standalone client-side motion design and video editing tools suite for the OpenFishTools ecosystem.

---

## 🗂️ Directory Structure

```text
tools/
├── Method/                     # Main Patcher Engine
│   ├── finalize.js             # Universal Finalizer & Download Coordinator
│   ├── compress.js             # Compression Pipeline Engine
│   └── item/                   # Patch Methods
│       ├── streamshield.js     # Cutefish StreamShield (Micro-Shield Trap)
│       ├── binarypatch.js      # Binary MP4 Atom Patcher
│       ├── FRYMethod.js        # Fast Re-encode Method
│       ├── fpspatch.js         # High-FPS Conformer
│       ├── wmvpatch.js         # Audio Container Patcher
│       ├── emergencymethod.js  # Fallback Patcher
│       └── fishV2.js           # Dual-Anchor Time-Trap
│
├── tiktok/                     # TikTok Utilities
│   ├── tiktok-quality-tool.js
│   ├── tiktok-downloader-tool.js
│   └── tiktok-stats-tool.js
│
├── video/                      # Media Processing Tools
│   ├── video-compressor-tool.js
│   ├── video-interpolation-tool.js
│   ├── audio-extractor-tool.js
│   └── image-sequence-tool.js
│
├── ai/                         # AI & Shaders
│   ├── upscale-tool.js
│   ├── upscale-gpu-enhancer.js
│   └── rembg-tool.js
│
├── converters/                 # XML & Project Format Tools
│   ├── ae-to-am-beatmark-tool.js
│   └── fivemb-generator-tool.js
│
├── workers/                    # Background Web Workers
│   ├── upscaleWorker.js
│   └── webm-muxer.min.js
│
└── experimental/               # [GIT-IGNORED] Local Research Pipeline
```

---

## 🚀 Building the Distribution Bundle

To compile all modular tools into `dist/web-tools.bundle.js`:

```bash
npm run build
```

The output file in `dist/web-tools.bundle.js` is automatically consumed by the **OpenFishTools Web** platform.
