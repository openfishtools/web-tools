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
    let selectedPreset = 'medium';
    let selectedThreadMode = 'multi'; // 'multi' | 'single'

    const MAX_FILE_MB_HARD = 1500;
    const MAX_DIMENSION = 3840;

    let activeContext = null;

    function appendToLogsEl(msg) {
        if (activeContext && typeof activeContext.onLog === 'function') {
            activeContext.onLog(msg);
        }
        const logsEl = document.getElementById('compressor-logs');
        if (logsEl) {
            logsEl.textContent += msg + '\n';
            logsEl.scrollTop = logsEl.scrollHeight;
        }
    }

    function log(msg) { appendToLogsEl(msg); }
    function logSection(title) { appendToLogsEl(`\n=== ${title} ===`); }
    function logEnd() { appendToLogsEl('====================\n'); }

    function reportProgress(percent, text) {
        if (activeContext && typeof activeContext.onProgress === 'function') {
            activeContext.onProgress(percent, text);
        }
        const progressFill = document.getElementById('tool-progress-fill');
        const progressPercent = document.getElementById('tool-progress-percent');
        const progressStatus = document.getElementById('tool-progress-status');
        if (progressFill) progressFill.style.width = `${percent}%`;
        if (progressPercent) progressPercent.textContent = `${percent}%`;
        if (progressStatus && text) progressStatus.textContent = text;
    }

    function updateDesc() {
        const descEl = document.getElementById('compressor-info-desc');
        if (!descEl) return;

        const isEn = (typeof window !== 'undefined' && window.currentLang === 'en');

        const isSingleThread = (selectedThreadMode === 'single');
        let codecLabel = isSingleThread ? 'H.264 (libx264)' : 'H.265 / HEVC';
        let presetLabel = isSingleThread ? 'Medium' : 'Ultrafast';
        let crfLabel = '19';
        let bitrateLabel = isSingleThread ? 'H.264 up to 19 Mbps' : 'HEVC up to 16 Mbps';
        let infoText = isEn 
            ? 'Optimal balance between compression speed, visual quality, and 60fps motion sharpness.' 
            : 'Keseimbangan optimal antara kecepatan kompresi, kualitas visual, dan ketajaman gerakan 60 FPS.';

        if (selectedPreset === 'slow') {
            codecLabel = isSingleThread ? 'H.264 (libx264)' : 'H.265 / HEVC';
            presetLabel = isSingleThread ? 'Slow' : 'Superfast';
            crfLabel = '18';
            bitrateLabel = isSingleThread ? 'H.264 up to 24 Mbps' : 'HEVC up to 20 Mbps';
            infoText = isEn
                ? 'Maximum visual fidelity with deep motion analysis and high bitrate headroom to eliminate macroblocking.'
                : 'Kualitas visual maksimal dengan analisis gerakan mendalam dan batas bitrate tinggi untuk mencegah video pecah.';
        } else if (selectedPreset === 'fast') {
            codecLabel = 'H.264 (libx264)';
            presetLabel = 'Veryfast';
            crfLabel = '21';
            bitrateLabel = 'H.264 up to 14 Mbps';
            infoText = isEn
                ? 'Fastest encoding with universal compatibility and 60fps high-motion safety headroom.'
                : 'Proses encoding paling cepat dengan kompatibilitas universal dan alokasi bitrate aman untuk gerakan 60 FPS.';
        }

        const threadingLabel = isSingleThread
            ? 'Single-Thread (Safe Mode)'
            : 'Multi-Thread (Auto Fallback)';

        descEl.innerHTML = `
            <div class="tiktok-desc-card">
                <ul class="tiktok-desc-list">
                    <li><span class="material-symbols-rounded">memory</span><strong>Codec:</strong> ${codecLabel}</li>
                    <li><span class="material-symbols-rounded">speed</span><strong>Preset:</strong> ${presetLabel}</li>
                    <li><span class="material-symbols-rounded">tune</span><strong>CRF:</strong> ${crfLabel}</li>
                    <li><span class="material-symbols-rounded">equalizer</span><strong>Bitrate:</strong> ${bitrateLabel}</li>
                    <li><span class="material-symbols-rounded">bolt</span><strong>Threading:</strong> ${threadingLabel}</li>
                </ul>
                <hr class="tiktok-desc-divider">
                <div class="tiktok-desc-footer">
                    <span class="material-symbols-rounded">info</span>
                    <span>${infoText}</span>
                </div>
            </div>
        `;
    }

    function initCompressorUI() {
        const optContainer = document.getElementById('tool-dynamic-options');
        if (!optContainer) return;

        const presetList = ['slow', 'medium', 'fast'];
        const pIdx = presetList.indexOf(selectedPreset);
        const selectedPIdx = pIdx >= 0 ? pIdx : 1;

        const threadList = ['multi', 'single'];
        const tIdx = threadList.indexOf(selectedThreadMode);
        const selectedTIdx = tIdx >= 0 ? tIdx : 0;

        optContainer.innerHTML = `
            <div class="tiktok-switcher-label">${t('compressor_preset_title') || 'Choose Compression Preset'}</div>
            <div class="tiktok-switch-scroll">
                <div class="tiktok-switch-track" id="compressor-preset-switch" data-selected="${selectedPreset}" data-count="3" data-selected-idx="${selectedPIdx}" style="--total: 3; --idx: ${selectedPIdx};">
                    <div class="tiktok-switch-indicator"></div>
                    <div class="tiktok-switch-option ${selectedPreset === 'slow' ? 'active' : ''}" data-preset="slow">SLOW</div>
                    <div class="tiktok-switch-option ${selectedPreset === 'medium' ? 'active' : ''}" data-preset="medium">MEDIUM</div>
                    <div class="tiktok-switch-option ${selectedPreset === 'fast' ? 'active' : ''}" data-preset="fast">FAST</div>
                </div>
            </div>

            <div class="tiktok-switcher-label">${t('compressor_threading_title') || 'Threading Mode'}</div>
            <div class="tiktok-switch-scroll">
                <div class="tiktok-switch-track" id="compressor-thread-switch" data-selected="${selectedThreadMode}" data-count="2" data-selected-idx="${selectedTIdx}" style="--total: 2; --idx: ${selectedTIdx};">
                    <div class="tiktok-switch-indicator"></div>
                    <div class="tiktok-switch-option ${selectedThreadMode === 'multi' ? 'active' : ''}" data-thread="multi">MULTI THREADS</div>
                    <div class="tiktok-switch-option ${selectedThreadMode === 'single' ? 'active' : ''}" data-thread="single">SINGLE THREAD</div>
                </div>
            </div>

            <div class="tiktok-preset-desc" id="compressor-info-desc"></div>

            <div class="process-logs-wrap hidden" id="compressor-logs-container">
                <div class="process-logs-header">
                    <span class="process-logs-title">${t('patcher_logs_title') || 'Process Logs'}</span>
                    <button type="button" class="btn-copy-logs" id="btn-copy-compressor-logs">
                        <span class="material-symbols-rounded">content_copy</span>
                        <span>${t('res_modal_copy') || 'Copy'}</span>
                    </button>
                </div>
                <pre class="process-logs-pre" id="compressor-logs"></pre>
            </div>
        `;

        updateDesc();

        const pSwitch = document.getElementById('compressor-preset-switch');
        if (pSwitch) {
            pSwitch.querySelectorAll('.tiktok-switch-option').forEach(opt => {
                opt.addEventListener('click', () => {
                    const allOpts = Array.from(pSwitch.querySelectorAll('.tiktok-switch-option'));
                    allOpts.forEach(o => o.classList.remove('active'));
                    opt.classList.add('active');
                    selectedPreset = opt.getAttribute('data-preset') || 'medium';
                    const optIdx = allOpts.indexOf(opt);
                    pSwitch.setAttribute('data-selected', selectedPreset);
                    pSwitch.setAttribute('data-selected-idx', optIdx.toString());
                    pSwitch.style.setProperty('--idx', optIdx.toString());
                    updateDesc();
                });
            });
        }

        const tSwitch = document.getElementById('compressor-thread-switch');
        if (tSwitch) {
            tSwitch.querySelectorAll('.tiktok-switch-option').forEach(opt => {
                opt.addEventListener('click', () => {
                    const allOpts = Array.from(tSwitch.querySelectorAll('.tiktok-switch-option'));
                    allOpts.forEach(o => o.classList.remove('active'));
                    opt.classList.add('active');
                    selectedThreadMode = opt.getAttribute('data-thread') || 'multi';
                    const optIdx = allOpts.indexOf(opt);
                    tSwitch.setAttribute('data-selected', selectedThreadMode);
                    tSwitch.setAttribute('data-selected-idx', optIdx.toString());
                    tSwitch.style.setProperty('--idx', optIdx.toString());
                    updateDesc();
                });
            });
        }

        const copyLogsBtn = document.getElementById('btn-copy-compressor-logs');
        if (copyLogsBtn) {
            copyLogsBtn.addEventListener('click', () => {
                const logsEl = document.getElementById('compressor-logs');
                if (logsEl && logsEl.textContent) {
                    navigator.clipboard.writeText(logsEl.textContent);
                    if (typeof window.showToast === 'function') {
                        window.showToast(t('logs_copied'));
                    }
                }
            });
        }
    }

    async function getVideoMeta(file) {
        let width = 0;
        let height = 0;
        let fps = 0;

        // Try getting fps & dimensions from MP4 atoms first
        try {
            if (window._tktk && typeof window._tktk.inspectMp4Meta === 'function') {
                const specs = await window._tktk.inspectMp4Meta(file);
                if (specs) {
                    if (specs.fps) fps = specs.fps;
                    if (specs.res) {
                        width = specs.res.width;
                        height = specs.res.height;
                    }
                }
            }
        } catch (_) {}

        if (!fps) {
            try {
                const sliceBlob = file.slice(0, Math.min(file.size, 2 * 1024 * 1024));
                const buf = await sliceBlob.arrayBuffer();
                if (window._tktk && typeof window._tktk.parseFpsFromMp4 === 'function') {
                    fps = window._tktk.parseFpsFromMp4(buf);
                } else {
                    const data = new Uint8Array(buf);
                    const view = new DataView(buf);
                    for (let i = 0; i < data.length - 8; i++) {
                        if (data[i] === 0x76 && data[i+1] === 0x69 && data[i+2] === 0x64 && data[i+3] === 0x65) {
                            const sStart = Math.max(0, i - 300);
                            const sEnd = Math.min(data.length, i + 8000);
                            let ts = 0, sd = 0;
                            for (let j = sStart; j < sEnd - 8; j++) {
                                if (data[j] === 0x6D && data[j+1] === 0x64 && data[j+2] === 0x68 && data[j+3] === 0x64) {
                                    const ver = view.getUint8(j + 4);
                                    ts = ver === 1 ? view.getUint32(j + 24) : view.getUint32(j + 16);
                                }
                                if (data[j] === 0x73 && data[j+1] === 0x74 && data[j+2] === 0x74 && data[j+3] === 0x73) {
                                    const ec = view.getUint32(j + 8);
                                    if (ec > 0) sd = view.getUint32(j + 16);
                                }
                                if (ts && sd) {
                                    const f = Math.round(ts / sd);
                                    if (f > 0 && f < 300) { fps = f; break; }
                                }
                            }
                        }
                        if (fps) break;
                    }
                }
            } catch (_) {}
        }

        // Fallback / complement dimensions via HTML5 video element
        if (!width || !height) {
            try {
                const dims = await new Promise((resolve) => {
                    const video = document.createElement('video');
                    video.preload = 'metadata';
                    const url = URL.createObjectURL(file);
                    video.onloadedmetadata = () => {
                        URL.revokeObjectURL(url);
                        resolve({ width: video.videoWidth || 0, height: video.videoHeight || 0 });
                    };
                    video.onerror = () => {
                        URL.revokeObjectURL(url);
                        resolve({ width: 0, height: 0 });
                    };
                    video.src = url;
                    setTimeout(() => resolve({ width: 0, height: 0 }), 3000);
                });
                if (!width && dims.width) width = dims.width;
                if (!height && dims.height) height = dims.height;
            } catch (_) {}
        }

        return { width, height, fps: fps || 60 };
    }

    async function getVideoDimensions(file) {
        const meta = await getVideoMeta(file);
        return { width: meta.width, height: meta.height };
    }

    async function loadFFmpegLibraries() {
        if (window.FFmpegWASM && window.FFmpegUtil) return true;
        if (window.CutefishFFmpegLoader && window.CutefishFFmpegLoader.loadFFmpegLibraries) {
            return await window.CutefishFFmpegLoader.loadFFmpegLibraries();
        }
        const loadScript = (src) => new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src;
            s.onload = () => resolve(true);
            s.onerror = () => reject(new Error(`Failed to load ${src}`));
            document.head.appendChild(s);
        });

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
            console.error('Error loading FFmpeg libraries:', err);
        }
        return !!(window.FFmpegWASM && window.FFmpegUtil);
    }

    async function processVideoCompressor(file) {
        if (!file || isProcessing) return;
        isProcessing = true;

        const processBtn = document.getElementById('tool-process-btn');
        const processLabel = document.getElementById('tool-process-label');
        const progressSec = document.getElementById('tool-progress-section');
        const progressFill = document.getElementById('tool-progress-fill');
        const progressPercent = document.getElementById('tool-progress-percent');
        const progressStatus = document.getElementById('tool-progress-status');
        const logsContainer = document.getElementById('compressor-logs-container');
        const logsEl = document.getElementById('compressor-logs');

        if (processBtn) processBtn.disabled = true;
        if (progressSec) progressSec.classList.remove('hidden');
        if (logsContainer) logsContainer.classList.remove('hidden');
        if (logsEl) logsEl.textContent = '';
        if (progressFill) progressFill.style.width = '0%';
        if (progressPercent) progressPercent.textContent = '0%';
        if (progressStatus) progressStatus.textContent = t('status_initializing');
        if (window.ToolProgressManager) {
            window.ToolProgressManager.set('tool-video-compressor', { isProcessing: true, percent: 0, status: t('status_initializing'), file });
        }

        const fileMB = file.size / (1024 * 1024);
        logSection('Video Compressor — Initializing');
        log(`  File : ${file.name} (${fileMB.toFixed(2)} MB)`);
        log(`  Preset : ${selectedPreset.toUpperCase()}`);
        log(`  Threading : ${selectedThreadMode === 'single' ? 'Single-Thread' : 'Multi-Thread'}`);
        logEnd();

        if (fileMB > MAX_FILE_MB_HARD) {
            const err = new Error(`File too large (${fileMB.toFixed(0)} MB). Maximum limit is ${MAX_FILE_MB_HARD} MB.`);
            log(`\n!! Error: ${err.message}`);
            if (progressStatus) progressStatus.textContent = `Error: ${err.message}`;
            if (typeof window.showToast === 'function') window.showToast(err.message);
            if (window.ToolProgressManager) window.ToolProgressManager.clear('tool-video-compressor');
            isProcessing = false;
            if (processBtn) processBtn.disabled = false;
            return;
        }

        try {
            if (progressStatus) progressStatus.textContent = t('status_reading_file');
            if (window.ToolProgressManager) {
                window.ToolProgressManager.set('tool-video-compressor', { isProcessing: true, percent: 5, status: t('status_reading_file'), file });
            }
            const { width, height, fps } = await getVideoMeta(file);
            const needsScale = width > MAX_DIMENSION || height > MAX_DIMENSION;
            if (needsScale) {
                log(`  Auto-scaling: ${width}x${height} -> max ${MAX_DIMENSION}px`);
            }
            logSection('Video Source Profile');
            log(`  Resolution: ${width || 'auto'}x${height || 'auto'}`);
            log(`  Framerate: ${fps} FPS ${fps >= 45 ? '(High-Motion 60fps Optimization Active)' : '(Standard Framerate)'}`);
            logEnd();

            const isReady = await loadFFmpegLibraries();
            if (!isReady) {
                throw new Error('FFmpeg library failed to load. Please check your network connection.');
            }

            const { FFmpeg } = window.FFmpegWASM;
            const { fetchFile, toBlobURL } = window.FFmpegUtil;
            let ffmpeg = null;
            let oomDetected = false;

            // Some failures from ffmpeg.load()/toBlobURL are not Error objects,
            // so always extract a readable string (never log "undefined").
            const errMsg = (e) => {
                if (!e) return 'unknown error';
                if (e instanceof Error && e.message) return e.message;
                if (typeof e === 'string') return e;
                try { return JSON.stringify(e); } catch (_) { return String(e); }
            };

            const cdnBaseMT = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@0.12.6/dist/umd';
            const cdnBaseST = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd';
            const unpkgBaseMT = 'https://unpkg.com/@ffmpeg/core-mt@0.12.6/dist/umd';
            const unpkgBaseST = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
            const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Tablet/i.test(navigator.userAgent) ||
                (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

            // SharedArrayBuffer exists on Android Chrome even WITHOUT
            // cross-origin isolation, but it cannot be shared with workers
            // there -> the MT core hangs forever. Don't trust flags alone:
            // prove it by actually sharing a SAB with a worker.
            const canShareSABWithWorker = () => new Promise((resolve) => {
                let w = null;
                const timer = setTimeout(() => { if (w) { try { w.terminate(); } catch (_) {} } resolve(false); }, 2000);
                try {
                    if (typeof SharedArrayBuffer === 'undefined' || typeof Worker === 'undefined') {
                        clearTimeout(timer);
                        return resolve(false);
                    }
                    const blob = new Blob(['self.onmessage=function(e){self.postMessage(1)}'], { type: 'text/javascript' });
                    w = new Worker(URL.createObjectURL(blob));
                    w.onmessage = () => { clearTimeout(timer); try { w.terminate(); } catch (_) {} resolve(true); };
                    w.onerror = () => { clearTimeout(timer); try { w.terminate(); } catch (_) {} resolve(false); };
                    w.postMessage([new SharedArrayBuffer(8)]);
                } catch (e) {
                    clearTimeout(timer);
                    if (w) { try { w.terminate(); } catch (_) {} }
                    resolve(false);
                }
            });

            let attemptMultiThread = (selectedThreadMode === 'multi');
            if (attemptMultiThread) {
                const canUseMT = !isMobileDevice
                    && typeof SharedArrayBuffer !== 'undefined'
                    && typeof Atomics !== 'undefined'
                    && window.crossOriginIsolated === true;
                if (!canUseMT) {
                    log(`  [Notice] Multi-thread environment tidak didukung browser ini. Menggunakan Single-Thread.`);
                    attemptMultiThread = false;
                }
            }

            const withTimeout = (promise, ms, label) => new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error(`${label || 'Operation'} timed out after ${Math.round(ms / 1000)}s`)), ms);
                Promise.resolve(promise).then(
                    (v) => { clearTimeout(timer); resolve(v); },
                    (e) => {
                        clearTimeout(timer);
                        reject(e instanceof Error ? e : new Error(errMsg(e)));
                    }
                );
            });

            const runCompressionPass = async (useMT) => {
                let ffmpeg = null;
                let oomDetected = false;

                logSection(`FFmpeg Core Initialization (${useMT ? 'Multi-Thread' : 'Single-Thread'})`);
                log(`  Multi-threading: ${useMT ? 'Enabled' : 'Disabled'}`);

                const loadedInstance = await window.CutefishFFmpegLoader.getFFmpegInstance({
                    isMultiThread: useMT,
                    log
                });
                ffmpeg = loadedInstance;
                logEnd();

                ffmpeg.on('progress', ({ progress }) => {
                    const percent = Math.max(0, Math.min(100, Math.round(progress * 100)));
                    const statusMsg = `${t('status_encoding')}...`;
                    reportProgress(percent, statusMsg);
                    if (window.ToolProgressManager) {
                        window.ToolProgressManager.set('tool-video-compressor', { isProcessing: true, percent, status: statusMsg, file });
                    }
                });

                ffmpeg.on('log', ({ message }) => {
                    const lc = message.toLowerCase();
                    if (lc.includes('oom') || lc.includes('out of memory') || lc.includes('cannot allocate memory') || lc.includes('abort(')) {
                        oomDetected = true;
                    }
                    log(message);
                });

                logSection('FFmpeg — Writing Input File');
                await ffmpeg.writeFile('input.mp4', await fetchFile(file));
                log('  Write: DONE');
                logEnd();

                const threads = navigator.hardwareConcurrency ? Math.min(navigator.hardwareConcurrency, 4).toString() : '2';
                const scaleFilter = `scale='if(gt(iw,ih),min(iw,${MAX_DIMENSION}),-2)':'if(gt(iw,ih),-2,min(ih,${MAX_DIMENSION}))'`;

                let command = [];
                const isHighFps = (!fps || fps >= 45);
                const maxDim = Math.max(width, height);
                const is720pOrLess = (maxDim > 0 && maxDim <= 1280);

                let crfVal = '19';
                let maxRate = '16M';
                let bufSize = '28M';
                let audioBitrate = '192k';
                let x265Params = '';

                if (selectedPreset === 'slow') {
                    // SLOW Preset: Deep motion analysis, highest visual clarity, zero macroblocking
                    audioBitrate = '192k';
                    if (useMT) {
                        x265Params = 'pools=2:frame-threads=1:wpp=1:no-sao=1:rc-lookahead=20:qpmax=30:qcomp=0.75:deblock=-1,-1';
                        if (is720pOrLess) {
                            crfVal = isHighFps ? '18' : '18.5';
                            maxRate = isHighFps ? '14M' : '10M';
                            bufSize = isHighFps ? '24M' : '18M';
                        } else {
                            crfVal = isHighFps ? '18' : '18.5';
                            maxRate = isHighFps ? '20M' : '15M';
                            bufSize = isHighFps ? '32M' : '26M';
                        }
                    } else {
                        // Single-Thread H.264 Slow
                        if (is720pOrLess) {
                            crfVal = isHighFps ? '18' : '18.5';
                            maxRate = isHighFps ? '16M' : '12M';
                            bufSize = isHighFps ? '26M' : '20M';
                        } else {
                            crfVal = isHighFps ? '18' : '18.5';
                            maxRate = isHighFps ? '24M' : '18M';
                            bufSize = isHighFps ? '38M' : '30M';
                        }
                    }
                } else if (selectedPreset === 'fast') {
                    // FAST Preset: H.264 Veryfast, optimized headroom for 60fps fast motion
                    audioBitrate = '160k';
                    if (is720pOrLess) {
                        crfVal = isHighFps ? '21' : '22';
                        maxRate = isHighFps ? '9.5M' : '7.5M';
                        bufSize = isHighFps ? '16M' : '13M';
                    } else {
                        crfVal = isHighFps ? '21' : '22';
                        maxRate = isHighFps ? '14M' : '11M';
                        bufSize = isHighFps ? '24M' : '18M';
                    }
                } else {
                    // MEDIUM Preset (Normal): Optimal balance with robust anti-pixelation margin
                    audioBitrate = '192k';
                    if (useMT) {
                        x265Params = 'pools=2:frame-threads=1:wpp=1:no-sao=1:rc-lookahead=15:qpmax=32:qcomp=0.72:deblock=-1,-1';
                        if (is720pOrLess) {
                            crfVal = isHighFps ? '19' : '20';
                            maxRate = isHighFps ? '11M' : '8.5M';
                            bufSize = isHighFps ? '18M' : '15M';
                        } else {
                            crfVal = isHighFps ? '19' : '19.5';
                            maxRate = isHighFps ? '16M' : '13M';
                            bufSize = isHighFps ? '28M' : '22M';
                        }
                    } else {
                        // Single-Thread H.264 Medium
                        if (is720pOrLess) {
                            crfVal = isHighFps ? '19' : '20';
                            maxRate = isHighFps ? '13M' : '10M';
                            bufSize = isHighFps ? '22M' : '17M';
                        } else {
                            crfVal = isHighFps ? '19' : '19.5';
                            maxRate = isHighFps ? '19M' : '15M';
                            bufSize = isHighFps ? '32M' : '26M';
                        }
                    }
                }

                logSection('Compression Configuration');
                log(`  Preset : ${selectedPreset.toUpperCase()}`);
                log(`  Codec : ${useMT && selectedPreset !== 'fast' ? 'libx265 (HEVC hvc1)' : 'libx264 (H.264)'}`);
                log(`  CRF : ${crfVal}`);
                log(`  Bitrate Ceiling (Maxrate) : ${maxRate}`);
                log(`  Buffer Size (Bufsize) : ${bufSize}`);
                log(`  Audio Bitrate : ${audioBitrate}`);
                logEnd();

                if (selectedPreset === 'fast') {
                    // FAST: H.264 Veryfast, smallest size while maintaining HD & 60fps stability
                    command = [
                        '-y', '-i', 'input.mp4',
                        '-threads', useMT ? threads : '1',
                        '-map', '0:v:0',
                        '-map', '0:a:0?',
                        ...(needsScale ? ['-vf', scaleFilter] : []),
                        '-c:v', 'libx264',
                        '-preset', 'veryfast',
                        '-crf', crfVal,
                        '-maxrate', maxRate,
                        '-bufsize', bufSize,
                        '-pix_fmt', 'yuv420p',
                        '-c:a', 'aac',
                        '-b:a', audioBitrate,
                        '-movflags', '+faststart',
                        'output.mp4'
                    ];
                } else if (selectedPreset === 'slow') {
                    // SLOW: HEVC Deep Tuned (Multi-Thread) or H.264 Slow (Single-Thread Safe)
                    if (useMT) {
                        command = [
                            '-y', '-i', 'input.mp4',
                            '-threads', '2',
                            '-map', '0:v:0',
                            '-map', '0:a:0?',
                            ...(needsScale ? ['-vf', scaleFilter] : []),
                            '-c:v', 'libx265',
                            '-tag:v', 'hvc1',
                            '-preset', 'superfast',
                            '-crf', crfVal,
                            '-maxrate', maxRate,
                            '-bufsize', bufSize,
                            '-pix_fmt', 'yuv420p',
                            '-x265-params', x265Params,
                            '-c:a', 'aac',
                            '-b:a', audioBitrate,
                            '-movflags', '+faststart',
                            'output.mp4'
                        ];
                    } else {
                        log(`  [Notice] Single-Thread mode: Menggunakan libx264 (H.264 Slow, CRF ${crfVal}, Maxrate ${maxRate}) untuk mencegah deadlock WebAssembly.`);
                        command = [
                            '-y', '-i', 'input.mp4',
                            '-threads', '1',
                            '-map', '0:v:0',
                            '-map', '0:a:0?',
                            ...(needsScale ? ['-vf', scaleFilter] : []),
                            '-c:v', 'libx264',
                            '-preset', 'slow',
                            '-crf', crfVal,
                            '-maxrate', maxRate,
                            '-bufsize', bufSize,
                            '-pix_fmt', 'yuv420p',
                            '-c:a', 'aac',
                            '-b:a', audioBitrate,
                            '-movflags', '+faststart',
                            'output.mp4'
                        ];
                    }
                } else {
                    // MEDIUM (Normal): HEVC (Multi-Thread) or H.264 Medium (Single-Thread Safe)
                    if (useMT) {
                        command = [
                            '-y', '-i', 'input.mp4',
                            '-threads', '2',
                            '-map', '0:v:0',
                            '-map', '0:a:0?',
                            ...(needsScale ? ['-vf', scaleFilter] : []),
                            '-c:v', 'libx265',
                            '-tag:v', 'hvc1',
                            '-preset', 'ultrafast',
                            '-crf', crfVal,
                            '-maxrate', maxRate,
                            '-bufsize', bufSize,
                            '-pix_fmt', 'yuv420p',
                            '-x265-params', x265Params,
                            '-c:a', 'aac',
                            '-b:a', audioBitrate,
                            '-movflags', '+faststart',
                            'output.mp4'
                        ];
                    } else {
                        log(`  [Notice] Single-Thread mode: Menggunakan libx264 (H.264 Medium, CRF ${crfVal}, Maxrate ${maxRate}) untuk mencegah deadlock WebAssembly.`);
                        command = [
                            '-y', '-i', 'input.mp4',
                            '-threads', '1',
                            '-map', '0:v:0',
                            '-map', '0:a:0?',
                            ...(needsScale ? ['-vf', scaleFilter] : []),
                            '-c:v', 'libx264',
                            '-preset', 'medium',
                            '-crf', crfVal,
                            '-maxrate', maxRate,
                            '-bufsize', bufSize,
                            '-pix_fmt', 'yuv420p',
                            '-c:a', 'aac',
                            '-b:a', audioBitrate,
                            '-movflags', '+faststart',
                            'output.mp4'
                        ];
                    }
                }

                logSection('FFmpeg — Execution');
                log(`  Command: ffmpeg ${command.join(' ')}`);
                try {
                    await ffmpeg.exec(command);
                } catch (execError) {
                    try {
                        const testData = await ffmpeg.readFile('output.mp4');
                        if (!testData || testData.byteLength < 1024) throw execError;
                    } catch (rErr) {
                        throw execError;
                    }
                }
                logEnd();

                if (oomDetected) throw new Error('Memory limit exceeded during video processing (OOM).');

                if (progressStatus) progressStatus.textContent = t('status_finalizing');
                if (window.ToolProgressManager) {
                    window.ToolProgressManager.set('tool-video-compressor', { isProcessing: true, percent: 99, status: t('status_finalizing'), file });
                }
                const data = await ffmpeg.readFile('output.mp4');
                if (!data || data.byteLength < 1024) {
                    throw new Error('Compression failed: output file is empty or corrupt.');
                }

                const blob = new Blob([data], { type: 'video/mp4' });
                const outName = `compressed_${selectedPreset}_${file.name.replace(/\.[^.]+$/, '')}.mp4`;

                if (!activeContext) {
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = outName;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                }

                try {
                    await ffmpeg.deleteFile('input.mp4');
                    await ffmpeg.deleteFile('output.mp4');
                    await ffmpeg.terminate();
                } catch (_) {}

                return { outName, byteLength: data.byteLength, blob };
            };

            let passResult = null;
            try {
                passResult = await runCompressionPass(attemptMultiThread);
            } catch (firstErr) {
                if (attemptMultiThread) {
                    log(`\n⚠️ [AUTO-FALLBACK] Multi-Thread gagal / Out of Memory (${errMsg(firstErr)}).`);
                    log(`🔄 Mengulang otomatis menggunakan Single-Thread (Safe Mode)...\n`);
                    if (progressStatus) progressStatus.textContent = 'Memori penuh (OOM). Beralih ke Single-Thread...';
                    reportProgress(10, 'Memori penuh (OOM). Beralih ke Single-Thread...');
                    passResult = await runCompressionPass(false);
                } else {
                    throw firstErr;
                }
            }

            reportProgress(100, t('status_completed') || 'Done!');
            if (window.ToolProgressManager) {
                window.ToolProgressManager.set('tool-video-compressor', { isProcessing: false, completed: true, percent: 100, status: t('status_completed'), file });
            }

            logSection('Video Compressor — Completed');
            log(`  Output: ${passResult.outName}`);
            log(`  Output size: ${(passResult.byteLength / (1024 * 1024)).toFixed(2)} MB`);
            logEnd();

            const processIcon = document.getElementById('tool-process-icon');
            if (processBtn) {
                processBtn.disabled = false;
                processBtn.dataset.state = 'completed';
                if (processLabel) processLabel.textContent = t('status_process_another');
                if (processIcon) processIcon.textContent = 'restart_alt';
            }
            if (typeof window.showToast === 'function') {
                window.showToast(t('status_completed_toast'));
            }

            return {
                type: 'file',
                data: passResult ? passResult.blob : null,
                filename: passResult ? passResult.outName : `compressed_${file.name}`,
                mimeType: 'video/mp4'
            };
        } catch (err) {
            console.error('Video Compressor Error:', err);
            log(`\n!! Error: ${err.message}`);
            if (progressStatus) progressStatus.textContent = `Error: ${err.message}`;
            if (typeof window.showToast === 'function') {
                window.showToast(`Error: ${err.message}`);
            }
            if (window.ToolProgressManager) {
                window.ToolProgressManager.clear('tool-video-compressor');
            }
            throw err;
        } finally {
            isProcessing = false;
            if (processBtn) processBtn.disabled = false;
        }
    }

    const toolDefinition = {
        id: 'tool-video-compressor',
        _id: 'tool-video-compressor',
        isTool: true,
        version: '2.2.0',
        title: 'Video Compressor',
        titleKey: 'tool_compressor_title',
        desc: 'Compress video to custom quality and file sizes',
        descKey: 'tool_compressor_desc',
        icon: 'compress',
        category: ['Video', 'Tools'],
        features: [
            'H.264 & H.265 (HEVC) Codecs',
            'Fast (H.264), Normal (HEVC), & Slow (Deep Tuned)',
            'Multi-Thread with Auto OOM Single-Thread Fallback',
            '100% Client-side Local WebAssembly Processing'
        ],
        specs: [
            { label: 'ENGINE', value: 'FFmpeg WebAssembly' },
            { label: 'FORMAT', value: 'MP4, MOV, WebM, MKV' },
            { label: 'PROCESSING', value: '100% Client-side (Local)' }
        ],
        schema: {
            inputs: [
                {
                    id: 'videoFile',
                    type: 'file',
                    label: 'Video File',
                    labelKey: 'tool_compressor_drop',
                    subtitle: 'Supports MP4, MOV, WebM',
                    accept: ['video/mp4', 'video/quicktime', 'video/webm', 'video/*'],
                    required: true,
                    maxSizeMb: 1500
                },
                {
                    id: 'preset',
                    name: 'preset',
                    type: 'segmented',
                    label: 'Preset',
                    default: 'medium',
                    options: [
                        { value: 'fast', label: 'Fast' },
                        { value: 'medium', label: 'Balanced' },
                        { value: 'slow', label: 'Quality' }
                    ]
                },
                {
                    id: 'threadMode',
                    name: 'threadMode',
                    type: 'segmented',
                    label: 'Thread',
                    default: 'multi',
                    options: [
                        { value: 'multi', label: 'Multi-Thread' },
                        { value: 'single', label: 'Single-Thread' }
                    ]
                }
            ]
        },
        run: async function(inputs, context = {}) {
            activeContext = context;
            const file = inputs.videoFile || inputs.file || selectedFile;
            if (!file) throw new Error('No video file provided.');
            if (inputs.preset) selectedPreset = inputs.preset;
            if (inputs.threadMode) selectedThreadMode = inputs.threadMode;

            return await processVideoCompressor(file);
        },
        initModal: initCompressorUI,
        onProcess: processVideoCompressor,
        onReset: function() {
            selectedFile = null;
            isProcessing = false;
            activeContext = null;
            const logsContainer = document.getElementById('compressor-logs-container');
            if (logsContainer) logsContainer.classList.add('hidden');
            const logs = document.getElementById('compressor-logs');
            if (logs) logs.textContent = '';
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

    window.VideoCompressorTool = toolDefinition;
})();
