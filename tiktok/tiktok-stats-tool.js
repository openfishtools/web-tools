(function() {
    'use strict';

    const API_URL = '/api';

    const COUNTRY_NAMES_ID = {
        'ID': 'Indonesia', 'MY': 'Malaysia', 'SG': 'Singapura', 'US': 'Amerika Serikat',
        'TH': 'Thailand', 'VN': 'Vietnam', 'PH': 'Filipina', 'JP': 'Jepang',
        'KR': 'Korea Selatan', 'GB': 'Inggris', 'AU': 'Australia', 'BR': 'Brasil',
        'DE': 'Jerman', 'FR': 'Prancis', 'IN': 'India', 'RU': 'Rusia',
        'CA': 'Kanada', 'MX': 'Meksiko', 'IT': 'Italia', 'ES': 'Spanyol',
        'NL': 'Belanda', 'TR': 'Turki', 'SA': 'Arab Saudi', 'AE': 'Uni Emirat Arab',
        'CN': 'Tiongkok', 'TW': 'Taiwan', 'HK': 'Hong Kong'
    };

    const COUNTRY_NAMES_EN = {
        'ID': 'Indonesia', 'MY': 'Malaysia', 'SG': 'Singapore', 'US': 'United States',
        'TH': 'Thailand', 'VN': 'Vietnam', 'PH': 'Philippines', 'JP': 'Japan',
        'KR': 'South Korea', 'GB': 'United Kingdom', 'AU': 'Australia', 'BR': 'Brazil',
        'DE': 'Germany', 'FR': 'France', 'IN': 'India', 'RU': 'Russia',
        'CA': 'Canada', 'MX': 'Mexico', 'IT': 'Italy', 'ES': 'Spain',
        'NL': 'Netherlands', 'TR': 'Turkey', 'SA': 'Saudi Arabia', 'AE': 'United Arab Emirates',
        'CN': 'China', 'TW': 'Taiwan', 'HK': 'Hong Kong'
    };

    let isRunning = false;
    let lastAnalysedUrl = '';
    let lastAnalysedTime = 0;
    let lastMetadata = null;
    const cacheMap = new Map();

    function t(key) {
        return (window.getTranslation && window.getTranslation(key)) || key;
    }

    function formatRegion(code) {
        if (!code) return '—';
        const upper = code.toUpperCase();
        const isId = (window.getCurrentLanguage && window.getCurrentLanguage() === 'id');
        const map = isId ? COUNTRY_NAMES_ID : COUNTRY_NAMES_EN;
        return map[upper] || upper;
    }

    function formatUploadDate(epoch) {
        if (!epoch || isNaN(epoch)) return '—';
        try {
            const date = new Date(epoch * 1000);
            const isId = (window.getCurrentLanguage && window.getCurrentLanguage() === 'id');
            const locale = isId ? 'id-ID' : 'en-US';
            return date.toLocaleDateString(locale, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch {
            return '—';
        }
    }

    function formatNumber(num) {
        if (num === null || num === undefined || isNaN(num)) return '—';
        try {
            return new Intl.NumberFormat().format(num);
        } catch {
            return String(num);
        }
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

    let streamProgressInterval = null;
    let currentProgressPct = 0;

    function showErrorCard(msg) {
        const errorCard = document.getElementById('stats-error-display');
        const errorTitle = document.getElementById('stats-error-title');
        const errorMsg = document.getElementById('stats-error-message');
        if (!errorCard) return;

        if (errorTitle) errorTitle.textContent = t('stats_err_title') || 'Video Tidak Ditemukan';
        if (errorMsg) errorMsg.textContent = msg || t('stats_err_not_found') || 'Video mungkin telah dihapus, bersifat privat, atau tautan tidak valid.';
        errorCard.classList.remove('hidden');

        if (typeof window.updateOpenModalsLayout === 'function') {
            window.updateOpenModalsLayout(true);
        }
    }

    function hideErrorCard() {
        const errorCard = document.getElementById('stats-error-display');
        if (errorCard) errorCard.classList.add('hidden');
    }

    function startStreamProgress() {
        const card = document.getElementById('stats-stream-progress-card');
        const fill = document.getElementById('stats-progress-fill');
        const pct = document.getElementById('stats-stream-progress-pct');
        const label = document.getElementById('stats-stream-progress-text');
        if (!card || !fill || !pct) return;

        if (label) label.textContent = t('stats_downloading_stream') || 'Mengunduh stream video untuk cek FPS & Resolusi...';

        currentProgressPct = 15;
        fill.style.width = `${currentProgressPct}%`;
        pct.textContent = `${currentProgressPct}%`;
        card.classList.remove('hidden');

        if (typeof window.updateOpenModalsLayout === 'function') {
            window.updateOpenModalsLayout(true);
        }

        if (streamProgressInterval) clearInterval(streamProgressInterval);
        streamProgressInterval = setInterval(() => {
            if (currentProgressPct < 88) {
                const step = Math.max(1, Math.round((90 - currentProgressPct) / 6));
                currentProgressPct += step;
                fill.style.width = `${currentProgressPct}%`;
                pct.textContent = `${currentProgressPct}%`;
            }
        }, 180);
    }

    function completeStreamProgress() {
        if (streamProgressInterval) {
            clearInterval(streamProgressInterval);
            streamProgressInterval = null;
        }
        const card = document.getElementById('stats-stream-progress-card');
        const fill = document.getElementById('stats-progress-fill');
        const pct = document.getElementById('stats-stream-progress-pct');
        if (!card || !fill || !pct) return;

        fill.style.width = '100%';
        pct.textContent = '100%';

        setTimeout(() => {
            card.classList.add('hidden');
            fill.style.width = '0%';
            pct.textContent = '0%';
            if (typeof window.updateOpenModalsLayout === 'function') {
                window.updateOpenModalsLayout(true);
            }
        }, 320);
    }

    function hideStreamProgress() {
        if (streamProgressInterval) {
            clearInterval(streamProgressInterval);
            streamProgressInterval = null;
        }
        const card = document.getElementById('stats-stream-progress-card');
        const fill = document.getElementById('stats-progress-fill');
        const pct = document.getElementById('stats-stream-progress-pct');
        if (card) card.classList.add('hidden');
        if (fill) fill.style.width = '0%';
        if (pct) pct.textContent = '0%';
    }

    function setInitialSkeletons() {
        const statsCover = document.getElementById('stats-video-cover');
        const statsCreatorName = document.getElementById('stats-creator-name');
        const statsCreatorHandle = document.getElementById('stats-creator-handle');
        const statsCaption = document.getElementById('stats-caption');

        if (statsCover) statsCover.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="90" height="120" fill="%232c322b"/>';
        if (statsCreatorName) statsCreatorName.innerHTML = '<span class="stats-skeleton stats-skeleton-text"></span>';
        if (statsCreatorHandle) statsCreatorHandle.innerHTML = '<span class="stats-skeleton" style="width: 70px;"></span>';
        if (statsCaption) statsCaption.innerHTML = '<span class="stats-skeleton" style="width: 100%;"></span>';

        const infoSkeletonIds = [
            'stats-upload-date', 'stats-region', 'stats-shadowban',
            'stats-views', 'stats-likes', 'stats-comments', 'stats-shares', 'stats-saves', 'stats-engagement'
        ];

        infoSkeletonIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = '<span class="stats-skeleton"></span>';
        });

        const streamValueIds = [
            'stats-resolution', 'stats-fps', 'stats-bitrate', 'stats-duration', 'stats-size'
        ];
        streamValueIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = '—';
        });

        const statsMethod = document.getElementById('stats-method');
        if (statsMethod) {
            statsMethod.classList.remove('is-marquee');
            statsMethod.textContent = '—';
        }
        const methodContainer = document.getElementById('stats-method-marquee-container');
        if (methodContainer) {
            methodContainer.classList.remove('is-overflowing');
        }
    }

    function renderDynamicFields() {
        if (!lastMetadata) return;
        const statsUploadDate = document.getElementById('stats-upload-date');
        const statsRegion = document.getElementById('stats-region');
        const statsShadowban = document.getElementById('stats-shadowban');
        const errorTitle = document.getElementById('stats-error-title');
        const progressText = document.getElementById('stats-stream-progress-text');

        if (statsUploadDate) statsUploadDate.textContent = formatUploadDate(lastMetadata.create_time);
        if (statsRegion) statsRegion.textContent = formatRegion(lastMetadata.region);

        if (statsShadowban) {
            const isShadowbanned = !!lastMetadata.is_nff_or_nr;
            if (isShadowbanned) {
                statsShadowban.innerHTML = `<span class="stats-badge-warn"><span class="material-symbols-rounded">warning</span>${t('stats_restricted')}</span>`;
            } else {
                statsShadowban.innerHTML = `<span class="stats-badge-safe"><span class="material-symbols-rounded">check_circle</span>${t('stats_safe')}</span>`;
            }
        }

        if (errorTitle) errorTitle.textContent = t('stats_err_title') || 'Video Tidak Ditemukan';
        if (progressText) progressText.textContent = t('stats_downloading_stream') || 'Mengunduh stream video untuk cek FPS & Resolusi...';
    }

    window.addEventListener('languageChanged', renderDynamicFields);

    function setButtonState(state, text) {
        const processBtn = document.getElementById('tool-process-btn');
        const processLabel = document.getElementById('tool-process-label');
        if (!processBtn) return;

        if (state === 'processing') {
            processBtn.disabled = true;
            processBtn.dataset.state = 'processing';
            if (processLabel) processLabel.textContent = text || t('stats_status_analysing_video') || "Analysing...";
        } else if (state === 'error') {
            processBtn.disabled = false;
            processBtn.dataset.state = 'error';
            if (processLabel) processLabel.textContent = text || t('stats_err_failed') || "Failed";
            setTimeout(() => {
                setButtonState('ready');
            }, 3500);
        } else {
            processBtn.disabled = false;
            processBtn.dataset.state = 'ready';
            if (processLabel) processLabel.textContent = text || t('tool_stats_btn') || "Analyse";
        }
    }

    function showStatus(msg, color) {
        setButtonState('error', msg);
        if (typeof window.showToast === 'function') {
            window.showToast(msg);
        }
        const statusEl = document.getElementById('tool-progress-status');
        if (statusEl) {
            statusEl.textContent = msg;
            if (color) statusEl.style.color = color;
        }
    }

    function isUndetectedMethod(str) {
        if (!str || typeof str !== 'string') return true;
        let s = str.trim();
        if (!s || s === '—' || s === '-' || s.toLowerCase() === 'unknown' || s.toLowerCase() === 'undetected') return true;
        
        // Strip outer quotes/brackets if wrapped
        if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
            s = s.slice(1, -1).trim();
        }
        if (!s) return true;

        // JSON payloads (e.g. {"aigc_label_type":0})
        if (s.startsWith('{') && s.endsWith('}')) return true;
        try {
            if (s.startsWith('{')) {
                JSON.parse(s);
                return true;
            }
        } catch (_) {}

        // FFmpeg / encoder muxer signatures (e.g. Lavf60.3.100, Lavc, x264, HandBrake)
        if (/^(lavf|lavc|ffmpeg|handbrake|libav|x264|x265)/i.test(s)) return true;

        // ByteDance internal video identifiers & hashes (e.g. vid:v10025g..., v10025g...)
        if (/^vid:[a-zA-Z0-9_-]+/i.test(s)) return true;
        if (/^v\d{4,}[a-zA-Z0-9_-]{8,}/i.test(s)) return true;

        // Generic internal server keys
        if (/^(item_id|video_id|tos_id|aweme_id|music_id|author_id):/i.test(s)) return true;

        // Generic container brand signatures
        if (/^(isom|mp42|dash|iso2|qt|avc1|mp41)$/i.test(s)) return true;

        // Purely numeric strings (e.g. "1", "0", "26400000")
        if (/^\d+$/.test(s)) return true;

        // Must contain at least one alphabet letter
        if (!/[a-zA-Z]/.test(s)) return true;

        return false;
    }

    function displayMethod(comment) {
        const statsMethod = document.getElementById('stats-method');
        if (!statsMethod) return;
        const container = statsMethod.closest('.stats-method-marquee-container') || statsMethod.parentElement;

        statsMethod.classList.remove('is-marquee');
        if (container) container.classList.remove('is-overflowing');
        statsMethod.style.removeProperty('--marquee-distance');
        statsMethod.style.removeProperty('animation-duration');

        let cleanComment = (comment || '').trim();
        if ((cleanComment.startsWith('"') && cleanComment.endsWith('"')) || (cleanComment.startsWith("'") && cleanComment.endsWith("'"))) {
            cleanComment = cleanComment.slice(1, -1).trim();
        }

        if (isUndetectedMethod(cleanComment)) {
            statsMethod.textContent = 'Undetected';
            return;
        }

        const domainOnlyMatch = cleanComment.match(/^(?:https?:\/\/)?([a-zA-Z0-9-]+\.[a-zA-Z0-9.-]+(?:\.[a-zA-Z]{2,}))(?:\/.*)?$/i);
        const urlMatch = cleanComment.match(/(https?:\/\/[^\s]+)/i);

        if (urlMatch) {
            statsMethod.innerHTML = '';
            const textBefore = cleanComment.slice(0, urlMatch.index);
            const url = urlMatch[0];
            const textAfter = cleanComment.slice(urlMatch.index + url.length);

            if (textBefore) statsMethod.appendChild(document.createTextNode(textBefore));
            const a = document.createElement('a');
            a.href = url;
            a.target = '_blank';
            a.rel = 'noopener';
            a.className = 'stats-method-link';
            a.textContent = url;
            statsMethod.appendChild(a);
            if (textAfter) statsMethod.appendChild(document.createTextNode(textAfter));
        } else if (domainOnlyMatch) {
            const domain = domainOnlyMatch[1];
            statsMethod.innerHTML = '';
            const a = document.createElement('a');
            a.href = cleanComment.startsWith('http') ? cleanComment : ('https://' + cleanComment);
            a.target = '_blank';
            a.rel = 'noopener';
            a.className = 'stats-method-link';
            a.textContent = domain;
            statsMethod.appendChild(a);
        } else {
            statsMethod.textContent = cleanComment;
        }

        if (container) {
            setTimeout(() => {
                const scrollW = statsMethod.scrollWidth;
                const clientW = container.clientWidth;
                const diff = scrollW - clientW;
                if (diff > 4) {
                    container.classList.add('is-overflowing');
                    const distance = diff + 16;
                    statsMethod.style.setProperty('--marquee-distance', `-${distance}px`);
                    const duration = Math.max(5, Math.min(14, Math.round(distance / 22) + 3));
                    statsMethod.style.animationDuration = `${duration}s`;
                    statsMethod.classList.add('is-marquee');
                }
            }, 60);
        }
    }

    async function analyseVideoMetadataFromUrl(videoUrl) {
        if (!videoUrl || !videoUrl.startsWith('http')) return null;
        try {
            const response = await fetch(`${API_URL}/tiktok-fps?url=${encodeURIComponent(videoUrl)}`);
            if (!response.ok) return null;
            return await response.json();
        } catch (e) {
            return null;
        }
    }

    function updateCacheBadge(show) {
        const titleEl = document.querySelector('#tool-modal-hero-slot .tool-title');
        if (titleEl) {
            let badge = titleEl.querySelector('.stats-cache-badge');
            if (show) {
                if (!badge) {
                    badge = document.createElement('span');
                    badge.className = 'stats-cache-badge';
                    badge.textContent = 'Cache';
                    badge.title = 'Served from 24h Edge Cache';
                    titleEl.appendChild(badge);
                } else {
                    badge.style.display = 'inline-flex';
                }
            } else if (badge) {
                badge.style.display = 'none';
            }
        }
    }

    async function analyseTikTokVideo(pageUrl) {
        if (isRunning) return;
        isRunning = true;

        hideErrorCard();
        hideStreamProgress();
        updateCacheBadge(false);
        setButtonState('processing', t('status_processing') || 'Fetching details...');

        setInitialSkeletons();
        const resultsContainer = document.getElementById('tiktok-stats-results');
        if (resultsContainer) {
            resultsContainer.classList.remove('hidden');
            if (typeof window.updateOpenModalsLayout === 'function') {
                window.updateOpenModalsLayout(true);
            }
        }

        try {
            let isFromCache = false;
            let metadata = cacheMap.get(pageUrl);
            if (metadata) {
                isFromCache = true;
            } else {
                const response = await fetch(`${API_URL}/tiktok-resolve?url=${encodeURIComponent(pageUrl)}`);
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(errorData.error || errorData.details || `Unable to resolve TikTok video URL (${response.status}).`);
                }
                const cacheHeader = response.headers.get('CF-Cache-Status') || response.headers.get('X-Edge-Cache');
                if (cacheHeader && cacheHeader.toUpperCase() === 'HIT') {
                    isFromCache = true;
                }
                metadata = await response.json();
                if (metadata && (metadata.play || metadata.hdplay)) {
                    cacheMap.set(pageUrl, metadata);
                }
            }

            const streamUrl = metadata ? (metadata.play || metadata.hdplay) : null;
            if (!metadata || !streamUrl) {
                throw new Error("Could not extract stream URL for this video.");
            }

            updateCacheBadge(isFromCache);

            lastAnalysedUrl = pageUrl;
            lastAnalysedTime = Date.now();
            lastMetadata = metadata;

            const statsCover = document.getElementById('stats-video-cover');
            const statsCreatorName = document.getElementById('stats-creator-name');
            const statsCreatorHandle = document.getElementById('stats-creator-handle');
            const statsCaption = document.getElementById('stats-caption');

            if (statsCover) statsCover.src = metadata.cover || '';
            if (statsCreatorName) statsCreatorName.textContent = metadata.author_nickname || 'Creator';
            if (statsCreatorHandle) statsCreatorHandle.textContent = metadata.author_unique_id ? `@${metadata.author_unique_id}` : '@username';
            if (statsCaption) statsCaption.textContent = metadata.title || '—';

            renderDynamicFields();

            const duration = metadata.duration || 0;
            const size = metadata.size || 0;

            const statsDuration = document.getElementById('stats-duration');
            const statsSize = document.getElementById('stats-size');
            if (statsDuration) statsDuration.textContent = duration ? `${duration}s` : '—';
            if (statsSize) statsSize.textContent = size ? `${(size / (1024 * 1024)).toFixed(2)} MB` : '—';

            const playCount = metadata.play_count || 0;
            const diggCount = metadata.digg_count || 0;
            const commentCount = metadata.comment_count || 0;
            const shareCount = metadata.share_count || 0;
            const collectCount = metadata.collect_count || 0;

            const statsViews = document.getElementById('stats-views');
            const statsLikes = document.getElementById('stats-likes');
            const statsComments = document.getElementById('stats-comments');
            const statsShares = document.getElementById('stats-shares');
            const statsSaves = document.getElementById('stats-saves');
            const statsEngagement = document.getElementById('stats-engagement');

            if (statsViews) statsViews.textContent = formatNumber(playCount);
            if (statsLikes) statsLikes.textContent = formatNumber(diggCount);
            if (statsComments) statsComments.textContent = formatNumber(commentCount);
            if (statsShares) statsShares.textContent = formatNumber(shareCount);
            if (statsSaves) statsSaves.textContent = formatNumber(collectCount);

            if (statsEngagement) {
                if (playCount > 0) {
                    const totalEngage = diggCount + commentCount + shareCount + collectCount;
                    const engRate = ((totalEngage / playCount) * 100).toFixed(2);
                    statsEngagement.textContent = `${engRate}%`;
                } else {
                    statsEngagement.textContent = '—';
                }
            }

            startStreamProgress();
            let videoMeta = await analyseVideoMetadataFromUrl(streamUrl);
            if ((!videoMeta || (!videoMeta.fps && !videoMeta.width)) && metadata && metadata.id) {
                const proxyStreamUrl = `https://www.tikwm.com/video/media/play/${metadata.id}.mp4`;
                if (proxyStreamUrl !== streamUrl) {
                    const fallbackMeta = await analyseVideoMetadataFromUrl(proxyStreamUrl);
                    if (fallbackMeta && (fallbackMeta.fps || fallbackMeta.width)) {
                        videoMeta = fallbackMeta;
                    }
                }
            }
            completeStreamProgress();

            const finalSize = metadata.size || (videoMeta && videoMeta.size) || 0;
            const finalDuration = metadata.duration || (videoMeta && videoMeta.duration) || 0;

            if (statsSize && finalSize) {
                statsSize.textContent = `${(finalSize / (1024 * 1024)).toFixed(2)} MB`;
            }

            const statsFps = document.getElementById('stats-fps');
            const statsResolution = document.getElementById('stats-resolution');
            const statsBitrate = document.getElementById('stats-bitrate');

            if (statsFps) {
                if (videoMeta && videoMeta.fps && !isNaN(videoMeta.fps)) {
                    statsFps.textContent = `${videoMeta.fps} fps`;
                } else {
                    statsFps.textContent = '—';
                }
            }

            if (statsResolution) {
                if (videoMeta && videoMeta.width && videoMeta.height) {
                    statsResolution.textContent = `${videoMeta.width} x ${videoMeta.height}`;
                } else if (metadata.w && metadata.h) {
                    statsResolution.textContent = `${metadata.w} x ${metadata.h}`;
                } else {
                    statsResolution.textContent = '—';
                }
            }

            if (statsBitrate) {
                if (finalSize && finalDuration) {
                    const bitrateKbps = (finalSize * 8) / (finalDuration * 1000);
                    if (bitrateKbps >= 1000) {
                        statsBitrate.textContent = `${(bitrateKbps / 1000).toFixed(2)} Mbps`;
                    } else {
                        statsBitrate.textContent = `${Math.round(bitrateKbps)} kbps`;
                    }
                } else {
                    statsBitrate.textContent = '—';
                }
            }

            displayMethod(videoMeta && videoMeta.comment ? videoMeta.comment.trim() : '');
            setButtonState('ready', t('tool_stats_btn') || 'Analyse');

        } catch (err) {
            console.error(err);
            if (resultsContainer) {
                resultsContainer.classList.add('hidden');
            }
            hideStreamProgress();
            let failMsg = err.message || '';
            if (!failMsg || failMsg.includes('Unable to resolve') || failMsg.includes('unavailable') || failMsg.includes('not found') || failMsg.includes('Could not extract') || failMsg.includes('Failed to fetch')) {
                failMsg = t('stats_err_not_found') || 'Video mungkin telah dihapus, bersifat privat, atau tautan tidak valid.';
            }
            showErrorCard(failMsg);
            setButtonState('error', t('stats_err_failed') || 'Analisis gagal.');
            if (typeof window.showToast === 'function') {
                window.showToast(failMsg);
            }
        } finally {
            isRunning = false;
        }
    }

    const toolDefinition = {
        id: 'tool-tiktok-stats',
        _id: 'tool-tiktok-stats',
        version: 'v1.1.5',
        title: 'TikTok Statistics',
        desc: 'Metadata & Stream Analyser',
        icon: 'query_stats',
        category: ['TikTok', 'Analytics', 'Tools'],
        inputType: 'url',
        hideDropZone: true,
        hideProgress: true,

        initModal: function(ctx) {
            const { optContainer, processBtn, processLabel } = ctx;
            if (!optContainer) return;

            updateCacheBadge(false);

            if (processLabel) processLabel.textContent = t('tool_stats_btn') || 'Analyse';

            optContainer.innerHTML = `
                <div id="stats-error-display" class="stats-error-card hidden">
                    <div class="stats-error-icon-wrapper">
                        <span class="material-symbols-rounded">error_outline</span>
                    </div>
                    <div class="stats-error-content">
                        <div class="stats-error-title" id="stats-error-title">${t('stats_err_title')}</div>
                        <div class="stats-error-message" id="stats-error-message">${t('stats_err_not_found')}</div>
                    </div>
                </div>

                <div id="tiktok-stats-results" class="stats-results-container hidden">
                    <div class="stats-preview-container">
                        <div class="stats-video-cover-wrapper">
                            <img id="stats-video-cover" src="" alt="Cover" class="stats-video-cover">
                        </div>
                        <div class="stats-preview-info">
                            <div id="stats-creator-name" class="stats-creator-name">Creator</div>
                            <div id="stats-creator-handle" class="stats-creator-handle">@username</div>
                            <div id="stats-caption" class="stats-caption">Caption goes here...</div>
                        </div>
                    </div>

                    <div class="stats-details-card">
                        <div class="stats-detail-row">
                            <span class="stats-detail-label"><span class="material-symbols-rounded">calendar_month</span><span>${t('stats_upload_date')}</span></span>
                            <strong id="stats-upload-date">—</strong>
                        </div>
                        <div class="stats-detail-row">
                            <span class="stats-detail-label"><span class="material-symbols-rounded">public</span><span>${t('stats_region')}</span></span>
                            <strong id="stats-region">—</strong>
                        </div>
                        <div class="stats-detail-row">
                            <span class="stats-detail-label"><span class="material-symbols-rounded">security</span><span>${t('stats_shadowban')}</span></span>
                            <div id="stats-shadowban">—</div>
                        </div>

                        <hr class="stats-section-divider">

                        <div id="stats-stream-progress-card" class="stats-stream-progress-card hidden">
                            <div class="stats-stream-progress-info">
                                <span class="stats-stream-progress-label">
                                    <span class="material-symbols-rounded">downloading</span>
                                    <span id="stats-stream-progress-text">${t('stats_downloading_stream')}</span>
                                </span>
                                <span id="stats-stream-progress-pct" class="stats-stream-progress-pct">0%</span>
                            </div>
                            <div class="stats-stream-progress-track">
                                <div id="stats-progress-fill" class="stats-stream-progress-fill" style="width: 0%;"></div>
                            </div>
                        </div>

                        <div class="stats-detail-row">
                            <span class="stats-detail-label"><span class="material-symbols-rounded">aspect_ratio</span><span>${t('stats_resolution')}</span></span>
                            <strong id="stats-resolution">—</strong>
                        </div>
                        <div class="stats-detail-row">
                            <span class="stats-detail-label"><span class="material-symbols-rounded">speed</span><span>${t('stats_fps')}</span></span>
                            <strong id="stats-fps">—</strong>
                        </div>
                        <div class="stats-detail-row">
                            <span class="stats-detail-label"><span class="material-symbols-rounded">equalizer</span><span>${t('stats_bitrate')}</span></span>
                            <strong id="stats-bitrate">—</strong>
                        </div>
                        <div class="stats-detail-row">
                            <span class="stats-detail-label"><span class="material-symbols-rounded">schedule</span><span>${t('stats_duration')}</span></span>
                            <strong id="stats-duration">—</strong>
                        </div>
                        <div class="stats-detail-row">
                            <span class="stats-detail-label"><span class="material-symbols-rounded">save</span><span>${t('stats_size')}</span></span>
                            <strong id="stats-size">—</strong>
                        </div>
                        <div class="stats-detail-row stats-method-row">
                            <span class="stats-detail-label"><span class="material-symbols-rounded">build</span><span>${t('stats_method')}</span></span>
                            <div class="stats-method-marquee-container" id="stats-method-marquee-container">
                                <strong id="stats-method" class="stats-method-text">—</strong>
                            </div>
                        </div>

                        <hr class="stats-section-divider">

                        <div class="stats-detail-row">
                            <span class="stats-detail-label"><span class="material-symbols-rounded">visibility</span><span>${t('stats_views')}</span></span>
                            <strong id="stats-views">—</strong>
                        </div>
                        <div class="stats-detail-row">
                            <span class="stats-detail-label"><span class="material-symbols-rounded">favorite</span><span>${t('stats_likes')}</span></span>
                            <strong id="stats-likes">—</strong>
                        </div>
                        <div class="stats-detail-row">
                            <span class="stats-detail-label"><span class="material-symbols-rounded">chat_bubble</span><span>${t('stats_comments')}</span></span>
                            <strong id="stats-comments">—</strong>
                        </div>
                        <div class="stats-detail-row">
                            <span class="stats-detail-label"><span class="material-symbols-rounded">share</span><span>${t('stats_shares')}</span></span>
                            <strong id="stats-shares">—</strong>
                        </div>
                        <div class="stats-detail-row">
                            <span class="stats-detail-label"><span class="material-symbols-rounded">bookmark</span><span>${t('stats_saves')}</span></span>
                            <strong id="stats-saves">—</strong>
                        </div>
                        <div class="stats-detail-row">
                            <span class="stats-detail-label"><span class="material-symbols-rounded">trending_up</span><span>${t('stats_engagement')}</span></span>
                            <strong id="stats-engagement">—</strong>
                        </div>
                    </div>
                </div>

                <div class="tool-input-group">
                    <label class="tool-input-label" for="tool-tiktok-stats-input">${t('tool_stats_url')}</label>
                    <div class="tool-input-wrapper">
                        <span class="material-symbols-rounded tool-input-icon">link</span>
                        <input type="text" id="tool-tiktok-stats-input" class="tool-input-text" placeholder="https://www.tiktok.com/... or https://tt.site/..." autocomplete="off">
                        <button type="button" class="tool-input-clear-btn hidden" id="tool-tiktok-stats-clear" title="Clear">
                            <span class="material-symbols-rounded">close</span>
                        </button>
                    </div>
                </div>
            `;

            const inputUrl = document.getElementById('tool-tiktok-stats-input');
            const clearBtn = document.getElementById('tool-tiktok-stats-clear');

            if (inputUrl && clearBtn) {
                inputUrl.addEventListener('input', () => {
                    if (inputUrl.value.trim().length > 0) {
                        clearBtn.classList.remove('hidden');
                    } else {
                        clearBtn.classList.add('hidden');
                    }
                });

                clearBtn.addEventListener('click', () => {
                    inputUrl.value = '';
                    clearBtn.classList.add('hidden');
                    hideErrorCard();
                    updateCacheBadge(false);
                    inputUrl.focus();
                });

                inputUrl.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        if (processBtn) processBtn.click();
                    }
                });
            }
        },

        onProcess: function() {
            const inputUrl = document.getElementById('tool-tiktok-stats-input');
            if (!inputUrl) return;

            let rawInput = inputUrl.value.trim();
            if (!rawInput) {
                hideErrorCard();
                showStatus(t('stats_err_enter_url') || 'Please enter a valid TikTok video URL.', "var(--md-sys-color-error)");
                return;
            }

            if (!isTikTokUrl(rawInput)) {
                hideErrorCard();
                showStatus(t('stats_err_invalid_url') || 'URL is not a valid TikTok link.', "var(--md-sys-color-error)");
                return;
            }

            let url = rawInput;
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                url = 'https://' + url;
            }

            const now = Date.now();
            if (url === lastAnalysedUrl && (now - lastAnalysedTime) < 2500 && cacheMap.has(url)) {
                return;
            }

            analyseTikTokVideo(url);
        }
    };

    if (window.AppTools && typeof window.AppTools.register === 'function') {
        window.AppTools.register(toolDefinition);
    } else {
        window._pendingTools = window._pendingTools || [];
        window._pendingTools.push(toolDefinition);
    }
})();
