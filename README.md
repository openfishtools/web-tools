# OpenFishTools Web Tools

[![Version: 1.0.0](https://img.shields.io/badge/version-1.0.0-9DFF00.svg)](README.md)
[![License: CC BY-NC 4.0](https://img.shields.io/badge/License-CC_BY--NC_4.0-lightgrey.svg)](LICENSE)

A collection of pure client-side video processing, AI vision, media analytics, and animation conversion libraries for modern web browsers.

All tools in this repository follow a **Universal, Headless, Schema-Driven** architecture:
- **Zero DOM Lock-in**: Tools do not enforce any specific HTML structure or DOM IDs. You can build your own custom UI using React, Vue, Svelte, Tailwind, Bootstrap, or plain Vanilla HTML/CSS.
- **Direct CDN Access (No Git Clone Required)**: You can load any tool script directly into your web app via public CDNs (e.g., jsDelivr, unpkg) without needing to clone or install the repository.
- **Declarative Input Schema**: All parameters (files, selects, sliders, toggles, segmented pills, URLs) are defined declaratively in `tool.schema.inputs`.
- **Pure Execution Runner**: Every tool exposes an asynchronous `run(inputs, context)` function with real-time callbacks (`onProgress`, `onLog`, `onPreview`).
- **Standardized Output**: Returns clean, predictable output objects (`type: 'file'` with a binary `Blob`, or `type: 'data'` with structured JSON).

---

## Table of Contents

1. [Quick Start: Direct CDN Integration (No Clone Required)](#quick-start-direct-cdn-integration-no-clone-required)
   - [Method 1: Direct Script Tag](#method-1-direct-script-tag)
   - [Method 2: Dynamic On-Demand Script Loader (Recommended)](#method-2-dynamic-on-demand-script-loader-recommended)
   - [Method 3: React / Next.js Component](#method-3-react--nextjs-component)
2. [Browser Prerequisites (SharedArrayBuffer & WebAssembly)](#browser-prerequisites-sharedarraybuffer--webassembly)
3. [Tools Catalog & CDN Links](#tools-catalog--cdn-links)
4. [Tool Architecture & Runner API](#tool-architecture--runner-api)
   - [Context & Callbacks](#context--callbacks)
   - [Standardized Output Formats](#standardized-output-formats)
5. [Declarative Input Schema Specification](#declarative-input-schema-specification)
6. [License](#license)

---

## Quick Start: Direct CDN Integration (No Clone Required)

You do **not** need to clone or install this repository. Every tool script is published and accessible worldwide via free Content Delivery Networks (CDNs).

### Method 1: Direct Script Tag

The simplest way is to include the tool script directly inside your HTML `<head>` or `<body>`.

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Audio Extractor Example</title>
</head>
<body>
    <h2>Extract Audio from Video</h2>
    <input type="file" id="video-input" accept="video/*">
    <button id="extract-btn" disabled>Extract MP3</button>
    <p id="status-text">Select a video file to begin.</p>

    <!-- 1. Load runtime dependency (FFmpeg WASM for video/audio tools) -->
    <script src="https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/umd/ffmpeg.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/umd/index.js"></script>

    <!-- 2. Load the tool directly from CDN -->
    <script src="https://cdn.jsdelivr.net/gh/openfishtools/web-tools@main/video/audio-extractor-tool.js"></script>

    <script>
        const input = document.getElementById('video-input');
        const btn = document.getElementById('extract-btn');
        const status = document.getElementById('status-text');

        let selectedFile = null;
        input.addEventListener('change', (e) => {
            selectedFile = e.target.files[0];
            btn.disabled = !selectedFile;
        });

        btn.addEventListener('click', async () => {
            btn.disabled = true;
            status.textContent = 'Extracting audio...';

            // Access the tool registered on the window object
            const tool = window.AudioExtractorTool || window.AppTools.get('tool-audio-extractor');

            const inputs = {
                videoFile: selectedFile
            };

            const context = {
                onProgress: (percent, statusText) => {
                    status.textContent = `${percent}% - ${statusText}`;
                },
                onLog: (msg) => console.log('[Extractor Log]', msg)
            };

            try {
                const result = await tool.run(inputs, context);

                if (result.type === 'file') {
                    // Trigger instant file download
                    const url = URL.createObjectURL(result.data);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = result.filename || 'extracted_audio.mp3';
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    URL.revokeObjectURL(url);
                    status.textContent = 'Done! MP3 downloaded successfully.';
                }
            } catch (err) {
                status.textContent = `Error: ${err.message}`;
            } finally {
                btn.disabled = false;
            }
        });
    </script>
</body>
</html>
```

---

### Method 2: Dynamic On-Demand Script Loader (Recommended)

To keep your website initial page load lightning fast, fetch and load tool scripts only when the user selects or clicks a tool:

```javascript
/**
 * Loads a tool dynamically from the openfishtools CDN.
 * @param {string} toolRelativePath E.g. 'video/video-compressor-tool.js'
 * @returns {Promise<Object>} The registered tool definition
 */
async function loadWebTool(toolRelativePath) {
    const cdnBase = 'https://cdn.jsdelivr.net/gh/openfishtools/web-tools@main/';
    const scriptUrl = cdnBase + toolRelativePath;

    // Check if script is already present
    let script = document.querySelector(`script[src="${scriptUrl}"]`);
    if (!script) {
        script = document.createElement('script');
        script.src = scriptUrl;
        script.async = true;
        document.head.appendChild(script);

        await new Promise((resolve, reject) => {
            script.onload = resolve;
            script.onerror = () => reject(new Error(`Failed to load tool script from ${scriptUrl}`));
        });
    }

    // Tools automatically register to window.AppTools or named global window properties
    const toolId = 'tool-' + toolRelativePath.split('/').pop().replace('-tool.js', '');
    return (window.AppTools && window.AppTools.get(toolId)) || null;
}

// Example usage:
const compressorTool = await loadWebTool('video/video-compressor-tool.js');
console.log('Loaded tool:', compressorTool.title, compressorTool.version);
```

---

### Method 3: React / Next.js Component

Use this lightweight React component to execute any tool with zero backend setup:

```jsx
import React, { useState, useEffect } from 'react';

export function UniversalToolRunner({ toolScriptPath }) {
    const [tool, setTool] = useState(null);
    const [file, setFile] = useState(null);
    const [progress, setProgress] = useState(0);
    const [status, setStatus] = useState('Idle');
    const [isProcessing, setIsProcessing] = useState(false);

    useEffect(() => {
        let isMounted = true;
        const script = document.createElement('script');
        script.src = `https://cdn.jsdelivr.net/gh/openfishtools/web-tools@main/${toolScriptPath}`;
        script.async = true;
        script.onload = () => {
            if (!isMounted) return;
            // Get tool from AppTools registry or global window
            const loaded = window.AppTools?.getAll()?.slice(-1)[0] || null;
            setTool(loaded);
        };
        document.body.appendChild(script);

        return () => {
            isMounted = false;
            script.remove();
        };
    }, [toolScriptPath]);

    const handleExecute = async () => {
        if (!tool || !file) return;
        setIsProcessing(true);

        const inputs = {
            videoFile: file,
            method: 'tbt',
            compress: 'off'
        };

        const context = {
            onProgress: (percent, statusText) => {
                setProgress(percent);
                setStatus(statusText);
            },
            onLog: (msg) => console.log('[Tool]', msg)
        };

        try {
            const result = await tool.run(inputs, context);
            if (result.type === 'file') {
                const downloadUrl = URL.createObjectURL(result.data);
                const a = document.createElement('a');
                a.href = downloadUrl;
                a.download = result.filename;
                a.click();
                URL.revokeObjectURL(downloadUrl);
                setStatus('Completed successfully!');
            }
        } catch (err) {
            alert(`Process failed: ${err.message}`);
        } finally {
            setIsProcessing(false);
        }
    };

    if (!tool) return <div>Loading tool from CDN...</div>;

    return (
        <div style={{ padding: 20, border: '1px solid #ccc', borderRadius: 8 }}>
            <h3>{tool.title}</h3>
            <p>{tool.desc}</p>

            <input
                type="file"
                disabled={isProcessing}
                onChange={(e) => setFile(e.target.files[0])}
            />

            <button
                disabled={!file || isProcessing}
                onClick={handleExecute}
                style={{ marginLeft: 12 }}
            >
                {isProcessing ? 'Processing...' : 'Run Tool'}
            </button>

            {isProcessing && (
                <div style={{ marginTop: 16 }}>
                    <div style={{ background: '#eee', height: 8, borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{ background: '#0066cc', height: '100%', width: `${progress}%`, transition: 'width 0.2s' }} />
                    </div>
                    <p>{progress}% - {status}</p>
                </div>
            )}
        </div>
    );
}
```

---

## Browser Prerequisites (SharedArrayBuffer & WebAssembly)

For multi-threaded WebAssembly execution (used by FFmpeg, RIFE Video Interpolation, and AI segmentation models), the browser requires Cross-Origin Isolation headers:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

### Static Hosts Without Header Control (e.g., GitHub Pages)
If your static hosting provider does not allow custom response headers, simply include `coi-serviceworker` in your document `<head>`:

```html
<script src="https://cdn.jsdelivr.net/npm/coi-serviceworker/coi-serviceworker.min.js"></script>
```

---

## Tools Catalog & CDN Links

All tools are simple, modular, and synced with the official web deployment.

| Simple Name | Category | Tool ID | CDN Script Path | Description |
|---|---|---|---|---|
| **Quality method** | TikTok | `tool-tiktok-patcher` | `tiktok/tiktok-quality-tool.js` | TikTok HQ upload patcher (FISH, Binary, StreamShield, FRY, 60fps conformer). |
| **TikTok Downloader** | TikTok | `tool-tiktok-downloader` | `tiktok/tiktok-downloader-tool.js` | High-definition TikTok video downloader without watermark. |
| **TikTok Statistics** | TikTok | `tool-tiktok-stats` | `tiktok/tiktok-stats-tool.js` | Real-time video metadata, stream bitrate, framerate, and engagement analytics. |
| **Video Compressor** | Video | `tool-video-compressor` | `video/video-compressor-tool.js` | Pure client-side MP4/WebM compressor with custom size and resolution controls. |
| **Audio Extractor** | Video | `tool-audio-extractor` | `video/audio-extractor-tool.js` | High-quality MP3 audio track extractor from video formats (MP4, MOV, WebM, MKV). |
| **Image Sequence to Video** | Video | `tool-image-sequence` | `video/image-sequence-tool.js` | Converts ZIP archives of image frames into smooth MP4 videos with audio. |
| **Video Interpolation** | Video / AI | `tool-video-interpolation` | `video/video-interpolation-tool.js` | AI frame interpolation (RIFE v4.7 via ONNX/WebGPU) for 2X / 4X smoother FPS. |
| **Remove Background** | AI | `tool-rembg` | `ai/rembg-tool.js` | AI neural segmentation (MediaPipe, RVM, MODNet) for image and video backgrounds. |
| **Qualitelio Enhancer** | AI | `tool-upscale-enhancer` | `ai/upscale-tool.js` | Super-resolution upscaler and real-time GPU shader enhancement filters. |
| **AE to AM** | Converters | `tool-ae-am-beatmark` | `converters/ae-to-am-beatmark-tool.js` | Converts After Effects keyframe markers into Alight Motion XML project markers. |
| **5MB XML Generator** | Converters | `tool-5mb-generator` | `converters/fivemb-generator-tool.js` | Optimizes Alight Motion XML files to under 5MB by swapping media placeholders. |

> **Note on Quality method Helpers**:
> When using `tiktok/tiktok-quality-tool.js`, the core patcher engines located in `method/` (`method/finalize.js`, `method/compress.js`, and `method/item/*.js`) are fetched dynamically from the CDN as needed.

---

## Tool Architecture & Runner API

Each tool definition contains metadata, an input schema, and an executable runner:

```javascript
{
    id: 'tool-video-compressor',
    version: '2.2.0',
    title: 'Video Compressor',
    desc: 'Compress video to custom quality and file sizes',
    icon: 'compress',
    category: ['Video', 'Tools'],

    // 1. Declarative schema defining available parameters
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
                name: 'targetMb',
                type: 'number',
                label: 'Target Size (MB)',
                default: 25,
                min: 1,
                max: 500
            }
        ]
    },

    // 2. Pure asynchronous execution function
    run: async function(inputs, context) {
        // inputs.videoFile -> File object
        // inputs.targetMb -> 25
        // context.onProgress(percent, statusText)
        // context.onLog(message)

        return {
            type: 'file',
            data: blob,
            filename: 'compressed_video.mp4',
            mimeType: 'video/mp4'
        };
    }
}
```

### Context & Callbacks

The `context` object passed to `tool.run(inputs, context)` accepts the following callbacks:

```javascript
const context = {
    // Called when the execution progress changes (0 to 100)
    onProgress: (percent, statusText) => {
        console.log(`[Progress ${percent}%] ${statusText}`);
    },

    // Called when the tool emits technical log messages (FFmpeg stdout, ONNX steps)
    onLog: (message) => {
        console.log(`[Log] ${message}`);
    },

    // Called when preview data is ready (e.g. video cover image, audio waveform)
    onPreview: (previewData) => {
        console.log('[Preview]', previewData);
    },

    // Optional AbortSignal to cancel running processes
    signal: abortController.signal
};
```

### Standardized Output Formats

#### 1. File Output (`type: 'file'`)
Returned by encoders, patchers, converters, upscalers, and extractors:
```javascript
{
    type: 'file',
    data: Blob,                // Binary Blob object of rendered result
    filename: 'output.mp4',    // Suggested filename
    mimeType: 'video/mp4'      // MIME type
}
```

#### 2. Structured Data Output (`type: 'data'`)
Returned by analytical and scanner tools (e.g., TikTok Statistics):
```javascript
{
    type: 'data',
    data: {
        preview: {
            cover: 'https://...',
            author: 'cutefishaep',
            title: 'Cool Edit'
        },
        items: [
            { label: 'Resolution', value: '1080 x 1920' },
            { label: 'FPS', value: '60 fps' },
            { label: 'Bitrate', value: '5.2 Mbps' }
        ]
    }
}
```

---

## Declarative Input Schema Specification

Tools define their inputs inside `tool.schema.inputs`. You can use this schema to auto-generate forms:

| Input Type (`type`) | Additional Properties | Description |
|---|---|---|
| `file` | `accept`, `required`, `multiple` | File input / dropzone. Value is a browser `File` or `Blob`. |
| `select` | `options: [{ label, value }]`, `default` | Standard dropdown select menu. |
| `segmented` | `options: [{ label, value }]`, `default` | Segmented pill button group. |
| `slider` | `min`, `max`, `step`, `unit`, `default` | Numeric slider input. |
| `number` | `min`, `max`, `step`, `default` | Numeric number box input. |
| `toggle` | `default: boolean` | Boolean switch on/off. |
| `url` | `placeholder`, `validate: Function` | Text URL input with validation. |
| `textarea` | `placeholder`, `rows`, `default` | Multi-line text input. |

---

## License

This project is licensed under the Creative Commons Attribution-NonCommercial 4.0 International ([CC BY-NC 4.0](LICENSE)).

You are free to:
- **Share**: Copy and redistribute the material in any medium or format.
- **Adapt**: Remix, transform, and build upon the material.

Under the terms of:
- **Attribution**: You must give appropriate credit to [OpenFishTools](https://github.com/openfishtools).
- **NonCommercial**: You may not use the material for commercial purposes without prior permission.
