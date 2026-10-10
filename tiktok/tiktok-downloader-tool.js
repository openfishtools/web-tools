(function() {
    'use strict';

    const API_URL = '/api';

    let currentMeta = null;
    let isDownloading = false;
    let activeContext = null;

    function t(key) {
        return (window.getTranslation && window.getTranslation(key)) || key;
    }

    function isTikTokUrl(raw) {
        if (!raw || typeof raw !== 'string') return false;
        let u = raw.trim();
        if (!u.startsWith('http://') && !u.startsWith('https://')) {
            u = 'https://' + u;
        }
        try {
            const parsed = new URL(u);
            const host = parsed.hostname.toLowerCase();
            const validHosts = ['tiktok.com', 'm.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com', 'tt.site', 'tikwm.com'];
            return validHosts.some(h => host === h || host.endsWith('.' + h));
        } catch {
            return false;
        }
    }

    function setButtonState(state, text) {
        const processBtn = document.getElementById('tool-process-btn');
        const processLabel = document.getElementById('tool-process-label');
        if (!processBtn) return;

        if (state === 'processing') {
            processBtn.disabled = true;
            processBtn.dataset.state = 'processing';
            if (processLabel) processLabel.textContent = text || "Processing...";
        } else if (state === 'completed') {
            processBtn.disabled = false;
            processBtn.dataset.state = 'completed';
            if (processLabel) processLabel.textContent = text || t('status_download_success') || "Video Downloaded!";
            setTimeout(() => {
                setButtonState('ready');
            }, 3500);
        } else if (state === 'error') {
            processBtn.disabled = false;
            processBtn.dataset.state = 'error';
            if (processLabel) processLabel.textContent = text || "Download Failed";
            setTimeout(() => {
                setButtonState('ready');
            }, 3500);
        } else {
            processBtn.disabled = false;
            processBtn.dataset.state = 'ready';
            if (processLabel) processLabel.textContent = text || t('tool_downloader_btn') || "Download Video";
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
            window.ToolProgressManager.set('tool-tiktok-downloader', {
                isProcessing: percent < 100,
                percent: percent,
                status: text || `${percent}%`
            });
        }
    }

    async function resolveAndDownload(pageUrl) {
        setButtonState('processing', "Resolving...");
        setProgress(0, "Fetching video details...");

        try {
            const response = await fetch(`${API_URL}/tiktok-resolve?url=${encodeURIComponent(pageUrl)}`);
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || errorData.details || `Unable to resolve TikTok video URL (${response.status}).`);
            }

            currentMeta = await response.json();
            if (!currentMeta || (!currentMeta.play && !currentMeta.hdplay)) {
                throw new Error("Could not extract video stream.");
            }

            if (activeContext && typeof activeContext.onPreview === 'function') {
                activeContext.onPreview({
                    cover: currentMeta.cover || '',
                    author: currentMeta.author_nickname || currentMeta.author_unique_id || 'Creator',
                    title: currentMeta.title || '—'
                });
            }

            const dlPreview = document.getElementById('tiktok-dl-preview');
            const dlCover = document.getElementById('tiktok-dl-cover');
            const dlAuthor = document.getElementById('tiktok-dl-author');
            const dlTitle = document.getElementById('tiktok-dl-title');

            if (dlPreview && currentMeta) {
                if (dlCover) dlCover.src = currentMeta.cover || '';
                if (dlAuthor) dlAuthor.textContent = currentMeta.author_nickname || currentMeta.author_unique_id || 'Creator';
                if (dlTitle) dlTitle.textContent = currentMeta.title || '—';
                dlPreview.classList.remove('hidden');
                if (typeof window.updateOpenModalsLayout === 'function') {
                    window.updateOpenModalsLayout(true);
                }
            }

            return await downloadVideo();

        } catch (err) {
            console.error(err);
            setButtonState('error', err.message || "Resolution failed");
            if (window.ToolProgressManager) {
                window.ToolProgressManager.clear('tool-tiktok-downloader');
            }
            if (activeContext) throw err;
        }
    }

    async function downloadVideo() {
        if (!currentMeta) return;

        setButtonState('processing', "Downloading...");
        setProgress(0, "Preparing download...");

        try {
            const videoUrl = (currentMeta.hdplay && currentMeta.hdplay.startsWith('http')) ? currentMeta.hdplay : (currentMeta.play || currentMeta.hdplay);

            if (!videoUrl) {
                throw new Error("No video URL available.");
            }

            const proxyUrl = `${API_URL}/proxy?url=${encodeURIComponent(videoUrl)}`;
            const response = await fetch(proxyUrl);

            if (!response.ok) {
                throw new Error("Download failed: " + response.status);
            }

            const contentLength = response.headers.get('content-length');
            const total = contentLength ? parseInt(contentLength, 10) : 0;
            let loaded = 0;

            const reader = response.body.getReader();
            const chunks = [];

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
                loaded += value.length;
                if (total > 0) {
                    const percent = Math.round((loaded / total) * 100);
                    setProgress(percent, `Downloading ${percent}%...`);
                    setButtonState('processing', `Downloading ${percent}%...`);
                }
            }

            setProgress(100, "Finalizing...");
            setButtonState('processing', "Finalizing...");
            const blob = new Blob(chunks, { type: 'video/mp4' });
            const filename = `tiktok_${currentMeta.author_unique_id || 'video'}_${Date.now()}.mp4`;

            if (activeContext) {
                setProgress(100, "Done!");
                setButtonState('completed', t('status_download_success') || "Video Downloaded!");
                return {
                    type: 'file',
                    data: blob,
                    filename: filename
                };
            }

            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(blobUrl);

            setProgress(100, "Done!");
            setButtonState('completed', t('status_download_success') || "Video Downloaded!");

            if (window.ToolProgressManager) {
                window.ToolProgressManager.set('tool-tiktok-downloader', {
                    isProcessing: false,
                    completed: true,
                    percent: 100,
                    status: 'Complete'
                });
            }

            const inputUrl = document.getElementById('tool-tiktok-dl-input');
            if (inputUrl) inputUrl.value = '';

            setTimeout(() => {
                const progressSec = document.getElementById('tool-progress-section');
                if (progressSec) progressSec.classList.add('hidden');
            }, 3500);

        } catch (err) {
            console.error(err);
            setButtonState('error', err.message || "Download failed");
            if (window.ToolProgressManager) {
                window.ToolProgressManager.clear('tool-tiktok-downloader');
            }
            if (activeContext) throw err;
        }
    }

    const toolDefinition = {
        id: 'tool-tiktok-downloader',
        _id: 'tool-tiktok-downloader',
        isTool: true,
        version: 'v1.0.3',
        title: 'TikTok Downloader',
        titleKey: 'tool_downloader_title',
        desc: 'Download TikTok video without watermark',
        descKey: 'tool_downloader_desc',
        icon: 'download',
        category: ['TikTok', 'Downloader', 'Tools'],
        inputType: 'url',
        hideDropZone: true,

        schema: {
            inputs: [
                {
                    id: 'url',
                    name: 'url',
                    type: 'url',
                    label: 'TikTok URL',
                    labelKey: 'tool_downloader_url',
                    placeholder: 'https://www.tiktok.com/...',
                    required: true,
                    validate: isTikTokUrl
                }
            ]
        },

        run: async function(inputs, context) {
            activeContext = context;
            try {
                let url = (inputs.url || '').trim();
                if (!url) throw new Error('TikTok URL is required');
                if (!url.startsWith('http://') && !url.startsWith('https://')) {
                    url = 'https://' + url;
                }
                return await resolveAndDownload(url);
            } finally {
                activeContext = null;
            }
        },

        initModal: function(ctx) {
            const { optContainer, processBtn, processLabel, ui } = ctx;
            if (!optContainer) return;

            if (processLabel) processLabel.textContent = t('tool_downloader_btn') || 'Download Video';

            const toolUI = ui || (window.ToolUI ? new window.ToolUI(optContainer) : null);
            if (toolUI) {
                toolUI.clear();
                toolUI.addCustomArea({
                    html: `
                        <div id="tiktok-dl-preview" class="stats-results-container hidden">
                            <div class="stats-preview-container">
                                <div class="stats-video-cover-wrapper">
                                    <img id="tiktok-dl-cover" src="" alt="Cover" class="stats-video-cover">
                                </div>
                                <div class="stats-preview-info">
                                    <div id="tiktok-dl-author" class="stats-creator-name">Creator</div>
                                    <div id="tiktok-dl-title" class="stats-caption">Video title</div>
                                </div>
                            </div>
                        </div>
                    `
                });

                toolUI.addInput({
                    id: 'tool-tiktok-dl-input',
                    label: t('tool_downloader_url') || 'TikTok Video URL',
                    icon: 'link',
                    placeholder: 'https://www.tiktok.com/... or https://tt.site/...',
                    onEnter: () => {
                        if (processBtn) processBtn.click();
                    }
                });
            }
        },

        onProcess: function() {
            const inputUrl = document.getElementById('tool-tiktok-dl-input');
            if (!inputUrl) return;

            let rawInput = inputUrl.value.trim();
            if (!rawInput) {
                showStatus(t('stats_err_enter_url') || 'Please enter a valid TikTok video URL.', "var(--md-sys-color-error)");
                return;
            }

            if (!isTikTokUrl(rawInput)) {
                showStatus(t('stats_err_invalid_url') || 'URL is not a valid TikTok link.', "var(--md-sys-color-error)");
                return;
            }

            let url = rawInput;
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                url = 'https://' + url;
            }

            if (currentMeta) {
                downloadVideo();
            } else {
                resolveAndDownload(url);
            }
        }
    };

    if (window.AppTools && typeof window.AppTools.register === 'function') {
        window.AppTools.register(toolDefinition);
    } else {
        window._pendingTools = window._pendingTools || [];
        window._pendingTools.push(toolDefinition);
    }
})();
