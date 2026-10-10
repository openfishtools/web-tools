(function() {
    'use strict';

    function t(key) {
        if (typeof window.getTranslation === 'function') {
            const res = window.getTranslation(key);
            if (res && res !== key) return res;
        }
        return key;
    }

    let selectedZipFile = null;
    let selectedAudioFile = null;
    let isProcessing = false;
    let defaultFps = 30;
    let defaultBitrate = 12;
    let activeContext = null;

    function log(msg) {
        if (activeContext && typeof activeContext.onLog === 'function') {
            activeContext.onLog(msg);
        }
        console.log('[Image Sequence]', msg);
    }

    function setButtonState(state, text) {
        const processBtn = document.getElementById('tool-process-btn');
        const processLabel = document.getElementById('tool-process-label');
        if (!processBtn) return;

        if (state === 'processing') {
            processBtn.disabled = true;
            processBtn.dataset.state = 'processing';
            if (processLabel) processLabel.textContent = text || t('status_processing') || "Converting...";
        } else if (state === 'completed') {
            processBtn.disabled = false;
            processBtn.dataset.state = 'completed';
            if (processLabel) processLabel.textContent = text || t('status_process_another') || "Process Another";
        } else if (state === 'error') {
            processBtn.disabled = false;
            processBtn.dataset.state = 'error';
            if (processLabel) processLabel.textContent = text || "Conversion Failed";
            setTimeout(() => {
                setButtonState('ready');
            }, 3500);
        } else {
            processBtn.disabled = !selectedZipFile;
            processBtn.dataset.state = selectedZipFile ? 'ready' : 'idle';
            if (processLabel) processLabel.textContent = text || t('tool_seq_btn') || "Convert to Video";
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
            window.ToolProgressManager.set('tool-image-sequence', {
                isProcessing: percent < 100,
                percent: percent,
                status: text || `${percent}%`,
                file: selectedZipFile
            });
        }
    }

    async function loadJSZip() {
        if (window.JSZip) return true;
        return new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = 'assets/jszip/jszip.min.js';
            script.onload = () => resolve(true);
            script.onerror = () => {
                const cdn = document.createElement('script');
                cdn.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
                cdn.onload = () => resolve(true);
                cdn.onerror = () => resolve(false);
                document.head.appendChild(cdn);
            };
            document.head.appendChild(script);
        });
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
                if (ffmpegRes.ok && workerRes.ok) {
                    const ffmpegCode = await ffmpegRes.text();
                    const workerCode = await workerRes.text();
                    const workerBlobUrl = URL.createObjectURL(new Blob([workerCode], { type: 'text/javascript' }));
                    const patchedCode = ffmpegCode.replace(/new Worker\(new URL\(e\.p\+e\.u\(814\),e\.b\),\{type:void 0\}\)/g, `new Worker("${workerBlobUrl}")`)
                                                   .replace(/u:e=>e\+"\.\x66\x66\x6d\x70\x65\x67\.\x6a\x73"/g, `u:()=>"${workerBlobUrl}"`)
                                                   .replace(/u:e=>e\+"\x2effmpeg\x2ejs"/g, `u:()=>"${workerBlobUrl}"`);
                    const ffmpegBlobUrl = URL.createObjectURL(new Blob([patchedCode], { type: 'text/javascript' }));
                    await loadScript(ffmpegBlobUrl);
                }
            }
            if (window.FFmpegWASM && window.FFmpegUtil) return true;
        } catch (e) {}

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
        } catch (e) {}

        return !!(window.FFmpegWASM && window.FFmpegUtil);
    }

    function initSequenceUI(ctx) {
        const { optContainer, processLabel } = ctx;
        if (!optContainer) return;

        if (processLabel) processLabel.textContent = t('tool_seq_btn') || 'Convert to Video';

        optContainer.innerHTML = `
            <div class="seq-config-grid">
                <div class="seq-input-card">
                    <label class="seq-config-label" for="seq-fps-input">
                        <span class="material-symbols-rounded">speed</span>
                        <span>${t('tool_seq_fps') || 'Frame Rate (FPS)'}</span>
                    </label>
                    <div class="seq-input-wrapper">
                        <input type="number" id="seq-fps-input" class="seq-text-input" min="1" max="240" value="${defaultFps}">
                        <span class="seq-unit-badge">FPS</span>
                    </div>
                </div>

                <div class="seq-input-card">
                    <label class="seq-config-label" for="seq-bitrate-input">
                        <span class="material-symbols-rounded">equalizer</span>
                        <span>${t('tool_seq_bitrate') || 'Bitrate (Mbps)'}</span>
                    </label>
                    <div class="seq-input-wrapper">
                        <input type="number" id="seq-bitrate-input" class="seq-text-input" min="1" max="50" value="${defaultBitrate}">
                        <span class="seq-unit-badge">Mbps</span>
                    </div>
                </div>
            </div>

            <div class="seq-audio-zone" id="seq-audio-zone">
                <input type="file" id="seq-audio-input" class="hidden" accept="audio/*,video/*">
                <div class="seq-audio-inner" id="seq-audio-inner">
                    <span class="material-symbols-rounded seq-audio-icon">music_note</span>
                    <div class="seq-audio-text-group">
                        <span class="seq-audio-title">${t('tool_seq_audio_drop') || 'Attach Audio/Soundtrack (Optional)'}</span>
                        <span class="seq-audio-sub">${t('tool_drop_formats') || 'Supports MP3, WAV, M4A, AAC, MP4'}</span>
                    </div>
                </div>
                <div class="seq-audio-badge hidden" id="seq-audio-badge">
                    <span class="material-symbols-rounded">check_circle</span>
                    <span class="seq-audio-name" id="seq-audio-name">audio.mp3</span>
                    <button type="button" class="seq-audio-remove-btn" id="seq-audio-remove-btn" title="Remove Audio">
                        <span class="material-symbols-rounded">close</span>
                    </button>
                </div>
            </div>
        `;

        const fpsInput = document.getElementById('seq-fps-input');
        const bitrateInput = document.getElementById('seq-bitrate-input');
        const audioZone = document.getElementById('seq-audio-zone');
        const audioInput = document.getElementById('seq-audio-input');
        const audioInner = document.getElementById('seq-audio-inner');
        const audioBadge = document.getElementById('seq-audio-badge');
        const audioName = document.getElementById('seq-audio-name');
        const removeAudioBtn = document.getElementById('seq-audio-remove-btn');

        if (fpsInput) fpsInput.addEventListener('change', () => defaultFps = Math.max(1, Math.min(240, parseInt(fpsInput.value, 10) || 30)));
        if (bitrateInput) bitrateInput.addEventListener('change', () => defaultBitrate = Math.max(1, Math.min(50, parseInt(bitrateInput.value, 10) || 12)));

        if (audioZone && audioInput) {
            audioZone.addEventListener('click', (e) => {
                if (e.target.closest('#seq-audio-remove-btn')) return;
                audioInput.click();
            });

            audioInput.addEventListener('change', (e) => {
                if (e.target.files && e.target.files[0]) {
                    selectedAudioFile = e.target.files[0];
                    if (audioInner) audioInner.classList.add('hidden');
                    if (audioBadge) audioBadge.classList.remove('hidden');
                    if (audioName) audioName.textContent = selectedAudioFile.name;
                    if (typeof window.updateOpenModalsLayout === 'function') window.updateOpenModalsLayout(true);
                }
            });

            if (removeAudioBtn) {
                removeAudioBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    selectedAudioFile = null;
                    audioInput.value = '';
                    if (audioBadge) audioBadge.classList.add('hidden');
                    if (audioInner) audioInner.classList.remove('hidden');
                    if (typeof window.updateOpenModalsLayout === 'function') window.updateOpenModalsLayout(true);
                });
            }
        }
    }

    async function processSequence(zipFile) {
        if (isProcessing || !zipFile) return;
        isProcessing = true;

        let ffmpeg = null;
        let oomDetected = false;
        const writtenFiles = [];

        const fps = defaultFps || 30;
        const bitrate = defaultBitrate || 12;

        setButtonState('processing', t('status_processing') || 'Reading ZIP...');
        setProgress(5, t('status_unzipped') || 'Unpacking images...');

        try {
            const hasZip = await loadJSZip();
            if (!hasZip || !window.JSZip) throw new Error("JSZip library failed to load.");

            const hasFFmpeg = await loadFFmpegLibraries();
            if (!hasFFmpeg) throw new Error("FFmpeg library failed to load.");

            const zip = await window.JSZip.loadAsync(zipFile);
            const imageEntries = [];
            const validExts = ['.png', '.jpg', '.jpeg', '.webp', '.bmp'];

            zip.forEach((relPath, entry) => {
                const lower = relPath.toLowerCase();
                if (entry.dir || lower.startsWith('__macosx/') || lower.split('/').some(part => part.startsWith('.'))) return;
                if (validExts.some(ext => lower.endsWith(ext))) {
                    imageEntries.push(entry);
                }
            });

            if (imageEntries.length === 0) {
                throw new Error(t('status_empty_zip') || "No valid images (PNG/JPG/WebP/BMP) found inside ZIP.");
            }

            imageEntries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

            let firstExt = imageEntries[0].name.split('.').pop().toLowerCase() || 'png';
            if (firstExt === 'jpeg') firstExt = 'jpg';

            setProgress(15, `${t('status_writing_frames') || 'Writing frames'} (0/${imageEntries.length})...`);

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

            const loadedInstance = await window.CutefishFFmpegLoader.getFFmpegInstance({
                isMultiThread,
                log: (msg) => console.log(msg)
            });

            if (!loadedInstance) {
                throw new Error("Failed to initialize FFmpeg engine.");
            }
            ffmpeg = loadedInstance;

            for (let i = 0; i < imageEntries.length; i++) {
                const entry = imageEntries[i];
                const arrayBuffer = await entry.async('arraybuffer');
                const frameName = `frame_${String(i).padStart(6, '0')}.${firstExt}`;
                await ffmpeg.writeFile(frameName, new Uint8Array(arrayBuffer));
                writtenFiles.push(frameName);

                if (i % 15 === 0 || i === imageEntries.length - 1) {
                    const percent = Math.round(15 + (i / imageEntries.length) * 45);
                    setProgress(percent, `Unpacking frame ${i + 1}/${imageEntries.length}...`);
                    setButtonState('processing', `Frames ${i + 1}/${imageEntries.length}`);
                }
            }

            let hasAudio = false;
            if (selectedAudioFile) {
                setProgress(65, t('status_writing_audio') || 'Attaching audio...');
                const audioExt = selectedAudioFile.name.split('.').pop() || 'mp3';
                await ffmpeg.writeFile(`audio.${audioExt}`, await fetchFile(selectedAudioFile));
                writtenFiles.push(`audio.${audioExt}`);
                hasAudio = true;
            }

            ffmpeg.on('log', ({ message }) => {
                const lc = String(message || '').toLowerCase();
                if (lc.includes('oom') || lc.includes('out of memory')) oomDetected = true;
            });

            ffmpeg.on('progress', ({ progress }) => {
                const percent = Math.max(65, Math.min(95, Math.round(65 + progress * 30)));
                setProgress(percent, `${t('status_encoding') || 'Encoding video'} (${percent}%)...`);
                setButtonState('processing', `Encoding ${percent}%...`);
            });

            const threads = navigator.hardwareConcurrency ? Math.min(navigator.hardwareConcurrency, 4).toString() : '2';

            const ffmpegArgs = [
                '-y',
                '-framerate', String(fps),
                '-i', `frame_%06d.${firstExt}`
            ];

            if (hasAudio) {
                const audioExt = selectedAudioFile.name.split('.').pop() || 'mp3';
                ffmpegArgs.push('-i', `audio.${audioExt}`, '-c:a', 'aac', '-b:a', '192k', '-shortest');
            }

            ffmpegArgs.push(
                '-threads', threads,
                '-c:v', 'libx264',
                '-b:v', `${bitrate}M`,
                '-pix_fmt', 'yuv420p',
                '-movflags', '+faststart',
                'output.mp4'
            );

            setProgress(70, t('status_encoding') || 'Rendering video...');
            await ffmpeg.exec(ffmpegArgs);

            if (oomDetected) {
                throw new Error("FFmpeg ran out of memory. Try using fewer frames or lower resolution images.");
            }

            setProgress(98, t('status_finalizing') || 'Finalizing MP4...');
            const data = await ffmpeg.readFile('output.mp4');

            if (!data || data.byteLength < 1024) {
                throw new Error("Output video file generation failed.");
            }

            const blob = new Blob([data], { type: 'video/mp4' });
            const outBase = zipFile.name.replace(/\.[^/.]+$/, '');
            const outName = `${outBase}_${fps}fps.mp4`;

            if (activeContext) {
                setProgress(100, t('status_download_success') || 'Video successfully generated!');
                setButtonState('completed', t('status_process_another') || 'Process Another');
                return {
                    type: 'file',
                    data: blob,
                    filename: outName
                };
            }

            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = outName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            setProgress(100, t('status_download_success') || 'Video successfully generated!');
            setButtonState('completed', t('status_process_another') || 'Process Another');

            if (window.ToolProgressManager) {
                window.ToolProgressManager.set('tool-image-sequence', {
                    isProcessing: false,
                    completed: true,
                    percent: 100,
                    status: 'Complete',
                    file: zipFile
                });
            }

            if (typeof window.showToast === 'function') {
                window.showToast(t('status_completed_toast') || 'Image sequence converted successfully!');
            }

        } catch (error) {
            console.error('Image Sequence Tool Error:', error);
            setButtonState('error', error.message || 'Conversion failed');
            if (window.ToolProgressManager) {
                window.ToolProgressManager.clear('tool-image-sequence');
            }
            if (activeContext) throw error;
        } finally {
            try {
                if (ffmpeg) {
                    await ffmpeg.deleteFile('output.mp4').catch(() => {});
                    for (const virtualFile of writtenFiles) {
                        await ffmpeg.deleteFile(virtualFile).catch(() => {});
                    }
                }
            } finally {
                isProcessing = false;
            }
        }
    }

    const toolDefinition = {
        id: 'tool-image-sequence',
        _id: 'tool-image-sequence',
        isTool: true,
        version: '1.1.0',
        title: 'Image Sequence to Video',
        titleKey: 'tool_seq_title',
        desc: 'AM Zip Exporter',
        descKey: 'tool_seq_desc',
        dropKey: 'tool_seq_drop',
        icon: 'video_file',
        category: ['Video', 'Tools'],
        features: [
            'Converts PNG, JPG, WebP, BMP frames inside ZIP',
            'Custom FPS (1 - 240 fps) & Bitrate controls',
            'Optional Audio/Soundtrack attachment',
            'Client-side Local WebAssembly Encoding'
        ],
        specs: [
            { label: 'INPUT', value: 'ZIP (Image Sequence)' },
            { label: 'OUTPUT', value: 'H.264 MP4' },
            { label: 'PROCESSING', value: '100% Client-side' }
        ],
        schema: {
            inputs: [
                {
                    id: 'zipFile',
                    name: 'zipFile',
                    type: 'file',
                    label: 'ZIP Archive',
                    labelKey: 'tool_seq_drop',
                    accept: '.zip',
                    required: true
                },
                {
                    id: 'fps',
                    name: 'fps',
                    type: 'number',
                    label: 'FPS',
                    labelKey: 'tool_seq_fps',
                    min: 1,
                    max: 240,
                    default: 30
                },
                {
                    id: 'bitrate',
                    name: 'bitrate',
                    type: 'number',
                    label: 'Bitrate',
                    labelKey: 'tool_seq_bitrate',
                    min: 1,
                    max: 50,
                    default: 12
                },
                {
                    id: 'audioFile',
                    name: 'audioFile',
                    type: 'file',
                    label: 'Audio Track',
                    labelKey: 'tool_seq_audio_drop',
                    accept: 'audio/*,video/*',
                    required: false
                }
            ]
        },
        run: async function(inputs, context) {
            activeContext = context;
            try {
                const zipFile = inputs.zipFile || inputs.file;
                if (!zipFile) throw new Error('ZIP file is required');
                defaultFps = parseInt(inputs.fps, 10) || 30;
                defaultBitrate = parseInt(inputs.bitrate, 10) || 12;
                selectedAudioFile = inputs.audioFile || null;
                return await processSequence(zipFile);
            } finally {
                activeContext = null;
            }
        },
        initModal: function(ctx) {
            initSequenceUI(ctx);
            selectedZipFile = null;
            selectedAudioFile = null;
        },
        onFileSelect: function(file) {
            if (file && !file.name.toLowerCase().endsWith('.zip')) {
                setButtonState('error', 'Please select a ZIP file');
                return;
            }
            selectedZipFile = file;
            setButtonState('ready', t('tool_seq_btn') || 'Convert to Video');
        },
        onProcess: function(file) {
            processSequence(file || selectedZipFile);
        },
        onReset: function() {
            selectedZipFile = null;
            selectedAudioFile = null;
            isProcessing = false;
            const audioBadge = document.getElementById('seq-audio-badge');
            const audioInner = document.getElementById('seq-audio-inner');
            const audioInput = document.getElementById('seq-audio-input');
            if (audioBadge) audioBadge.classList.add('hidden');
            if (audioInner) audioInner.classList.remove('hidden');
            if (audioInput) audioInput.value = '';
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

    window.ImageSequenceTool = toolDefinition;
})();
