(function () {
    'use strict';

    const REPO_OWNER = 'cutefishaep';
    const REPO_NAME = 'fp-ext';
    const GITHUB_API_LATEST = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
    const GITHUB_RELEASES_PAGE = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`;
    const FALLBACK_VERSION = 'v0.3.0';
    const FALLBACK_ZIP_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${FALLBACK_VERSION}/fish-acceleration.zip`;
    const CACHE_KEY = 'fp_ext_latest_release_cache';

    // Tempat link YouTube tutorial (diisi user)
    // Format: 'https://www.youtube.com/watch?v=...' atau 'https://youtu.be/...'
    let youtubeTutorialUrl = '';

    function t(key, fallback) {
        return (window.getTranslation && window.getTranslation(key)) || fallback || key;
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

    async function fetchLatestRelease() {
        // Cek sessionStorage cache terlebih dahulu (cache selama 10 menit)
        try {
            const cached = sessionStorage.getItem(CACHE_KEY);
            if (cached) {
                const parsed = JSON.parse(cached);
                if (Date.now() - parsed.timestamp < 10 * 60 * 1000 && parsed.data) {
                    return parsed.data;
                }
            }
        } catch (_) {}

        try {
            const res = await fetch(GITHUB_API_LATEST, {
                headers: { 'Accept': 'application/vnd.github.v3+json' }
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();

            let zipAsset = null;
            if (Array.isArray(data.assets)) {
                zipAsset = data.assets.find(a => (a.name || '').endsWith('.zip')) || data.assets[0];
            }

            const result = {
                tag: data.tag_name || FALLBACK_VERSION,
                name: data.name || `Fish Acceleration ${data.tag_name || FALLBACK_VERSION}`,
                publishedAt: data.published_at || null,
                zipUrl: zipAsset?.browser_download_url || FALLBACK_ZIP_URL,
                zipSize: zipAsset?.size || 84729,
                releaseUrl: data.html_url || GITHUB_RELEASES_PAGE
            };

            try {
                sessionStorage.setItem(CACHE_KEY, JSON.stringify({
                    timestamp: Date.now(),
                    data: result
                }));
            } catch (_) {}

            return result;
        } catch (err) {
            console.warn('[ExtensionTool] Failed to fetch latest release from GitHub API, using fallback:', err.message);
            return {
                tag: FALLBACK_VERSION,
                name: `Fish Acceleration ${FALLBACK_VERSION}`,
                publishedAt: '2026-11-16T02:48:12Z',
                zipUrl: FALLBACK_ZIP_URL,
                zipSize: 84729,
                releaseUrl: GITHUB_RELEASES_PAGE
            };
        }
    }

    function formatBytes(bytes) {
        if (!bytes || isNaN(bytes)) return '~83 KB';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    }

    function formatDate(isoStr) {
        if (!isoStr) return '—';
        try {
            const d = new Date(isoStr);
            const isId = (window.getCurrentLanguage && window.getCurrentLanguage() === 'id');
            return d.toLocaleDateString(isId ? 'id-ID' : 'en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
        } catch {
            return '—';
        }
    }

    function initExtensionMethodUI({ optContainer, dropZone, processBtn, progressSec }) {
        if (!optContainer) return;
        if (dropZone) dropZone.classList.add('hidden');
        if (processBtn && processBtn.parentElement) processBtn.parentElement.classList.add('hidden');
        if (progressSec) progressSec.classList.add('hidden');

        optContainer.innerHTML = '';

        const wrapper = document.createElement('div');
        wrapper.className = 'ext-modal-container';

        const embedUrl = extractYouTubeEmbedUrl(youtubeTutorialUrl);

        wrapper.innerHTML = `
            <!-- 1. Kolom Tutorial di Atas -->
            <div class="ext-card-section">
                <div class="ext-section-header">
                    <span class="material-symbols-rounded">smart_display</span>
                    <span>${t('ext_tutorial_title', 'Tutorial Pemasangan Ekstensi')}</span>
                </div>

                <div class="ext-video-wrap" id="ext-video-container">
                    ${embedUrl ? `
                        <iframe src="${embedUrl}" title="YouTube video player" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
                    ` : `
                        <div class="ext-video-placeholder">
                            <span class="material-symbols-rounded">play_circle</span>
                            <div class="ext-video-placeholder-title">${t('ext_video_pending', 'Tutorial Video')}</div>
                            <div class="ext-video-placeholder-desc">${t('ext_video_pending_desc', 'Video tutorial pemasangan ekstensi akan segera tersedia di sini.')}</div>
                        </div>
                    `}
                </div>

                <div class="ext-steps-list">
                    <div class="ext-step-item">
                        <span class="ext-step-badge">1</span>
                        <div class="ext-step-text">Download file ekstensi <strong id="ext-step-zip-name">fish-acceleration.zip</strong> pada blok di bawah.</div>
                    </div>
                    <div class="ext-step-item">
                        <span class="ext-step-badge">2</span>
                        <div class="ext-step-text">Ekstrak file <span class="ext-step-code">.zip</span> tersebut ke dalam folder di komputer Anda.</div>
                    </div>
                    <div class="ext-step-item">
                        <span class="ext-step-badge">3</span>
                        <div class="ext-step-text">Buka tab baru di browser: <span class="ext-step-code">chrome://extensions/</span> (dukungan Chrome, Edge, Brave, Kiwi).</div>
                    </div>
                    <div class="ext-step-item">
                        <span class="ext-step-badge">4</span>
                        <div class="ext-step-text">Aktifkan tombol <strong>Developer mode</strong> (Mode pengembang) di pojok kanan atas.</div>
                    </div>
                    <div class="ext-step-item">
                        <span class="ext-step-badge">5</span>
                        <div class="ext-step-text">Klik <strong>Load unpacked</strong> (Muat yang belum dibuka), lalu pilih folder hasil ekstrak tadi.</div>
                    </div>
                    <div class="ext-step-item">
                        <span class="ext-step-badge">6</span>
                        <div class="ext-step-text">Buka <strong>TikTok Studio</strong> (<span class="ext-step-code">tiktok.com/tiktokstudio</span>), ekstensi akan aktif otomatis.</div>
                    </div>
                </div>
            </div>

            <!-- 2. Block Download Extension di Bawah -->
            <div class="ext-card-section ext-download-box">
                <div class="ext-section-header">
                    <span class="material-symbols-rounded">download</span>
                    <span>${t('ext_download_title', 'Download Ekstensi')}</span>
                </div>

                <div class="ext-release-info-grid">
                    <div class="ext-release-chip">
                        <span class="ext-chip-label">${t('ext_chip_ver', 'Versi')}</span>
                        <span class="ext-chip-val badge-safe" id="ext-ver-text">${FALLBACK_VERSION}</span>
                    </div>
                    <div class="ext-release-chip">
                        <span class="ext-chip-label">${t('ext_chip_size', 'Ukuran')}</span>
                        <span class="ext-chip-val" id="ext-size-text">~83 KB</span>
                    </div>
                    <div class="ext-release-chip">
                        <span class="ext-chip-label">${t('ext_chip_date', 'Diperbarui')}</span>
                        <span class="ext-chip-val" id="ext-date-text">...</span>
                    </div>
                    <div class="ext-release-chip">
                        <span class="ext-chip-label">${t('ext_chip_status', 'Status')}</span>
                        <span class="ext-chip-val badge-safe">Latest Stable</span>
                    </div>
                </div>

                <div class="ext-download-actions">
                    <a href="${FALLBACK_ZIP_URL}" id="ext-download-btn" class="ext-btn-download" download>
                        <span class="material-symbols-rounded">file_download</span>
                        <span>${t('ext_btn_download', 'Download Extension (.zip)')}</span>
                    </a>
                    <a href="${GITHUB_RELEASES_PAGE}" id="ext-github-btn" class="ext-btn-secondary" target="_blank" rel="noopener noreferrer">
                        <span class="material-symbols-rounded">open_in_new</span>
                        <span>GitHub Release</span>
                    </a>
                </div>

                <div class="ext-footer-note">
                    ${t('ext_footer_note', 'Ekstensi otomatis mendeteksi rilis versi terbaru langsung dari repositori cutefishaep/fp-ext.')}
                </div>
            </div>
        `;

        optContainer.appendChild(wrapper);

        // Fetch release terbaru secara asinkron dan update UI
        fetchLatestRelease().then(release => {
            const verEl = wrapper.querySelector('#ext-ver-text');
            const sizeEl = wrapper.querySelector('#ext-size-text');
            const dateEl = wrapper.querySelector('#ext-date-text');
            const dlBtn = wrapper.querySelector('#ext-download-btn');
            const ghBtn = wrapper.querySelector('#ext-github-btn');

            if (verEl) verEl.textContent = release.tag;
            if (sizeEl) sizeEl.textContent = formatBytes(release.zipSize);
            if (dateEl) dateEl.textContent = formatDate(release.publishedAt);
            if (dlBtn && release.zipUrl) dlBtn.href = release.zipUrl;
            if (ghBtn && release.releaseUrl) ghBtn.href = release.releaseUrl;

            // Update badge tool card jika ada
            const cardEl = document.querySelector(`.tool-card[data-id="tool-tiktok-extension"] .tool-ver-badge`);
            if (cardEl && release.tag) {
                cardEl.textContent = release.tag;
            }
        });
    }

    const toolDefinition = {
        id: 'tool-tiktok-extension',
        _id: 'tool-tiktok-extension',
        isTool: true,
        version: '0.3.0',
        title: 'Extension Method',
        titleKey: 'tool_extension_title',
        desc: 'TikTok Studio Desktop UA & Ingest Extension',
        descKey: 'tool_extension_desc',
        icon: 'extension',
        category: ['TikTok', 'Tools'],
        hideDropZone: true,
        hideProcessBtn: true,
        hideProgress: true,
        specs: [
            { label: 'PLATFORM', value: 'Chrome, Edge, Brave, Kiwi' },
            { label: 'VERSION', value: 'v0.3.0 (Auto-updating)' },
            { label: 'SOURCE', value: 'GitHub / cutefishaep/fp-ext' }
        ],
        initModal: initExtensionMethodUI,
        setTutorialUrl: function(url) {
            youtubeTutorialUrl = url || '';
        }
    };

    // Public setter agar link YouTube bisa di-inject atau diatur kapan saja
    window.setExtensionTutorialUrl = function(url) {
        youtubeTutorialUrl = url || '';
        const container = document.getElementById('ext-video-container');
        if (container) {
            const embed = extractYouTubeEmbedUrl(youtubeTutorialUrl);
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

    window.ExtensionMethodTool = toolDefinition;

})();
