(function() {
    'use strict';

    function t(key) {
        if (typeof window.getTranslation === 'function') {
            const res = window.getTranslation(key);
            if (res && res !== key) return res;
        }
        return key;
    }

    let selectedFile = null;
    let isProcessing = false;
    let multiplier = 2;
    let originalFps = 30;
    let ffmpegInstance = null;
    let cancelRife = false;
    let activeContext = null;

    function log(msg) {
        if (activeContext && typeof activeContext.onLog === 'function') {
            activeContext.onLog(msg);
        }
        const logsEl = document.getElementById('interp-logs');
        if (logsEl) {
            logsEl.textContent += (logsEl.textContent ? '\n' : '') + msg;
            logsEl.scrollTop = logsEl.scrollHeight;
        }
        const container = document.getElementById('interp-logs-container');
        if (container) container.classList.remove('hidden');
    }

    function setButtonState(state, text) {
        const processBtn = document.getElementById('tool-process-btn');
        const processLabel = document.getElementById('tool-process-label');
        if (!processBtn) return;

        if (state === 'processing') {
            processBtn.disabled = true;
            processBtn.dataset.state = 'processing';
            if (processLabel) processLabel.textContent = text || t('status_processing') || "Interpolating...";
        } else if (state === 'completed') {
            processBtn.disabled = false;
            processBtn.dataset.state = 'completed';
            if (processLabel) processLabel.textContent = text || t('status_process_another') || "Process Another";
        } else if (state === 'error') {
            processBtn.disabled = false;
            processBtn.dataset.state = 'error';
            if (processLabel) processLabel.textContent = text || t('status_error') || "Interpolation Failed";
            setTimeout(() => {
                setButtonState('ready');
            }, 3500);
        } else {
            processBtn.disabled = !selectedFile;
            processBtn.dataset.state = selectedFile ? 'ready' : 'idle';
            if (processLabel) processLabel.textContent = text || t('tool_interp_btn') || "Interpolate Video";
        }
    }

    function setProgress(percent, text) {
        if (activeContext && typeof activeContext.onProgress === 'function') {
            activeContext.onProgress(percent, text);
        }
        const progressSec = document.getElementById('tool-progress-section');
        const progressFill = document.getElementById('tool-progress-fill');
        const progressStatus = document.getElementById('tool-progress-status');
        const progressPercent = document.getElementById('tool-progress-percent');

        if (progressSec) progressSec.classList.remove('hidden');
        if (progressFill) progressFill.style.width = percent + '%';
        if (progressPercent) progressPercent.textContent = percent + '%';
        if (progressStatus && text) progressStatus.textContent = text;

        if (window.ToolProgressManager) {
            window.ToolProgressManager.set('tool-video-interpolation', {
                isProcessing: percent < 100,
                percent: percent,
                status: text || `${percent}%`,
                file: selectedFile
            });
        }
    }

    async function loadFFmpegLibraries() {
        if (window.FFmpegWASM && window.FFmpegUtil) return true;
        const loadScript = (src) => new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src;
            s.onload = () => resolve(true);
            s.onerror = () => reject(new Error(`Failed to load ${src}`));
            document.head.appendChild(s);
        });
        if (window.CutefishFFmpegLoader && window.CutefishFFmpegLoader.loadFFmpegLibraries) {
            return await window.CutefishFFmpegLoader.loadFFmpegLibraries();
        }
        try {
            if (!window.FFmpegUtil) {
                try { await loadScript('https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/umd/index.js'); } catch (e) {
                    await loadScript('https://unpkg.com/@ffmpeg/util@0.12.1/dist/umd/index.js');
                }
            }
            if (!window.FFmpegWASM) {
                try { await loadScript('https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/umd/ffmpeg.js'); } catch (e) {
                    await loadScript('https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/umd/ffmpeg.js');
                }
            }
        } catch (err) {
            console.error('[Video Interpolation] Error loading FFmpeg libraries:', err);
        }
        return !!(window.FFmpegWASM && window.FFmpegUtil);
    }

    async function detectFps(file) {
        return new Promise((resolve) => {
            const video = document.createElement('video');
            video.preload = 'metadata';
            video.muted = true;
            video.playsInline = true;
            video.setAttribute('playsinline', '');
            video.setAttribute('webkit-playsinline', '');
            const url = URL.createObjectURL(file);
            video.src = url;
            let resolved = false;
            let timeout = null;
            const done = (fps) => {
                if (!resolved) {
                    resolved = true;
                    if (timeout) clearTimeout(timeout);
                    try { video.pause(); } catch(_) {}
                    video.src = '';
                    URL.revokeObjectURL(url);
                    resolve(fps);
                }
            };
            timeout = setTimeout(() => done(30), 1200);

            if ('requestVideoFrameCallback' in video) {
                const frames = [];
                const cb = (now, meta) => {
                    frames.push(meta.mediaTime);
                    if (frames.length < 8) {
                        video.requestVideoFrameCallback(cb);
                    } else {
                        const diffs = [];
                        for (let k = 1; k < frames.length; k++) {
                            const d = frames[k] - frames[k - 1];
                            if (d > 0.001) diffs.push(d);
                        }
                        if (!diffs.length) { done(30); return; }
                        const avg = diffs.reduce((a, b) => a + b, 0) / diffs.length;
                        const raw = 1 / avg;
                        const common = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];
                        const nearest = common.reduce((p, c) => Math.abs(c - raw) < Math.abs(p - raw) ? c : p);
                        done(nearest);
                    }
                };
                video.currentTime = 0;
                video.requestVideoFrameCallback(cb);
                video.play().catch(() => done(30));
            } else {
                video.onloadedmetadata = () => done(30);
                video.onerror = () => done(30);
            }
        });
    }

    class RIFEInterpolator {
        constructor(width, height) {
            this.origWidth = width;
            this.origHeight = height;
            this.width = Math.ceil(width / 32) * 32;
            this.height = Math.ceil(height / 32) * 32;
            this.session = null;
            this.device = null;
            this._modelBuffer = null;
            this.canvas0 = document.createElement('canvas'); this.canvas0.width = this.width; this.canvas0.height = this.height; this.ctx0 = this.canvas0.getContext('2d', { willReadFrequently: true });
            this.canvas1 = document.createElement('canvas'); this.canvas1.width = this.width; this.canvas1.height = this.height; this.ctx1 = this.canvas1.getContext('2d', { willReadFrequently: true });
            this.interpCanvas = document.createElement('canvas'); this.interpCanvas.width = this.width; this.interpCanvas.height = this.height; this.interpCtx = this.interpCanvas.getContext('2d', { willReadFrequently: true });
            const total = this.width * this.height;
            this.floatData0 = new Float32Array(total * 3);
            this.floatData1 = new Float32Array(total * 3);
            this.targetImgData = this.interpCtx.createImageData(this.width, this.height);
            this.targetU32 = new Uint32Array(this.targetImgData.data.buffer);
            this.isReady = false;
        }
        async init(onLog){
            if (navigator.gpu) {
                try {
                    const adapterPromise = navigator.gpu.requestAdapter();
                    const timeoutPromise = new Promise((_, rej) => setTimeout(() => rej(new Error('GPU request timed out')), 1500));
                    const adapter = await Promise.race([adapterPromise, timeoutPromise]);
                    if (adapter) this.device = await adapter.requestDevice();
                } catch (_) {}
            }
            onLog('[RIFE] Loading RIFE model...');
            const localModelUrl = 'ai/models/rife47_ensemble_True_scale_1_sim.onnx';
            const cdnBase = window.TOOLS_CDN_BASE || 'https://cdn.jsdelivr.net/gh/openfishtools/web-tools@main/';
            const hfBase = window.HF_RESOURCE_BASE || 'https://huggingface.co/cutefishae/resource-cutefish/resolve/main';
            const remoteUrls = [
                `${hfBase}/models/rife47_ensemble_True_scale_1_sim.onnx`,
                'https://huggingface.co/cutefishae/resource-cutefish/resolve/main/models/rife47_ensemble_True_scale_1_sim.onnx',
                'https://huggingface.co/yuvraj108c/rife-onnx/resolve/main/rife47_ensemble_True_scale_1_sim.onnx',
                'https://hf-mirror.com/yuvraj108c/rife-onnx/resolve/main/rife47_ensemble_True_scale_1_sim.onnx',
                localModelUrl,
                'assets/models/rife47_ensemble_True_scale_1_sim.onnx'
            ];
            let modelBuffer = null;
            const cacheName = 'chros-offline-assets-v1'; let cache = null; if ('caches' in window) try { cache = await caches.open(cacheName); } catch (e) {}
            if (cache) { try { const full = new URL(localModelUrl, window.location.origin).href; const m = await cache.match(full) || await cache.match(localModelUrl); if (m) { onLog('[RIFE] Loading from offline cache...'); modelBuffer = await m.arrayBuffer(); } } catch (e) {} }
            if (!modelBuffer) {
                for (const u of remoteUrls) {
                    try {
                        onLog('[RIFE] Fetching RIFE model from CDN...');
                        const r = await fetch(u);
                        if (r.ok) {
                            const buf = await r.arrayBuffer();
                            if (buf && buf.byteLength > 1000000) {
                                const head = new TextDecoder().decode(new Uint8Array(buf.slice(0, 40)));
                                if (!head.startsWith('File size exceeded') && !head.startsWith('<!DOCTYPE') && !head.startsWith('{')) {
                                    modelBuffer = buf;
                                    if (cache) { try { const full = new URL(localModelUrl, window.location.origin).href; const cr = new Response(modelBuffer.slice(0), { headers: { 'Content-Type': 'application/octet-stream' } }); await cache.put(full, cr.clone()); await cache.put(localModelUrl, cr); } catch (e) {} }
                                    break;
                                }
                            }
                        }
                    } catch (e) {}
                }
            }
            if (!modelBuffer) throw new Error('Failed to load RIFE model');
            this._modelBuffer = modelBuffer;

            if (typeof ort === 'undefined' || !ort.InferenceSession) {
                if (typeof window.ensureOnnxRuntime !== 'function') throw new Error('ONNX Runtime failed to load.');
                await window.ensureOnnxRuntime();
            }

            if (ort.env && ort.env.wasm) {
                const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Tablet/i.test(navigator.userAgent) ||
                               (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
                ort.env.wasm.numThreads = isMobile ? 1 : Math.min(4, navigator.hardwareConcurrency || 4);
                ort.env.wasm.simd = true;
            }

            const epList = this.device
                ? [{ name: 'webgpu', powerPreference: 'high-performance' }, 'wasm']
                : ['wasm'];
            try {
                this.session = await ort.InferenceSession.create(modelBuffer.slice(0), {
                    executionProviders: epList,
                    graphOptimizationLevel: 'all'
                });
            } catch (e) {
                onLog('[RIFE] Primary provider failed, fallback WASM');
                this.session = await ort.InferenceSession.create(modelBuffer.slice(0), {
                    executionProviders: ['wasm'],
                    graphOptimizationLevel: 'all'
                });
            }
            this.isReady = true;
            onLog('[RIFE] RIFE v4.7 ready');
        }
        async interpolate(srcCanvas0, srcCanvas1, progressVal, outCanvas){
            if(!this.isReady) throw new Error('RIFE not ready');
            const w = this.width, h = this.height, ow = this.origWidth, oh = this.origHeight;
            this.ctx0.clearRect(0, 0, w, h); this.ctx0.drawImage(srcCanvas0, 0, 0, ow, oh, 0, 0, w, h);
            const d0 = this.ctx0.getImageData(0, 0, w, h).data;
            this.ctx1.clearRect(0, 0, w, h); this.ctx1.drawImage(srcCanvas1, 0, 0, ow, oh, 0, 0, w, h);
            const d1 = this.ctx1.getImageData(0, 0, w, h).data;
            const total = w * h, inv = 1 / 255, ro = 0, go = total, bo = total * 2;
            for(let i = 0, p = 0; i < total; i++, p += 4){
                this.floatData0[ro + i] = d0[p] * inv;
                this.floatData0[go + i] = d0[p + 1] * inv;
                this.floatData0[bo + i] = d0[p + 2] * inv;
                this.floatData1[ro + i] = d1[p] * inv;
                this.floatData1[go + i] = d1[p + 1] * inv;
                this.floatData1[bo + i] = d1[p + 2] * inv;
            }
            const t0 = new ort.Tensor('float32', this.floatData0, [1, 3, h, w]);
            const t1 = new ort.Tensor('float32', this.floatData1, [1, 3, h, w]);
            const tt = new ort.Tensor('float32', new Float32Array([progressVal]), [1]);
            const inputs = this.session.inputNames;
            const n0 = inputs.find(n => n.includes('0') || n.includes('img0')) || inputs[0];
            const n1 = inputs.find(n => n.includes('1') || n.includes('img1')) || inputs[1];
            const nt = inputs.find(n => n.includes('time')) || (inputs.length > 2 ? inputs[2] : null);
            const feeds = {}; feeds[n0] = t0; feeds[n1] = t1; if (nt) feeds[nt] = tt;

            let res = null;
            try {
                res = await this.session.run(feeds);
            } catch (err) {
                if (this.device && this._modelBuffer) {
                    this.device = null;
                    this.session = await ort.InferenceSession.create(this._modelBuffer.slice(0), {
                        executionProviders: ['wasm'],
                        graphOptimizationLevel: 'all'
                    });
                    res = await this.session.run(feeds);
                } else {
                    throw err;
                }
            }

            try {
                const out = res[this.session.outputNames[0]].data;
                const u32 = this.targetU32;
                for(let i = 0; i < total; i++){
                    const r = Math.min(255, Math.max(0, (out[ro + i] * 255) | 0));
                    const g = Math.min(255, Math.max(0, (out[go + i] * 255) | 0));
                    const b = Math.min(255, Math.max(0, (out[bo + i] * 255) | 0));
                    u32[i] = 0xFF000000 | (b << 16) | (g << 8) | r;
                }
                this.interpCtx.putImageData(this.targetImgData, 0, 0);
                const oc = outCanvas.getContext('2d');
                oc.clearRect(0, 0, ow, oh);
                oc.drawImage(this.interpCanvas, 0, 0, w, h, 0, 0, ow, oh);
            } finally {
                try { t0.dispose(); } catch (_) {}
                try { t1.dispose(); } catch (_) {}
                try { tt.dispose(); } catch (_) {}
                if (res) {
                    for (const k in res) {
                        try { if (res[k] && typeof res[k].dispose === 'function') res[k].dispose(); } catch (_) {}
                    }
                }
            }
        }
        destroy() {
            if (this.session && typeof this.session.release === 'function') {
                try { this.session.release(); } catch (_) {}
            }
            this.session = null;
            this.device = null;
            this._modelBuffer = null;
            this.floatData0 = null;
            this.floatData1 = null;
            this.targetImgData = null;
            this.targetU32 = null;
            this.canvas0 = null;
            this.canvas1 = null;
            this.interpCanvas = null;
            this.isReady = false;
        }
    }

    async function getFFmpeg(){
        if(ffmpegInstance) return ffmpegInstance;
        const ready = await loadFFmpegLibraries();
        if(!ready || !window.FFmpegWASM || !window.FFmpegUtil) throw new Error('FFmpeg library failed to load');
        const {FFmpeg} = window.FFmpegWASM;
        const {toBlobURL} = window.FFmpegUtil;
        const errMsg = (e) => {
            if (!e) return 'unknown error';
            if (e instanceof Error && e.message) return e.message;
            if (typeof e === 'string') return e;
            try { return JSON.stringify(e); } catch (_) { return String(e); }
        };

        const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Tablet/i.test(navigator.userAgent) ||
                           (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        const isMultiThread = !isMobileDevice && typeof SharedArrayBuffer !== 'undefined' && window.crossOriginIsolated === true;

        ffmpegInstance = await window.CutefishFFmpegLoader.getFFmpegInstance({
            isMultiThread,
            log: (msg) => console.log(msg)
        });
        ffmpegInstance.on('log', ({ message }) => {
            if (message && !message.includes('frame=') && !message.includes('fps=')) console.log('[FFmpeg]', message);
        });
        return ffmpegInstance;
    }

    async function checkInterpSystemCompatibility() {
        const checkingScreen = document.getElementById('interp-checking-screen');
        const gpuDot = document.getElementById('interp-gpu-dot');
        const gpuStatus = document.getElementById('interp-gpu-status');
        const mainContent = document.getElementById('interp-main-content');
        const processBtn = document.getElementById('tool-process-btn');
        if (processBtn) { processBtn.disabled = true; processBtn.dataset.state = 'processing'; }
        if (checkingScreen) checkingScreen.classList.remove('hidden');
        if (mainContent) mainContent.classList.add('hidden');
        if (gpuDot) { gpuDot.textContent = 'sync'; gpuDot.style.color = 'var(--md-sys-color-primary)'; gpuDot.classList.add('upscale-spinner'); }
        if (gpuStatus) gpuStatus.textContent = t('interp_checking_gpu') || 'WebGPU: Checking...';

        let hasWebGPU = false;
        if (navigator.gpu) {
            try {
                const adapterPromise = navigator.gpu.requestAdapter();
                const timeoutPromise = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 1500));
                const adapter = await Promise.race([adapterPromise, timeoutPromise]);
                if (adapter) hasWebGPU = true;
            } catch(e) {}
        }
        await new Promise(r => setTimeout(r, 200));
        if (gpuDot) {
            gpuDot.classList.remove('upscale-spinner');
            if (hasWebGPU) {
                gpuDot.textContent = 'check_circle';
                gpuDot.style.color = '#4CAF50';
                if (gpuStatus) gpuStatus.textContent = t('interp_ready_gpu') || 'WebGPU: Available (High Speed)';
            } else {
                gpuDot.textContent = 'info';
                gpuDot.style.color = '#FF9800';
                if (gpuStatus) gpuStatus.textContent = t('interp_fallback_gpu') || 'WebGPU unavailable: Using CPU WASM mode';
            }
        }
        await new Promise(r => setTimeout(r, 200));
        if (checkingScreen) checkingScreen.classList.add('hidden');
        if (mainContent) mainContent.classList.remove('hidden');
        const pb = document.getElementById('tool-process-btn');
        if (pb) {
            pb.disabled = false;
            pb.dataset.state = 'ready';
            const pl = document.getElementById('tool-process-label');
            if (pl) pl.textContent = t('tool_interp_btn') || 'Interpolate Video';
        }
        if (typeof window.updateOpenModalsLayout === 'function') window.updateOpenModalsLayout(true);
    }

    async function renderWorkspace(file) {
        const optContainer = document.getElementById('tool-dynamic-options');
        if (!optContainer) return;

        originalFps = 30; // default for instant rendering

        optContainer.innerHTML = `
            <div class="interp-workspace" id="interp-workspace-inner">
                <div id="interp-checking-screen" class="system-checking-card">
                    <h3 class="system-checking-title" data-i18n="system_checking_title">${t('system_checking_title') || 'Checking System Compatibility...'}</h3>
                    <div class="system-checking-list">
                        <div class="system-checking-item">
                            <span id="interp-gpu-dot" class="material-symbols-rounded" style="font-size:20px;">hourglass_empty</span>
                            <span id="interp-gpu-status">${t('interp_checking_gpu') || 'WebGPU: Checking...'}</span>
                        </div>
                    </div>
                </div>
                <div id="interp-main-content" class="hidden">
                <div class="interp-metrics-grid">
                    <div class="interp-metric-card">
                        <div id="interp-input-fps" class="interp-metric-val">${originalFps.toFixed(0)} FPS</div>
                        <div class="interp-metric-label" data-i18n="interp_input_label">${t('interp_input_label') || 'Input'}</div>
                    </div>
                    <div class="interp-metric-card highlight">
                        <div id="interp-target-fps" class="interp-metric-val primary">${(originalFps * multiplier).toFixed(0)} FPS</div>
                        <div class="interp-metric-label" data-i18n="interp_output_label">${t('interp_output_label') || 'Output'}</div>
                    </div>
                </div>

                <div class="interp-controls-card">
                    <p class="interp-controls-title" data-i18n="interp_multiplier_title">${t('interp_multiplier_title') || 'FPS Multiplier'}</p>
                    <div class="interp-multipliers-track" id="interp-multipliers">
                        <div class="interp-mult-pill ${multiplier === 2 ? 'active' : ''}" data-mult="2">2x</div>
                        <div class="interp-mult-pill ${multiplier === 4 ? 'active' : ''}" data-mult="4">4x</div>
                        <div class="interp-mult-pill ${multiplier === 8 ? 'active' : ''}" data-mult="8">8x</div>
                    </div>
                </div>
                </div>
                <div class="process-logs-wrap" id="interp-logs-container">
                    <div class="process-logs-header">
                        <span class="process-logs-title">${t('upscale_logs_title') || 'Process Logs'}</span>
                        <button type="button" class="btn-copy-logs" id="btn-copy-interp-logs">
                            <span class="material-symbols-rounded">content_copy</span>
                            <span>${t('res_modal_copy') || 'Copy'}</span>
                        </button>
                    </div>
                    <pre class="process-logs-pre" id="interp-logs"></pre>
                </div>
            </div>
        `;

        const track = document.getElementById('interp-multipliers');
        const targetFpsEl = document.getElementById('interp-target-fps');

        if (track) {
            track.querySelectorAll('.interp-mult-pill').forEach(btn => {
                btn.addEventListener('click', () => {
                    track.querySelectorAll('.interp-mult-pill').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    multiplier = parseInt(btn.getAttribute('data-mult'), 10) || 2;
                    if (targetFpsEl) targetFpsEl.textContent = `${(originalFps * multiplier).toFixed(0)} FPS`;
                });
            });
        }
        const copyLogsBtn = document.getElementById('btn-copy-interp-logs');
        if (copyLogsBtn) {
            copyLogsBtn.addEventListener('click', () => {
                const logsEl = document.getElementById('interp-logs');
                if (logsEl && logsEl.textContent) {
                    navigator.clipboard.writeText(logsEl.textContent);
                    if (typeof window.showToast === 'function') window.showToast(t('btn_copied') || 'Copied!');
                }
            });
        }

        if (typeof window.translateUI === 'function') {
            window.translateUI();
        }
        if (typeof window.updateOpenModalsLayout === 'function') {
            window.updateOpenModalsLayout(true);
        }
        checkInterpSystemCompatibility();

        // Detect actual video FPS in background without blocking modal rendering
        detectFps(file).then(detected => {
            originalFps = detected;
            const inFpsEl = document.getElementById('interp-input-fps');
            if (inFpsEl) inFpsEl.textContent = `${originalFps.toFixed(0)} FPS`;
            if (targetFpsEl) targetFpsEl.textContent = `${(originalFps * multiplier).toFixed(0)} FPS`;
        }).catch(() => {});
    }

    async function processInterpolation(file) {
        if (isProcessing || !file) return;
        isProcessing = true;
        cancelRife = false;

        setButtonState('processing', t('status_processing') || 'Initializing AI Engine...');
        setProgress(10, t('interp_checking_gpu') || 'Checking system...');
        log(`[Interp] Source: ${file.name} (${(file.size/(1024*1024)).toFixed(2)} MB) | ${originalFps} FPS → ${originalFps*multiplier} FPS (${multiplier}x)`);

        let outIdx = 0;
        let inName = null;
        let ffmpeg = null;
        let rife = null;
        let totalInputFrames = 0;

        try {
            ffmpeg = await getFFmpeg();
            const { fetchFile } = window.FFmpegUtil;

            const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Tablet/i.test(navigator.userAgent) ||
                               (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

            const targetFps = originalFps * multiplier;
            log(`[RIFE] Starting RIFE AI interpolation ${originalFps}→${targetFps} FPS (${multiplier}x) ...`);
            setProgress(15, `${t('status_encoding') || 'Preparing frames'} (${targetFps} FPS)...`);
            setButtonState('processing', `Interpolating ${multiplier}X...`);

            // Probe metadata using hidden video element
            const procVideo = document.createElement('video');
            procVideo.muted = true;
            procVideo.playsInline = true;
            procVideo.setAttribute('playsinline', '');
            procVideo.setAttribute('webkit-playsinline', '');
            procVideo.preload = 'metadata';
            const videoUrl = URL.createObjectURL(file);
            procVideo.src = videoUrl;

            await new Promise((res) => {
                procVideo.onloadedmetadata = () => res();
                procVideo.onerror = () => res();
                setTimeout(() => res(), 3000);
            });

            const origW = (procVideo.videoWidth || 640) & ~1;
            const origH = (procVideo.videoHeight || 360) & ~1;
            URL.revokeObjectURL(videoUrl);

            // Safe mobile processing dimensions to avoid WebGPU/WebGL OOM crashes
            const maxDim = isMobileDevice ? 640 : 960;
            let scale = 1;
            if (Math.max(origW, origH) > maxDim) {
                scale = maxDim / Math.max(origW, origH);
            }
            const width = Math.max(64, Math.round(origW * scale) & ~1);
            const height = Math.max(64, Math.round(origH * scale) & ~1);

            log(`[RIFE] Dimensions: ${origW}x${origH} -> Processing at ${width}x${height} (${isMobileDevice ? 'Mobile Safe Mode' : 'Standard Mode'})`);

            rife = new RIFEInterpolator(width, height);
            await rife.init((m) => log(m));
            setProgress(25, 'RIFE engine ready...');

            const ext = file.name.split('.').pop() || 'mp4';
            inName = `input_${Date.now()}.${ext}`;
            await ffmpeg.writeFile(inName, await fetchFile(file));
            log(`[RIFE] Extracting video frames via FFmpeg WASM...`);
            setProgress(30, 'Extracting frames...');

            // Extract frames cleanly with FFmpeg WASM - eliminates flaky HTML5 video seeking
            await ffmpeg.exec(['-i', inName, '-vf', `scale=${width}:${height}`, '-vsync', '0', '-qscale:v', '3', 'in_%05d.jpg']);

            // Count total extracted frames
            totalInputFrames = 0;
            while (true) {
                const fname = `in_${String(totalInputFrames + 1).padStart(5, '0')}.jpg`;
                try {
                    const testData = await ffmpeg.readFile(fname);
                    if (!testData || testData.byteLength === 0) break;
                    totalInputFrames++;
                } catch (_) {
                    break;
                }
            }

            if (totalInputFrames < 2) {
                throw new Error('Not enough frames extracted for video interpolation.');
            }

            const totalOutputFrames = (totalInputFrames - 1) * multiplier + 1;
            log(`[RIFE] Extracted ${totalInputFrames} source frames -> Generating ${totalOutputFrames} output frames`);
            setProgress(40, `Interpolating frames (0/${totalOutputFrames})...`);

            const c0 = document.createElement('canvas'); c0.width = width; c0.height = height; const ctx0 = c0.getContext('2d', { willReadFrequently: true });
            const c1 = document.createElement('canvas'); c1.width = width; c1.height = height; const ctx1 = c1.getContext('2d', { willReadFrequently: true });
            const outCanvas = document.createElement('canvas'); outCanvas.width = width; outCanvas.height = height;
            outIdx = 0;

            const writeFrame = async (canvas) => {
                const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85));
                const ab = await blob.arrayBuffer();
                await ffmpeg.writeFile(`frame_${String(outIdx++).padStart(5, '0')}.jpg`, new Uint8Array(ab));
            };

            // Load initial frame 1
            const f1Data = await ffmpeg.readFile('in_00001.jpg');
            const img0 = await createImageBitmap(new Blob([f1Data], { type: 'image/jpeg' }));
            ctx0.clearRect(0, 0, width, height);
            ctx0.drawImage(img0, 0, 0, width, height);
            img0.close();
            try { await ffmpeg.deleteFile('in_00001.jpg'); } catch (_) {}

            for (let i = 2; i <= totalInputFrames; i++) {
                if (cancelRife) throw new Error('Cancelled by user');

                const fName = `in_${String(i).padStart(5, '0')}.jpg`;
                const fData = await ffmpeg.readFile(fName);
                const img1 = await createImageBitmap(new Blob([fData], { type: 'image/jpeg' }));
                ctx1.clearRect(0, 0, width, height);
                ctx1.drawImage(img1, 0, 0, width, height);
                img1.close();
                try { await ffmpeg.deleteFile(fName); } catch (_) {}

                for (let s = 0; s < multiplier; s++) {
                    const p = s / multiplier;
                    if (p === 0) {
                        await writeFrame(c0);
                    } else {
                        await rife.interpolate(c0, c1, p, outCanvas);
                        await writeFrame(outCanvas);
                    }
                }

                ctx0.clearRect(0, 0, width, height);
                ctx0.drawImage(c1, 0, 0);

                const pct = 40 + Math.round(((i - 1) / totalInputFrames) * 45);
                setProgress(Math.min(85, pct), `Interpolating ${outIdx}/${totalOutputFrames}...`);
                if (i % 10 === 0) {
                    log(`[RIFE] ${outIdx}/${totalOutputFrames} frames`);
                }

                // Yield to event loop to allow GC and keep UI responsive on mobile
                if (i % 2 === 0) {
                    await new Promise(r => setTimeout(r, 4));
                }
            }

            if (!cancelRife) {
                await writeFrame(c0);
            }

            log(`[RIFE] Encoding ${outIdx} frames @ ${targetFps} FPS...`);
            setProgress(88, 'Encoding output video...');

            ffmpeg.on('progress', ({ progress }) => {
                const encPct = 88 + Math.round(progress * 7);
                setProgress(Math.min(95, encPct), `Encoding video (${Math.round(progress * 100)}%)...`);
            });

            const hardwareThreads = navigator.hardwareConcurrency || 4;
            const threads = Math.min(4, hardwareThreads).toString();

            // Reconstruct video with libx264, scaling back to original dimensions if scaled for inference
            const encodeArgs = ['-y', '-framerate', String(targetFps), '-threads', threads, '-i', 'frame_%05d.jpg', '-i', inName];
            if (scale < 1) {
                encodeArgs.push('-vf', `scale=${origW}:${origH}:flags=bicubic`);
            }
            encodeArgs.push('-map', '0:v', '-map', '1:a?', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', String(targetFps), '-preset', 'ultrafast', '-shortest', 'output.mp4');

            await ffmpeg.exec(encodeArgs);
            setProgress(95, t('status_finalizing') || 'Finalizing video...');
            const data = await ffmpeg.readFile('output.mp4');

            if (!data || data.byteLength < 1024) {
                throw new Error("Video interpolation rendering failed.");
            }

            const blob = new Blob([data], { type: 'video/mp4' });
            const outName = file.name.replace(/\.[^/.]+$/, '') + `_${multiplier}x_${targetFps}fps.mp4`;

            if (activeContext) {
                setProgress(100, t('status_completed') || 'Done!');
                setButtonState('completed', t('status_process_another') || 'Process Another');
                return {
                    type: 'file',
                    data: blob,
                    filename: outName
                };
            }

            const outUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = outUrl;
            a.download = outName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(outUrl);

            setProgress(100, t('status_completed') || 'Done!');
            setButtonState('completed', t('status_process_another') || 'Process Another');

            if (window.ToolProgressManager) {
                window.ToolProgressManager.set('tool-video-interpolation', {
                    isProcessing: false,
                    completed: true,
                    percent: 100,
                    status: 'Complete',
                    file
                });
            }

            if (typeof window.showToast === 'function') {
                window.showToast(t('status_completed_toast') || 'Video interpolated successfully!');
            }

        } catch (err) {
            console.error('[Video Interpolation] Error:', err);
            log(`[Interp Error] ${err.message || err}`);
            setButtonState('error', err.message || 'Interpolation failed');
            if (window.ToolProgressManager) {
                window.ToolProgressManager.clear('tool-video-interpolation');
            }
            if (activeContext) throw err;
        } finally {
            if (rife) {
                try { rife.destroy(); } catch (_) {}
            }
            if (ffmpeg) {
                for (let f = 0; f < outIdx; f++) {
                    try { await ffmpeg.deleteFile(`frame_${String(f).padStart(5, '0')}.jpg`); } catch (_) {}
                }
                for (let f = 1; f <= totalInputFrames; f++) {
                    try { await ffmpeg.deleteFile(`in_${String(f).padStart(5, '0')}.jpg`); } catch (_) {}
                }
                if (inName) {
                    try { await ffmpeg.deleteFile(inName); } catch (_) {}
                }
                try { await ffmpeg.deleteFile('output.mp4'); } catch (_) {}
            }
            isProcessing = false;
        }
    }

    const toolDefinition = {
        id: 'tool-video-interpolation',
        _id: 'tool-video-interpolation',
        isTool: true,
        version: '1.0.3',
        title: 'Video Interpolation',
        titleKey: 'tool_interp_title',
        desc: 'FPS Upscaler',
        descKey: 'tool_interp_desc',
        dropKey: 'tool_interp_drop',
        icon: 'motion_photos_on',
        category: ['Video', 'AI', 'Tools'],
        features: [
            '2X, 4X, & 8X Motion-Compensated Frame Generation',
            'AI Optical Flow & Motion Vector Processing',
            'Ultra Smooth Playback and High-FPS Export',
            '100% Client-side Browser Execution'
        ],
        specs: [
            { label: 'MODEL', value: 'RIFE v4.7 AI' },
            { label: 'ACCELERATION', value: 'WebGPU / WASM' },
            { label: 'PROCESSING', value: '100% Local Browser' }
        ],
        schema: {
            inputs: [
                {
                    id: 'videoFile',
                    name: 'videoFile',
                    type: 'file',
                    label: 'Video File',
                    labelKey: 'tool_interp_drop',
                    accept: 'video/*',
                    required: true
                },
                {
                    id: 'multiplier',
                    name: 'multiplier',
                    type: 'segmented',
                    label: 'Multiplier',
                    labelKey: 'interp_multiplier_title',
                    default: 2,
                    options: [
                        { label: '2X', value: 2 },
                        { label: '4X', value: 4 },
                        { label: '8X', value: 8 }
                    ]
                }
            ]
        },
        run: async function(inputs, context) {
            activeContext = context;
            try {
                const videoFile = inputs.videoFile || inputs.file;
                if (!videoFile) throw new Error('Video file is required');
                multiplier = parseInt(inputs.multiplier, 10) || 2;
                originalFps = await detectFps(videoFile);
                return await processInterpolation(videoFile);
            } finally {
                activeContext = null;
            }
        },
        initModal: function(ctx) {
            const { optContainer, processLabel } = ctx;
            if (optContainer) optContainer.innerHTML = '';
            if (processLabel) processLabel.textContent = t('tool_interp_btn') || 'Interpolate Video';
            selectedFile = null;
        },
        onFileSelect: function(file) {
            selectedFile = file;
            renderWorkspace(file);
            setButtonState('processing', t('system_checking_title') || 'Checking System Compatibility...');
        },
        onProcess: function(file) {
            processInterpolation(file || selectedFile);
        },
        onReset: function() {
            cancelRife = true;
            selectedFile = null;
            isProcessing = false;
            multiplier = 2;
            const optContainer = document.getElementById('tool-dynamic-options');
            if (optContainer) optContainer.innerHTML = '';
        },
        clearCache: function(btn) {
            if (typeof window.clearAllToolCache === 'function') window.clearAllToolCache(btn);
        }
    };

    if (window.AppTools && typeof window.AppTools.register === 'function') {
        window.AppTools.register(toolDefinition);
    } else {
        window._pendingTools = window._pendingTools || [];
        window._pendingTools.push(toolDefinition);
    }

    window.VideoInterpolationTool = toolDefinition;
})();
