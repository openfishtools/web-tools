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
    let activePreset = 'cartoonist';
    let enhanceTiming = 'before';
    let normaliseSize = false;
    let isGeneratingPreview = false;
    let previewActive = false;
    let gpuEnhancer = null;
    let upscaleEngine = null;
    let currentObjectUrl = null;
    let isImageMode = false;
    let sliderPos = 50;
    let isDraggingSlider = false;
    let lastResultCanvas = null;
    let isBatchMode = false;
    let batchFiles = [];
    let batchResults = [];
    let batchDone = false;

    function cloneCanvas(src) {
        const c = document.createElement('canvas');
        c.width = src.width;
        c.height = src.height;
        c.getContext('2d').drawImage(src, 0, 0);
        return c;
    }

    function setCompletedLayout(done) {
        const controlsCard = document.getElementById('upscale-controls-card');
        if (controlsCard) controlsCard.classList.toggle('hidden', !!done);
        const actionRow = document.getElementById('upscale-action-row');
        if (actionRow && !isBatchMode) actionRow.classList.toggle('hidden', !!done);
        const logsContainer = document.getElementById('upscale-logs-container');
        if (logsContainer && done) logsContainer.classList.add('hidden');
    }

    const PRESETS = [
        { id: 'cartoonist', name: 'Cartoonist', sharpen: 14, unsharpAmount: 107, unsharpRadius: 5.1, denoise: 2.9, shadows: 2, saturation: 1 },
        { id: 'cartoonist2', name: 'Cartoonist 2', sharpen: 20, unsharpAmount: 120, unsharpRadius: 10, denoise: 2, shadows: 4, saturation: 1.3 },
        { id: 'humanDetail', name: 'Human Detail', sharpen: 100, denoise: 1.2 },
        { id: 'smoothFace', name: 'Smooth Face', sharpen: 26, unsharpRadius: 4.5 },
        { id: 'idgaf', name: 'IDGAF', sharpen: 100 },
        { id: 'none', name: 'No Filter' }
    ];

    function getPresetParams(presetId) {
        const p = PRESETS.find(x => x.id === presetId) || PRESETS[0];
        return {
            sharpen: p.sharpen || 0,
            unsharpAmount: p.unsharpAmount || 0,
            unsharpRadius: p.unsharpRadius || 0,
            denoise: p.denoise || 0,
            brightness: p.brightness || 0,
            contrast: p.contrast || 1,
            shadows: p.shadows || 0,
            hue: p.hue || 0,
            saturation: p.saturation !== undefined ? p.saturation : 1
        };
    }

    function applyCropTo916(srcCanvas) {
        const srcW = srcCanvas.naturalWidth || srcCanvas.width;
        const srcH = srcCanvas.naturalHeight || srcCanvas.height;
        if (!srcW || !srcH) return null;

        const targetAspect = 9 / 16;
        const srcAspect = srcW / srcH;
        if (Math.abs(srcAspect - targetAspect) < 0.001) return null;

        let cropW = srcW;
        let cropH = srcH;

        if (srcAspect > targetAspect) {
            cropH = srcH;
            cropW = Math.round(srcH * targetAspect);
        } else {
            cropW = srcW;
            cropH = Math.round(srcW / targetAspect);
        }

        const cropX = Math.floor((srcW - cropW) / 2);
        const cropY = Math.floor((srcH - cropH) / 2);

        const out = document.createElement('canvas');
        out.width = cropW;
        out.height = cropH;
        const ctx = out.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(srcCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
        return out;
    }

    function resizeTo1080x1920(sourceCanvas) {
        const out = document.createElement('canvas');
        out.width = 1080;
        out.height = 1920;
        const ctx = out.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(sourceCanvas, 0, 0, 1080, 1920);
        return out;
    }

    function setButtonState(state, text) {
        const processBtn = document.getElementById('tool-process-btn');
        const processLabel = document.getElementById('tool-process-label');
        if (!processBtn) return;

        if (state === 'processing') {
            processBtn.disabled = true;
            processBtn.dataset.state = 'processing';
            if (processLabel) processLabel.textContent = text || t('status_processing') || "Enhancing...";
        } else if (state === 'completed') {
            processBtn.disabled = false;
            processBtn.dataset.state = 'completed';
            if (processLabel) processLabel.textContent = text || t('status_process_another') || "Process Another";
        } else if (state === 'error') {
            processBtn.disabled = false;
            processBtn.dataset.state = 'error';
            if (processLabel) processLabel.textContent = text || t('status_error') || "Enhancement Failed";
            setTimeout(() => {
                setButtonState('ready');
            }, 3500);
        } else {
            const hasWork = !!selectedFile || (isBatchMode && batchFiles.length > 0);
            processBtn.disabled = !hasWork;
            processBtn.dataset.state = hasWork ? 'ready' : 'idle';
            if (processLabel) processLabel.textContent = text || t('tool_upscale_btn') || "Start Processing";
        }
    }

    function setProgress(percent, text) {
        const progressSec = document.getElementById('tool-progress-section');
        const progressFill = document.getElementById('tool-progress-fill');
        const progressStatus = document.getElementById('tool-progress-status');
        const progressPercent = document.getElementById('tool-progress-percent');

        if (progressSec) progressSec.classList.remove('hidden');
        if (progressFill) progressFill.style.width = percent + '%';
        if (progressPercent) progressPercent.textContent = percent + '%';
        if (progressStatus && text) progressStatus.textContent = text;

        if (window.ToolProgressManager) {
            window.ToolProgressManager.set('tool-upscale-enhancer', {
                isProcessing: percent < 100,
                percent: percent,
                status: text || `${percent}%`,
                file: selectedFile
            });
        }
    }

    function updateSliderVisuals() {
        const canvasClip = document.getElementById('upscale-canvas-clip');
        const sliderLine = document.getElementById('upscale-slider-line');
        if (canvasClip) {
            canvasClip.style.clipPath = `polygon(${sliderPos}% 0, 100% 0, 100% 100%, ${sliderPos}% 100%)`;
        }
        if (sliderLine) {
            sliderLine.style.left = `${sliderPos}%`;
        }
    }

    function drawOriginalPreview() {
        const canvas = document.getElementById('upscale-preview-canvas');
        const video = document.getElementById('upscale-preview-video');
        const image = document.getElementById('upscale-preview-image');
        if (!canvas) return;
        const source = isImageMode ? image : video;
        if (!source) return;
        const w = source.naturalWidth || source.videoWidth || source.width || 0;
        const h = source.naturalHeight || source.videoHeight || source.height || 0;
        if (!w || !h) return;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(source, 0, 0);
    }

    function log(msg) {
        const logsEl = document.getElementById('upscale-logs');
        if (logsEl) {
            logsEl.textContent += (logsEl.textContent ? '\n' : '') + msg;
            logsEl.scrollTop = logsEl.scrollHeight;
        }
    }

    function showLogs() {
        const container = document.getElementById('upscale-logs-container');
        if (container) container.classList.remove('hidden');
    }

    async function checkUpscaleSystemCompatibility() {
        const checkingScreen = document.getElementById('upscale-checking-screen');
        const engineDot = document.getElementById('upscale-engine-dot');
        const engineStatus = document.getElementById('upscale-engine-status');
        const gpuDot = document.getElementById('upscale-gpu-dot');
        const gpuStatus = document.getElementById('upscale-gpu-status');
        const ffmpegDot = document.getElementById('upscale-ffmpeg-dot');
        const ffmpegStatus = document.getElementById('upscale-ffmpeg-status');
        const mainContent = document.getElementById('upscale-main-content');
        const processBtn = document.getElementById('tool-process-btn');
        if (processBtn) { processBtn.disabled = true; processBtn.dataset.state = 'processing'; }

        if (checkingScreen) checkingScreen.classList.remove('hidden');
        if (mainContent) mainContent.classList.add('hidden');

        if (engineDot) { engineDot.textContent = 'sync'; engineDot.style.color = 'var(--md-sys-color-primary)'; engineDot.classList.add('upscale-spinner'); }
        if (engineStatus) engineStatus.textContent = t('upscale_checking_ai') || 'AI Engine: Checking...';
        if (gpuDot) { gpuDot.textContent = 'sync'; gpuDot.style.color = 'var(--md-sys-color-primary)'; gpuDot.classList.add('upscale-spinner'); }
        if (gpuStatus) gpuStatus.textContent = t('upscale_checking_gpu') || 'GPU Canvas: Checking...';
        if (ffmpegDot) { ffmpegDot.textContent = 'sync'; ffmpegDot.style.color = 'var(--md-sys-color-primary)'; ffmpegDot.classList.add('upscale-spinner'); }
        if (ffmpegStatus) ffmpegStatus.textContent = isImageMode ? 'FFmpeg WASM: Not needed for images' : (t('upscale_checking_ffmpeg') || 'FFmpeg WASM: Checking...');

        if (!isImageMode && typeof window.loadFFmpegLibraries === 'function') {
            window.loadFFmpegLibraries().catch(()=>{});
        }

        let attempts = 0;
        const interval = setInterval(() => {
            attempts++;
            const engineReady = !!(getUpscaleEngine && getUpscaleEngine() && getUpscaleEngine().ready);
            if (engineDot) {
                if (engineReady) { engineDot.textContent = 'check_circle'; engineDot.style.color = '#4CAF50'; engineDot.classList.remove('upscale-spinner'); if (engineStatus) engineStatus.textContent = t('upscale_ready_ai') || 'AI Engine: Ready'; }
                else if (attempts > 8) { engineDot.textContent = 'cancel'; engineDot.style.color = '#F44336'; engineDot.classList.remove('upscale-spinner'); if (engineStatus) engineStatus.textContent = t('upscale_failed_ai') || 'AI Engine: Unavailable'; }
            }
            const gpuReady = !!(window.UpscaleGpuEnhancer);
            if (gpuDot) {
                if (gpuReady) { gpuDot.textContent = 'check_circle'; gpuDot.style.color = '#4CAF50'; gpuDot.classList.remove('upscale-spinner'); if (gpuStatus) gpuStatus.textContent = t('upscale_ready_gpu') || 'GPU Canvas: Ready'; }
                else if (attempts > 8) { gpuDot.textContent = 'cancel'; gpuDot.style.color = '#F44336'; gpuDot.classList.remove('upscale-spinner'); if (gpuStatus) gpuStatus.textContent = t('upscale_failed_gpu') || 'GPU Canvas: Unavailable'; }
            }
            const ffmpegReady = isImageMode ? true : !!(window.FFmpegWASM && window.FFmpegUtil);
            if (ffmpegDot) {
                if (ffmpegReady) { ffmpegDot.textContent = 'check_circle'; ffmpegDot.style.color = '#4CAF50'; ffmpegDot.classList.remove('upscale-spinner'); if (ffmpegStatus) ffmpegStatus.textContent = isImageMode ? 'FFmpeg WASM: Not needed for images' : (t('upscale_ready_ffmpeg') || 'FFmpeg WASM: Ready'); }
                else if (attempts > 12) { ffmpegDot.textContent = 'check_circle'; ffmpegDot.style.color = '#4CAF50'; ffmpegDot.classList.remove('upscale-spinner'); if (ffmpegStatus) ffmpegStatus.textContent = 'FFmpeg WASM: Will Load on Process'; }
            }
            const allReady = engineReady && gpuReady && ffmpegReady;
            if (allReady || attempts > 12) {
                clearInterval(interval);
                const actuallyReady = engineReady && gpuReady;
                if (!actuallyReady) {
                    setTimeout(() => {
                        const closeBtn = document.getElementById('tool-modal-close-btn');
                        if (closeBtn) closeBtn.click();
                        else {
                            const backdrop = document.getElementById('tool-modal-backdrop');
                            if (backdrop) backdrop.click();
                        }
                    }, 3000);
                    return;
                }
                setTimeout(() => {
                    if (checkingScreen) checkingScreen.classList.add('hidden');
                    if (mainContent) mainContent.classList.remove('hidden');
                    const pb = document.getElementById('tool-process-btn');
                    if (pb) { pb.disabled = false; pb.dataset.state = 'ready'; const pl = document.getElementById('tool-process-label'); if (pl) pl.textContent = t('tool_upscale_btn') || 'Start Processing'; }
                    updateSliderVisuals();
                    if (typeof window.updateOpenModalsLayout === 'function') window.updateOpenModalsLayout(true);
                }, 700);
            }
        }, 400);
    }

    function resetResultDisplay() {
        previewActive = false;
        const unprocOverlay = document.getElementById('upscale-unprocessed-overlay');
        if (unprocOverlay) unprocOverlay.classList.add('show');
        const enhVid = document.getElementById('upscale-enhanced-video');
        if (enhVid) {
            enhVid.pause();
            enhVid.classList.add('hidden');
        }
        const prevCanvas = document.getElementById('upscale-preview-canvas');
        if (prevCanvas) prevCanvas.classList.remove('hidden');
        if (enhancedVideoUrl) {
            URL.revokeObjectURL(enhancedVideoUrl);
            enhancedVideoUrl = null;
        }
        lastResultBlob = null;
        lastResultCanvas = null;
        const labelRight = document.getElementById('upscale-slider-label-right');
        if (labelRight) {
            labelRight.textContent = t('upscale_label_original') || 'Original';
            labelRight.setAttribute('data-i18n', 'upscale_label_original');
        }
    }

    function clearPreview() {
        resetResultDisplay();
        const origFrame = document.getElementById('upscale-original-frame');
        if (origFrame) origFrame.classList.add('hidden');
        const vid = document.getElementById('upscale-preview-video');
        const imgEl = document.getElementById('upscale-preview-image');
        if (vid && !isImageMode) {
            vid.classList.remove('hidden');
        }
        if (imgEl && isImageMode) imgEl.classList.remove('hidden');
    }

    function applyGpuFilter(source, targetCanvas) {
        const w = source.naturalWidth || source.videoWidth || source.width || 0;
        const h = source.naturalHeight || source.videoHeight || source.height || 0;
        if (!w || !h) return;
        if (!gpuEnhancer && window.UpscaleGpuEnhancer) {
            try { gpuEnhancer = new window.UpscaleGpuEnhancer(); } catch (e) {}
        }
        const params = getPresetParams(activePreset);
        if (gpuEnhancer) {
            gpuEnhancer.process(source, params, targetCanvas);
        } else {
            targetCanvas.width = w;
            targetCanvas.height = h;
            const ctx = targetCanvas.getContext('2d');
            ctx.drawImage(source, 0, 0);
        }
    }

    const UPSCALE_FACTOR = 4;

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
                try {
                    await loadScript('https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/umd/index.js');
                } catch (e) {
                    await loadScript('https://unpkg.com/@ffmpeg/util@0.12.1/dist/umd/index.js');
                }
            }
            if (!window.FFmpegWASM) {
                try {
                    await loadScript('https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/umd/ffmpeg.js');
                } catch (e) {
                    await loadScript('https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/umd/ffmpeg.js');
                }
            }
        } catch (err) {
            console.error('[Qualitelio Enhancer] Error loading FFmpeg libraries:', err);
        }
        return !!(window.FFmpegWASM && window.FFmpegUtil);
    }

    async function getFFmpegInstance() {
        const ready = await loadFFmpegLibraries();
        if (!ready || !window.FFmpegWASM || !window.FFmpegUtil) {
            throw new Error("FFmpeg library failed to load. Check your connection and try again.");
        }

        const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Tablet/i.test(navigator.userAgent) ||
                           (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        const isMultiThread = !isMobileDevice && typeof SharedArrayBuffer !== 'undefined' && window.crossOriginIsolated === true;

        return await window.CutefishFFmpegLoader.getFFmpegInstance({
            isMultiThread,
            log: (msg) => console.log(msg)
        });
    }

    function triggerDownload(blob, filename) {
        const outUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = outUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(outUrl), 3000);
    }

    let enhancedVideoUrl = null;
    let lastResultBlob = null;

    function bindSyncVideos(a, b) {
        if (!a || !b || a._syncBoundWith === b) return;
        a._syncBoundWith = b;
        b._syncBoundWith = a;
        const sync = (from, to) => {
            if (from._syncLock || Math.abs(from.currentTime - to.currentTime) <= 0.18) return;
            from._syncLock = true;
            try { to.currentTime = from.currentTime; } catch (e) {}
            setTimeout(() => { from._syncLock = false; }, 120);
            if (!from.paused && to.paused) to.play().catch(() => {});
        };
        a.addEventListener('timeupdate', () => sync(a, b));
        b.addEventListener('timeupdate', () => sync(b, a));
    }

    function showEnhancedVideoInPreview(blob) {
        return new Promise((resolve) => {
            const ev = document.getElementById('upscale-enhanced-video');
            const canvas = document.getElementById('upscale-preview-canvas');
            const overlayEl = document.getElementById('upscale-unprocessed-overlay');
            const labelRight = document.getElementById('upscale-slider-label-right');
            const origVid = document.getElementById('upscale-preview-video');
            const origImg = document.getElementById('upscale-preview-image');
            const origFrameCanvas = document.getElementById('upscale-original-frame');
            if (!ev || !blob) { resolve(false); return; }

            if (enhancedVideoUrl) URL.revokeObjectURL(enhancedVideoUrl);
            enhancedVideoUrl = URL.createObjectURL(blob);
            lastResultBlob = blob;
            ev.src = enhancedVideoUrl;
            ev.classList.remove('hidden');
            if (canvas) canvas.classList.add('hidden');

            if (overlayEl) overlayEl.classList.remove('show');
            if (labelRight) {
                labelRight.textContent = t('upscale_label_enhanced_ai') || 'Enhanced';
                labelRight.setAttribute('data-i18n', 'upscale_label_enhanced_ai');
            }

            if (origFrameCanvas) origFrameCanvas.classList.add('hidden');
            if (!isImageMode && origVid) {
                origVid.classList.remove('hidden');
                origVid.pause();
                bindSyncVideos(origVid, ev);
                const startSynced = () => {
                    try { ev.currentTime = origVid.currentTime || 0; } catch (e) {}
                    ev.play().catch(() => {});
                };
                if (ev.readyState >= 1) startSynced();
                else ev.addEventListener('loadedmetadata', startSynced, { once: true });
            } else if (isImageMode && origImg) {
                origImg.classList.remove('hidden');
                ev.pause();
            }
            previewActive = true;
            resolve(true);
        });
    }

    function probeVideoDuration(file) {
        return new Promise((resolve) => {
            const v = document.createElement('video');
            v.preload = 'metadata';
            const u = URL.createObjectURL(file);
            v.onloadedmetadata = () => { URL.revokeObjectURL(u); resolve(isFinite(v.duration) ? v.duration : 0); };
            v.onerror = () => { URL.revokeObjectURL(u); resolve(0); };
            v.src = u;
        });
    }

    function loadImageEl(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('Failed to decode frame.'));
            img.src = url;
        });
    }

    async function runAiVideoPipeline(ffmpeg, inName, srcFile, onProgress) {
        const engine = getUpscaleEngine();
        if (!engine) throw new Error('AI engine unavailable.');
        if (!gpuEnhancer && window.UpscaleGpuEnhancer) {
            try { gpuEnhancer = new window.UpscaleGpuEnhancer(); } catch (e) {}
        }
        const params = getPresetParams(activePreset);

        let detectedFps = 0;
        const onLog = ({ message }) => {
            const m = message.match(/(\d+(?:\.\d+)?) fps/);
            if (m) detectedFps = parseFloat(m[1]);
        };
        ffmpeg.on('log', onLog);

        onProgress(0.02);
        log('[AI-Video] Extracting frames via FFmpeg...');
        await ffmpeg.createDir('frames');
        await ffmpeg.exec(['-i', inName, '-vsync', '0', '-qscale:v', '2', 'frames/f_%06d.jpg']);
        const files = (await ffmpeg.LS('frames')).filter(f => f.endsWith('.jpg')).sort();
        const total = files.length;
        if (!total) throw new Error('No frames extracted.');

        let fps = detectedFps;
        if (!fps) {
            const dur = await probeVideoDuration(srcFile);
            fps = dur > 0 ? total / dur : 30;
        }
        fps = Math.min(Math.max(fps, 1), 60);

        const MAX_FRAMES = 600;
        let step = 1;
        if (total > MAX_FRAMES) {
            step = Math.ceil(total / MAX_FRAMES);
            log(`[AI-Video] ${total} frames detected -> sampling every ${step} (cap ${MAX_FRAMES}).`);
        }
        const selected = files.filter((_, i) => i % step === 0);
        log(`[AI-Video] Upscaling ${selected.length}/${total} frames @ ${(fps / step).toFixed(2)} fps | Preset: ${activePreset} | Order: ${enhanceTiming === 'before' ? 'Filter > Upscale' : 'Upscale > Filter'}${normaliseSize ? ' | Normalise ON' : ''}`);

        await ffmpeg.createDir('up');
        for (let i = 0; i < selected.length; i++) {
            const fdata = await ffmpeg.readFile('frames/' + selected[i]);
            const fblob = new Blob([fdata], { type: 'image/jpeg' });
            const furl = URL.createObjectURL(fblob);
            try {
                const img = await loadImageEl(furl);
                let work = img;
                if (normaliseSize) {
                    const c = applyCropTo916(img);
                    if (c) work = c;
                }

                let out;
                if (enhanceTiming === 'before') {
                    const filtered = document.createElement('canvas');
                    filtered.width = work.naturalWidth || work.width;
                    filtered.height = work.naturalHeight || work.height;
                    if (gpuEnhancer) gpuEnhancer.process(work, params, filtered);
                    else filtered.getContext('2d').drawImage(work, 0, 0);
                    out = document.createElement('canvas');
                    await engine.renderFrame(filtered, out, null);
                } else {
                    const upscaled = document.createElement('canvas');
                    await engine.renderFrame(work, upscaled, null);
                    out = document.createElement('canvas');
                    out.width = upscaled.width;
                    out.height = upscaled.height;
                    if (gpuEnhancer) gpuEnhancer.process(upscaled, params, out);
                    else out.getContext('2d').drawImage(upscaled, 0, 0);
                }
                if (normaliseSize) out = resizeTo1080x1920(out);

                const oblob = await new Promise(r => out.toBlob(r, 'image/jpeg', 0.92));
                const obuf = new Uint8Array(await oblob.arrayBuffer());
                await ffmpeg.writeFile(`up/o_${String(i + 1).padStart(6, '0')}.jpg`, obuf);
            } finally {
                URL.revokeObjectURL(furl);
                try { await ffmpeg.deleteFile('frames/' + selected[i]); } catch (e) {}
            }
            onProgress((i + 1) / selected.length);
        }

        log('[AI-Video] Reassembling MP4 with audio...');
        const outFps = (fps / step).toFixed(3);
        await ffmpeg.exec([
            '-y',
            '-framerate', outFps,
            '-i', 'up/o_%06d.jpg',
            '-i', inName,
            '-map', '0:v:0',
            '-map', '1:a:0?',
            '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-b:a', '192k',
            '-shortest',
            'enhanced.mp4'
        ]);
        if (typeof ffmpeg.off === 'function') ffmpeg.off('log', onLog);
    }

    class UpscaleEngine {
        constructor() {
            this.ready = false;
            this.worker = null;
            this.activeRequest = null;
            this.lastW = 0;
            this.lastH = 0;
        }

        init() {
            if (this.ready) return true;
            try {
                this.worker = new Worker('assets/upscale/upscaleWorker.js?v=4');
                this.worker.addEventListener('message', (e) => {
                    const { progress, done, output, alertmsg, info } = e.data;
                    if (info && this.infoHandler) this.infoHandler(info);
                    if (progress !== undefined && this.activeRequest && this.activeRequest.onProgress) {
                        this.activeRequest.onProgress(progress, info);
                    }
                    if (alertmsg && this.activeRequest) {
                        const req = this.activeRequest;
                        this.activeRequest = null;
                        req.reject(new Error(alertmsg));
                    }
                    if (done && output && this.activeRequest) {
                        const w = this.lastW * UPSCALE_FACTOR;
                        const h = this.lastH * UPSCALE_FACTOR;
                        const canvas = this.activeRequest.target;
                        canvas.width = w;
                        canvas.height = h;
                        const ctx = canvas.getContext('2d');
                        const imgData = ctx.createImageData(w, h);
                        imgData.data.set(new Uint8ClampedArray(output));
                        ctx.putImageData(imgData, 0, 0);
                        const req = this.activeRequest;
                        this.activeRequest = null;
                        req.resolve();
                    }
                });
                this.worker.addEventListener('error', (e) => {
                    if (this.activeRequest) {
                        const req = this.activeRequest;
                        this.activeRequest = null;
                        req.reject(new Error(e.message || 'Worker error'));
                    }
                });
                this.ready = true;
                return true;
            } catch (err) {
                console.warn('[Qualitelio Enhancer] AI worker init failed:', err);
                return false;
            }
        }

        renderFrame(source, target, onProgress) {
            return new Promise((resolve, reject) => {
                const w = source.naturalWidth || source.videoWidth || source.width || 0;
                const h = source.naturalHeight || source.videoHeight || source.height || 0;
                if (!w || !h) { reject(new Error('Source dimensions are 0.')); return; }

                const off = document.createElement('canvas');
                off.width = w;
                off.height = h;
                const ctx = off.getContext('2d', { willReadFrequently: true });
                ctx.drawImage(source, 0, 0);
                const imgData = ctx.getImageData(0, 0, w, h);

                if (this.activeRequest) {
                    this.activeRequest.reject(new Error('Cancelled by newer request.'));
                }

                this.lastW = w;
                this.lastH = h;
                this.activeRequest = { resolve, reject, onProgress, target };
                this.worker.postMessage({
                    input: imgData.data.buffer,
                    width: w,
                    height: h,
                    factor: UPSCALE_FACTOR,
                    tile_size: 128,
                    min_lap: 16,
                    model_type: 'realesrgan',
                    model: 'anime_fast',
                    backend: 'webgl',
                    hasAlpha: false
                }, [imgData.data.buffer]);
            });
        }
    }

    function getUpscaleEngine() {
        if (!upscaleEngine) upscaleEngine = new UpscaleEngine();
        if (!upscaleEngine.ready) upscaleEngine.init();
        return upscaleEngine.ready ? upscaleEngine : null;
    }

    async function generatePreview() {
        if (isGeneratingPreview || !selectedFile) return;
        isGeneratingPreview = true;
        previewActive = false;

        const previewBtn = document.getElementById('upscale-preview-toggle');
        const previewBtnText = previewBtn ? previewBtn.querySelector('.preview-btn-text') : null;
        const previewBtnIcon = previewBtn ? previewBtn.querySelector('.material-symbols-rounded') : null;

        const controls = document.querySelectorAll('#upscale-workspace-inner button, #upscale-workspace-inner input');
        controls.forEach(el => { el.disabled = true; });

        setButtonState('processing', t('status_processing') || 'Generating preview...');

        if (previewBtnText) previewBtnText.textContent = t('upscale_preview_generating') || 'Generating Preview...';
        if (previewBtnIcon) {
            previewBtnIcon.textContent = 'sync';
            previewBtnIcon.style.animation = 'spin 1s linear infinite';
        }

        showLogs();
        log(`[Preview] Source: ${selectedFile.name}`);
        log(`[Preview] Preset: ${activePreset} | Order: ${enhanceTiming === 'before' ? 'Filter > Upscale' : 'Upscale > Filter'}`);

        const startTime = performance.now();

        try {
            let frameSource;
            if (isImageMode) {
                frameSource = document.getElementById('upscale-preview-image');
            } else {
                const vid = document.getElementById('upscale-preview-video');
                vid.pause();
                if (vid.readyState < 2) {
                    await new Promise(resolve => {
                        const check = () => {
                            if (vid.readyState >= 2) resolve();
                            else setTimeout(check, 50);
                        };
                        check();
                    });
                }
                const durSlider = document.getElementById('upscale-duration-slider');
                if (durSlider && !durSlider.disabled) {
                    const wantT = parseFloat(durSlider.value) || 0;
                    if (Math.abs((vid.currentTime || 0) - wantT) > 0.03) {
                        await new Promise(resolve => {
                            const done = () => resolve();
                            vid.addEventListener('seeked', done, { once: true });
                            try { vid.currentTime = wantT; } catch (e) { done(); }
                            setTimeout(done, 2000);
                        });
                    }
                }
                frameSource = document.createElement('canvas');
                frameSource.width = vid.videoWidth;
                frameSource.height = vid.videoHeight;
                frameSource.getContext('2d').drawImage(vid, 0, 0);
                log(`[Preview] Frame captured @ ${vid.currentTime.toFixed(2)}s (${frameSource.width}x${frameSource.height})`);
            }
            if (!frameSource) throw new Error('No media source');

            const srcW = frameSource.naturalWidth || frameSource.width;
            const srcH = frameSource.naturalHeight || frameSource.height;

            if (normaliseSize) {
                const cropped = applyCropTo916(frameSource);
                if (cropped) {
                    log(`[Preview] Normalise ON: center-crop ${srcW}x${srcH} to 9:16 (native pixels, centered)...`);
                    frameSource = cropped;
                    log(`[Preview] Cropped source: ${frameSource.width}x${frameSource.height} (full height preserved)`);
                } else {
                    log(`[Preview] Normalise ON: source ${srcW}x${srcH} already 9:16, no crop needed.`);
                }
            }

            const origFrameCanvas = document.getElementById('upscale-original-frame');
            const origVidEl = document.getElementById('upscale-preview-video');
            const origImgEl = document.getElementById('upscale-preview-image');
            if (normaliseSize && origFrameCanvas) {
                origFrameCanvas.width = frameSource.width;
                origFrameCanvas.height = frameSource.height;
                origFrameCanvas.getContext('2d').drawImage(frameSource, 0, 0);
                origFrameCanvas.classList.remove('hidden');
                if (origVidEl) origVidEl.classList.add('hidden');
                if (origImgEl) origImgEl.classList.add('hidden');
                log('[Preview] Left side aligned to the same 9:16 region for accurate comparison.');
            }

            const canvas = document.getElementById('upscale-preview-canvas');
            if (!canvas) throw new Error('Preview canvas not found');

            canvas.width = frameSource.width;
            canvas.height = frameSource.height;
            canvas.getContext('2d').drawImage(frameSource, 0, 0);

            const engine = getUpscaleEngine();
            if (!engine) {
                log('[Preview] AI Engine unavailable, falling back to filter-only.');
            } else {
                log(`[Preview] AI Engine: Real-ESRGAN x${UPSCALE_FACTOR} (anime_fast, webgl) ready.`);
            }

            const onAiProgress = (p) => {
                const normalized = Math.min(1, Math.max(0, (p || 0) / 100));
                const pct = 40 + Math.round(normalized * 50);
                setProgress(pct, t('status_processing') || 'AI upscaling...');
            };

            if (enhanceTiming === 'before') {
                log('[Preview] Step 1/2: Applying GPU filter...');
                const filtered = document.createElement('canvas');
                applyGpuFilter(frameSource, filtered);
                log(`[Preview] Filtered: ${filtered.width}x${filtered.height}`);

                if (engine) {
                    setProgress(40, t('status_processing') || 'AI upscaling...');
                    log(`[Preview] Step 2/2: AI upscale x${UPSCALE_FACTOR}...`);
                    await engine.renderFrame(filtered, canvas, onAiProgress);
                } else {
                    canvas.width = filtered.width;
                    canvas.height = filtered.height;
                    canvas.getContext('2d').drawImage(filtered, 0, 0);
                }
            } else {
                let upscaled = frameSource;
                if (engine) {
                    setProgress(30, t('status_processing') || 'AI upscaling...');
                    log(`[Preview] Step 1/2: AI upscale x${UPSCALE_FACTOR}...`);
                    upscaled = document.createElement('canvas');
                    await engine.renderFrame(frameSource, upscaled, onAiProgress);
                    log(`[Preview] Upscaled: ${upscaled.width}x${upscaled.height}`);
                }

                setProgress(85, t('status_processing') || 'Applying filter...');
                log('[Preview] Step 2/2: Applying GPU filter on upscaled frame...');
                applyGpuFilter(upscaled, canvas);
            }

            if (normaliseSize) {
                setProgress(92, t('upscale_norm_output') || 'Normalising output to 1080x1920...');
                const norm = resizeTo1080x1920(canvas);
                canvas.width = 1080;
                canvas.height = 1920;
                canvas.getContext('2d').drawImage(norm, 0, 0);
                log('[Preview] Normalised output: 1080x1920 (9:16)');
            }

            setProgress(100, t('status_completed') || 'Done!');

            previewActive = true;
            lastResultCanvas = cloneCanvas(canvas);

            const doneOverlay = document.getElementById('upscale-unprocessed-overlay');
            if (doneOverlay) doneOverlay.classList.remove('show');

            const labelRight = document.getElementById('upscale-slider-label-right');
            if (labelRight) {
                labelRight.textContent = t('upscale_label_enhanced_ai') || 'Enhanced';
                labelRight.setAttribute('data-i18n', 'upscale_label_enhanced_ai');
            }

            const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
            log(`[Preview] Done in ${elapsed}s. Output: ${canvas.width}x${canvas.height} (${(canvas.width / srcW).toFixed(1)}x from ${srcW}x${srcH})`);

            if (typeof window.showToast === 'function') {
                window.showToast(t('upscale_preview_done') || 'Preview ready!');
            }

        } catch (err) {
            console.error('[Qualitelio Enhancer] Preview error:', err);
            clearPreview();
            drawOriginalPreview();
            log(`[Preview Error] ${err.message}`);
            if (typeof window.showToast === 'function') {
                window.showToast(t('upscale_preview_failed') || 'Preview failed');
            }
        } finally {
            isGeneratingPreview = false;

            if (window.ToolProgressManager) {
                window.ToolProgressManager.clear('tool-upscale-enhancer');
            }
            const progressSec = document.getElementById('tool-progress-section');
            if (progressSec) progressSec.classList.add('hidden');

            controls.forEach(el => { el.disabled = false; });
            setButtonState('ready', t('tool_upscale_btn') || 'Start Processing');

            if (previewBtnText) previewBtnText.textContent = t('btn_preview') || 'Preview';
            if (previewBtnIcon) {
                previewBtnIcon.textContent = 'visibility';
                previewBtnIcon.style.animation = '';
            }
        }
    }

    let zoom = 1;
    let pan = { x: 0, y: 0 };
    let isPanning = false;
    let panStart = { x: 0, y: 0 };
    let panOrigin = { x: 0, y: 0 };
    let isPinching = false;
    let pinchStartDist = 0;
    let pinchStartZoom = 1;

    function applyTransform() {
        const layers = document.querySelectorAll('#upscale-comparison-container .upscale-transform-layer');
        const transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
        layers.forEach(el => { el.style.transform = transform; });
    }

    function clampPan() {
        const container = document.getElementById('upscale-comparison-container');
        if (!container) return;
        const maxX = container.offsetWidth * (zoom - 1) / 2;
        const maxY = container.offsetHeight * (zoom - 1) / 2;
        pan.x = Math.max(-maxX, Math.min(maxX, pan.x));
        pan.y = Math.max(-maxY, Math.min(maxY, pan.y));
    }

    function setupSliderEvents(container) {
        if (!container) return;

        const updateCursor = () => {
            container.style.cursor = zoom > 1 ? (isPanning ? 'grabbing' : 'grab') : 'col-resize';
        };

        const onSliderMove = (clientX) => {
            const rect = container.getBoundingClientRect();
            if (rect.width <= 0) return;
            sliderPos = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
            updateSliderVisuals();
        };

        const isNearSlider = (clientX) => {
            const rect = container.getBoundingClientRect();
            if (rect.width <= 0) return false;
            const sliderX = rect.left + (sliderPos / 100) * rect.width;
            return Math.abs(clientX - sliderX) < 30;
        };

        container.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;

            if (zoom === 1 || isNearSlider(e.clientX)) {
                isDraggingSlider = true;
                onSliderMove(e.clientX);
                const onMove = (ev) => {
                    if (!isDraggingSlider) return;
                    onSliderMove(ev.clientX);
                };
                const onUp = () => {
                    isDraggingSlider = false;
                    window.removeEventListener('pointermove', onMove);
                    window.removeEventListener('pointerup', onUp);
                };
                window.addEventListener('pointermove', onMove);
                window.addEventListener('pointerup', onUp);
            } else if (zoom > 1) {
                isPanning = true;
                panStart = { x: e.clientX, y: e.clientY };
                panOrigin = { ...pan };
                updateCursor();
                const onMove = (ev) => {
                    if (!isPanning) return;
                    pan.x = panOrigin.x + (ev.clientX - panStart.x);
                    pan.y = panOrigin.y + (ev.clientY - panStart.y);
                    clampPan();
                    applyTransform();
                };
                const onUp = () => {
                    isPanning = false;
                    updateCursor();
                    window.removeEventListener('pointermove', onMove);
                    window.removeEventListener('pointerup', onUp);
                };
                window.addEventListener('pointermove', onMove);
                window.addEventListener('pointerup', onUp);
            }
        });

        container.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            zoom = Math.max(1, Math.min(5, zoom * delta));
            if (zoom <= 1) { zoom = 1; pan = { x: 0, y: 0 }; }
            clampPan();
            applyTransform();
            updateCursor();
            updateZoomBadge();
        }, { passive: false });

        container.addEventListener('touchstart', (e) => {
            if (e.touches.length === 2) {
                isPinching = true;
                isDraggingSlider = false;
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                pinchStartDist = Math.hypot(dx, dy);
                pinchStartZoom = zoom;
            } else if (e.touches.length === 1) {
                const tx = e.touches[0].clientX;
                if (zoom === 1 || isNearSlider(tx)) {
                    isDraggingSlider = true;
                    onSliderMove(tx);
                } else {
                    isPanning = true;
                    panStart = { x: tx, y: e.touches[0].clientY };
                    panOrigin = { ...pan };
                }
            }
        }, { passive: true });

        container.addEventListener('touchmove', (e) => {
            if (e.touches.length === 2 && isPinching) {
                e.preventDefault();
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                const dist = Math.hypot(dx, dy);
                zoom = Math.max(1, Math.min(5, pinchStartZoom * (dist / pinchStartDist)));
                if (zoom <= 1) { zoom = 1; pan = { x: 0, y: 0 }; }
                clampPan();
                applyTransform();
                updateZoomBadge();
            } else if (e.touches.length === 1) {
                if (isPanning) {
                    pan.x = panOrigin.x + (e.touches[0].clientX - panStart.x);
                    pan.y = panOrigin.y + (e.touches[0].clientY - panStart.y);
                    clampPan();
                    applyTransform();
                } else if (isDraggingSlider) {
                    e.preventDefault();
                    onSliderMove(e.touches[0].clientX);
                }
            }
        }, { passive: false });

        container.addEventListener('touchend', () => {
            isPinching = false;
            isPanning = false;
            isDraggingSlider = false;
            updateCursor();
        });
    }

    function updateZoomBadge() {
        const badge = document.getElementById('upscale-zoom-badge');
        if (badge) {
            if (zoom > 1) {
                badge.textContent = `${zoom.toFixed(1)}x`;
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        }
    }


    function controlsCardHtml() {
        return `
                <div class="upscale-controls-card" id="upscale-controls-card">
                    <p class="upscale-controls-title" data-i18n="upscale_preset_title">${t('upscale_preset_title') || 'Enhancement Preset'}</p>
                    <div class="upscale-preset-list" id="upscale-preset-list">
                        ${PRESETS.map(p => `
                            <button type="button" class="upscale-preset-btn ${p.id === activePreset ? 'active' : ''}" data-preset="${p.id}">
                                <span class="material-symbols-rounded">auto_awesome</span>
                                <span>${p.name}</span>
                            </button>
                        `).join('')}
                    </div>

                    <p class="upscale-controls-title upscale-title-spaced" data-i18n="upscale_timing_title">${t('upscale_timing_title') || 'Enhance Timing'}</p>
                    <div class="upscale-order-toggle tiktok-switch-track" id="upscale-timing-toggle" data-selected="${enhanceTiming}">
                        <div class="tiktok-switch-indicator"></div>
                        <button type="button" class="upscale-order-btn tiktok-switch-option ${enhanceTiming === 'before' ? 'active' : ''}" data-order="before" data-i18n="upscale_timing_before">${t('upscale_timing_before') || 'Before Upscale'}</button>
                        <button type="button" class="upscale-order-btn tiktok-switch-option ${enhanceTiming === 'after' ? 'active' : ''}" data-order="after" data-i18n="upscale_timing_after">${t('upscale_timing_after') || 'After Upscale'}</button>
                    </div>

                    <p class="upscale-controls-title upscale-title-spaced" data-i18n="upscale_output_title">${t('upscale_output_title') || 'Output'}</p>
                    <div class="upscale-normalise-row">
                        <div class="upscale-normalise-text">
                            <div class="upscale-normalise-title" data-i18n="upscale_normalise_title">${t('upscale_normalise_title') || 'Normalise Size'}</div>
                            <div class="upscale-normalise-desc" data-i18n="upscale_normalise_desc">${t('upscale_normalise_desc') || 'Crop center to 1080×1920 · Save as JPG'}</div>
                        </div>
                        <label class="normalise-switch-wrap" for="upscale-normalise-toggle">
                            <input type="checkbox" id="upscale-normalise-toggle" ${normaliseSize ? 'checked' : ''}>
                            <span class="normalise-track"></span>
                            <span class="normalise-thumb"></span>
                        </label>
                    </div>
                </div>`;
    }

    function logsHtml() {
        return `
                <div class="process-logs-wrap" id="upscale-logs-container">
                    <div class="process-logs-header">
                        <span class="process-logs-title">${t('upscale_logs_title') || 'Process Logs'}</span>
                        <button type="button" class="btn-copy-logs" id="btn-copy-upscale-logs">
                            <span class="material-symbols-rounded">content_copy</span>
                            <span>${t('res_modal_copy') || 'Copy'}</span>
                        </button>
                    </div>
                    <pre class="process-logs-pre" id="upscale-logs"></pre>
                </div>`;
    }

    function wireCommonControls() {
        const copyLogsBtn = document.getElementById('btn-copy-upscale-logs');
        if (copyLogsBtn) {
            copyLogsBtn.addEventListener('click', () => {
                const logsEl = document.getElementById('upscale-logs');
                if (logsEl && logsEl.textContent) {
                    navigator.clipboard.writeText(logsEl.textContent);
                    if (typeof window.showToast === 'function') {
                        window.showToast(t('btn_copied') || 'Copied!');
                    }
                }
            });
        }

        const presetList = document.getElementById('upscale-preset-list');
        if (presetList) {
            presetList.querySelectorAll('.upscale-preset-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    presetList.querySelectorAll('.upscale-preset-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    activePreset = btn.getAttribute('data-preset') || 'cartoonist';
                    if (!isBatchMode) clearPreview();
                });
            });
        }

        const timingToggle = document.getElementById('upscale-timing-toggle');
        if (timingToggle) {
            timingToggle.querySelectorAll('.upscale-order-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    timingToggle.querySelectorAll('.upscale-order-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    enhanceTiming = btn.getAttribute('data-order') || 'before';
                    timingToggle.setAttribute('data-selected', enhanceTiming);
                    if (!isBatchMode) clearPreview();
                });
            });
        }

        const normaliseToggle = document.getElementById('upscale-normalise-toggle');
        if (normaliseToggle) {
            normaliseToggle.addEventListener('change', () => {
                normaliseSize = normaliseToggle.checked;
                if (!isBatchMode) {
                    clearPreview();
                    drawOriginalPreview();
                }
            });
        }

        if (typeof window.translateUI === 'function') {
            window.translateUI();
        }
        if (typeof window.updateOpenModalsLayout === 'function') {
            window.updateOpenModalsLayout(true);
        }
    }

    function renderWorkspace(file) {
        const optContainer = document.getElementById('tool-dynamic-options');
        if (!optContainer) return;

        isImageMode = file.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(file.name);
        if (currentObjectUrl) {
            URL.revokeObjectURL(currentObjectUrl);
        }
        currentObjectUrl = URL.createObjectURL(file);
        zoom = 1;
        pan = { x: 0, y: 0 };

        optContainer.innerHTML = `
            <div class="upscale-workspace" id="upscale-workspace-inner">
                <div id="upscale-checking-screen" class="system-checking-card">
                    <h3 class="system-checking-title" data-i18n="system_checking_title">${t('system_checking_title') || 'Checking System Compatibility...'}</h3>
                    <div class="system-checking-list">
                        <div class="system-checking-item">
                            <span id="upscale-engine-dot" class="material-symbols-rounded" style="font-size:20px;">hourglass_empty</span>
                            <span id="upscale-engine-status">${t('upscale_checking_ai') || 'AI Engine: Checking...'}</span>
                        </div>
                        <div class="system-checking-item">
                            <span id="upscale-gpu-dot" class="material-symbols-rounded" style="font-size:20px;">hourglass_empty</span>
                            <span id="upscale-gpu-status">${t('upscale_checking_gpu') || 'GPU Canvas: Checking...'}</span>
                        </div>
                        <div class="system-checking-item">
                            <span id="upscale-ffmpeg-dot" class="material-symbols-rounded" style="font-size:20px;">hourglass_empty</span>
                            <span id="upscale-ffmpeg-status">${t('upscale_checking_ffmpeg') || 'FFmpeg WASM: Checking...'}</span>
                        </div>
                    </div>
                </div>
                <div id="upscale-main-content" class="hidden">
                <div class="upscale-comparison-container" id="upscale-comparison-container">
                    <div class="upscale-comparison-wrapper">
                        <div class="upscale-transform-layer">
                            <video id="upscale-preview-video" class="${isImageMode ? 'hidden' : ''}" src="${currentObjectUrl}" playsinline muted loop preload="auto"></video>
                            <img id="upscale-preview-image" class="${isImageMode ? '' : 'hidden'}" src="${currentObjectUrl}" alt="Original">
                            <canvas id="upscale-original-frame" class="hidden"></canvas>
                        </div>
                        <div class="upscale-canvas-clip" id="upscale-canvas-clip">
                            <div class="upscale-transform-layer">
                                <video id="upscale-enhanced-video" class="hidden" muted loop playsinline autoplay></video>
                                <canvas id="upscale-preview-canvas"></canvas>
                            </div>
                            <div class="upscale-unprocessed-overlay show" id="upscale-unprocessed-overlay">
                                <div class="unprocessed-title" data-i18n="upscale_unprocessed_title">${t('upscale_unprocessed_title') || 'Unprocessed'}</div>
                                <div class="unprocessed-subtitle" data-i18n="upscale_unprocessed_desc">${t('upscale_unprocessed_desc') || 'Press preview to view the processed file'}</div>
                            </div>
                        </div>
                    </div>
                    <div class="upscale-slider-line" id="upscale-slider-line">
                        <div class="upscale-slider-handle">&#9664; &#9654;</div>
                    </div>
                    <div class="upscale-slider-label left" data-i18n="upscale_label_original">${t('upscale_label_original') || 'Original'}</div>
                    <div class="upscale-slider-label right" id="upscale-slider-label-right" data-i18n="upscale_label_original">${t('upscale_label_original') || 'Original'}</div>
                    <div class="upscale-zoom-badge hidden" id="upscale-zoom-badge">1.0x</div>
                </div>

                <div class="upscale-action-row" id="upscale-action-row">
                    <button type="button" class="upscale-action-btn" id="upscale-preview-toggle">
                        <span class="material-symbols-rounded">visibility_off</span>
                        <span class="preview-btn-text" data-i18n="btn_preview">${t('btn_preview') || 'Preview'}</span>
                    </button>
                </div>

                <div class="upscale-duration-row ${isImageMode ? 'hidden' : ''}" id="upscale-duration-row">
                    <span class="material-symbols-rounded">schedule</span>
                    <input type="range" id="upscale-duration-slider" min="0" max="0" step="0.05" value="0" disabled>
                    <span class="upscale-duration-label" id="upscale-duration-label">00:00.0</span>
                </div>

                ${controlsCardHtml()}
                ${logsHtml()}
                </div>
            </div>
        `;

        const compContainer = document.getElementById('upscale-comparison-container');
        setupSliderEvents(compContainer);
        updateSliderVisuals();
        checkUpscaleSystemCompatibility();

        const previewImg = document.getElementById('upscale-preview-image');
        const previewVid = document.getElementById('upscale-preview-video');

        if (isImageMode && previewImg) {
            previewImg.onload = () => drawOriginalPreview();
            if (previewImg.complete) drawOriginalPreview();
        } else if (previewVid) {
            const durSlider = document.getElementById('upscale-duration-slider');
            const durLabel = document.getElementById('upscale-duration-label');
            const fmtTime = (s) => {
                const m = Math.floor(s / 60);
                return String(m).padStart(2, '0') + ':' + (s - m * 60).toFixed(1).padStart(4, '0');
            };
            previewVid.onloadedmetadata = () => {
                if (durSlider && isFinite(previewVid.duration)) {
                    durSlider.max = previewVid.duration || 0;
                    durSlider.disabled = false;
                    durSlider.value = 0;
                    if (durLabel) durLabel.textContent = fmtTime(0);
                }
            };
            previewVid.onloadeddata = () => { if (!previewActive) drawOriginalPreview(); };
            previewVid.ontimeupdate = () => {
                if (!previewActive && !isGeneratingPreview) {
                    drawOriginalPreview();
                    if (durLabel) durLabel.textContent = fmtTime(previewVid.currentTime || 0);
                }
            };
            if (durSlider) {
                durSlider.addEventListener('input', () => {
                    const v = parseFloat(durSlider.value) || 0;
                    try { previewVid.currentTime = v; } catch (e) {}
                    if (durLabel) durLabel.textContent = fmtTime(v);
                    if (previewActive || enhancedVideoUrl || lastResultCanvas) {
                        resetResultDisplay();
                        drawOriginalPreview();
                        log(`[Seek] Frame position -> ${fmtTime(v)}. Result cleared.`);
                    }
                });
            }
        }

        const previewBtn = document.getElementById('upscale-preview-toggle');
        if (previewBtn) {
            previewBtn.addEventListener('click', generatePreview);
        }

        wireCommonControls();
    }

    async function enhanceMedia(file) {
        if (isProcessing || !file) return;
        isProcessing = true;

        setButtonState('processing', t('status_processing') || 'Enhancing media...');
        setProgress(15, t('upscale_checking_gpu') || 'Preparing WebGL/WebGPU shader...');

        showLogs();
        const enhanceStartTime = performance.now();
        log(`[Enhance] Source: ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`);
        log(`[Enhance] Preset: ${activePreset} | Order: ${enhanceTiming === 'before' ? 'Filter > Upscale' : 'Upscale > Filter'} | Normalise: ${normaliseSize ? 'ON' : 'OFF'}`);

        try {
            const isImg = file.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(file.name);
            const presetObj = PRESETS.find(p => p.id === activePreset) || PRESETS[0];

            if (isImg) {
                setProgress(40, t('status_processing') || 'Processing image filters...');
                log('[Enhance] Loading image...');
                const img = new Image();
                const imgLoaded = new Promise((resolve, reject) => {
                    img.onload = resolve;
                    img.onerror = () => reject(new Error('Failed to decode image.'));
                });
                img.src = URL.createObjectURL(file);
                await imgLoaded;
                log(`[Enhance] Image loaded: ${img.naturalWidth}x${img.naturalHeight}`);

                let filterSource = img;
                if (normaliseSize) {
                    const cropped = applyCropTo916(img);
                    if (cropped) {
                        setProgress(30, t('status_processing') || 'Normalising center-crop 9:16...');
                        log(`[Enhance] Normalise ON: center-crop ${img.naturalWidth}x${img.naturalHeight} to 9:16 (native pixels, centered)...`);
                        filterSource = cropped;
                        log(`[Enhance] Cropped source: ${filterSource.width}x${filterSource.height} (full height preserved)`);
                    } else {
                        log(`[Enhance] Normalise ON: source ${img.naturalWidth}x${img.naturalHeight} already 9:16, no crop needed.`);
                    }
                }

                if (!gpuEnhancer && window.UpscaleGpuEnhancer) {
                    try { gpuEnhancer = new window.UpscaleGpuEnhancer(); } catch (e) {}
                }

                log(`[Enhance] GPU filter engine: ${gpuEnhancer ? 'WebGL2 ready' : 'fallback 2D canvas'}`);
                const engine = getUpscaleEngine();
                const params = getPresetParams(activePreset);
                log(`[Enhance] AI Engine: ${engine ? `Real-ESRGAN x${UPSCALE_FACTOR} ready` : 'unavailable, filter-only'}`);

                const onAiProgress = (p) => {
                    const normalized = Math.min(1, Math.max(0, (p || 0) / 100));
                    const pct = 40 + Math.round(normalized * 50);
                    setProgress(pct, t('status_processing') || 'AI upscaling...');
                };

                let workSource = filterSource;
                let outCanvas;

                if (enhanceTiming === 'before') {
                    setProgress(35, t('status_processing') || 'Applying GPU filter...');
                    log('[Enhance] Step 1/2: Applying GPU filter...');
                    const filtered = document.createElement('canvas');
                    filtered.width = filterSource.naturalWidth || filterSource.width;
                    filtered.height = filterSource.naturalHeight || filterSource.height;
                    if (gpuEnhancer) {
                        gpuEnhancer.process(filterSource, params, filtered);
                    } else {
                        filtered.getContext('2d').drawImage(filterSource, 0, 0);
                    }

                    if (engine) {
                        setProgress(40, t('status_processing') || 'AI upscaling...');
                        log(`[Enhance] Step 2/2: AI upscale x${UPSCALE_FACTOR}...`);
                        outCanvas = document.createElement('canvas');
                        await engine.renderFrame(filtered, outCanvas, onAiProgress);
                        log(`[Enhance] Upscaled: ${outCanvas.width}x${outCanvas.height}`);
                    } else {
                        outCanvas = filtered;
                    }
                } else {
                    if (engine) {
                        setProgress(40, t('status_processing') || 'AI upscaling...');
                        log(`[Enhance] Step 1/2: AI upscale x${UPSCALE_FACTOR}...`);
                        workSource = document.createElement('canvas');
                        await engine.renderFrame(filterSource, workSource, onAiProgress);
                        log(`[Enhance] Upscaled: ${workSource.width}x${workSource.height}`);
                    }

                    setProgress(85, t('status_processing') || 'Applying GPU filter...');
                    log('[Enhance] Step 2/2: Applying GPU filter on upscaled frame...');
                    outCanvas = document.createElement('canvas');
                    outCanvas.width = workSource.naturalWidth || workSource.width;
                    outCanvas.height = workSource.naturalHeight || workSource.height;
                    if (gpuEnhancer) {
                        gpuEnhancer.process(workSource, params, outCanvas);
                    } else {
                        outCanvas.getContext('2d').drawImage(workSource, 0, 0);
                    }
                }
                if (normaliseSize) {
                    setProgress(90, t('status_finalizing') || 'Normalising output to 1080x1920...');
                    outCanvas = resizeTo1080x1920(outCanvas);
                    log(`[Enhance] Normalised output: ${outCanvas.width}x${outCanvas.height} (9:16)`);
                }

                const mime = normaliseSize ? 'image/jpeg' : 'image/png';
                const ext = normaliseSize ? 'jpg' : 'png';
                const blob = await new Promise(r => outCanvas.toBlob(r, mime, 0.92));
                if (!blob) throw new Error('Failed to encode output image.');

                const previewCanvasEl = document.getElementById('upscale-preview-canvas');
                if (previewCanvasEl && outCanvas.width) {
                    previewCanvasEl.width = outCanvas.width;
                    previewCanvasEl.height = outCanvas.height;
                    previewCanvasEl.getContext('2d').drawImage(outCanvas, 0, 0);
                }
                const overlayAfterDone = document.getElementById('upscale-unprocessed-overlay');
                if (overlayAfterDone) overlayAfterDone.classList.remove('show');
                const labelAfterDone = document.getElementById('upscale-slider-label-right');
                if (labelAfterDone) {
                    labelAfterDone.textContent = t('upscale_label_enhanced_ai') || 'Enhanced';
                    labelAfterDone.setAttribute('data-i18n', 'upscale_label_enhanced_ai');
                }
                lastResultCanvas = cloneCanvas(outCanvas);
                lastResultBlob = null;
                previewActive = true;
                setCompletedLayout(true);

                const outName = file.name.replace(/\.[^/.]+$/, '') + `_enhanced.${ext}`;
                triggerDownload(blob, outName);

                const imgElapsed = ((performance.now() - enhanceStartTime) / 1000).toFixed(1);
                log(`[Enhance] Saved: ${outName} (${(blob.size / (1024 * 1024)).toFixed(2)} MB) in ${imgElapsed}s`);

                setProgress(100, t('status_completed') || 'Done!');
                setButtonState('completed', t('status_process_another') || 'Process Another');

            } else {
                setProgress(30, t('status_processing') || 'Enhancing video stream...');
                setButtonState('processing', t('status_processing') || 'Processing video...');

                log('[Enhance] Loading FFmpeg core (~31 MB, first time only)...');
                setProgress(35, t('status_loading_engine') || 'Loading FFmpeg...');
                const ffmpeg = await getFFmpegInstance();

                const ext = file.name.split('.').pop() || 'mp4';
                const inName = `input.${ext}`;
                await ffmpeg.writeFile(inName, await fetchFile(file));

                const engine = getUpscaleEngine();
                if (engine) {
                    log(`[Enhance] AI video pipeline engaged (Real-ESRGAN x${UPSCALE_FACTOR}).`);
                    await runAiVideoPipeline(ffmpeg, inName, file, (frac) => {
                        setProgress(40 + Math.round(Math.min(1, Math.max(0, frac)) * 55), `${t('status_processing') || 'AI upscaling'} ${Math.round(frac * 100)}%`);
                    });
                } else {
                    log('[Enhance] AI engine unavailable — using FFmpeg filter chain.');
                    let vf = 'unsharp=5:5:1.0:5:5:0.0';
                    if (presetObj.id === 'cartoonist') vf = 'unsharp=7:7:1.5:7:7:0.5,eq=contrast=1.1:saturation=1.15';
                    if (presetObj.id === 'cartoonist2') vf = 'unsharp=9:9:2.0:9:9:0.8,eq=contrast=1.15:saturation=1.25';
                    if (presetObj.id === 'humanDetail') vf = 'unsharp=5:5:1.2:5:5:0.3,hqdn3d=1.5:1.5:3:3';
                    if (presetObj.id === 'smoothFace') vf = 'hqdn3d=2.5:2.5:4:4,unsharp=5:5:0.8';

                    if (normaliseSize) {
                        vf = `crop=min(iw\\,ih*9/16):min(ih\\,iw*16/9),scale=1080:1920,setsar=1,${vf}`;
                    }

                    setProgress(60, t('status_encoding') || 'Encoding enhanced video...');
                    log(`[Enhance] FFmpeg filter chain: ${vf}`);
                    await ffmpeg.exec(['-y', '-i', inName, '-map', '0:v:0', '-map', '0:a:0?', '-vf', vf, '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'copy', 'enhanced.mp4']);
                }

                setProgress(95, t('status_finalizing') || 'Finalizing output video...');
                const data = await ffmpeg.readFile('enhanced.mp4');
                const blob = new Blob([data], { type: 'video/mp4' });

                const outName = file.name.replace(/\.[^/.]+$/, '') + `_enhanced.mp4`;
                triggerDownload(blob, outName);

                try {
                    await showEnhancedVideoInPreview(blob);
                    lastResultCanvas = null;
                    log('[Enhance] Synced original/Enhanced preview active.');
                } catch (pvErr) {
                    console.warn('[Qualitelio Enhancer] Preview playback skipped:', pvErr);
                }

                const vidElapsed = ((performance.now() - enhanceStartTime) / 1000).toFixed(1);
                log(`[Enhance] Saved: ${outName} (${(blob.size / (1024 * 1024)).toFixed(2)} MB) in ${vidElapsed}s`);

                setProgress(100, t('status_completed') || 'Done!');
                setButtonState('completed', t('status_process_another') || 'Process Another');
            }

            setCompletedLayout(true);

            if (window.ToolProgressManager) {
                window.ToolProgressManager.set('tool-upscale-enhancer', {
                    isProcessing: false,
                    completed: true,
                    percent: 100,
                    status: 'Complete',
                    file
                });
            }

            if (typeof window.showToast === 'function') {
                window.showToast(t('status_completed_toast') || 'Media enhanced successfully!');
            }

        } catch (err) {
            console.error('[Qualitelio Enhancer] Error:', err);
            setButtonState('error', err.message || 'Enhancement failed');
            if (window.ToolProgressManager) {
                window.ToolProgressManager.clear('tool-upscale-enhancer');
            }
        } finally {
            isProcessing = false;
        }
    }

    async function loadJSZip() {
        if (window.JSZip) return true;
        const loadScript = (src) => new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src;
            s.onload = () => resolve(true);
            s.onerror = () => reject(new Error(`Failed to load ${src}`));
            document.head.appendChild(s);
        });
        try {
            try {
                await loadScript('assets/jszip/jszip.min.js');
            } catch (e) {
                await loadScript('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js');
            }
        } catch (err) {
            console.error('[Qualitelio Enhancer] Error loading JSZip:', err);
        }
        return !!window.JSZip;
    }

    function batchOutName(file) {
        const isImg = file.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(file.name);
        const ext = isImg ? (normaliseSize ? 'jpg' : 'png') : 'mp4';
        return file.name.replace(/\.[^/.]+$/, '') + `_enhanced.${ext}`;
    }

    async function batchProcessImage(file, onProgress) {
        onProgress(0.05);
        log('[Batch] Loading image...');
        const img = new Image();
        const imgLoaded = new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = () => reject(new Error('Failed to decode image.'));
        });
        img.src = URL.createObjectURL(file);
        await imgLoaded;

        let filterSource = img;
        if (normaliseSize) {
            const cropped = applyCropTo916(img);
            if (cropped) {
                filterSource = cropped;
                log(`[Batch] Cropped source: ${filterSource.width}x${filterSource.height}`);
            }
        }

        if (!gpuEnhancer && window.UpscaleGpuEnhancer) {
            try { gpuEnhancer = new window.UpscaleGpuEnhancer(); } catch (e) {}
        }

        const engine = getUpscaleEngine();
        const params = getPresetParams(activePreset);
        let workSource = filterSource;
        let outCanvas;

        if (enhanceTiming === 'before') {
            onProgress(0.2);
            const filtered = document.createElement('canvas');
            filtered.width = filterSource.naturalWidth || filterSource.width;
            filtered.height = filterSource.naturalHeight || filterSource.height;
            if (gpuEnhancer) {
                gpuEnhancer.process(filterSource, params, filtered);
            } else {
                filtered.getContext('2d').drawImage(filterSource, 0, 0);
            }

            if (engine) {
                onProgress(0.35);
                outCanvas = document.createElement('canvas');
                await engine.renderFrame(filtered, outCanvas, (p) => {
                    onProgress(0.35 + Math.min(1, Math.max(0, p / 100)) * 0.55);
                });
            } else {
                outCanvas = filtered;
            }
        } else {
            if (engine) {
                onProgress(0.1);
                workSource = document.createElement('canvas');
                await engine.renderFrame(filterSource, workSource, (p) => {
                    onProgress(0.1 + Math.min(1, Math.max(0, p / 100)) * 0.7);
                });
            }
            onProgress(0.85);
            outCanvas = document.createElement('canvas');
            outCanvas.width = workSource.naturalWidth || workSource.width;
            outCanvas.height = workSource.naturalHeight || workSource.height;
            if (gpuEnhancer) {
                gpuEnhancer.process(workSource, params, outCanvas);
            } else {
                outCanvas.getContext('2d').drawImage(workSource, 0, 0);
            }
        }

        let outFinal = outCanvas;
        if (normaliseSize) {
            onProgress(0.92);
            outFinal = resizeTo1080x1920(outFinal);
        }

        onProgress(0.96);
        const mime = normaliseSize ? 'image/jpeg' : 'image/png';
        const blob = await new Promise(r => outFinal.toBlob(r, mime, 0.92));
        URL.revokeObjectURL(img.src);
        if (!blob) throw new Error('Failed to encode output image.');
        return { blob, outName: batchOutName(file) };
    }

    async function batchProcessVideo(file, onProgress) {
        onProgress(0.05);
        log('[Batch] Loading FFmpeg...');
        const ffmpeg = await getFFmpegInstance();

        const ext = file.name.split('.').pop() || 'mp4';
        await ffmpeg.writeFile(`input.${ext}`, await fetchFile(file));

        let vf = 'unsharp=5:5:1.0:5:5:0.0';
        if (activePreset === 'cartoonist') vf = 'unsharp=7:7:1.5:7:7:0.5,eq=contrast=1.1:saturation=1.15';
        if (activePreset === 'cartoonist2') vf = 'unsharp=9:9:2.0:9:9:0.8,eq=contrast=1.15:saturation=1.25';
        if (activePreset === 'humanDetail') vf = 'unsharp=5:5:1.2:5:5:0.3,hqdn3d=1.5:1.5:3:3';
        if (activePreset === 'smoothFace') vf = 'hqdn3d=2.5:2.5:4:4,unsharp=5:5:0.8';
        if (normaliseSize) {
            vf = `crop=min(iw\\,ih*9/16):min(ih\\,iw*16/9),scale=1080:1920,setsar=1,${vf}`;
        }

        log(`[Batch] FFmpeg filter chain: ${vf}`);
        onProgress(0.15);
        await ffmpeg.exec(['-y', '-i', `input.${ext}`, '-map', '0:v:0', '-map', '0:a:0?', '-vf', vf, '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'copy', 'enhanced.mp4']);
        onProgress(0.9);
        const data = await ffmpeg.readFile('enhanced.mp4');
        const blob = new Blob([data], { type: 'video/mp4' });
        return { blob, outName: batchOutName(file) };
    }

    function renderBatchList() {
        const listEl = document.getElementById('upscale-batch-list');
        if (!listEl) return;
        listEl.innerHTML = batchFiles.map((item) => {
            const sizeMb = (item.file.size / (1024 * 1024)).toFixed(2);
            let statusChip = `<span class="upscale-batch-item-status">${t('upscale_batch_ready') || 'Ready'}</span>`;
            let actionsHtml = `<button type="button" class="upscale-batch-item-remove" data-remove="${item.id}" title="${t('upscale_batch_remove') || 'Remove'}"><span class="material-symbols-rounded">close</span></button>`;

            if (item.status === 'processing') {
                statusChip = `<span class="upscale-batch-item-status">${t('status_processing') || 'Processing...'}</span>`;
                actionsHtml = '';
            } else if (item.status === 'done' && item.result) {
                statusChip = `<span class="upscale-batch-item-status done">${t('status_completed') || 'Done'}</span>`;
                actionsHtml = `
                    <button type="button" class="upscale-batch-item-download" data-dl="${item.id}" title="Download"><span class="material-symbols-rounded">download</span></button>
                    <button type="button" class="upscale-batch-item-remove" data-remove="${item.id}" title="${t('upscale_batch_remove') || 'Remove'}"><span class="material-symbols-rounded">close</span></button>`;
            } else if (item.status === 'failed') {
                statusChip = `<span class="upscale-batch-item-status failed">${t('upscale_batch_failed') || 'Failed'}</span>`;
                actionsHtml = `<button type="button" class="upscale-batch-item-remove" data-remove="${item.id}" title="${t('upscale_batch_remove') || 'Remove'}"><span class="material-symbols-rounded">close</span></button>`;
            }

            return `
                <div class="upscale-batch-item">
                    <div class="upscale-batch-item-info">
                        <div class="upscale-batch-item-name">${item.file.name}</div>
                        <div class="upscale-batch-item-size">${sizeMb} MB</div>
                    </div>
                    ${statusChip}
                    ${actionsHtml}
                </div>`;
        }).join('');

        listEl.querySelectorAll('.upscale-batch-item-remove').forEach(btn => {
            btn.addEventListener('click', () => removeBatchFile(btn.getAttribute('data-remove')));
        });
        listEl.querySelectorAll('.upscale-batch-item-download').forEach(btn => {
            btn.addEventListener('click', () => {
                const item = batchFiles.find(b => String(b.id) === btn.getAttribute('data-dl'));
                if (item && item.result) triggerDownload(item.result.blob, item.result.outName);
            });
        });

        const zipBtn = document.getElementById('upscale-batch-zip-btn');
        if (zipBtn) {
            zipBtn.classList.toggle('hidden', !(batchDone && batchFiles.some(b => b.result)));
        }
    }

    function markBatchCompleted() {
        const dropWrap = document.getElementById('upscale-batch-drop-wrap');
        if (dropWrap) dropWrap.classList.add('hidden');
        renderBatchList();
    }

    async function downloadAllZip() {
        const results = batchFiles.filter(b => b.result).map(b => b.result);
        if (!results.length) return;
        setButtonState('processing', t('upscale_zip_preparing') || 'Preparing ZIP...');
        const ok = await loadJSZip();
        if (!ok || !window.JSZip) {
            setButtonState('completed', t('status_process_another') || 'Process Another');
            results.forEach(r => triggerDownload(r.blob, r.outName));
            return;
        }
        try {
            const zip = new window.JSZip();
            results.forEach(r => zip.file(r.outName, r.blob));
            const zipBlob = await zip.generateAsync({ type: 'blob' });
            triggerDownload(zipBlob, `qualitelio-enhancer-${results.length}-files.zip`);
            log(`[Batch] ZIP saved (${results.length} files, ${(zipBlob.size / (1024 * 1024)).toFixed(2)} MB)`);
        } catch (err) {
            log(`[Batch] ZIP failed: ${err.message}. Downloading individually...`);
            results.forEach(r => triggerDownload(r.blob, r.outName));
        }
        setButtonState('completed', t('status_process_another') || 'Process Another');
    }

    function addBatchFiles(fileList) {
        Array.from(fileList).forEach(f => {
            batchFiles.push({ id: Date.now() + Math.random(), file: f, status: 'queued', result: null });
        });
        renderBatchList();
        setButtonState('ready', t('tool_upscale_btn') || 'Start Processing');
    }

    function removeBatchFile(id) {
        if (isProcessing) return;
        batchFiles = batchFiles.filter(b => String(b.id) !== String(id));
        renderBatchList();
        setButtonState(batchFiles.length ? 'ready' : 'idle', t('tool_upscale_btn') || 'Start Processing');
    }

    function renderBatchWorkspace() {
        const optContainer = document.getElementById('tool-dynamic-options');
        if (!optContainer) return;

        optContainer.innerHTML = `
            <div class="upscale-workspace" id="upscale-workspace-inner">
                <div id="upscale-batch-drop-wrap">
                    <div class="upscale-batch-drop" id="upscale-batch-drop">
                        <span class="material-symbols-rounded">library_add</span>
                        <span data-i18n="upscale_batch_drop">${t('upscale_batch_drop') || 'Drop photos / videos here or click to add'}</span>
                    </div>
                    <input type="file" id="upscale-batch-input" multiple accept="video/*,image/*,video/mp4,video/quicktime,video/webm,image/png,image/jpeg,image/webp" class="hidden">
                </div>
                <div class="upscale-batch-list" id="upscale-batch-list"></div>
                ${controlsCardHtml()}
                <button type="button" class="upscale-action-btn upscale-zip-btn hidden" id="upscale-batch-zip-btn">
                    <span class="material-symbols-rounded">download</span>
                    <span data-i18n="btn_download_all_zip">${t('btn_download_all_zip') || 'Download All (.zip)'}</span>
                </button>
                ${logsHtml()}
            </div>
        `;

        const batchDrop = document.getElementById('upscale-batch-drop');
        const batchInput = document.getElementById('upscale-batch-input');
        if (batchDrop && batchInput) {
            batchDrop.addEventListener('click', () => batchInput.click());
            batchInput.addEventListener('change', (e) => {
                if (e.target.files && e.target.files.length > 0) {
                    addBatchFiles(e.target.files);
                    e.target.value = '';
                }
            });
            batchDrop.addEventListener('dragover', (e) => {
                e.preventDefault();
                batchDrop.classList.add('dragover');
            });
            batchDrop.addEventListener('dragleave', () => batchDrop.classList.remove('dragover'));
            batchDrop.addEventListener('drop', (e) => {
                e.preventDefault();
                batchDrop.classList.remove('dragover');
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    addBatchFiles(e.dataTransfer.files);
                }
            });
        }

        const zipBtn = document.getElementById('upscale-batch-zip-btn');
        if (zipBtn) {
            zipBtn.addEventListener('click', downloadAllZip);
        }

        wireCommonControls();
        renderBatchList();
    }

    async function runBatch() {
        if (isProcessing || !batchFiles.length) return;
        isProcessing = true;
        batchDone = false;
        setButtonState('processing', t('status_processing') || 'Enhancing...');
        showLogs();
        log(`[Batch] ${batchFiles.length} file(s) | Preset: ${activePreset} | Order: ${enhanceTiming === 'before' ? 'Filter > Upscale' : 'Upscale > Filter'} | Normalise: ${normaliseSize ? 'ON' : 'OFF'}`);

        const total = batchFiles.length;
        try {
            for (let i = 0; i < total; i++) {
                const item = batchFiles[i];
                item.status = 'processing';
                item.result = null;
                renderBatchList();

                const base = Math.round((i / total) * 100);
                const span = Math.round(100 / total);
                setProgress(base, `${t('status_processing') || 'Processing'} (${i + 1}/${total})`);
                log(`[Batch] (${i + 1}/${total}) ${item.file.name} (${(item.file.size / (1024 * 1024)).toFixed(2)} MB)`);

                const t0 = performance.now();
                const isImg = item.file.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(item.file.name);
                const processFn = isImg ? batchProcessImage : batchProcessVideo;
                const { blob, outName } = await processFn(item.file, (frac) => {
                    setProgress(base + Math.round(Math.min(1, Math.max(0, frac)) * span), `${t('status_processing') || 'Processing'} (${i + 1}/${total})`);
                });

                item.result = { blob, outName };
                item.status = 'done';
                renderBatchList();
                log(`[Batch] Done: ${outName} (${(blob.size / (1024 * 1024)).toFixed(2)} MB) in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
            }

            batchDone = true;
            markBatchCompleted();
            setProgress(100, t('status_completed') || 'Done!');
            setButtonState('completed', t('status_process_another') || 'Process Another');

            if (window.ToolProgressManager) {
                window.ToolProgressManager.set('tool-upscale-enhancer', {
                    isProcessing: false,
                    completed: true,
                    percent: 100,
                    status: 'Complete',
                    file: null
                });
            }
            if (typeof window.showToast === 'function') {
                window.showToast(t('status_completed_toast') || 'Media enhanced successfully!');
            }
        } catch (err) {
            console.error('[Qualitelio Enhancer] Batch error:', err);
            const failedItem = batchFiles.find(b => b.status === 'processing');
            if (failedItem) failedItem.status = 'failed';
            renderBatchList();
            log(`[Batch Error] ${err.message || err}`);
            setButtonState('error', err.message || 'Batch failed');
            if (window.ToolProgressManager) {
                window.ToolProgressManager.clear('tool-upscale-enhancer');
            }
        } finally {
            isProcessing = false;
        }
    }

    function restoreWorkspaceVisualState(st) {
        updateSliderVisuals();
        if (st && st.completed) {
            const canvas = document.getElementById('upscale-preview-canvas');
            const overlay = document.getElementById('upscale-unprocessed-overlay');
            const labelRight = document.getElementById('upscale-slider-label-right');
            let restored = false;

            if (lastResultCanvas && canvas) {
                canvas.width = lastResultCanvas.width;
                canvas.height = lastResultCanvas.height;
                canvas.getContext('2d').drawImage(lastResultCanvas, 0, 0);
                previewActive = true;
                restored = true;
            } else if (lastResultBlob && !isImageMode) {
                showEnhancedVideoInPreview(lastResultBlob).then(() => {
                    setCompletedLayout(true);
                });
                restored = true;
            }

            if (restored) {
                if (overlay) overlay.classList.remove('show');
                if (labelRight) {
                    labelRight.textContent = t('upscale_label_enhanced_ai') || 'Enhanced';
                    labelRight.setAttribute('data-i18n', 'upscale_label_enhanced_ai');
                }
            }
            setCompletedLayout(true);
        }
    }

    const toolDefinition = {
        id: 'tool-upscale-enhancer',
        _id: 'tool-upscale-enhancer',
        title: 'Qualitelio Enhancer',
        titleKey: 'tool_upscale_title',
        desc: 'Media Upscaler',
        descKey: 'tool_upscale_desc',
        dropKey: 'tool_upscale_drop',
        icon: 'auto_awesome',
        category: 'Tools',
        features: [
            'Cartoonist, Human Detail & Smooth Face Presets',
            'GPU-Accelerated WebGL/WebGPU Shader Filters',
            'Interactive Draggable Split Preview Slider',
            '1080x1920 Center Crop Normalisation'
        ],
        specs: [
            { label: 'ENGINE', value: 'WebGL & WebGPU' },
            { label: 'FORMAT', value: 'MP4, MOV, PNG, JPG' },
            { label: 'PROCESSING', value: '100% Local GPU' }
        ],
        hideDropOnUpload: true,
        multiFile: true,
        initModal: function(ctx) {
            const { optContainer, dropZone } = ctx;
            const st = window.ToolProgressManager ? window.ToolProgressManager.get('tool-upscale-enhancer') : null;
            const isActive = !!(st && (st.isProcessing || st.completed));
            const srcFile = selectedFile || (st && st.file) || null;
            if (isActive && srcFile && !isBatchMode && optContainer) {
                selectedFile = srcFile;
                renderWorkspace(selectedFile);
                restoreWorkspaceVisualState(st);
                if (dropZone) dropZone.classList.add('hidden');
            } else {
                if (optContainer) optContainer.innerHTML = '';
                selectedFile = null;
                lastResultCanvas = null;
                previewActive = false;
                isBatchMode = false;
                batchFiles = [];
                batchResults = [];
                batchDone = false;
            }
        },
        onFileSelect: function(file) {
            selectedFile = file;
            renderWorkspace(file);
            setButtonState('processing', t('system_checking_title') || 'Checking System Compatibility...');
        },
        canProcess: function() {
            return isBatchMode ? batchFiles.length > 0 : !!selectedFile;
        },
        onFilesSelect: function(files) {
            if (!files || !files.length) return;
            isBatchMode = true;
            selectedFile = null;
            previewActive = false;
            lastResultCanvas = null;
            batchFiles = files.map(f => ({ id: Date.now() + Math.random(), file: f, status: 'queued', result: null }));
            batchResults = [];
            batchDone = false;
            const dz = document.getElementById('tool-drop-zone');
            if (dz) dz.classList.add('hidden');
            renderBatchWorkspace();
            setButtonState('ready', t('tool_upscale_btn') || 'Start Processing');
        },
        onProcess: function(file) {
            if (isBatchMode) {
                runBatch();
                return;
            }
            enhanceMedia(file || selectedFile);
        },
        onReset: function() {
            selectedFile = null;
            isProcessing = false;
            activePreset = 'cartoonist';
            isGeneratingPreview = false;
            previewActive = false;
            lastResultCanvas = null;
            lastResultBlob = null;
            if (enhancedVideoUrl) {
                URL.revokeObjectURL(enhancedVideoUrl);
                enhancedVideoUrl = null;
            }
            isBatchMode = false;
            batchFiles = [];
            batchResults = [];
            batchDone = false;
            if (currentObjectUrl) {
                URL.revokeObjectURL(currentObjectUrl);
                currentObjectUrl = null;
            }
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

    window.QualitelioEnhancerTool = toolDefinition;
})();
