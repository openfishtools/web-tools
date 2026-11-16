(function () {
    'use strict';

    const REPO_OWNER = 'cutefishaep';
    const REPO_NAME = 'fp-ext';
    const GITHUB_API_LATEST = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
    const GITHUB_RELEASES_PAGE = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`;
    const FALLBACK_VERSION = 'v0.3.0';
    const FALLBACK_ZIP_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${FALLBACK_VERSION}/fish-acceleration.zip`;
    const CACHE_KEY = 'fp_ext_latest_release_cache';

    // Tempat link YouTube tutorial (diisi user kapan saja)
    let youtubeTutorialUrl = '';

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
            return d.toLocaleDateString('id-ID', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
        } catch {
            return '—';
        }
    }

    function injectExtensionStyles() {
        if (document.getElementById('fp-ext-tool-styles')) return;
        const style = document.createElement('style');
        style.id = 'fp-ext-tool-styles';
        style.textContent = `
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
                padding: 18px 20px !important;
                display: flex !important;
                flex-direction: column !important;
                gap: 14px !important;
                box-sizing: border-box !important;
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
                width: 100% !important;
                height: 100% !important;
                border: none !important;
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
                font-size: 13px !important;
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
                gap: 7px !important;
                background: var(--md-sys-color-surface-container-high, #1e291f) !important;
                color: var(--md-sys-color-on-surface, #f2f7f2) !important;
                border: 1px solid var(--md-sys-color-outline-variant, rgba(255, 255, 255, 0.12)) !important;
                border-radius: var(--radius-m, 12px) !important;
                padding: 12px 16px !important;
                font-size: 13px !important;
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
            .ext-footer-note {
                font-size: 11.5px !important;
                color: var(--md-sys-color-on-surface-variant, rgba(242, 247, 242, 0.5)) !important;
                margin-top: 2px !important;
            }

            @media (max-width: 480px) {
                .ext-download-actions {
                    grid-template-columns: 1fr !important;
                }
            }
        `;
        document.head.appendChild(style);
    }

    function initExtensionMethodUI({ optContainer, dropZone, processBtn, progressSec }) {
        if (!optContainer) return;
        injectExtensionStyles();

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
                    <span>Tutorial Pemasangan Ekstensi</span>
                </div>

                <div class="ext-video-wrap" id="ext-video-container">
                    ${embedUrl ? `
                        <iframe src="${embedUrl}" title="YouTube video player" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
                    ` : `
                        <div class="ext-video-placeholder">
                            <span class="material-symbols-rounded">play_circle</span>
                            <div class="ext-video-placeholder-title">Tutorial Video</div>
                            <div class="ext-video-placeholder-desc">Video tutorial pemasangan ekstensi akan segera tersedia di sini.</div>
                        </div>
                    `}
                </div>
            </div>

            <!-- 2. Quetta Browser (Di Atas Ekstensi) -->
            <div class="ext-card-section ext-quetta-card">
                <div class="ext-quetta-header-row">
                    <div class="ext-section-header">
                        <span class="material-symbols-rounded">phone_android</span>
                        <span>Download Quetta Browser</span>
                    </div>
                    <span class="ext-quetta-tag">Android / Mobile</span>
                </div>
                <p class="ext-quetta-desc">Khusus pengguna HP / Android, unduh Quetta Browser untuk memasang dan menjalankan ekstensi di ponsel.</p>
                <a href="https://www.quetta.net/" target="_blank" rel="noopener noreferrer" class="ext-btn-quetta">
                    <span class="material-symbols-rounded">download</span>
                    <span>Download Quetta Browser</span>
                    <span class="material-symbols-rounded" style="font-size: 16px; margin-left: 2px;">arrow_outward</span>
                </a>
            </div>

            <!-- 3. Block Download Extension di Bawah -->
            <div class="ext-card-section ext-download-box">
                <div class="ext-section-header">
                    <span class="material-symbols-rounded">download</span>
                    <span>Download Ekstensi</span>
                </div>

                <div class="ext-release-info-grid">
                    <div class="ext-release-chip">
                        <span class="ext-chip-label">Versi</span>
                        <span class="ext-chip-val badge-safe" id="ext-ver-text">${FALLBACK_VERSION}</span>
                    </div>
                    <div class="ext-release-chip">
                        <span class="ext-chip-label">Ukuran</span>
                        <span class="ext-chip-val" id="ext-size-text">~83 KB</span>
                    </div>
                    <div class="ext-release-chip">
                        <span class="ext-chip-label">Diperbarui</span>
                        <span class="ext-chip-val" id="ext-date-text">...</span>
                    </div>
                    <div class="ext-release-chip">
                        <span class="ext-chip-label">Status</span>
                        <span class="ext-chip-val badge-safe">Latest Stable</span>
                    </div>
                </div>

                <div class="ext-download-actions">
                    <a href="${FALLBACK_ZIP_URL}" id="ext-download-btn" class="ext-btn-download" download>
                        <span class="material-symbols-rounded">file_download</span>
                        <span>Download Extension (.zip)</span>
                    </a>
                    <a href="${GITHUB_RELEASES_PAGE}" id="ext-github-btn" class="ext-btn-secondary" target="_blank" rel="noopener noreferrer">
                        <span class="material-symbols-rounded">open_in_new</span>
                        <span>GitHub Release</span>
                    </a>
                </div>

                <div class="ext-footer-note">
                    Ekstensi otomatis mendeteksi rilis versi terbaru langsung dari repositori cutefishaep/fp-ext.
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
        desc: 'TikTok Studio Desktop UA & Ingest Extension',
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
