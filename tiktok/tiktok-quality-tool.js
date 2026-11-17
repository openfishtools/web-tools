(function() {
    'use strict';

    function t(key) {
        if (typeof window.getTranslation === 'function') {
            const res = window.getTranslation(key);
            if (res && res !== key) return res;
        }
        return key;
    }

    function tOpt(key, fallback) {
        if (key && typeof window.getTranslation === 'function') {
            const res = window.getTranslation(key);
            if (res && res !== key) return res;
        }
        return fallback;
    }

    let selectedFile = null;
    let currentFileBuffer = null;
    let isProcessing = false;
    let currentVersion = '';
    let compressMode = 'off';
    let currentInspectedFile = null;
    let currentVideoSpecs = null;
    let isExtensionDetected = false;
    let activeContext = null;

    const MAX_FILE_MB = 1500;

    function escapeHTML(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function appendToLogsEl(msg) {
        if (activeContext && typeof activeContext.onLog === 'function') {
            activeContext.onLog(msg);
        }
        const logsEl = document.getElementById('tiktok-logs');
        if (logsEl) {
            logsEl.textContent += msg + '\n';
            logsEl.scrollTop = logsEl.scrollHeight;
        }
    }

    function log(msg) {
        appendToLogsEl(msg);
    }

    function logSection(title) {
        appendToLogsEl(`\n=== ${title} ===`);
    }

    function logEnd() {
        appendToLogsEl('====================\n');
    }

    function isIosDevice() {
        return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    }

    function isMobileDevice() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Tablet/i.test(navigator.userAgent) ||
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    }

    function errMsg(e) {
        if (!e) return 'unknown error';
        if (e instanceof Error && e.message) return e.message;
        if (typeof e === 'string') return e;
        try { return JSON.stringify(e); } catch (_) { return String(e); }
    }



    // SharedArrayBuffer exists on Android Chrome even WITHOUT cross-origin
    // isolation, but it cannot be shared with workers there -> the MT core
    // hangs forever. Don't trust flags alone: prove it by actually sharing
    // a SAB with a worker.
    function canShareSABWithWorker() {
        return new Promise((resolve) => {
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
    }

    async function supportsMultiThread() {
        if (isMobileDevice()) return false;
        if (typeof SharedArrayBuffer === 'undefined' || typeof Atomics === 'undefined') return false;
        if (window.crossOriginIsolated !== true) return false;
        return true;
    }

    // ffmpeg.load()/toBlobURL can hang silently on mobile — never leave the
    // user stuck: every step gets a hard timeout so we can fall back.
    function withTimeout(promise, ms, label) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`${label || 'Operation'} timed out after ${Math.round(ms / 1000)}s`)), ms);
            Promise.resolve(promise).then(
                (v) => { clearTimeout(timer); resolve(v); },
                (e) => {
                    clearTimeout(timer);
                    reject(e instanceof Error ? e : new Error(errMsg(e)));
                }
            );
        });
    }

    function detectBrowser() {
        const ua = navigator.userAgent;
        if (ua.includes('Chrome')) return 'Chrome';
        if (ua.includes('Safari')) return 'Safari';
        if (ua.includes('Firefox')) return 'Firefox';
        return 'Browser';
    }

    function detectOS() {
        const ua = navigator.userAgent;
        if (ua.includes('Windows')) return 'Windows';
        if (ua.includes('Mac')) return 'macOS';
        if (ua.includes('Android')) return 'Android';
        if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS';
        return 'OS';
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

    async function loadFFmpegHelper(ffmpeg, toBlobURL, forceSingleThread = false) {
        const isMultiThread = forceSingleThread ? false : await supportsMultiThread();
        logSection('FFmpeg Initialization');
        log(`  Multi-threading: ${isMultiThread ? 'Enabled' : 'Disabled'}`);

        return await window.CutefishFFmpegLoader.getFFmpegInstance({
            isMultiThread,
            log
        });
    }

    function parseFpsFromMp4(buffer) {
        try {
            const data = new Uint8Array(buffer);
            const view = new DataView(buffer);

            // Prioritize video track ('vide') to avoid audio track sample rates (e.g. 48000/1024=47fps)
            for (let i = 0; i < data.length - 8; i++) {
                if (data[i] === 0x76 && data[i+1] === 0x69 && data[i+2] === 0x64 && data[i+3] === 0x65) {
                    const searchStart = Math.max(0, i - 300);
                    const searchEnd = Math.min(data.length, i + 8000);
                    let timescale = 0;
                    let sampleDelta = 0;
                    for (let j = searchStart; j < searchEnd - 8; j++) {
                        if (data[j] === 0x6D && data[j+1] === 0x64 && data[j+2] === 0x68 && data[j+3] === 0x64) {
                            const version = view.getUint8(j + 4);
                            timescale = version === 1 ? view.getUint32(j + 24) : view.getUint32(j + 16);
                        }
                        if (data[j] === 0x73 && data[j+1] === 0x74 && data[j+2] === 0x74 && data[j+3] === 0x73) {
                            const entryCount = view.getUint32(j + 8);
                            if (entryCount > 0) {
                                sampleDelta = view.getUint32(j + 16);
                            }
                        }
                        if (timescale && sampleDelta) {
                            const fps = Math.round(timescale / sampleDelta);
                            if (fps > 0 && fps < 300) return fps;
                        }
                    }
                }
            }

            let timescale = 0;
            let sampleDelta = 0;
            for (let i = 0; i < data.length - 8; i++) {
                if (data[i] === 0x6D && data[i+1] === 0x64 && data[i+2] === 0x68 && data[i+3] === 0x64) {
                    const version = view.getUint8(i + 4);
                    timescale = version === 1 ? view.getUint32(i + 24) : view.getUint32(i + 16);
                }
                if (data[i] === 0x73 && data[i+1] === 0x74 && data[i+2] === 0x74 && data[i+3] === 0x73) {
                    const entryCount = view.getUint32(i + 8);
                    if (entryCount > 0) {
                        sampleDelta = view.getUint32(i + 16);
                    }
                }
                if (timescale && sampleDelta) {
                    const fps = Math.round(timescale / sampleDelta);
                    if (fps > 0 && fps < 300) return fps;
                }
            }
        } catch (e) {}
        return 60;
    }

    function parseResolutionFromMp4(buffer) {
        try {
            const data = new Uint8Array(buffer);
            const view = new DataView(buffer);
            for (let i = 0; i < data.length - 8; i++) {
                if (data[i] === 0x74 && data[i+1] === 0x6B && data[i+2] === 0x68 && data[i+3] === 0x64) {
                    const version = view.getUint8(i + 4);
                    const wOffset = version === 1 ? i + 92 : i + 80;
                    const hOffset = version === 1 ? i + 96 : i + 84;
                    if (wOffset + 4 <= buffer.byteLength) {
                        let width = Math.round(view.getUint32(wOffset) / 65536);
                        let height = Math.round(view.getUint32(hOffset) / 65536);

                        // Detect rotation matrix in tkhd (fix Alight Motion vertical export bug)
                        const matrixOffset = version === 1 ? (i - 4) + 60 : (i - 4) + 48;
                        if (matrixOffset + 36 <= buffer.byteLength && width > 0 && height > 0) {
                            const m0 = view.getInt32(matrixOffset, false) / 65536;
                            const m1 = view.getInt32(matrixOffset + 4, false) / 65536;
                            const m3 = view.getInt32(matrixOffset + 12, false) / 65536;
                            const m4 = view.getInt32(matrixOffset + 16, false) / 65536;
                            // Only swap on a real ~90°/~270° rotation: both diagonal
                            // components (a & d) are ~0 ONLY in quarter-turn matrices.
                            // Identity (m0=1,m4=1) and 180° (m0=-1,m4=-1) must NOT swap.
                            if (Math.abs(m0) < 0.5 && Math.abs(m4) < 0.5) {
                                const temp = width;
                                width = height;
                                height = temp;
                            }
                        }

                        if (width > 0 && height > 0 && width < 16000 && height < 16000) return { width, height, rotated: (width !== Math.round(view.getUint32(wOffset) / 65536) || height !== Math.round(view.getUint32(hOffset) / 65536)) };
                    }
                }
            }
        } catch (e) {}
        return { width: 1080, height: 1920, rotated: false };
    }

    function computeVideoProcessingOptions(w, h, fps, fileMB, mode) {
        let targetW = w || 1080;
        let targetH = h || 1920;
        const qualityShortSide = (mode === '720p') ? 720 : (mode === '1080p') ? 1080 : null;
        if (qualityShortSide) {
            // Flexible: scale the SHORT side to the quality target and keep the
            // source aspect ratio. Works for landscape, portrait AND square
            // (e.g. 1080x1080 -> 720x720) without forcing black bars.
            const shortSide = Math.min(targetW, targetH);
            if (shortSide > 0) {
                const ratio = qualityShortSide / shortSide;
                targetW = Math.round(targetW * ratio);
                targetH = Math.round(targetH * ratio);
            }
        }
        targetW = Math.floor(targetW / 2) * 2;
        targetH = Math.floor(targetH / 2) * 2;
        return {
            width: targetW,
            height: targetH,
            vfString: `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`
        };
    }

    async function clearAllToolCache(btnEl) {
        if (typeof window.clearAllToolCache === 'function') {
            return window.clearAllToolCache(btnEl);
        }
        if (isProcessing) return;
        if (btnEl) {
            btnEl.disabled = true;
            const icon = btnEl.querySelector('.material-symbols-rounded');
            if (icon) {
                icon.style.transition = 'transform 0.6s var(--ease-spring-soft)';
                icon.style.transform = 'rotate(720deg) scale(1.2)';
            }
        }

        if (typeof window.showToast === 'function') {
            window.showToast(t('cache_purging_toast'));
        }

        if ('serviceWorker' in navigator) {
            try {
                const regs = await navigator.serviceWorker.getRegistrations();
                for (const reg of regs) await reg.unregister();
            } catch (e) {}
        }
        if ('caches' in window) {
            try {
                const names = await caches.keys();
                await Promise.all(names.map(name => caches.delete(name)));
            } catch (e) {}
        }
        if (window.indexedDB && typeof window.indexedDB.databases === 'function') {
            try {
                const dbs = await window.indexedDB.databases();
                for (const db of dbs) {
                    if (db.name) window.indexedDB.deleteDatabase(db.name);
                }
            } catch (e) {}
        }
        try {
            const savedLang = localStorage.getItem('user_lang');
            sessionStorage.clear();
            localStorage.clear();
            if (savedLang) localStorage.setItem('user_lang', savedLang);
        } catch (e) {}

        currentFileBuffer = null;
        selectedFile = null;

        setTimeout(() => {
            window.location.reload();
        }, 400);
    }

    const TARGET_USERSCRIPT_VERSION = '1.5.3';
    let detectedUserscriptVersion = null;

    function checkExtensionPresence() {
        if (typeof window !== 'undefined') {
            if (window.__TIKTOK_CLOUD_DISABLER_VERSION__) {
                detectedUserscriptVersion = window.__TIKTOK_CLOUD_DISABLER_VERSION__;
            } else if (document.documentElement && document.documentElement.dataset.tiktokCloudDisablerVersion) {
                detectedUserscriptVersion = document.documentElement.dataset.tiktokCloudDisablerVersion;
            }
            if (window.__TIKTOK_CLOUD_DISABLER__ || (document.documentElement && document.documentElement.dataset.tiktokCloudDisabler === 'active')) {
                isExtensionDetected = true;
                return Promise.resolve(true);
            }
        }
        return new Promise((resolve) => {
            let timer = null;
            function onMsg(ev) {
                if (ev.data && (ev.data.type === 'TIKTOK_CLOUD_DISABLER_PONG' || ev.data.type === 'ADJN_PONG')) {
                    window.removeEventListener('message', onMsg);
                    if (timer) clearTimeout(timer);
                    if (ev.data.version) detectedUserscriptVersion = ev.data.version;
                    isExtensionDetected = true;
                    resolve(true);
                }
            }
            window.addEventListener('message', onMsg);
            try {
                window.postMessage({ type: 'TIKTOK_CLOUD_DISABLER_PING' }, '*');
            } catch (_) {}
            timer = setTimeout(() => {
                window.removeEventListener('message', onMsg);
                if (!isExtensionDetected && typeof window !== 'undefined' && (window.__TIKTOK_CLOUD_DISABLER__ || (document.documentElement && document.documentElement.dataset.tiktokCloudDisabler === 'active'))) {
                    isExtensionDetected = true;
                    if (window.__TIKTOK_CLOUD_DISABLER_VERSION__) {
                        detectedUserscriptVersion = window.__TIKTOK_CLOUD_DISABLER_VERSION__;
                    }
                }
                resolve(isExtensionDetected);
            }, 250);
        });
    }

    async function inspectMp4Meta(file) {
        if (!file) return null;
        let width = 0;
        let height = 0;
        let fps = 0;

        function scanBuffer(buffer) {
            let foundFps = 0;
            let foundRes = null;
            try {
                const data = new Uint8Array(buffer);
                const view = new DataView(buffer);

                // Prioritize video track ('vide') for fps
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
                                if (f > 0 && f < 300) { foundFps = f; break; }
                            }
                        }
                    }
                    if (foundFps) break;
                }

                let timescale = 0;
                let sampleDelta = 0;
                for (let i = 0; i < data.length - 8; i++) {
                    if (data[i] === 0x6D && data[i+1] === 0x64 && data[i+2] === 0x68 && data[i+3] === 0x64) {
                        if (i + 28 <= buffer.byteLength) {
                            const version = view.getUint8(i + 4);
                            timescale = version === 1 ? view.getUint32(i + 24) : view.getUint32(i + 16);
                        }
                    }
                    if (data[i] === 0x73 && data[i+1] === 0x74 && data[i+2] === 0x74 && data[i+3] === 0x73) {
                        if (i + 20 <= buffer.byteLength) {
                            const entryCount = view.getUint32(i + 8);
                            if (entryCount > 0) {
                                sampleDelta = view.getUint32(i + 16);
                            }
                        }
                    }
                    if (timescale && sampleDelta && !foundFps) {
                        const f = Math.round(timescale / sampleDelta);
                        if (f > 0 && f < 300) foundFps = f;
                    }
                    if (data[i] === 0x74 && data[i+1] === 0x6B && data[i+2] === 0x68 && data[i+3] === 0x64) {
                        const version = view.getUint8(i + 4);
                        const wOffset = version === 1 ? i + 92 : i + 80;
                        const hOffset = version === 1 ? i + 96 : i + 84;
                        if (wOffset + 4 <= buffer.byteLength && hOffset + 4 <= buffer.byteLength) {
                            let w = Math.round(view.getUint32(wOffset) / 65536);
                            let h = Math.round(view.getUint32(hOffset) / 65536);
                            if (w > 0 && h > 0 && w < 16000 && h < 16000) {
                                foundRes = { width: w, height: h };
                            }
                        }
                    }
                }
            } catch (e) {}
            return { fps: foundFps, res: foundRes };
        }

        try {
            const headBlob = file.slice(0, Math.min(file.size, 2 * 1024 * 1024));
            const headBuf = await headBlob.arrayBuffer();
            const headRes = scanBuffer(headBuf);
            if (headRes.fps) fps = headRes.fps;
            if (headRes.res) {
                width = headRes.res.width;
                height = headRes.res.height;
            }

            if ((!fps || !width) && file.size > 2 * 1024 * 1024) {
                const tailStart = Math.max(0, file.size - 4 * 1024 * 1024);
                const tailBlob = file.slice(tailStart, file.size);
                const tailBuf = await tailBlob.arrayBuffer();
                const tailRes = scanBuffer(tailBuf);
                if (!fps && tailRes.fps) fps = tailRes.fps;
                if (!width && tailRes.res) {
                    width = tailRes.res.width;
                    height = tailRes.res.height;
                }
            }
        } catch (e) {}

        if (!width || !height) {
            try {
                await new Promise((resolve) => {
                    const v = document.createElement('video');
                    v.preload = 'metadata';
                    const url = URL.createObjectURL(file);
                    v.onloadedmetadata = () => {
                        width = v.videoWidth || width;
                        height = v.videoHeight || height;
                        URL.revokeObjectURL(url);
                        resolve();
                    };
                    v.onerror = () => {
                        URL.revokeObjectURL(url);
                        resolve();
                    };
                    v.src = url;
                });
            } catch (e) {}
        }

        return {
            width: width || 1080,
            height: height || 1920,
            fps: fps || 60,
            size: file.size || 0
        };
    }

    function updateExtensionWarning() {
        const slot = document.getElementById('tiktok-ext-alert-slot');
        const processBtn = document.getElementById('tool-process-btn');
        const processLabel = document.getElementById('tool-process-label');

        if (slot) slot.innerHTML = '';
        if (processBtn && !isProcessing && processBtn.dataset.state === 'blocked') {
            processBtn.disabled = false;
            processBtn.dataset.state = 'ready';
            if (processLabel) processLabel.textContent = (window.getTranslation && window.getTranslation('patcher_start_process')) || 'Process Video';
        }
    }

    function showTikTokStudioUploadPrompt() {
        const slot = document.getElementById('tiktok-upload-prompt-slot');
        if (!slot) return;
        slot.innerHTML = `
            <div class="tiktok-studio-upload-card" id="tiktok-studio-upload-card" style="background: rgba(190, 220, 116, 0.06); border: 1px solid rgba(190, 220, 116, 0.35); border-radius: 12px; padding: 14px 16px; margin-top: 14px; display: flex; flex-direction: column; gap: 8px;">
                <div style="display: flex; align-items: center; gap: 8px; color: var(--md-sys-color-primary, #bedc74); font-size: 13.5px; font-weight: 700;">
                    <span class="material-symbols-rounded">cloud_upload</span>
                    <span>${t('patcher_upload_studio_title') || 'Video siap diunggah'}</span>
                </div>
                <p style="font-size: 12px; line-height: 1.5; color: var(--md-sys-color-on-surface, #edf0e8); margin: 0;">
                    ${t('patcher_upload_studio_desc') || 'Video telah berhasil dipatch. Buka Zernio untuk melanjutkan proses upload.'}
                </p>
                <div style="display: flex; align-items: center; margin-top: 4px;">
                    <a href="https://zernio.com/" target="_blank" rel="noopener noreferrer" style="display: inline-flex; align-items: center; justify-content: center; gap: 6px; background: var(--md-sys-color-primary, #bedc74); color: var(--md-sys-color-on-primary, #1a2c00); font-size: 12.5px; font-weight: 600; text-decoration: none; padding: 8px 16px; border-radius: 9999px; transition: opacity 0.15s ease;">
                        <span class="material-symbols-rounded" style="font-size: 18px;">open_in_new</span>
                        <span>${t('patcher_upload_studio_btn') || 'Buka Zernio'}</span>
                    </a>
                </div>
            </div>
        `;
    }

    function removeTikTokStudioUploadPrompt() {
        const slot = document.getElementById('tiktok-upload-prompt-slot');
        if (slot) slot.innerHTML = '';
    }

    function isSpecsOver1080p() {
        if (!currentVideoSpecs) return false;
        const shortSide = Math.min(currentVideoSpecs.width, currentVideoSpecs.height);
        const longSide = Math.max(currentVideoSpecs.width, currentVideoSpecs.height);
        return shortSide > 1080 || longSide > 1920;
    }

    function isSpecsOver60Mb() {
        const sz = (currentVideoSpecs && currentVideoSpecs.size) || (currentInspectedFile && currentInspectedFile.size) || 0;
        return sz > 60 * 1024 * 1024;
    }

    function isSpecsOver120Fps() {
        if (!currentVideoSpecs) return false;
        return currentVideoSpecs.fps >= 120;
    }

    function isSpecsOver60Fps() {
        if (!currentVideoSpecs) return false;
        return currentVideoSpecs.fps > 60;
    }

    function updateCompressUIForSpecs() {
        const cSwitch = document.getElementById('tiktok-compress-mode');
        if (!cSwitch) return;

        const offOpt = cSwitch.querySelector('.tiktok-switch-option[data-mode="off"]');
        if (isSpecsOver1080p()) {
            if (offOpt) {
                offOpt.classList.add('disabled');
                offOpt.setAttribute('title', 'Resolusi > 1080p wajib dikompres (pilihan OFF dinonaktifkan)');
                offOpt.style.opacity = '0.35';
                offOpt.style.cursor = 'not-allowed';
            }
            if (compressMode === 'off') {
                compressMode = '1080p';
            }
        } else {
            if (offOpt) {
                offOpt.classList.remove('disabled');
                offOpt.removeAttribute('title');
                offOpt.style.opacity = '';
                offOpt.style.cursor = '';
            }
        }

        const allOpts = Array.from(cSwitch.querySelectorAll('.tiktok-switch-option'));
        let activeIdx = 0;
        allOpts.forEach((o, i) => {
            if (o.getAttribute('data-mode') === compressMode) {
                o.classList.add('active');
                activeIdx = i;
            } else {
                o.classList.remove('active');
            }
        });
        cSwitch.setAttribute('data-selected', compressMode);
        cSwitch.setAttribute('data-selected-idx', activeIdx.toString());
        cSwitch.style.setProperty('--idx', activeIdx.toString());
        updateDesc();
    }

    async function inspectAndAlert(file) {
        if (!file) return;
        removeTikTokStudioUploadPrompt();
        currentInspectedFile = file;
        currentVideoSpecs = await inspectMp4Meta(file);
        await checkExtensionPresence();
        updateCompressUIForSpecs();
        updateExtensionWarning();
    }

    if (typeof window !== 'undefined') {
        window.addEventListener('message', (ev) => {
            if (ev.data && (ev.data.type === 'TIKTOK_CLOUD_DISABLER_PONG' || ev.data.type === 'ADJN_PONG')) {
                isExtensionDetected = true;
                updateExtensionWarning();
            }
        });
        window.addEventListener('languageChanged', () => {
            updateDesc();
            updateExtensionWarning();
        });
    }

    function parseDescTags(input) {
        if (!input || typeof input !== 'string') return null;
        const str = input.trim();
        if (str.startsWith('<div class="tiktok-desc-card"')) {
            return null;
        }
        const tagMatch = /\[(format|codec|mode|resolution|res|method|fps|framerate|info|credit|favorite|warning|warn|item:[^\]]+)\]/i;
        if (!tagMatch.test(str)) {
            return null;
        }
        const isEn = (typeof window !== 'undefined' && window.currentLang === 'en');
        const items = [];
        const footers = [];
        const re = /\[(format|codec|mode|resolution|res|method|fps|framerate|info|credit|favorite|warning|warn|item:[^\]]+)\]([\s\S]*?)(?=\[(?:format|codec|mode|resolution|res|method|fps|framerate|info|credit|favorite|warning|warn|item:[^\]]+)\]|$)/gi;
        let match;
        while ((match = re.exec(str)) !== null) {
            const rawTag = match[1].trim().toLowerCase();
            const content = match[2].trim();
            if (!content) continue;
            if (rawTag === 'info') {
                footers.push({ icon: 'info', text: content });
            } else if (rawTag === 'credit' || rawTag === 'favorite') {
                footers.push({ icon: 'favorite', text: content });
            } else if (rawTag === 'warning' || rawTag === 'warn') {
                footers.push({ icon: 'warning', text: content });
            } else if (rawTag.startsWith('item:')) {
                const parts = match[1].slice(5).split(':');
                const icon = parts[0] || 'info';
                const label = parts[1] || 'Info';
                items.push({ icon, label, value: content });
            } else {
                let icon = 'info';
                let label = rawTag.charAt(0).toUpperCase() + rawTag.slice(1);
                if (rawTag === 'format') { icon = 'movie'; label = 'Format'; }
                else if (rawTag === 'codec') { icon = 'memory'; label = 'Codec'; }
                else if (rawTag === 'mode') { icon = 'tune'; label = 'Mode'; }
                else if (rawTag === 'resolution' || rawTag === 'res') { icon = 'aspect_ratio'; label = isEn ? 'Resolution' : 'Resolusi'; }
                else if (rawTag === 'method') { icon = 'verified'; label = isEn ? 'method' : 'metode'; }
                else if (rawTag === 'fps' || rawTag === 'framerate') { icon = 'speed'; label = 'Framerate'; }
                items.push({ icon, label, value: content });
            }
        }
        return { items, footers };
    }

    function buildDescCardHtml({ items = [], footers = [] }) {
        let html = '<div class="tiktok-desc-card">';
        if (items.length > 0) {
            html += '<ul class="tiktok-desc-list">';
            items.forEach(item => {
                html += `<li><span class="material-symbols-rounded">${item.icon || 'info'}</span><strong>${item.label}:</strong> ${item.value}</li>`;
            });
            html += '</ul>';
        }
        if (footers.length > 0) {
            footers.forEach((footer, idx) => {
                if (items.length > 0 || idx > 0) {
                    html += '<hr class="tiktok-desc-divider">';
                }
                const isWarn = (footer.icon === 'warning');
                const rowClass = isWarn ? 'tiktok-desc-warning-row' : 'tiktok-desc-footer';
                html += `
                    <div class="${rowClass}">
                        <span class="material-symbols-rounded">${footer.icon || 'info'}</span>
                        <span>${footer.text}</span>
                    </div>
                `;
            });
        }
        html += '</div>';
        return html;
    }

    function renderModularDescCard(parsedOrHtml) {
        if (!parsedOrHtml) return '';
        if (typeof parsedOrHtml === 'string') {
            let str = parsedOrHtml.trim();
            if (str.startsWith('<div class="tiktok-desc-card"')) {
                const tagMatch = /\[(format|codec|mode|resolution|res|method|fps|framerate|info|credit|favorite|warning|warn|item:[^\]]+)\]/i;
                if (tagMatch.test(str)) {
                    const parsed = parseDescTags(str);
                    if (parsed && parsed.items.length > 0 && str.includes('</ul>')) {
                        const extraLi = parsed.items.map(it => `<li><span class="material-symbols-rounded">${it.icon || 'info'}</span><strong>${it.label}:</strong> ${it.value}</li>`).join('');
                        str = str.replace('</ul>', `${extraLi}</ul>`);
                    }
                    if (parsed && parsed.footers.length > 0 && str.includes('</div>')) {
                        const extraFooters = parsed.footers.map(f => `
                            <hr class="tiktok-desc-divider">
                            <div class="${f.icon === 'warning' ? 'tiktok-desc-warning-row' : 'tiktok-desc-footer'}">
                                <span class="material-symbols-rounded">${f.icon || 'info'}</span>
                                <span>${f.text}</span>
                            </div>
                        `).join('');
                        const lastDivIdx = str.lastIndexOf('</div>');
                        str = str.slice(0, lastDivIdx) + extraFooters + '</div>';
                    }
                    str = str.replace(/\[(?:format|codec|mode|resolution|res|method|fps|framerate|info|credit|favorite|warning|warn|item:[^\]]+)\][\s\S]*?(?=\[(?:format|codec|mode|resolution|res|method|fps|framerate|info|credit|favorite|warning|warn|item:[^\]]+)\]|$)/gi, '');
                }
                return str.trim();
            }
            const parsed = parseDescTags(str);
            if (parsed && (parsed.items.length > 0 || parsed.footers.length > 0)) {
                return buildDescCardHtml(parsed);
            }
            return `
                <div class="tiktok-desc-card">
                    <div class="tiktok-desc-footer">
                        <span class="material-symbols-rounded">info</span>
                        <span>${str}</span>
                    </div>
                </div>
            `;
        }
        if (typeof parsedOrHtml === 'object') {
            return buildDescCardHtml(parsedOrHtml);
        }
        return '';
    }

    if (typeof window !== 'undefined') {
        window.renderModularDescCard = renderModularDescCard;
    }

    function getRegistry() {
        return (typeof window !== 'undefined' && window.TikTokMethods) ? window.TikTokMethods : null;
    }

    function getAllRegisteredMethods() {
        const reg = getRegistry();
        if (reg && typeof reg.getAll === 'function') return reg.getAll();
        if (reg && Array.isArray(reg._items)) return reg._items.slice();
        return [];
    }

    function getActiveMethod(methodId) {
        const reg = getRegistry();
        const targetId = methodId || currentVersion;
        if (reg && typeof reg.getById === 'function') {
            return reg.getById(targetId) || (typeof reg.getDefault === 'function' ? reg.getDefault() : null);
        }
        const items = getAllRegisteredMethods();
        if (items.length === 0) return null;
        const lower = String(targetId || '').toLowerCase();
        return items.find(m =>
            m.id.toLowerCase() === lower ||
            (Array.isArray(m.aliases) && m.aliases.some(a => String(a).toLowerCase() === lower))
        ) || items[0] || null;
    }

    function getDynamicCategories() {
        const items = getAllRegisteredMethods();
        const catDefs = {
            recommended: {
                id: 'recommended',
                labelKey: 'patcher_cat_recommended',
                defaultLabel: 'Rekomendasi',
                icon: 'verified',
                methods: []
            },
            backup: {
                id: 'backup',
                labelKey: 'patcher_cat_backup',
                defaultLabel: 'Cadangan',
                icon: 'history',
                methods: []
            }
        };

        for (const m of items) {
            const catKey = m.category || 'recommended';
            if (!catDefs[catKey]) {
                catDefs[catKey] = {
                    id: catKey,
                    labelKey: `patcher_cat_${catKey}`,
                    defaultLabel: catKey.toUpperCase(),
                    icon: 'tune',
                    methods: []
                };
            }
            catDefs[catKey].methods.push({
                id: m.id,
                labelKey: m.labelKey || '',
                defaultLabel: m.name || m.id.toUpperCase(),
                raw: m
            });
        }

        return catDefs;
    }

    const lastSelectedPerCat = {};

    function getCategoryForMethod(methodId) {
        const m = getActiveMethod(methodId);
        return (m && m.category) ? m.category : 'recommended';
    }

    function updateDesc() {
        const descEl = document.getElementById('tiktok-info-desc');
        if (!descEl) return;

        const activeMethod = getActiveMethod(currentVersion);
        const isEn = (typeof window !== 'undefined' && window.currentLang === 'en');
        const lang = isEn ? 'en' : 'id';
        const modeKey = (activeMethod && activeMethod.supportsCompress === false) ? 'off' : (compressMode || 'off');

        let baseDesc = '';
        if (activeMethod && activeMethod.descriptions) {
            const langMap = activeMethod.descriptions[lang] || activeMethod.descriptions.id || {};
            baseDesc = langMap[modeKey] || langMap.off || '';
        }

        baseDesc = renderModularDescCard(baseDesc);

        if (currentVideoSpecs) {
            const badges = [];
            const patchName = (activeMethod && activeMethod.name) ? activeMethod.name : (currentVersion || '').toUpperCase();

            if (isSpecsOver1080p()) {
                const resText = (t('patcher_notice_res_limit') || 'Resolusi <strong>{res}</strong> (&gt; 1080p) terdeteksi. Kompresi otomatis diatur ke <strong>1080p</strong>.')
                    .replace('{res}', `${currentVideoSpecs.width}x${currentVideoSpecs.height}`);
                badges.push(`
                    <div class="tiktok-desc-warning-row">
                        <span class="material-symbols-rounded">warning</span>
                        <span>${resText}</span>
                    </div>
                `);
            }
            if (isSpecsOver60Mb()) {
                const sizeVal = ((currentVideoSpecs.size || (currentInspectedFile && currentInspectedFile.size) || 0) / (1024 * 1024)).toFixed(1);
                const sizeText = (t('patcher_notice_size_60mb') || 'Ukuran video <strong>{size} MB</strong> (&gt; 60 MB) terdeteksi. Disarankan untuk dikompresi agar proses upload lancar (opsional).')
                    .replace('{size}', sizeVal);
                badges.push(`
                    <div class="tiktok-desc-info-row">
                        <span class="material-symbols-rounded">folder_open</span>
                        <span>${sizeText}</span>
                    </div>
                `);
            }
            if (isSpecsOver120Fps()) {
                const fpsText = (t('patcher_notice_fps_120') || 'Video <strong>{fps} FPS</strong> (&gt; 120 FPS) terdeteksi. Wajib normalisasi slow motion.')
                    .replace('{fps}', currentVideoSpecs.fps);
                badges.push(`
                    <div class="tiktok-desc-warning-row">
                        <span class="material-symbols-rounded">speed</span>
                        <span>${fpsText}</span>
                    </div>
                `);
            } else if (isSpecsOver60Fps()) {
                let fpsText = '';
                if (activeMethod && activeMethod.handlesOwn60FpsSlowmo) {
                    fpsText = (t('patcher_notice_fps_direct') || 'Video <strong>{fps} FPS</strong> (&gt; 60 FPS) terdeteksi. Dikonversi ke <strong>60 FPS slow motion</strong>.')
                        .replace('{fps}', currentVideoSpecs.fps);
                } else {
                    fpsText = (t('patcher_notice_fps_emergency') || 'Video <strong>{fps} FPS</strong> (&gt; 60 FPS) terdeteksi. Dikonversi ke <strong>60 FPS slow motion</strong> sebelum patch <strong>{method}</strong>.')
                        .replace('{fps}', currentVideoSpecs.fps)
                        .replace('{method}', patchName);
                }
                badges.push(`
                    <div class="tiktok-desc-info-row">
                        <span class="material-symbols-rounded">speed</span>
                        <span>${fpsText}</span>
                    </div>
                `);
            }

            if (badges.length > 0) {
                const noticeHtml = badges.join('');
                baseDesc = noticeHtml + baseDesc;
            }
        }

        descEl.innerHTML = baseDesc;
    }

    // ===== Mode switch (Web / Extension) =====
    let qualityUiMode = 'web';
    // Video tutorial YouTube Shorts (Fish Acceleration). Bisa di-override runtime
    // via window.setExtensionTutorialUrl(url).
    let extYoutubeTutorialUrl = 'https://youtube.com/shorts/xftaz12NQMo';

    const FP_EXT_REPO_OWNER = 'cutefishaep';
    const FP_EXT_REPO_NAME = 'fp-ext';
    const FP_EXT_GITHUB_API_LATEST = `https://api.github.com/repos/${FP_EXT_REPO_OWNER}/${FP_EXT_REPO_NAME}/releases/latest`;
    const FP_EXT_GITHUB_RELEASES_PAGE = `https://github.com/${FP_EXT_REPO_OWNER}/${FP_EXT_REPO_NAME}/releases`;
    const FP_EXT_CACHE_KEY = 'fp_ext_latest_release_cache';

    const EXT_I18N = {
        id: {
            tutorialTitle: 'Tutorial Video',
            videoPending: 'Tutorial Video',
            videoPendingDesc: 'Video tutorial akan segera tersedia di sini.',
            quettaTitle: 'Quetta Browser',
            quettaTag: 'Android / Mobile',
            quettaDesc: 'Khusus pengguna HP / Android untuk memasang ekstensi di ponsel.',
            quettaBtn: 'Download Quetta',
            extTitle: 'Download Ekstensi',
            chipVer: 'Versi',
            chipSize: 'Ukuran',
            chipDate: 'Diperbarui',
            chipStatus: 'Status',
            statusSafe: 'Latest Stable',
            btnDownload: 'Download',
            btnGithub: 'GitHub'
        },
        en: {
            tutorialTitle: 'Video Tutorial',
            videoPending: 'Video Tutorial',
            videoPendingDesc: 'Video tutorial will be available here soon.',
            quettaTitle: 'Quetta Browser',
            quettaTag: 'Android / Mobile',
            quettaDesc: 'For mobile / Android users to install extensions on smartphones.',
            quettaBtn: 'Download Quetta',
            extTitle: 'Download Extension',
            chipVer: 'Version',
            chipSize: 'Size',
            chipDate: 'Updated',
            chipStatus: 'Status',
            statusSafe: 'Latest Stable',
            btnDownload: 'Download',
            btnGithub: 'GitHub'
        }
    };

    function extLang() {
        if (window.getCurrentLanguage && typeof window.getCurrentLanguage === 'function') {
            const lang = window.getCurrentLanguage();
            if (lang === 'id' || lang === 'en') return lang;
        }
        return (navigator.language && navigator.language.startsWith('id')) ? 'id' : 'en';
    }

    function extText(key) {
        const lang = extLang();
        return (EXT_I18N[lang] && EXT_I18N[lang][key]) || EXT_I18N.en[key] || key;
    }

    function extractYouTubeEmbedUrl(url) {
        if (!url || typeof url !== 'string') return null;
        const trimmed = url.trim();
        if (!trimmed) return null;

        const m = trimmed.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/i);
        if (m && m[1]) {
            return `https://www.youtube-nocookie.com/embed/${m[1]}?rel=0`;
        }
        return null;
    }

    async function fetchExtReleaseFromGithubApi() {
        try {
            const res = await fetch(FP_EXT_GITHUB_API_LATEST, {
                headers: { 'Accept': 'application/vnd.github.v3+json' }
            });
            if (!res.ok) return null;
            const data = await res.json();

            let zipAsset = null;
            if (Array.isArray(data.assets)) {
                zipAsset = data.assets.find(a => (a.name || '').endsWith('.zip')) || null;
            }
            if (!data.tag_name || !zipAsset) return null;

            return {
                tag: data.tag_name,
                name: data.name || `Fish Acceleration ${data.tag_name}`,
                publishedAt: data.published_at || null,
                zipUrl: zipAsset.browser_download_url,
                zipSize: zipAsset.size || null,
                releaseUrl: data.html_url || FP_EXT_GITHUB_RELEASES_PAGE
            };
        } catch (_) {
            return null;
        }
    }

    async function fetchExtReleaseFromJsDelivr() {
        try {
            const res = await fetch(`https://data.jsdelivr.com/v1/packages/gh/${FP_EXT_REPO_OWNER}/${FP_EXT_REPO_NAME}`);
            if (!res.ok) return null;
            const data = await res.json();
            const versions = Array.isArray(data.versions) ? data.versions : [];
            const latest = versions.find(v => v && v.version && !v.dev);
            if (!latest) return null;

            const raw = String(latest.version).trim();
            const tag = raw.startsWith('v') ? raw : `v${raw}`;
            return {
                tag: tag,
                name: `Fish Acceleration ${tag}`,
                publishedAt: null,
                zipUrl: `https://github.com/${FP_EXT_REPO_OWNER}/${FP_EXT_REPO_NAME}/releases/download/${tag}/fish-acceleration-${tag}.zip`,
                zipSize: null,
                releaseUrl: `https://github.com/${FP_EXT_REPO_OWNER}/${FP_EXT_REPO_NAME}/releases/tag/${tag}`
            };
        } catch (_) {
            return null;
        }
    }

    async function fetchExtLatestRelease() {
        try {
            const cached = sessionStorage.getItem(FP_EXT_CACHE_KEY);
            if (cached) {
                const parsed = JSON.parse(cached);
                if (Date.now() - parsed.timestamp < 10 * 60 * 1000 && parsed.data) {
                    return parsed.data;
                }
            }
        } catch (_) {}

        // Chain: GitHub API (exact assets) -> jsDelivr versions (no rate limit).
        // No hardcoded release data: when both fail, UI shows placeholders and
        // the download button points to the releases page.
        const result = (await fetchExtReleaseFromGithubApi())
            || (await fetchExtReleaseFromJsDelivr())
            || null;

        if (result) {
            try {
                sessionStorage.setItem(FP_EXT_CACHE_KEY, JSON.stringify({
                    timestamp: Date.now(),
                    data: result
                }));
            } catch (_) {}
        }

        return result;
    }

    function extFormatBytes(bytes) {
        if (!bytes || isNaN(bytes)) return '~85 KB';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    }

    function extFormatDate(isoStr) {
        if (!isoStr) return '—';
        try {
            const d = new Date(isoStr);
            const lang = extLang();
            return d.toLocaleDateString(lang === 'id' ? 'id-ID' : 'en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
        } catch {
            return '—';
        }
    }

    function injectQualityModeStyles() {
        if (document.getElementById('tiktok-quality-mode-styles')) return;
        const style = document.createElement('style');
        style.id = 'tiktok-quality-mode-styles';
        style.textContent = `
            .tiktok-mode-header {
                position: sticky;
                top: 0;
                z-index: 5;
                display: flex;
                flex-direction: column;
                gap: 6px;
                margin: -12px 0 4px;
                padding: 4px 0 6px;
                background: var(--md-sys-color-surface-container, #172118);
            }
            /* Mode selector (Web <-> Extension) - segmented sliding switch, centered */
            .tiktok-mode-row {
                display: flex;
                justify-content: center;
            }
            #tiktok-mode-switch {
                min-width: 260px;
                width: auto;
                max-width: 100%;
            }

            .ext-modal-container {
                display: flex !important;
                flex-direction: column !important;
                gap: 14px !important;
                width: 100% !important;
                box-sizing: border-box !important;
            }
            .ext-card-section {
                background: var(--md-sys-color-surface-container, #172118) !important;
                border: 1px solid var(--md-sys-color-outline-variant, rgba(255, 255, 255, 0.1)) !important;
                border-radius: var(--radius-l, 16px) !important;
                padding: 10px 20px 16px !important;
                display: flex !important;
                flex-direction: column !important;
                gap: 10px !important;
                box-sizing: border-box !important;
            }
            .ext-modal-container > .ext-card-section:first-child {
                margin-top: -4px !important;
            }
            .ext-section-header {
                display: flex !important;
                align-items: center !important;
                gap: 10px !important;
                font-size: 14.5px !important;
                font-weight: 600 !important;
                color: var(--md-sys-color-on-surface, #f2f7f2) !important;
            }
            .ext-section-header .material-symbols-rounded {
                font-size: 20px !important;
                color: var(--md-sys-color-primary, #a3dba7) !important;
            }
            .ext-video-wrap {
                width: 100% !important;
                aspect-ratio: 16 / 9 !important;
                border-radius: var(--radius-m, 12px) !important;
                overflow: hidden !important;
                background: var(--md-sys-color-surface-container-highest, #232d24) !important;
                border: 1px solid var(--md-sys-color-outline-variant, rgba(255, 255, 255, 0.08)) !important;
                position: relative !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
            }
            .ext-video-wrap iframe {
                position: absolute !important;
                inset: 0 !important;
                width: 100% !important;
                height: 100% !important;
                border: none !important;
            }
            .ext-video-wrap a.ext-btn-quetta {
                position: absolute !important;
                inset: 0 !important;
                width: 100% !important;
                height: 100% !important;
            }
            /* Lite-embed: thumbnail klik-untuk-play (tahan COEP/adblock lebih baik) */
            .ext-video-litestub {
                position: absolute !important;
                inset: 0 !important;
                width: 100% !important;
                height: 100% !important;
                padding: 0 !important;
                border: none !important;
                background: none !important;
                cursor: pointer !important;
                display: block !important;
            }
            .ext-video-thumb {
                width: 100% !important;
                height: 100% !important;
                object-fit: cover !important;
                display: block !important;
            }
            .ext-video-playbtn {
                position: absolute !important;
                top: 50% !important;
                left: 50% !important;
                transform: translate(-50%, -50%) !important;
                width: 60px !important;
                height: 42px !important;
                border-radius: 12px !important;
                background: rgba(0, 0, 0, 0.72) !important;
                pointer-events: none !important;
            }
            .ext-video-playbtn::after {
                content: '' !important;
                position: absolute !important;
                top: 50% !important;
                left: 50% !important;
                transform: translate(-42%, -50%) !important;
                border-left: 15px solid #ffffff !important;
                border-top: 9px solid transparent !important;
                border-bottom: 9px solid transparent !important;
            }
            .ext-video-placeholder {
                display: flex !important;
                flex-direction: column !important;
                align-items: center !important;
                justify-content: center !important;
                gap: 10px !important;
                padding: 24px !important;
                text-align: center !important;
            }
            .ext-video-placeholder .material-symbols-rounded {
                font-size: 48px !important;
                color: var(--md-sys-color-primary, #a3dba7) !important;
                opacity: 0.85 !important;
            }
            .ext-video-placeholder-title {
                font-size: 14px !important;
                font-weight: 600 !important;
                color: var(--md-sys-color-on-surface, #f2f7f2) !important;
            }
            .ext-video-placeholder-desc {
                font-size: 12px !important;
                color: var(--md-sys-color-on-surface-variant, rgba(242, 247, 242, 0.65)) !important;
                max-width: 380px !important;
                line-height: 1.45 !important;
            }

            /* Quetta Browser Card */
            .ext-quetta-card {
                background: linear-gradient(135deg, rgba(30, 41, 31, 0.95), rgba(23, 33, 24, 0.95)) !important;
                border: 1px solid rgba(163, 219, 167, 0.22) !important;
                gap: 10px !important;
            }
            .ext-quetta-header-row {
                display: flex !important;
                align-items: center !important;
                justify-content: space-between !important;
                gap: 10px !important;
            }
            .ext-quetta-tag {
                background: rgba(163, 219, 167, 0.12) !important;
                color: #a3dba7 !important;
                border: 1px solid rgba(163, 219, 167, 0.25) !important;
                border-radius: 6px !important;
                padding: 2px 8px !important;
                font-size: 11px !important;
                font-weight: 600 !important;
            }
            .ext-quetta-desc {
                font-size: 12.5px !important;
                color: var(--md-sys-color-on-surface-variant, rgba(242, 247, 242, 0.75)) !important;
                margin: 0 !important;
                line-height: 1.45 !important;
            }
            .ext-btn-quetta {
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                gap: 8px !important;
                background: var(--md-sys-color-surface-container-high, #1e291f) !important;
                color: var(--md-sys-color-primary, #a3dba7) !important;
                border: 1px solid rgba(163, 219, 167, 0.35) !important;
                border-radius: var(--radius-m, 12px) !important;
                padding: 11px 18px !important;
                font-size: 13.5px !important;
                font-weight: 600 !important;
                text-decoration: none !important;
                width: 100% !important;
                box-sizing: border-box !important;
                transition: all 0.2s ease !important;
            }
            .ext-btn-quetta:hover {
                background: rgba(163, 219, 167, 0.15) !important;
                border-color: #a3dba7 !important;
                transform: translateY(-1px) !important;
            }

            /* Release 2x2 Grid */
            .ext-release-info-grid {
                display: grid !important;
                grid-template-columns: repeat(2, 1fr) !important;
                gap: 10px !important;
            }
            .ext-release-chip {
                background: var(--md-sys-color-surface-container-high, #1e291f) !important;
                border: 1px solid var(--md-sys-color-outline-variant, rgba(255, 255, 255, 0.08)) !important;
                border-radius: var(--radius-m, 12px) !important;
                padding: 10px 14px !important;
                display: flex !important;
                flex-direction: column !important;
                gap: 3px !important;
            }
            .ext-chip-label {
                font-size: 10.5px !important;
                color: var(--md-sys-color-on-surface-variant, rgba(242, 247, 242, 0.55)) !important;
                text-transform: uppercase !important;
                letter-spacing: 0.4px !important;
                font-weight: 600 !important;
            }
            .ext-chip-val {
                font-size: 13.5px !important;
                font-weight: 700 !important;
                color: var(--md-sys-color-on-surface, #f2f7f2) !important;
            }
            .ext-chip-val.badge-safe {
                color: var(--md-sys-color-primary, #a3dba7) !important;
            }

            /* Actions Row - Balanced 2 Columns */
            .ext-download-actions {
                display: grid !important;
                grid-template-columns: 1fr 1fr !important;
                gap: 10px !important;
                width: 100% !important;
                box-sizing: border-box !important;
                margin-top: 4px !important;
            }
            .ext-btn-download {
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                gap: 8px !important;
                background: var(--md-sys-color-primary, #a3dba7) !important;
                color: var(--md-sys-color-on-primary, #0c3912) !important;
                border: none !important;
                border-radius: var(--radius-m, 12px) !important;
                padding: 12px 16px !important;
                font-size: 13.5px !important;
                font-weight: 600 !important;
                cursor: pointer !important;
                text-decoration: none !important;
                box-sizing: border-box !important;
                width: 100% !important;
                text-align: center !important;
                transition: opacity 0.2s ease, transform 0.15s ease !important;
            }
            .ext-btn-download:hover {
                opacity: 0.92 !important;
                transform: translateY(-1px) !important;
            }
            .ext-btn-secondary {
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                gap: 8px !important;
                background: var(--md-sys-color-surface-container-high, #1e291f) !important;
                color: var(--md-sys-color-on-surface, #f2f7f2) !important;
                border: 1px solid var(--md-sys-color-outline-variant, rgba(255, 255, 255, 0.12)) !important;
                border-radius: var(--radius-m, 12px) !important;
                padding: 12px 16px !important;
                font-size: 13.5px !important;
                font-weight: 500 !important;
                cursor: pointer !important;
                text-decoration: none !important;
                box-sizing: border-box !important;
                width: 100% !important;
                text-align: center !important;
                transition: background 0.2s ease !important;
            }
            .ext-btn-secondary:hover {
                background: var(--md-sys-color-surface-container-highest, #232d24) !important;
            }

            @media (max-width: 480px) {
                .ext-download-actions {
                    grid-template-columns: 1fr !important;
                }
            }
        `;
        document.head.appendChild(style);
    }

    function setQualityChromeVisible(visible) {
        const dropZone = document.getElementById('tool-drop-zone');
        const processBtn = document.getElementById('tool-process-btn');
        const progressSec = document.getElementById('tool-progress-section');
        const fileBadge = document.getElementById('tool-file-badge');
        if (dropZone) dropZone.classList.toggle('hidden', !visible);
        if (processBtn && processBtn.parentElement) processBtn.parentElement.classList.toggle('hidden', !visible);
        // Never force-show progress or file badge: hide in Extension mode, leave
        // natural state (hidden until file selected / processing) in Web mode.
        if (!visible) {
            if (progressSec) progressSec.classList.add('hidden');
            if (fileBadge) fileBadge.classList.add('hidden');
        }
    }

    function renderExtensionModeUI(container) {
        const embedUrl = extractYouTubeEmbedUrl(extYoutubeTutorialUrl);

        container.innerHTML = `
            <div class="ext-modal-container">
                <!-- 1. Kolom Tutorial di Atas -->
                <div class="ext-card-section">
                    <div class="ext-section-header">
                        <span class="material-symbols-rounded">smart_display</span>
                        <span>${extText('tutorialTitle')}</span>
                    </div>

                    <div class="ext-video-wrap" id="ext-video-container">
                        ${embedUrl ? `
                            <button type="button" class="ext-video-litestub" data-embed-src="${embedUrl}" data-watch-url="https://www.youtube.com/watch?v=${extYoutubeTutorialUrl.match(/([\w-]{11})/)[1]}" title="Play video tutorial">
                                <img class="ext-video-thumb" src="https://i.ytimg.com/vi/${extYoutubeTutorialUrl.match(/([\w-]{11})/)[1]}/hqdefault.jpg" alt="" loading="lazy" referrerpolicy="no-referrer">
                                <span class="ext-video-playbtn"></span>
                            </button>
                        ` : `
                            <div class="ext-video-placeholder">
                                <span class="material-symbols-rounded">play_circle</span>
                                <div class="ext-video-placeholder-title">${extText('videoPending')}</div>
                                <div class="ext-video-placeholder-desc">${extText('videoPendingDesc')}</div>
                            </div>
                        `}
                    </div>
                </div>

                <!-- 2. Quetta Browser (Di Atas Ekstensi) -->
                <div class="ext-card-section ext-quetta-card">
                    <div class="ext-quetta-header-row">
                        <div class="ext-section-header">
                            <span class="material-symbols-rounded">phone_android</span>
                            <span>${extText('quettaTitle')}</span>
                        </div>
                        <span class="ext-quetta-tag">${extText('quettaTag')}</span>
                    </div>
                    <p class="ext-quetta-desc">${extText('quettaDesc')}</p>
                    <a href="https://www.quetta.net/" target="_blank" rel="noopener noreferrer" class="ext-btn-quetta">
                        <span class="material-symbols-rounded">download</span>
                        <span>${extText('quettaBtn')}</span>
                        <span class="material-symbols-rounded" style="font-size: 16px; margin-left: 2px;">arrow_outward</span>
                    </a>
                </div>

                <!-- 3. Block Download Extension di Bawah -->
                <div class="ext-card-section ext-download-box">
                    <div class="ext-section-header">
                        <span class="material-symbols-rounded">download</span>
                        <span>${extText('extTitle')}</span>
                    </div>

                    <div class="ext-release-info-grid">
                        <div class="ext-release-chip">
                            <span class="ext-chip-label">${extText('chipVer')}</span>
                            <span class="ext-chip-val badge-safe" id="ext-ver-text">...</span>
                        </div>
                        <div class="ext-release-chip">
                            <span class="ext-chip-label">${extText('chipSize')}</span>
                            <span class="ext-chip-val" id="ext-size-text">...</span>
                        </div>
                        <div class="ext-release-chip">
                            <span class="ext-chip-label">${extText('chipDate')}</span>
                            <span class="ext-chip-val" id="ext-date-text">...</span>
                        </div>
                        <div class="ext-release-chip">
                            <span class="ext-chip-label">${extText('chipStatus')}</span>
                            <span class="ext-chip-val badge-safe">${extText('statusSafe')}</span>
                        </div>
                    </div>

                    <div class="ext-download-actions">
                        <a href="${FP_EXT_GITHUB_RELEASES_PAGE}" id="ext-download-btn" class="ext-btn-download" download>
                            <span class="material-symbols-rounded">download</span>
                            <span>${extText('btnDownload')}</span>
                        </a>
                        <a href="${FP_EXT_GITHUB_RELEASES_PAGE}" id="ext-github-btn" class="ext-btn-secondary" target="_blank" rel="noopener noreferrer">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
                            </svg>
                            <span>${extText('btnGithub')}</span>
                        </a>
                    </div>
                </div>
            </div>
        `;

        // Fetch release terbaru secara asinkron dan update UI.
        // Tanpa data hardcoded: kalau semua sumber gagal, chips tetap "—"
        // dan tombol Download mengarah ke halaman releases.
        fetchExtLatestRelease().then(release => {
            const verEl = container.querySelector('#ext-ver-text');
            const sizeEl = container.querySelector('#ext-size-text');
            const dateEl = container.querySelector('#ext-date-text');
            const dlBtn = container.querySelector('#ext-download-btn');
            const ghBtn = container.querySelector('#ext-github-btn');

            if (verEl) verEl.textContent = release ? release.tag : '—';
            if (sizeEl) sizeEl.textContent = (release && release.zipSize) ? extFormatBytes(release.zipSize) : '—';
            if (dateEl) dateEl.textContent = (release && release.publishedAt) ? extFormatDate(release.publishedAt) : '—';
            if (dlBtn && release && release.zipUrl) dlBtn.href = release.zipUrl;
            if (ghBtn && release && release.releaseUrl) ghBtn.href = release.releaseUrl;

            // Update badge tool card jika ada
            const cardEl = document.querySelector(`.tool-card[data-id="tool-tiktok-patcher"] .tool-ver-badge`);
            if (cardEl && release && release.tag) {
                cardEl.textContent = release.tag;
            }
        });

        // Lite-embed: klik thumbnail -> iframe YouTube. Halaman dengan cross-origin
        // isolation aktif (COEP via coi-serviceworker) memblokir iframe YouTube
        // ("refused to connect") → fallback: tombol buka YouTube di tab baru.
        const stub = container.querySelector('.ext-video-litestub');
        if (stub) {
            stub.addEventListener('click', () => {
                const src = stub.dataset.embedSrc;
                const watchUrl = stub.dataset.watchUrl;
                if (!src) return;

                if (window.crossOriginIsolated === true) {
                    // COEP aktif: iframe pasti diblokir — buka langsung di YouTube
                    const fallback = document.createElement('a');
                    fallback.className = 'ext-btn-quetta';
                    fallback.href = watchUrl;
                    fallback.target = '_blank';
                    fallback.rel = 'noopener noreferrer';
                    fallback.innerHTML = `
                        <span class="material-symbols-rounded">smart_display</span>
                        <span>Watch the tutorial on YouTube</span>
                        <span class="material-symbols-rounded" style="font-size: 16px; margin-left: 2px;">arrow_outward</span>
                    `;
                    const wrap = container.querySelector('#ext-video-container');
                    wrap.innerHTML = '';
                    wrap.appendChild(fallback);
                    if (watchUrl) window.open(watchUrl, '_blank', 'noopener');
                    return;
                }

                const iframe = document.createElement('iframe');
                iframe.src = src + (src.includes('?') ? '&' : '?') + 'autoplay=1';
                iframe.title = 'YouTube video player';
                iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
                iframe.referrerPolicy = 'strict-origin-when-cross-origin';
                iframe.allowFullscreen = true;
                const wrapEl = container.querySelector('#ext-video-container');
                wrapEl.innerHTML = '';
                wrapEl.appendChild(iframe);
            });
        }
    }

    function initQualityMethodUI() {
        const optContainer = document.getElementById('tool-dynamic-options');
        if (!optContainer) return;
        injectQualityModeStyles();

        // Mode switch lives ABOVE the drop zone, inserted as its own block.
        const dropZone = document.getElementById('tool-drop-zone');
        let header;
        if (dropZone && dropZone.parentElement) {
            header = document.getElementById('tiktok-quality-mode-header');
            if (!header) {
                header = document.createElement('div');
                header.id = 'tiktok-quality-mode-header';
                header.className = 'tiktok-mode-header';
                dropZone.parentElement.insertBefore(header, dropZone);
            }
        } else {
            header = document.createElement('div');
            header.className = 'tiktok-mode-header';
        }

        header.innerHTML = `
            <div class="tiktok-mode-row">
                <div class="tiktok-switch-track" id="tiktok-mode-switch" data-selected="${qualityUiMode}" data-count="2" data-selected-idx="${qualityUiMode === 'extension' ? 1 : 0}" style="--total: 2; --idx: ${qualityUiMode === 'extension' ? 1 : 0};" aria-label="Mode Web atau Extension">
                    <div class="tiktok-switch-indicator"></div>
                    <div class="tiktok-switch-option ${qualityUiMode === 'web' ? 'active' : ''}" data-mode="web">Web</div>
                    <div class="tiktok-switch-option ${qualityUiMode === 'extension' ? 'active' : ''}" data-mode="extension">Extension</div>
                </div>
            </div>
        `;

        const applyMode = (targetMode) => {
            if (targetMode === qualityUiMode) return;
            qualityUiMode = targetMode;
            initQualityMethodUI();
            const modalBodyEl = document.querySelector('.tool-modal-body');
            if (modalBodyEl) modalBodyEl.scrollTop = 0;
        };
        const modeSwitch = header.querySelector('#tiktok-mode-switch');
        if (modeSwitch) {
            modeSwitch.querySelectorAll('.tiktok-switch-option').forEach(opt => {
                opt.addEventListener('click', () => applyMode(opt.getAttribute('data-mode')));
            });
        }

        // Fallback host when the modal has no drop zone: prepend the header here.
        if (!dropZone || !dropZone.parentElement) {
            optContainer.innerHTML = '';
            optContainer.appendChild(header);
        }

        // Rebuild body container; keep the fallback header (no drop zone case).
        optContainer.innerHTML = '';
        if (!dropZone || !dropZone.parentElement) {
            optContainer.appendChild(header);
        }
        const modeBody = document.createElement('div');
        modeBody.id = 'tiktok-mode-body';
        optContainer.appendChild(modeBody);

        if (qualityUiMode === 'extension') {
            setQualityChromeVisible(false);
            renderExtensionModeUI(modeBody);
            return;
        }

        setQualityChromeVisible(true);
        initWebModeUI(modeBody);
    }

    function initWebModeUI(container) {
        const categories = getDynamicCategories();
        const availableCats = Object.values(categories).filter(c => c.methods.length > 0);
        const fallbackCatKey = availableCats.length > 0 ? availableCats[0].id : 'recommended';

        let activeCategory = getCategoryForMethod(currentVersion);
        if (!categories[activeCategory] || categories[activeCategory].methods.length === 0) {
            activeCategory = fallbackCatKey;
        }
        const catData = categories[activeCategory] || { methods: [] };

        if (catData.methods.length > 0 && !catData.methods.some(m => m.id === currentVersion)) {
            currentVersion = (lastSelectedPerCat[activeCategory] && catData.methods.some(m => m.id === lastSelectedPerCat[activeCategory]))
                ? lastSelectedPerCat[activeCategory]
                : catData.methods[0].id;
        }
        lastSelectedPerCat[activeCategory] = currentVersion;

        const activeMethod = getActiveMethod(currentVersion);
        const showCompress = !activeMethod || (activeMethod.supportsCompress !== false);
        const compressList = ['off', '720p', '1080p'];
        const cIdx = compressList.indexOf(compressMode);
        const selectedCIdx = cIdx >= 0 ? cIdx : 0;

        container.innerHTML = `
            <div class="tiktok-category-header">
                <div class="tiktok-switcher-label">${t('patcher_ver_title')}</div>
                <div class="tiktok-category-tabs" role="tablist">
                    ${availableCats.map(cat => `
                        <button type="button" class="tiktok-category-tab ${activeCategory === cat.id ? 'active' : ''}" data-category="${cat.id}" role="tab" aria-selected="${activeCategory === cat.id}">
                            <span class="material-symbols-rounded">${cat.icon || 'verified'}</span>
                            <span>${tOpt(cat.labelKey, cat.defaultLabel)}</span>
                        </button>
                    `).join('')}
                </div>
            </div>
            <div class="tiktok-switch-scroll" id="tiktok-version-scroll"></div>

            <div id="tiktok-compress-row" style="display: ${showCompress ? 'block' : 'none'};">
                <div class="tiktok-switcher-label">${t('patcher_compress_title')}</div>
                <div class="tiktok-switch-scroll">
                    <div class="tiktok-switch-track" id="tiktok-compress-mode" data-selected="${compressMode}" data-count="3" data-selected-idx="${selectedCIdx}" style="--total: 3; --idx: ${selectedCIdx};">
                        <div class="tiktok-switch-indicator"></div>
                        <div class="tiktok-switch-option ${compressMode === 'off' ? 'active' : ''}" data-mode="off">OFF</div>
                        <div class="tiktok-switch-option ${compressMode === '720p' ? 'active' : ''}" data-mode="720p">720P</div>
                        <div class="tiktok-switch-option ${compressMode === '1080p' ? 'active' : ''}" data-mode="1080p">1080P</div>
                    </div>
                </div>
            </div>

            <div class="tiktok-preset-desc" id="tiktok-info-desc"></div>

            <div id="tiktok-ext-alert-slot"></div>
            <div id="tiktok-upload-prompt-slot"></div>

            <div class="process-logs-wrap hidden" id="tiktok-logs-container">
                <div class="process-logs-header">
                    <span class="process-logs-title">${t('patcher_logs_title')}</span>
                    <button type="button" class="btn-copy-logs" id="btn-copy-logs">
                        <span class="material-symbols-rounded">content_copy</span>
                        <span>${t('res_modal_copy')}</span>
                    </button>
                </div>
                <pre class="process-logs-pre" id="tiktok-logs"></pre>
            </div>
        `;

        function renderMethodTrack(catKey) {
            activeCategory = catKey;
            const latestCategories = getDynamicCategories();
            const currentCatData = latestCategories[catKey] || latestCategories[fallbackCatKey] || { methods: [] };
            const scrollContainer = document.getElementById('tiktok-version-scroll');
            if (!scrollContainer || currentCatData.methods.length === 0) return;

            if (!currentCatData.methods.some(m => m.id === currentVersion)) {
                currentVersion = (lastSelectedPerCat[catKey] && currentCatData.methods.some(m => m.id === lastSelectedPerCat[catKey]))
                    ? lastSelectedPerCat[catKey]
                    : currentCatData.methods[0].id;
            }
            lastSelectedPerCat[catKey] = currentVersion;

            const activeIdx = Math.max(0, currentCatData.methods.findIndex(m => m.id === currentVersion));
            const count = currentCatData.methods.length;

            scrollContainer.innerHTML = `
                <div class="tiktok-switch-track" id="tiktok-version-switch" data-selected="${currentVersion}" data-count="${count}" data-selected-idx="${activeIdx}" style="--total: ${count}; --idx: ${activeIdx};">
                    <div class="tiktok-switch-indicator"></div>
                    ${currentCatData.methods.map((m, idx) => `
                        <div class="tiktok-switch-option ${m.id === currentVersion ? 'active' : ''}" data-version="${m.id}" data-idx="${idx}">${tOpt(m.labelKey, m.defaultLabel)}</div>
                    `).join('')}
                </div>
            `;

            const vSwitch = document.getElementById('tiktok-version-switch');
            const cRow = document.getElementById('tiktok-compress-row');

            if (vSwitch) {
                vSwitch.querySelectorAll('.tiktok-switch-option').forEach(opt => {
                    opt.addEventListener('click', () => {
                        const allOpts = Array.from(vSwitch.querySelectorAll('.tiktok-switch-option'));
                        allOpts.forEach(o => o.classList.remove('active'));
                        opt.classList.add('active');
                        currentVersion = opt.getAttribute('data-version') || currentCatData.methods[0].id;
                        lastSelectedPerCat[activeCategory] = currentVersion;
                        const optIdx = opt.getAttribute('data-idx') || '0';
                        vSwitch.setAttribute('data-selected', currentVersion);
                        vSwitch.setAttribute('data-selected-idx', optIdx);
                        vSwitch.style.setProperty('--idx', optIdx);
                        const selMethod = getActiveMethod(currentVersion);
                        if (cRow) {
                            cRow.style.display = (!selMethod || selMethod.supportsCompress !== false) ? 'block' : 'none';
                        }
                        updateCompressUIForSpecs();
                        updateExtensionWarning();
                        updateDesc();
                    });
                });
            }

            const curMethod = getActiveMethod(currentVersion);
            if (cRow) {
                cRow.style.display = (!curMethod || curMethod.supportsCompress !== false) ? 'block' : 'none';
            }
            updateCompressUIForSpecs();
            updateExtensionWarning();
            updateDesc();
        }

        const catTabs = container.querySelectorAll('.tiktok-category-tab');
        catTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const targetCat = tab.getAttribute('data-category');
                if (targetCat === activeCategory) return;
                catTabs.forEach(t => {
                    t.classList.remove('active');
                    t.setAttribute('aria-selected', 'false');
                });
                tab.classList.add('active');
                tab.setAttribute('aria-selected', 'true');
                renderMethodTrack(targetCat);
            });
        });

        renderMethodTrack(activeCategory);

        const cSwitch = document.getElementById('tiktok-compress-mode');
        if (cSwitch) {
            cSwitch.querySelectorAll('.tiktok-switch-option').forEach(opt => {
                opt.addEventListener('click', () => {
                    if (opt.classList.contains('disabled')) {
                        if (typeof window.showToast === 'function') {
                            window.showToast(t('patcher_compress_required_toast') || 'Resolusi video > 1080p wajib dikompres (pilih 1080P atau 720P).');
                        }
                        return;
                    }
                    const allOpts = Array.from(cSwitch.querySelectorAll('.tiktok-switch-option'));
                    allOpts.forEach(o => o.classList.remove('active'));
                    opt.classList.add('active');
                    compressMode = opt.getAttribute('data-mode') || 'off';
                    const optIdx = allOpts.indexOf(opt);
                    cSwitch.setAttribute('data-selected', compressMode);
                    cSwitch.setAttribute('data-selected-idx', optIdx.toString());
                    cSwitch.style.setProperty('--idx', optIdx.toString());
                    updateDesc();
                    updateExtensionWarning();
                });
            });
        }


        const copyLogsBtn = document.getElementById('btn-copy-logs');
        if (copyLogsBtn) {
            copyLogsBtn.addEventListener('click', () => {
                const logsEl = document.getElementById('tiktok-logs');
                if (logsEl && logsEl.textContent) {
                    navigator.clipboard.writeText(logsEl.textContent);
                    if (typeof window.showToast === 'function') {
                        window.showToast(t('logs_copied'));
                    }
                }
            });
        }

        const heroSlot = document.getElementById('tool-modal-hero-slot');
        if (heroSlot) {
            const oldExtBtn = heroSlot.querySelector('#btn-tiktok-download-ext-hero');
            if (oldExtBtn) oldExtBtn.remove();

            if (!heroSlot.querySelector('#btn-tiktok-clear-cache')) {
                const clearBtn = document.createElement('button');
                clearBtn.type = 'button';
                clearBtn.id = 'btn-tiktok-clear-cache';
                clearBtn.title = t('patcher_clear_cache');
                clearBtn.className = 'btn-icon-ghost';
                clearBtn.innerHTML = '<span class="material-symbols-rounded">cleaning_services</span>';
                clearBtn.onclick = (e) => {
                    e.stopPropagation();
                    clearAllToolCache(clearBtn);
                };
                heroSlot.appendChild(clearBtn);
            }
        }
    }

    async function processQualityMethod(file) {
        if (!file || isProcessing) return;

        if (!currentVideoSpecs) {
            currentVideoSpecs = await inspectMp4Meta(file);
        }

        const activeMethod = getActiveMethod(currentVersion);
        if (!activeMethod || (typeof activeMethod.patch !== 'function' && typeof activeMethod.execute !== 'function')) {
            throw new Error(`Method "${currentVersion}" is not loaded.`);
        }
        currentVersion = activeMethod.id;

        const isResOver1080p = isSpecsOver1080p();
        const isFpsOver60 = isSpecsOver60Fps();

        // If resolution > 1080p, compress mode cannot be off! Force to 1080p
        if (isResOver1080p && compressMode === 'off') {
            compressMode = '1080p';
            updateCompressUIForSpecs();
        }

        isProcessing = true;

        const processBtn = document.getElementById('tool-process-btn');
        const downloadBtn = document.getElementById('tool-download-btn');
        const progressSec = document.getElementById('tool-progress-section');
        const progressFill = document.getElementById('tool-progress-fill');
        const progressPercent = document.getElementById('tool-progress-percent');
        const progressStatus = document.getElementById('tool-progress-status');
        const logsContainer = document.getElementById('tiktok-logs-container');
        const logsEl = document.getElementById('tiktok-logs');

        if (processBtn) processBtn.disabled = true;
        if (downloadBtn) downloadBtn.classList.add('hidden');
        if (progressSec) progressSec.classList.remove('hidden');
        if (logsContainer) logsContainer.classList.remove('hidden');
        if (logsEl) logsEl.textContent = '';
        if (progressFill) progressFill.style.width = '0%';
        if (progressPercent) progressPercent.textContent = '0%';
        if (progressStatus) progressStatus.textContent = t('status_initializing');
        if (window.ToolProgressManager) {
            window.ToolProgressManager.set('tool-tiktok-patcher', { isProcessing: true, percent: 0, status: t('status_initializing'), file });
        }

        const methodLogName = activeMethod.name || activeMethod.id.toUpperCase();
        logSection('Quality method — Initializing');
        log(`  File : ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`);
        log(`  method : ${methodLogName}`);

        // Effective compress mode calculation
        let effectiveCompressMode = compressMode;
        if (isResOver1080p && effectiveCompressMode === 'off') {
            effectiveCompressMode = '1080p';
        }
        if (activeMethod.supportsCompress === false) {
            effectiveCompressMode = 'off';
        }

        if (activeMethod.supportsCompress !== false) {
            log(`  Compress : ${effectiveCompressMode.toUpperCase()}`);
        }
        if (isFpsOver60) {
            if (activeMethod.handlesOwn60FpsSlowmo) {
                log(`  FPS Profile : ${currentVideoSpecs.fps} FPS -> Converting to 60 FPS slow motion`);
            } else {
                log(`  FPS Profile : ${currentVideoSpecs.fps} FPS -> Converting to 60 FPS slow motion before ${methodLogName} patch`);
            }
        }
        logEnd();

        try {
            if (!currentVideoSpecs) {
                currentVideoSpecs = await inspectMp4Meta(file);
                updateCompressUIForSpecs();
                updateExtensionWarning();
            }
            if (!currentFileBuffer) {
                if (progressStatus) progressStatus.textContent = t('status_reading_file');
                if (window.ToolProgressManager) {
                    window.ToolProgressManager.set('tool-tiktok-patcher', { isProcessing: true, percent: 5, status: t('status_reading_file'), file });
                }
                currentFileBuffer = await file.arrayBuffer();
            }
            window._tktk.currentFileBuffer = currentFileBuffer;
            window._tktk.selectedFile = file;

            if (typeof activeMethod.patch === 'function') {
                let workingBuffer = currentFileBuffer;
                const isOff = (effectiveCompressMode === 'off');

                // ==========================================================
                // 1. OPTIONAL COMPRESS STAGE (compress.js)
                // ==========================================================
                if (!isOff && activeMethod.supportsCompress !== false) {
                    const compressFn = window.compressVideo || (window._tktk && window._tktk.compressVideo);
                    if (typeof compressFn !== 'function') {
                        throw new Error('Compression module (compress.js) is not loaded.');
                    }
                    logSection('Smart Compression');
                    workingBuffer = await compressFn(file, effectiveCompressMode, workingBuffer);
                    logEnd();
                }

                // ==========================================================
                // 2. MANDATORY NORMALIZATION STAGE (normalize.js)
                //    Normalizes clip before patching (and after compression
                //    when compression is enabled).
                // ==========================================================
                const normalizeFn = window.normalizeClip || (window._tktk && window._tktk.normalizeClip);
                if (typeof normalizeFn !== 'function') {
                    throw new Error('Normalization module (normalize.js) is not loaded.');
                }
                workingBuffer = await normalizeFn(file, workingBuffer, {
                    isCompressed: !isOff && activeMethod.supportsCompress !== false,
                    remuxFaststart: !!activeMethod.remuxFaststart,
                    handlesOwn60FpsSlowmo: !!activeMethod.handlesOwn60FpsSlowmo,
                    log,
                    logSection,
                    logEnd
                });

                // ==========================================================
                // 3. DYNAMIC PATCH STAGE (method/item/*.js)
                // ==========================================================
                logSection(`Applying ${methodLogName} Method`);
                let patchResult;
                try {
                    patchResult = await activeMethod.patch(workingBuffer, {
                        file,
                        mode: effectiveCompressMode,
                        log,
                        logSection,
                        logEnd,
                        _tktk: window._tktk
                    });
                } catch (patchErr) {
                    if (!isOff && activeMethod.supportsCompress !== false) {
                        log(`  [Notice] ${methodLogName} patch fallback, using compressed stream: ${patchErr.message}`);
                        patchResult = workingBuffer;
                    } else {
                        throw patchErr;
                    }
                }
                logEnd();

                let finalBytes = patchResult;
                let finalizeOpts = activeMethod.outputOptions || 'hd';
                if (patchResult && !(patchResult instanceof Uint8Array) && !(patchResult instanceof ArrayBuffer) && patchResult.bytes) {
                    finalBytes = patchResult.bytes;
                    if (patchResult.outputOptions) finalizeOpts = patchResult.outputOptions;
                }

                // ==========================================================
                // 4. MANDATORY FINALIZE STAGE (finalize.js)
                // ==========================================================
                const finalizeFn = window.finalizePatcherDownload || (window._tktk && window._tktk.finalizePatcherDownload);
                if (typeof finalizeFn !== 'function') {
                    throw new Error('Finalize module (finalize.js) is not loaded.');
                }
                finalizeFn(file, finalBytes, finalizeOpts);
            } else {
                await activeMethod.execute(file, effectiveCompressMode);
            }
        } catch (err) {
            console.error('Quality method Error:', err);
            log(`\n!! Error: ${err.message}`);
            if (progressStatus) progressStatus.textContent = `Error: ${err.message}`;
            if (typeof window.showToast === 'function') window.showToast(`Error: ${err.message}`);
            if (window.ToolProgressManager) {
                window.ToolProgressManager.clear('tool-tiktok-patcher');
            }
        } finally {
            isProcessing = false;
            if (processBtn) processBtn.disabled = false;
        }
    }

    window._tktk = {
        get isProcessing() { return isProcessing; },
        set isProcessing(v) { isProcessing = v; },
        get currentFileBuffer() { return currentFileBuffer; },
        set currentFileBuffer(v) { currentFileBuffer = v; },
        get compressMode() { return compressMode; },
        get hdrMode() { return 'off'; },
        get hdrEnabled() { return false; },
        get selectedFile() { return selectedFile; },
        set selectedFile(v) { selectedFile = v; },
        get activeContext() { return activeContext; },
        set activeContext(v) { activeContext = v; },
        get statusText() { return document.getElementById('tool-progress-status') || { innerHTML: '' }; },
        get btnStart() { return document.getElementById('tool-process-btn') || { classList: { add(){}, remove(){} } }; },
        get progressContainer() { return document.getElementById('tool-progress-section') || { classList: { add(){}, remove(){} } }; },
        get progressFill() { return document.getElementById('tool-progress-fill') || { style: {} }; },
        get progressPercent() { return document.getElementById('tool-progress-percent') || { textContent: '' }; },
        get progressText() { return document.getElementById('tool-progress-status') || { textContent: '' }; },
        get logsContainer() { return document.getElementById('tiktok-logs-container') || { classList: { add(){}, remove(){} } }; },
        get logsEl() { return document.getElementById('tiktok-logs') || { textContent: '' }; },
        log,
        logSection,
        logEnd,
        appendToLogsEl,
        escapeHTML,
        loadFFmpegLibraries,
        loadFFmpegHelper,
        detectBrowser,
        detectOS,
        parseFpsFromMp4,
        parseResolutionFromMp4,
        computeVideoProcessingOptions,
        isMobileDevice,
        inspectMp4Meta,
        inspectAndAlert,
        checkExtensionPresence,
        updateExtensionWarning,
        showStatusError: function(msg) {
            const statusEl = document.getElementById('tool-progress-status');
            if (statusEl) statusEl.textContent = msg;
        },
        showUploadGuideModal: function() {},
        showAdConsentModal: function() {},
        closeAdConsentModal: function() {},
        showTikTokStudioUploadPrompt,
        removeTikTokStudioUploadPrompt
    };

    function getDefaultMethodId() {
        const def = getActiveMethod();
        return def ? def.id : '';
    }

    const toolDefinition = {
        id: 'tool-tiktok-patcher',
        _id: 'tool-tiktok-patcher',
        isTool: true,
        version: '3.9.3',
        title: 'Quality method',
        titleKey: 'tool_patcher_title',
        desc: 'TikTok HQ Upload',
        descKey: 'patcher_subtitle',
        icon: 'high_quality',
        category: ['TikTok', 'Tools'],
        get features() {
            const list = getAllRegisteredMethods().map(m => `${m.name || m.id.toUpperCase()} Method`);
            list.push('720p & 1080p Compression');
            return list;
        },
        specs: [
            { label: 'ENGINE', value: 'FFmpeg WASM & Pure JS' },
            { label: 'FORMAT', value: 'MP4, MOV, WebM' },
            { label: 'PROCESSING', value: 'Client-side (Browser)' }
        ],
        schema: {
            get inputs() {
                const methods = getAllRegisteredMethods();
                const defId = getDefaultMethodId();
                return [
                    {
                        id: 'videoFile',
                        name: 'videoFile',
                        type: 'file',
                        label: 'Video File',
                        labelKey: 'tool_drop_video',
                        accept: 'video/*',
                        required: true
                    },
                    {
                        id: 'method',
                        name: 'method',
                        type: 'segmented',
                        label: 'method',
                        labelKey: 'patcher_cat_quality_method',
                        default: defId,
                        options: methods.map(m => ({
                            label: m.name || m.id.toUpperCase(),
                            value: m.id
                        }))
                    },
                    {
                        id: 'compress',
                        name: 'compress',
                        type: 'segmented',
                        label: 'Compress',
                        labelKey: 'patcher_compress_title',
                        default: 'off',
                        options: [
                            { label: 'OFF', value: 'off' },
                            { label: '720', value: '720p' },
                            { label: '1080', value: '1080p' }
                        ]
                    }
                ];
            }
        },
        run: async function(inputs, context) {
            activeContext = context;
            if (window._tktk) window._tktk.activeContext = context;
            window._lastFinalizedPatcherResult = null;
            try {
                const file = (inputs && (inputs.videoFile || inputs.file)) || selectedFile;
                if (!file) throw new Error('Video file is required');
                currentVersion = (inputs && inputs.method) || getDefaultMethodId();
                compressMode = (inputs && inputs.compress) || 'off';
                selectedFile = file;
                await processQualityMethod(file);
                if (window._lastFinalizedPatcherResult) {
                    const r = window._lastFinalizedPatcherResult;
                    if (typeof context.onProgress === 'function') context.onProgress(100, 'Done!');
                    return {
                        type: 'file',
                        data: r.blob,
                        filename: r.filename
                    };
                }
                throw new Error('Patcher did not produce an output file.');
            } finally {
                activeContext = null;
                if (window._tktk) window._tktk.activeContext = null;
            }
        },
        initModal: initQualityMethodUI,
        onFileSelect: inspectAndAlert,
        onProcess: processQualityMethod,
        onReset: function() {
            isProcessing = false;
            qualityUiMode = 'web';
            currentFileBuffer = null;
            selectedFile = null;
            currentInspectedFile = null;
            currentVideoSpecs = null;
            compressMode = 'off';
            currentVersion = getDefaultMethodId();
            Object.keys(lastSelectedPerCat).forEach(k => delete lastSelectedPerCat[k]);
            removeTikTokStudioUploadPrompt();
            updateCompressUIForSpecs();
            const slot = document.getElementById('tiktok-ext-alert-slot');
            if (slot) slot.innerHTML = '';
            const logsContainer = document.getElementById('tiktok-logs-container');
            if (logsContainer) logsContainer.classList.add('hidden');
            const logs = document.getElementById('tiktok-logs');
            if (logs) logs.textContent = '';
        },
        clearCache: clearAllToolCache
    };

    // Public setter agar link YouTube bisa di-inject atau diatur kapan saja
    window.setExtensionTutorialUrl = function(url) {
        extYoutubeTutorialUrl = url || '';
        const container = document.getElementById('ext-video-container');
        if (container) {
            const embed = extractYouTubeEmbedUrl(extYoutubeTutorialUrl);
            if (embed) {
                container.innerHTML = `<iframe src="${embed}" title="YouTube video player" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
            }
        }
    };

    if (window.AppTools && typeof window.AppTools.register === 'function') {
        window.AppTools.register(toolDefinition);
    } else {
        window._pendingTools = window._pendingTools || [];
        window._pendingTools.push(toolDefinition);
    }

    window.QualityMethodTool = toolDefinition;

})();
