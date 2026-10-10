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
    let currentFileBuffer = null;
    let isProcessing = false;
    let currentVersion = 'tbt';
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

        if (!slot) return;

        if (!isExtensionDetected) {
            if (typeof window !== 'undefined' && (window.__TIKTOK_CLOUD_DISABLER__ || (document.documentElement && document.documentElement.dataset.tiktokCloudDisabler === 'active'))) {
                isExtensionDetected = true;
                if (window.__TIKTOK_CLOUD_DISABLER_VERSION__) {
                    detectedUserscriptVersion = window.__TIKTOK_CLOUD_DISABLER_VERSION__;
                } else if (document.documentElement && document.documentElement.dataset.tiktokCloudDisablerVersion) {
                    detectedUserscriptVersion = document.documentElement.dataset.tiktokCloudDisablerVersion;
                }
            }
        }

        if (currentVersion !== 'v3' && currentVersion !== 'binary' && currentVersion !== 'tbt' && currentVersion !== 'streamshield') {
            slot.innerHTML = '';
            if (processBtn && !isProcessing && processBtn.dataset.state === 'blocked') {
                processBtn.disabled = false;
                processBtn.dataset.state = 'ready';
                if (processLabel) processLabel.textContent = (window.getTranslation && window.getTranslation('patcher_start_process')) || 'Process Video';
            }
            return;
        }

        // Only enforce userscript if video is above 1080p or >= 120fps
        const isResOver1080p = currentVideoSpecs && (
            Math.min(currentVideoSpecs.width, currentVideoSpecs.height) > 1080 ||
            Math.max(currentVideoSpecs.width, currentVideoSpecs.height) > 1920
        );
        const isFpsOver120 = currentVideoSpecs && currentVideoSpecs.fps >= 120;
        const requiresUserscript = isResOver1080p || isFpsOver120;

        const isVersionMatch = isExtensionDetected && (detectedUserscriptVersion === TARGET_USERSCRIPT_VERSION);

        if (isVersionMatch) {
            slot.innerHTML = `
                <div class="tiktok-ext-success">
                    <span class="material-symbols-rounded">verified_user</span>
                    <span>${t('patcher_ext_active_notice')}</span>
                </div>
            `;
            if (processBtn && !isProcessing && processBtn.dataset.state === 'blocked') {
                processBtn.disabled = false;
                processBtn.dataset.state = 'ready';
                if (processLabel) processLabel.textContent = (window.getTranslation && window.getTranslation('patcher_start_process')) || 'Process Video';
            }
            return;
        }

        const browser = detectBrowser();
        const extensionInstallUrl = (browser === 'Firefox')
            ? 'https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/'
            : 'https://chromewebstore.google.com/detail/violentmonkey/jinjaccalgkegednnccohejagnlnfdag';
        const localUserscriptUrl = 'userscript/tiktok-cloud-disabler.user.js';

        if (requiresUserscript) {
            // Case 1: Video > 1080p or >= 120 FPS -> Userscript is strictly required!
            if (isExtensionDetected && !isVersionMatch) {
                const activeVer = detectedUserscriptVersion || 'lama';
                const updateTitle = t('patcher_ext_update_title') || 'Pembaruan Userscript Diperlukan';
                const updateBody = (t('patcher_ext_update_body') || 'Userscript Anda terdeteksi versi lama (aktif: <strong>v{active}</strong>, dibutuhkan: <strong>v{target}</strong>). Silahkan perbarui userscript ke versi terbaru agar pembatasan Cloud Canvas dinonaktifkan.')
                    .replace('{active}', activeVer)
                    .replace('{target}', TARGET_USERSCRIPT_VERSION);

                slot.innerHTML = `
                    <div class="tiktok-ext-warning">
                        <div class="tiktok-ext-warning-header">
                            <span class="material-symbols-rounded">system_update</span>
                            <span>${updateTitle}</span>
                        </div>
                        <p class="tiktok-ext-warning-body">${updateBody}</p>
                        <div class="tiktok-ext-actions">
                            <a href="${localUserscriptUrl}" target="_blank" class="btn-ext-download" id="btn-tiktok-update-userscript">
                                <span class="material-symbols-rounded">download</span>
                                <span>${t('patcher_ext_btn_update')} (v${TARGET_USERSCRIPT_VERSION})</span>
                            </a>
                            <button type="button" class="btn-ext-download btn-ext-download-secondary" id="btn-tiktok-copy-userscript" title="Salin kode ke clipboard">
                                <span class="material-symbols-rounded">content_copy</span>
                                <span>Salin Kode</span>
                            </button>
                            <button type="button" class="btn-ext-recheck" id="btn-tiktok-recheck-ext" title="${t('patcher_ext_recheck_btn')}">
                                <span class="material-symbols-rounded">refresh</span>
                            </button>
                        </div>
                    </div>
                `;
            } else {
                const titleText = t('patcher_ext_warn_title') || 'Bypass Cloud Canvas Diperlukan (>1080p / 120 FPS)';
                slot.innerHTML = `
                    <div class="tiktok-ext-warning">
                        <div class="tiktok-ext-warning-header">
                            <span class="material-symbols-rounded">extension</span>
                            <span>${titleText}</span>
                        </div>
                        <p class="tiktok-ext-warning-body">${t('patcher_ext_warn_body')}</p>
                        <div class="tiktok-ext-actions">
                            <a href="${localUserscriptUrl}" target="_blank" class="btn-ext-download" id="btn-tiktok-install-userscript">
                                <span class="material-symbols-rounded">code</span>
                                <span>${t('patcher_ext_btn_userscript')}</span>
                            </a>
                            <a href="${extensionInstallUrl}" target="_blank" rel="noopener noreferrer" class="btn-ext-download btn-ext-download-secondary" id="btn-tiktok-install-manager">
                                <span class="material-symbols-rounded">download</span>
                                <span>${t('patcher_ext_btn_install')}</span>
                            </a>
                            <button type="button" class="btn-ext-recheck" id="btn-tiktok-recheck-ext" title="${t('patcher_ext_recheck_btn')}">
                                <span class="material-symbols-rounded">refresh</span>
                            </button>
                        </div>
                    </div>
                `;
            }

            if (processBtn && !isProcessing) {
                processBtn.disabled = true;
                processBtn.dataset.state = 'blocked';
                if (processLabel) {
                    processLabel.textContent = t('patcher_ext_btn_blocked');
                }
            }
        } else {
            // Case 2: Standard video (<= 1080p, < 120fps) -> Do NOT block process button!
            if (processBtn && !isProcessing && processBtn.dataset.state === 'blocked') {
                processBtn.disabled = false;
                processBtn.dataset.state = 'ready';
                if (processLabel) processLabel.textContent = (window.getTranslation && window.getTranslation('patcher_start_process')) || 'Process Video';
            }

            const optTitle = t('patcher_ext_optional_title') || 'Opsional';
            const optBody = t('patcher_ext_optional_body') || 'Pasang userscript ini jika hasil video yang Anda unggah ke TikTok Studio otomatis ter-downscale atau terlihat buram. Userscript akan menonaktifkan modul editor cloud TikTok agar kualitas asli video tetap terjaga.';

            slot.innerHTML = `
                <div class="tiktok-ext-warning" style="border-color: rgba(190, 220, 116, 0.4); background: rgba(190, 220, 116, 0.05);">
                    <div class="tiktok-ext-warning-header" style="color: var(--md-sys-color-primary, #bedc74);">
                        <span class="material-symbols-rounded">info</span>
                        <span>${optTitle}</span>
                    </div>
                    <div class="tiktok-ext-warning-body">${optBody}</div>
                    <div class="tiktok-ext-actions">
                        <a href="${localUserscriptUrl}" target="_blank" class="btn-ext-download" id="btn-tiktok-install-userscript">
                            <span class="material-symbols-rounded">code</span>
                            <span>${t('patcher_ext_btn_userscript')}</span>
                        </a>
                        <a href="${extensionInstallUrl}" target="_blank" rel="noopener noreferrer" class="btn-ext-download btn-ext-download-secondary" id="btn-tiktok-install-manager">
                            <span class="material-symbols-rounded">download</span>
                            <span>${t('patcher_ext_btn_install')}</span>
                        </a>
                        <button type="button" class="btn-ext-recheck" id="btn-tiktok-hardreset-ext" title="${t('patcher_clear_cache') || 'Hard Reset (Bersihkan Cache & Muat Ulang)'}">
                            <span class="material-symbols-rounded">restart_alt</span>
                        </button>
                    </div>
                </div>
            `;
        }

        const copyBtn = slot.querySelector('#btn-tiktok-copy-userscript');
        if (copyBtn) {
            copyBtn.addEventListener('click', async () => {
                try {
                    const res = await fetch('userscript/tiktok-cloud-disabler.user.js');
                    const code = await res.text();
                    await navigator.clipboard.writeText(code);
                    if (typeof window.showToast === 'function') window.showToast('Kode Userscript v' + TARGET_USERSCRIPT_VERSION + ' berhasil disalin ke clipboard!');
                } catch (e) {
                    if (typeof window.showToast === 'function') window.showToast('Gagal menyalin kode: ' + e.message);
                }
            });
        }

        const recheckBtn = slot.querySelector('#btn-tiktok-recheck-ext');
        if (recheckBtn) {
            recheckBtn.addEventListener('click', async () => {
                recheckBtn.disabled = true;
                recheckBtn.classList.add('loading');
                await checkExtensionPresence();
                if (isExtensionDetected) {
                    if (typeof window.showToast === 'function') {
                        window.showToast(t('patcher_ext_detected_toast'));
                    }
                } else {
                    if (typeof window.showToast === 'function') {
                        window.showToast(t('patcher_ext_not_found_toast'));
                    }
                }
                updateExtensionWarning();
            });
        }

        const hardresetBtn = slot.querySelector('#btn-tiktok-hardreset-ext');
        if (hardresetBtn) {
            hardresetBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                clearAllToolCache(hardresetBtn);
            });
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
                    ${t('patcher_upload_studio_desc') || 'Video telah berhasil dipatch. Buka TikTok Studio untuk melanjutkan proses upload.'}
                </p>
                <div style="display: flex; align-items: center; margin-top: 4px;">
                    <a href="https://www.tiktok.com/tiktokstudio/upload?from=creator_center&tab=video" target="_blank" rel="noopener noreferrer" style="display: inline-flex; align-items: center; justify-content: center; gap: 6px; background: var(--md-sys-color-primary, #bedc74); color: var(--md-sys-color-on-primary, #1a2c00); font-size: 12.5px; font-weight: 600; text-decoration: none; padding: 8px 16px; border-radius: 9999px; transition: opacity 0.15s ease;">
                        <span class="material-symbols-rounded" style="font-size: 18px;">open_in_new</span>
                        <span>${t('patcher_upload_studio_btn') || 'Buka TikTok Studio'}</span>
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
                else if (rawTag === 'method') { icon = 'verified'; label = isEn ? 'Method' : 'Metode'; }
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

    function updateDesc() {
        const descEl = document.getElementById('tiktok-info-desc');
        if (!descEl) return;
        let baseDesc = '';
        if (currentVersion === 'v1') {
            baseDesc = t('patcher_desc_wmv') || `
                [format] .wmv
                [codec] WMV2
                [info] Mengonversi video ke format Windows Media Video (.wmv) melalui penyandian ulang lossless.
            `;
        } else if (currentVersion === 'fps') {
            if (compressMode === '720p') {
                baseDesc = t('patcher_desc_fps_720p') || `
                    [format] .mp4
                    [resolution] 720p
                    [framerate] 30 FPS Presentation Patch
                    [info] Mengompresi video ke 720p dengan bitrate hemat MB, lalu menerapkan timescale patch agar playback di TikTok berjalan halus.
                    [warn] Metode ini tidak membypass quality, hanya FPS saja.
                `;
            } else if (compressMode === '1080p') {
                baseDesc = t('patcher_desc_fps_1080p') || `
                    [format] .mp4
                    [resolution] 1080p
                    [framerate] 30 FPS Presentation Patch
                    [info] Mengompresi video pada resolusi Full HD 1080p dengan ukuran MB kecil dan tajam, lalu menerapkan timescale patch.
                    [warn] Metode ini tidak membypass quality, hanya FPS saja.
                `;
            } else {
                baseDesc = t('patcher_desc_fps_off') || t('patcher_desc_fps') || `
                    [format] .mp4
                    [mode] Direct Pass-Through
                    [framerate] 30 FPS Presentation Patch
                    [info] Video akan terlihat slow motion di galeri offline, namun otomatis berjalan mulus (smooth 60 FPS) saat diunggah ke TikTok.
                    [warn] Metode ini tidak membypass quality, hanya FPS saja.
                `;
            }
        } else if (currentVersion === 'binary') {
            if (compressMode === '720p') {
                baseDesc = t('patcher_desc_binary_720p') || `
                    [format] .mp4
                    [resolution] 720p
                    [codec] H.264
                    [info] Mengompresi dan menyesuaikan batas resolusi ke 720p dengan alokasi bitrate teroptimasi, lalu menerapkan rekonstruksi metadata kontainer MP4.
                `;
            } else if (compressMode === '1080p') {
                baseDesc = t('patcher_desc_binary_1080p') || `
                    [format] .mp4
                    [resolution] 1080p
                    [codec] H.264
                    [info] Mengompresi video pada resolusi Full HD 1080p dengan batas bitrate tinggi untuk menjaga ketajaman gerak, dilanjutkan dengan rekonstruksi metadata kontainer MP4.
                `;
            } else {
                baseDesc = t('patcher_desc_binary_off') || `
                    [format] .mp4
                    [mode] Direct Pass-Through
                    [info] Menata ulang struktur metadata dan susunan streaming MP4 secara langsung tanpa kompresi, menjaga resolusi serta kualitas visual asli tetap utuh 100%.
                `;
            }
        } else if (currentVersion === 'tbt' || currentVersion === 'streamshield' || currentVersion === 'fish') {
            if (compressMode === '720p') {
                baseDesc = t('patcher_desc_fish_720p') || `
                    [format] .mp4
                    [resolution] 720p
                    [info] Mengompresi video ke 720p agar ukuran file lebih ringan, lalu menata ulang metadata MP4.
                `;
            } else if (compressMode === '1080p') {
                baseDesc = t('patcher_desc_fish_1080p') || `
                    [format] .mp4
                    [resolution] 1080p
                    [info] Mengompresi video ke Full HD 1080p untuk menjaga ketajaman, lalu menata ulang metadata MP4.
                `;
            } else {
                baseDesc = t('patcher_desc_fish_off') || `
                    [format] .mp4
                    [mode] Direct Pass-Through
                    [info] Menata ulang struktur atom MP4 secara instan tanpa encode ulang, menjaga resolusi serta kualitas video dan audio tetap 100% asli.
                `;
            }
        } else {
            // v3 (F R Y)
            if (compressMode === '720p') {
                baseDesc = t('patcher_desc_fry_720p') || `
                    [format] .mp4
                    [resolution] 720p
                    [info] Mengompresi video ke 720p agar ukuran file lebih ringan, lalu menerapkan patch metadata MP4.
                    [credit] Terima kasih untuk <a href="https://www.tiktok.com/@itsmefachry" target="_blank" rel="noopener noreferrer">@itsmefachry</a> &amp; <a href="https://www.tiktok.com/@adek.jamannow" target="_blank" rel="noopener noreferrer">@adek.jamannow</a> karena sudah membagikan source method-nya dan membantu fix method ini.
                `;
            } else if (compressMode === '1080p') {
                baseDesc = t('patcher_desc_fry_1080p') || `
                    [format] .mp4
                    [resolution] 1080p
                    [info] Mengompresi video ke Full HD 1080p untuk menjaga ketajaman, lalu menerapkan patch metadata MP4.
                    [credit] Terima kasih untuk <a href="https://www.tiktok.com/@itsmefachry" target="_blank" rel="noopener noreferrer">@itsmefachry</a> &amp; <a href="https://www.tiktok.com/@adek.jamannow" target="_blank" rel="noopener noreferrer">@adek.jamannow</a> karena sudah membagikan source method-nya dan membantu fix method ini.
                `;
            } else {
                baseDesc = t('patcher_desc_fry_off') || `
                    [format] .mp4
                    [mode] Direct Pass-Through
                    [info] Menata ulang metadata MP4 tanpa encode ulang, menjaga kualitas video dan audio tetap asli.
                    [credit] Terima kasih untuk <a href="https://www.tiktok.com/@itsmefachry" target="_blank" rel="noopener noreferrer">@itsmefachry</a> &amp; <a href="https://www.tiktok.com/@adek.jamannow" target="_blank" rel="noopener noreferrer">@adek.jamannow</a> karena sudah membagikan source method-nya dan membantu fix method ini.
                `;
            }
        }

        baseDesc = renderModularDescCard(baseDesc);

        if (currentVideoSpecs) {
            const badges = [];
            let patchName = currentVersion.toUpperCase();
            if (currentVersion === 'v3') patchName = 'F R Y';
            else if (currentVersion === 'tbt' || currentVersion === 'fish') patchName = 'FISH';

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
                const fpsText = (t('patcher_notice_fps_120') || 'Video <strong>{fps} FPS</strong> (&gt; 120 FPS) terdeteksi. Wajib normalisasi slow motion atau gunakan Userscript Bypass Cloud Canvas.')
                    .replace('{fps}', currentVideoSpecs.fps);
                badges.push(`
                    <div class="tiktok-desc-warning-row">
                        <span class="material-symbols-rounded">speed</span>
                        <span>${fpsText}</span>
                    </div>
                `);
            } else if (isSpecsOver60Fps()) {
                let fpsText = '';
                if (currentVersion === 'fps') {
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

    const METHOD_CATEGORIES = {
        recommended: {
            id: 'recommended',
            labelKey: 'patcher_cat_recommended',
            defaultLabel: 'Rekomendasi',
            icon: 'verified',
            methods: [
                { id: 'tbt', labelKey: 'patcher_method_tbt', defaultLabel: 'FISH' },
                { id: 'binary', labelKey: 'patcher_method_binary', defaultLabel: 'BINARY' },
                { id: 'v3', labelKey: 'patcher_method_fry', defaultLabel: 'F R Y' }
            ]
        },
        backup: {
            id: 'backup',
            labelKey: 'patcher_cat_backup',
            defaultLabel: 'Cadangan',
            icon: 'history',
            methods: [
                { id: 'fps', labelKey: 'patcher_method_fps', defaultLabel: 'FPS' },
                { id: 'v1', labelKey: 'patcher_method_wmv', defaultLabel: 'WMV' }
            ]
        }
    };

    const lastSelectedPerCat = {
        recommended: 'tbt',
        backup: 'fps'
    };

    function getCategoryForMethod(methodId) {
        if (methodId === 'v1' || methodId === 'fps') {
            return 'backup';
        }
        return 'recommended';
    }

    function initQualityMethodUI() {
        const optContainer = document.getElementById('tool-dynamic-options');
        if (!optContainer) return;

        let activeCategory = getCategoryForMethod(currentVersion);
        const catData = METHOD_CATEGORIES[activeCategory] || METHOD_CATEGORIES.recommended;

        if (!catData.methods.some(m => m.id === currentVersion)) {
            currentVersion = (lastSelectedPerCat[activeCategory] && catData.methods.some(m => m.id === lastSelectedPerCat[activeCategory]))
                ? lastSelectedPerCat[activeCategory]
                : catData.methods[0].id;
        }
        lastSelectedPerCat[activeCategory] = currentVersion;

        const showCompress = (currentVersion !== 'v1');
        const compressList = ['off', '720p', '1080p'];
        const cIdx = compressList.indexOf(compressMode);
        const selectedCIdx = cIdx >= 0 ? cIdx : 0;

        optContainer.innerHTML = `
            <div class="tiktok-category-header">
                <div class="tiktok-switcher-label">${t('patcher_ver_title')}</div>
                <div class="tiktok-category-tabs" role="tablist">
                    <button type="button" class="tiktok-category-tab ${activeCategory === 'recommended' ? 'active' : ''}" data-category="recommended" role="tab" aria-selected="${activeCategory === 'recommended'}">
                        <span class="material-symbols-rounded">verified</span>
                        <span>${t('patcher_cat_recommended') || 'Rekomendasi'}</span>
                    </button>
                    <button type="button" class="tiktok-category-tab ${activeCategory === 'backup' ? 'active' : ''}" data-category="backup" role="tab" aria-selected="${activeCategory === 'backup'}">
                        <span class="material-symbols-rounded">history</span>
                        <span>${t('patcher_cat_backup') || 'Cadangan'}</span>
                    </button>
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
            const currentCatData = METHOD_CATEGORIES[catKey] || METHOD_CATEGORIES.recommended;
            const scrollContainer = document.getElementById('tiktok-version-scroll');
            if (!scrollContainer) return;

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
                        <div class="tiktok-switch-option ${m.id === currentVersion ? 'active' : ''}" data-version="${m.id}" data-idx="${idx}">${t(m.labelKey) || m.defaultLabel}</div>
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
                        if (cRow) {
                            cRow.style.display = (currentVersion !== 'v1') ? 'block' : 'none';
                        }
                        updateCompressUIForSpecs();
                        updateExtensionWarning();
                        updateDesc();
                    });
                });
            }

            if (cRow) {
                cRow.style.display = (currentVersion !== 'v1') ? 'block' : 'none';
            }
            updateCompressUIForSpecs();
            updateExtensionWarning();
            updateDesc();
        }

        const catTabs = optContainer.querySelectorAll('.tiktok-category-tab');
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
        checkExtensionPresence().then(updateExtensionWarning);

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
        await checkExtensionPresence();

        const isResOver1080p = isSpecsOver1080p();
        const isFpsOver60 = isSpecsOver60Fps();
        const isFpsOver120 = currentVideoSpecs && currentVideoSpecs.fps >= 120;
        const isHighProfile = isResOver1080p || isFpsOver120;

        // If resolution > 1080p, compress mode cannot be off! Force to 1080p
        if (isResOver1080p && compressMode === 'off') {
            compressMode = '1080p';
            updateCompressUIForSpecs();
        }

        if ((currentVersion === 'v3' || currentVersion === 'binary' || currentVersion === 'tbt' || currentVersion === 'streamshield') && isHighProfile && (!isExtensionDetected || detectedUserscriptVersion !== TARGET_USERSCRIPT_VERSION)) {
            updateExtensionWarning();
            if (typeof window.showToast === 'function') {
                window.showToast(t('patcher_ext_blocked_toast'));
            }
            return;
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

        logSection('Quality Method — Initializing');
        log(`  File : ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`);
        let methodLogName = currentVersion.toUpperCase();
        if (currentVersion === 'v3') methodLogName = 'F R Y';
        else if (currentVersion === 'binary') methodLogName = 'BINARY';
        else if (currentVersion === 'fps') methodLogName = 'FPS';
        else if (currentVersion === 'tbt' || currentVersion === 'fish') methodLogName = 'FISH';
        log(`  Method : ${methodLogName}`);

        // Effective compress mode calculation
        let effectiveCompressMode = compressMode;
        if (isResOver1080p && effectiveCompressMode === 'off') {
            effectiveCompressMode = '1080p';
        }

        if (currentVersion !== 'v1') {
            log(`  Compress : ${effectiveCompressMode.toUpperCase()}`);
        }
        if (isFpsOver60) {
            if (currentVersion === 'fps') {
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

            if (currentVersion === 'v1') {
                if (typeof window.processVideoV1 === 'function') {
                    await window.processVideoV1(file, effectiveCompressMode);
                } else {
                    throw new Error('V1 WMV module is not loaded.');
                }
            } else if (currentVersion === 'fps') {
                if (typeof window.processVideoFPS === 'function') {
                    await window.processVideoFPS(file, effectiveCompressMode);
                } else {
                    await processFpsInternal(file, currentFileBuffer);
                }
            } else if (currentVersion === 'binary') {
                if (typeof window.processVideoBinary === 'function') {
                    await window.processVideoBinary(file, effectiveCompressMode);
                } else {
                    throw new Error('Binary module is not loaded.');
                }
            } else if (currentVersion === 'tbt' || currentVersion === 'streamshield') {
                if (typeof window.processVideoStreamShield === 'function') {
                    await window.processVideoStreamShield(file, effectiveCompressMode);
                } else if (typeof window.processVideoTBT === 'function') {
                    await window.processVideoTBT(file, effectiveCompressMode);
                } else {
                    throw new Error('StreamShield module is not loaded.');
                }
            } else {
                if (typeof window.processVideoFRY === 'function') {
                    await window.processVideoFRY(file, effectiveCompressMode);
                } else if (typeof window.processVideoV3 === 'function') {
                    await window.processVideoV3(file, effectiveCompressMode);
                } else {
                    throw new Error('F R Y module is not loaded.');
                }
            }
        } catch (err) {
            console.error('Quality Method Error:', err);
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

    async function processFpsInternal(file, buffer) {
        const progressFill = document.getElementById('tool-progress-fill');
        const progressPercent = document.getElementById('tool-progress-percent');
        const progressStatus = document.getElementById('tool-progress-status');
        const downloadBtn = document.getElementById('tool-download-btn');

        logSection('FPS Direct Patch');
        if (progressStatus) progressStatus.textContent = t('status_fps_adjusting');
        if (progressFill) progressFill.style.width = '50%';
        if (progressPercent) progressPercent.textContent = '50%';
        if (window.ToolProgressManager) {
            window.ToolProgressManager.set('tool-tiktok-patcher', { isProcessing: true, percent: 50, status: t('status_fps_adjusting'), file });
        }

        await new Promise(r => setTimeout(r, 200));

        const bytes = new Uint8Array(buffer);
        const blob = new Blob([bytes], { type: 'video/mp4' });
        const outName = `[PATCHED_FPS]_${file.name}`;
        window._lastFinalizedPatcherResult = { filename: outName, blob };

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

        if (progressFill) progressFill.style.width = '100%';
        if (progressPercent) progressPercent.textContent = '100%';
        if (progressStatus) progressStatus.textContent = t('status_completed');
        if (window.ToolProgressManager) {
            window.ToolProgressManager.set('tool-tiktok-patcher', { isProcessing: false, completed: true, percent: 100, status: t('status_completed'), file });
        }
        log('  FPS metadata patch applied successfully.');
        logEnd();

        const processBtn = document.getElementById('tool-process-btn');
        const processLabel = document.getElementById('tool-process-label');
        const processIcon = document.getElementById('tool-process-icon');
        if (processBtn) {
            processBtn.disabled = false;
            processBtn.dataset.state = 'completed';
            if (processLabel) processLabel.textContent = t('status_process_another');
            if (processIcon) processIcon.textContent = 'restart_alt';
        }
        if (typeof window.showToast === 'function') window.showToast(t('fps_patch_completed'));
        showTikTokStudioUploadPrompt();
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

    const toolDefinition = {
        id: 'tool-tiktok-patcher',
        _id: 'tool-tiktok-patcher',
        isTool: true,
        version: '3.7.0',
        title: 'Quality Method',
        desc: 'TikTok HQ Upload',
        icon: 'high_quality',
        category: ['TikTok', 'Tools'],
        features: [
            'F R Y Patch',
            'Binary Patch (Classic 0.2.0)',
            'WMV Container Re-encode',
            '60 FPS Timescale Patch',
            '720p & 1080p Compression'
        ],
        specs: [
            { label: 'ENGINE', value: 'FFmpeg WASM & Pure JS' },
            { label: 'FORMAT', value: 'MP4, MOV, WebM' },
            { label: 'PROCESSING', value: 'Client-side (Browser)' }
        ],
        schema: {
            inputs: [
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
                    label: 'Method',
                    labelKey: 'patcher_cat_quality_method',
                    default: 'tbt',
                    options: [
                        { label: 'FISH', value: 'tbt' },
                        { label: 'Binary', value: 'binary' },
                        { label: 'StreamShield', value: 'streamshield' },
                        { label: 'FRY', value: 'v3' },
                        { label: 'FPS 60', value: 'fps' },
                        { label: 'WMV', value: 'v1' }
                    ]
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
            ]
        },
        run: async function(inputs, context) {
            activeContext = context;
            if (window._tktk) window._tktk.activeContext = context;
            window._lastFinalizedPatcherResult = null;
            try {
                const file = (inputs && (inputs.videoFile || inputs.file)) || selectedFile;
                if (!file) throw new Error('Video file is required');
                currentVersion = inputs.method || 'tbt';
                compressMode = inputs.compress || 'off';
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
            currentFileBuffer = null;
            selectedFile = null;
            currentInspectedFile = null;
            currentVideoSpecs = null;
            compressMode = 'off';
            currentVersion = 'tbt';
            lastSelectedPerCat.recommended = 'tbt';
            lastSelectedPerCat.backup = 'fps';
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

    if (window.AppTools && typeof window.AppTools.register === 'function') {
        window.AppTools.register(toolDefinition);
    } else {
        window._pendingTools = window._pendingTools || [];
        window._pendingTools.push(toolDefinition);
    }

    window.QualityMethodTool = toolDefinition;

})();
