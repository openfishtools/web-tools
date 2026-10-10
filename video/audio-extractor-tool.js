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
    let isExtracting = false;
    let activeContext = null;

    const MAX_FILE_MB = 800;
    const MAX_FILE_MB_HARD = 1500;

    function setButtonState(state, text) {
        const processBtn = document.getElementById('tool-process-btn');
        const processLabel = document.getElementById('tool-process-label');
        if (!processBtn) return;

        if (state === 'processing') {
            processBtn.disabled = true;
            processBtn.dataset.state = 'processing';
            if (processLabel) processLabel.textContent = text || t('status_processing') || "Extracting Audio...";
        } else if (state === 'completed') {
            processBtn.disabled = false;
            processBtn.dataset.state = 'completed';
            if (processLabel) processLabel.textContent = text || t('status_process_another') || "Process Another";
        } else if (state === 'error') {
            processBtn.disabled = false;
            processBtn.dataset.state = 'error';
            if (processLabel) processLabel.textContent = text || t('status_error') || "Extraction Failed";
            setTimeout(() => {
                setButtonState('ready');
            }, 3500);
        } else {
            processBtn.disabled = !selectedFile;
            processBtn.dataset.state = selectedFile ? 'ready' : 'idle';
            if (processLabel) processLabel.textContent = text || t('tool_audio_btn') || "Extract Audio";
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
            window.ToolProgressManager.set('tool-audio-extractor', {
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

        try {
            if (!window.FFmpegUtil) {
                await loadScript('https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/umd/index.js');
            }
            if (!window.FFmpegWASM) {
                const [ffmpegRes, workerRes] = await Promise.all([
                    fetch('https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/umd/ffmpeg.js'),
                    fetch('https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/umd/814.ffmpeg.js')
                ]);

                if (!ffmpegRes.ok || !workerRes.ok) throw new Error('CDN HTTP response error');

                const ffmpegCode = await ffmpegRes.text();
                const workerCode = await workerRes.text();

                const workerBlobUrl = URL.createObjectURL(new Blob([workerCode], { type: 'text/javascript' }));
                const patchedCode = ffmpegCode.replace(/new Worker\(new URL\(e\.p\+e\.u\(814\),e\.b\),\{type:void 0\}\)/g, `new Worker("${workerBlobUrl}")`)
                                               .replace(/u:e=>e\+"\.\x66\x66\x6d\x70\x65\x67\.\x6a\x73"/g, `u:()=>"${workerBlobUrl}"`)
                                               .replace(/u:e=>e\+"\x2effmpeg\x2ejs"/g, `u:()=>"${workerBlobUrl}"`);
                const ffmpegBlobUrl = URL.createObjectURL(new Blob([patchedCode], { type: 'text/javascript' }));
                await loadScript(ffmpegBlobUrl);
            }
            if (window.FFmpegWASM && window.FFmpegUtil) return true;
        } catch (cdnErr) {
            console.warn('CDN load failed:', cdnErr);
        }

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
            if (window.FFmpegWASM && window.FFmpegUtil) return true;
        } catch (err) {
            console.error('Failed to load FFmpeg libraries:', err);
        }

        return !!(window.FFmpegWASM && window.FFmpegUtil);
    }

    async function extractAudio(file) {
        if (isExtracting || !file) return;
        isExtracting = true;
        let oomDetected = false;

        setButtonState('processing', t('status_processing') || 'Initializing FFmpeg...');
        setProgress(5, t('status_loading_engine') || 'Loading engine...');

        try {
            const isReady = await loadFFmpegLibraries();
            if (!isReady) {
                throw new Error("FFmpeg library failed to load. Please check network connection.");
            }

            const { FFmpeg } = window.FFmpegWASM;
            const { fetchFile, toBlobURL } = window.FFmpegUtil;
            const errMsg = (e) => {
                if (!e) return 'unknown error';
                if (e instanceof Error && e.message) return e.message;
                if (typeof e === 'string') return e;
                try { return JSON.stringify(e); } catch (_) { return String(e); }
            };

            const cdnBaseMT = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@0.12.6/dist/umd';
            const cdnBaseST = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd';
            const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Tablet/i.test(navigator.userAgent) || 
                               (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

            const isMultiThread = !isMobileDevice && typeof SharedArrayBuffer !== 'undefined' && window.crossOriginIsolated === true;

            const ffmpeg = await window.CutefishFFmpegLoader.getFFmpegInstance({
                isMultiThread,
                log: (msg) => console.log(msg)
            });

            if (!ffmpeg) {
                throw new Error("Failed to initialize FFmpeg engine.");
            }

            ffmpeg.on('progress', ({ progress }) => {
                const percent = Math.max(10, Math.min(95, Math.round(progress * 100)));
                setProgress(percent, `${t('status_encoding') || 'Extracting audio'} (${percent}%)...`);
                setButtonState('processing', `Extracting ${percent}%...`);
            });

            ffmpeg.on('log', ({ message }) => {
                const lc = message.toLowerCase();
                if (lc.includes('oom') || lc.includes('out of memory')) {
                    oomDetected = true;
                }
            });

            setProgress(15, t('status_processing') || 'Reading video stream...');
            const ext = file.name.split('.').pop() || 'mp4';
            const inputName = `input.${ext}`;
            await ffmpeg.writeFile(inputName, await fetchFile(file));

            const threads = navigator.hardwareConcurrency 
                ? Math.min(navigator.hardwareConcurrency, 4).toString() 
                : '2';

            const command = ['-y', '-i', inputName, '-threads', threads, '-vn', '-c:a', 'libmp3lame', '-b:a', '192k', 'audio.mp3'];

            try {
                await ffmpeg.exec(command);
            } catch (execError) {
                try {
                    const testData = await ffmpeg.readFile('audio.mp3');
                    if (!testData || testData.byteLength < 1024) throw execError;
                } catch (readError) {
                    throw execError;
                }
            }

            if (oomDetected) {
                throw Object.assign(new Error('OOM'), { _oom: true });
            }

            setProgress(98, t('status_finalizing') || 'Finalizing audio file...');
            const data = await ffmpeg.readFile('audio.mp3');

            if (!data || data.byteLength < 1024) {
                throw Object.assign(new Error('OOM'), { _oom: true });
            }

            const blob = new Blob([data], { type: 'audio/mpeg' });
            const outName = `${file.name.replace(/\.[^.]+$/, '')}.mp3`;

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
                await ffmpeg.deleteFile(inputName);
                await ffmpeg.deleteFile('audio.mp3');
            } catch (_) {}

            setProgress(100, t('status_completed') || 'Done!');
            setButtonState('completed', t('status_process_another') || 'Process Another');

            if (window.ToolProgressManager) {
                window.ToolProgressManager.set('tool-audio-extractor', {
                    isProcessing: false,
                    completed: true,
                    percent: 100,
                    status: 'Complete',
                    file
                });
            }

            if (typeof window.showToast === 'function') {
                window.showToast(t('status_completed_toast') || 'Audio extracted successfully!');
            }

            return {
                type: 'file',
                data: blob,
                filename: outName,
                mimeType: 'audio/mpeg'
            };

        } catch (error) {
            console.error('Audio Extractor Error:', error);
            const msg = (error.message || '').toLowerCase();
            const isOom = error._oom || oomDetected || msg.includes('oom') || msg.includes('memory');
            const errLabel = isOom ? 'Out of memory (file too large)' : (error.message || 'Extraction failed');
            setButtonState('error', errLabel);

            if (window.ToolProgressManager) {
                window.ToolProgressManager.clear('tool-audio-extractor');
            }
            throw error;
        } finally {
            isExtracting = false;
        }
    }

    const toolDefinition = {
        id: 'tool-audio-extractor',
        _id: 'tool-audio-extractor',
        isTool: true,
        version: '1.0.0',
        title: 'Audio Extractor',
        titleKey: 'tool_audio_extractor_title',
        desc: 'Video to Audio',
        descKey: 'tool_audio_extractor_desc',
        dropKey: 'tool_audio_extractor_drop',
        icon: 'audiotrack',
        category: ['Video', 'Tools'],
        features: [
            'High Quality MP3 (192 kbps, LAME encoder)',
            'Supports MP4, MOV, WebM, MKV, AVI, FLV',
            '100% Client-side WASM Processing (Private)',
            'Automatic Multi-threaded Acceleration'
        ],
        specs: [
            { label: 'ENGINE', value: 'FFmpeg WebAssembly' },
            { label: 'BITRATE', value: '192 kbps MP3' },
            { label: 'PRIVACY', value: '100% Local (Zero Server Upload)' }
        ],
        schema: {
            inputs: [
                {
                    id: 'videoFile',
                    type: 'file',
                    label: 'Video File',
                    labelKey: 'tool_audio_extractor_drop',
                    subtitle: 'Supports MP4, MOV, WebM, MKV, AVI',
                    accept: ['video/mp4', 'video/quicktime', 'video/webm', 'video/*'],
                    required: true,
                    maxSizeMb: 1500
                }
            ]
        },
        run: async function(inputs, context = {}) {
            activeContext = context;
            const file = inputs.videoFile || inputs.file || selectedFile;
            if (!file) throw new Error('No video file provided.');

            return await extractAudio(file);
        },
        initModal: function(ctx) {
            const { optContainer, processLabel } = ctx;
            if (optContainer) optContainer.innerHTML = '';
            if (processLabel) processLabel.textContent = t('tool_audio_btn') || 'Extract Audio';
            selectedFile = null;
        },
        onFileSelect: function(file) {
            selectedFile = file;
            setButtonState('ready', t('tool_audio_btn') || 'Extract Audio');
        },
        onProcess: function(file) {
            extractAudio(file || selectedFile);
        },
        onReset: function() {
            selectedFile = null;
            isExtracting = false;
            activeContext = null;
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

    window.AudioExtractorTool = toolDefinition;
})();
