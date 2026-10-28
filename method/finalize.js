(function() {
    'use strict';

    /**
     * ╔═══════════════════════════════════════════════════════════════╗
     * ║                  CMT - CUTEFISH MEDIA TOOLS                   ║
     * ║                   Universal Finalize Module                   ║
     * ║                                                               ║
     * ║  Single source of truth for post-patch finalizing, downloading║
     * ║  naming standardization (*_hd.mp4), and UI completion hooks.  ║
     * ║  Designed for cutefish.my.id & Editorstuff CMT toolchain.     ║
     * ╚═══════════════════════════════════════════════════════════════╝
     *
     * @param {File} file - Original video File object
     * @param {Uint8Array} finalBytes - Processed media buffer bytes
     * @param {string|Object} [optionsOrSuffix='hd'] - Suffix string or config object { suffix, ext, mimeType }
     * @returns {{ url: string, filename: string, blob: Blob }}
     */
    /**
     * In-memory MP4 Container HDR Patch
     * Injects or updates the 19-byte colr (nclx) atom to declare ITU-R BT.2020 / ARIB STD-B67 (HLG)
     * color primaries and transfer characteristics without lossy re-encoding.
     *
     * @param {Uint8Array} data
     * @returns {Uint8Array}
     */
    function applyHdrColrPatch(data) {
        // HDR container injection is deprecated and removed
        return data;
    }

    function finalizePatcherDownload(file, finalBytes, optionsOrSuffix) {
        let suffix = 'hd';
        let ext = 'mp4';
        let mimeType = 'video/mp4';

        if (typeof optionsOrSuffix === 'string' && optionsOrSuffix.trim()) {
            suffix = optionsOrSuffix.trim();
        } else if (typeof optionsOrSuffix === 'object' && optionsOrSuffix !== null) {
            if (optionsOrSuffix.suffix) suffix = optionsOrSuffix.suffix;
            if (optionsOrSuffix.ext) ext = optionsOrSuffix.ext;
            if (optionsOrSuffix.mimeType) mimeType = optionsOrSuffix.mimeType;
        }

        if (!suffix) {
            suffix = 'hd';
        }

        const s = window._tktk || {};

        const rawName = (file && file.name) ? file.name.replace(/\.[^.]+$/, '') : 'video';
        const filename = `${rawName}_${suffix}.${ext}`;

        const blob = new Blob([finalBytes], { type: mimeType });
        const url = URL.createObjectURL(blob);

        window._lastFinalizedPatcherResult = { url, filename, blob };

        // Auto trigger download if not in headless context
        const isHeadless = !!(window._tktk && window._tktk.activeContext);
        if (!isHeadless) {
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }

        // Update modal download button
        const dlBtn = document.getElementById('tool-download-btn');
        if (dlBtn) {
            dlBtn.classList.remove('hidden');
            dlBtn.onclick = () => {
                const da = document.createElement('a');
                da.href = url;
                da.download = filename;
                document.body.appendChild(da);
                da.click();
                document.body.removeChild(da);
            };
        }

        const getT = (key, fallback) => {
            if (typeof window.getTranslation === 'function') {
                return window.getTranslation(key) || fallback;
            }
            return fallback;
        };

        if (s.log && typeof s.log === 'function') {
            s.log(`  Process Completed Successfully! Output: ${filename}`);
            if (typeof s.logEnd === 'function') s.logEnd();
        }

        if (s.statusText) {
            s.statusText.innerHTML = `<span style="color: #4caf50; font-weight: bold;">&#10003; ${getT('status_completed', 'Selesai')}</span>`;
        }
        if (s.progressFill) s.progressFill.style.width = '100%';
        if (s.progressPercent) s.progressPercent.textContent = '100%';
        if (s.progressText) s.progressText.textContent = getT('status_completed', 'Selesai');

        if (window.ToolProgressManager) {
            window.ToolProgressManager.set('tool-tiktok-patcher', {
                isProcessing: false,
                completed: true,
                percent: 100,
                status: getT('status_completed', 'Selesai'),
                file
            });
        }

        const processBtn = document.getElementById('tool-process-btn');
        const processLabel = document.getElementById('tool-process-label');
        const processIcon = document.getElementById('tool-process-icon');
        if (processBtn) {
            processBtn.disabled = false;
            processBtn.dataset.state = 'completed';
            if (processLabel) processLabel.textContent = getT('status_process_another', 'Process Another');
            if (processIcon) processIcon.textContent = 'restart_alt';
        }

        s.isProcessing = false;

        if (typeof window.showToast === 'function') {
            window.showToast(getT('status_completed_toast', 'Pemrosesan video berhasil diselesaikan!'));
        }

        if (typeof s.showTikTokStudioUploadPrompt === 'function') {
            s.showTikTokStudioUploadPrompt();
        }

        return { url, filename, blob };
    }

    // Universal Self-Registering TikTok Method Registry
    const existingItems = (window.TikTokMethods && Array.isArray(window.TikTokMethods._items))
        ? window.TikTokMethods._items
        : [];

    const CATEGORY_META = {
        recommended: {
            id: 'recommended',
            labelKey: 'patcher_cat_recommended',
            defaultLabel: 'Rekomendasi',
            icon: 'verified',
            order: 1
        },
        backup: {
            id: 'backup',
            labelKey: 'patcher_cat_backup',
            defaultLabel: 'Cadangan',
            icon: 'history',
            order: 2
        }
    };

    window.TikTokMethods = {
        _items: [],
        _categories: CATEGORY_META,
        register(methodDef) {
            if (!methodDef || !methodDef.id) return;
            const normalized = Object.assign({
                category: 'recommended',
                order: 99,
                supportsCompress: true,
                remuxFaststart: false,
                requiresUserscript: false,
                handlesOwn60FpsSlowmo: false,
                outputOptions: 'hd',
                aliases: [],
                descriptions: { id: {}, en: {} }
            }, methodDef);
            const idx = this._items.findIndex(m => m.id === normalized.id);
            if (idx >= 0) {
                this._items[idx] = normalized;
            } else {
                this._items.push(normalized);
            }
            this._items.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
        },
        getAll() {
            return this._items.slice();
        },
        getByCategory(category) {
            return this._items.filter(m => (m.category || 'recommended') === category);
        },
        getCategories() {
            const catKeys = [];
            for (const m of this._items) {
                const c = m.category || 'recommended';
                if (!catKeys.includes(c)) catKeys.push(c);
            }
            if (catKeys.length === 0) return [CATEGORY_META.recommended, CATEGORY_META.backup];
            return catKeys
                .map(k => CATEGORY_META[k] || { id: k, labelKey: `patcher_cat_${k}`, defaultLabel: k.toUpperCase(), icon: 'tune', order: 99 })
                .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
        },
        getById(id) {
            if (!id) return this._items[0] || null;
            const lower = String(id).toLowerCase();
            return this._items.find(m =>
                m.id.toLowerCase() === lower ||
                (Array.isArray(m.aliases) && m.aliases.some(a => String(a).toLowerCase() === lower))
            ) || null;
        },
        getDefault(category) {
            if (category) {
                const list = this.getByCategory(category);
                if (list.length > 0) return list[0];
            }
            const rec = this.getByCategory('recommended');
            if (rec.length > 0) return rec[0];
            return this._items[0] || null;
        }
    };

    if (existingItems.length > 0) {
        existingItems.forEach(m => window.TikTokMethods.register(m));
    }

    // CMT & Global exports
    window.finalizePatcherDownload = finalizePatcherDownload;
    window.finalizeCMT = finalizePatcherDownload;
    window.applyHdrColrPatch = applyHdrColrPatch;
    if (window._tktk) {
        window._tktk.finalizePatcherDownload = finalizePatcherDownload;
        window._tktk.applyHdrColrPatch = applyHdrColrPatch;
    }

})();
