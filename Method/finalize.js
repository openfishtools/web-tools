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

    function hasCutefishMetadata(bytes) {
        const target = [99, 117, 116, 101, 102, 105, 115, 104, 46, 109, 121, 46, 105, 100]; // "cutefish.my.id"
        const max = Math.min(bytes.length - target.length, 4 * 1024 * 1024);
        for (let i = 0; i <= max; i++) {
            if (bytes[i] === target[0]) {
                let match = true;
                for (let j = 1; j < target.length; j++) {
                    if (bytes[i + j] !== target[j]) { match = false; break; }
                }
                if (match) return true;
            }
        }
        return false;
    }

    function applyCutefishMetadataPatch(bytes) {
        if (!bytes || bytes.length < 32) return bytes;
        if (hasCutefishMetadata(bytes)) return bytes;

        let moovOffset = -1;
        let moovSize = 0;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

        for (let i = 0; i < bytes.length - 8; i++) {
            if (bytes[i+4] === 0x6D && bytes[i+5] === 0x6F && bytes[i+6] === 0x6F && bytes[i+7] === 0x76) {
                moovOffset = i;
                moovSize = view.getUint32(i, false);
                break;
            }
        }

        if (moovOffset === -1 || moovSize <= 8 || moovOffset + moovSize > bytes.length) {
            return bytes;
        }

        const textCmt = new TextEncoder().encode('cutefish.my.id');

        const cmtData = new Uint8Array(16 + textCmt.length);
        new DataView(cmtData.buffer).setUint32(0, cmtData.length, false);
        cmtData.set([0x64, 0x61, 0x74, 0x61, 0, 0, 0, 1, 0, 0, 0, 0], 4);
        cmtData.set(textCmt, 16);

        const cmtItem = new Uint8Array(8 + cmtData.length);
        new DataView(cmtItem.buffer).setUint32(0, cmtItem.length, false);
        cmtItem.set([0xa9, 0x63, 0x6d, 0x74], 4);
        cmtItem.set(cmtData, 8);

        const ilstSize = 8 + cmtItem.length;
        const ilstBox = new Uint8Array(ilstSize);
        new DataView(ilstBox.buffer).setUint32(0, ilstSize, false);
        ilstBox.set([0x69, 0x6c, 0x73, 0x74], 4);
        ilstBox.set(cmtItem, 8);

        const hdlrBox = new Uint8Array(33);
        new DataView(hdlrBox.buffer).setUint32(0, 33, false);
        hdlrBox.set([0x68, 0x64, 0x6c, 0x72], 4);
        hdlrBox.set([0x6d, 0x64, 0x69, 0x72], 12);

        const metaSize = 12 + hdlrBox.length + ilstBox.length;
        const metaBox = new Uint8Array(metaSize);
        new DataView(metaBox.buffer).setUint32(0, metaSize, false);
        metaBox.set([0x6d, 0x65, 0x74, 0x61], 4);
        metaBox.set(hdlrBox, 12);
        metaBox.set(ilstBox, 12 + hdlrBox.length);

        const udtaSize = 8 + metaBox.length;
        const udtaBox = new Uint8Array(udtaSize);
        new DataView(udtaBox.buffer).setUint32(0, udtaSize, false);
        udtaBox.set([0x75, 0x64, 0x74, 0x61], 4);
        udtaBox.set(metaBox, 8);

        let existingUdtaOffset = -1;
        let existingUdtaSize = 0;
        let p = moovOffset + 8;
        while (p < moovOffset + moovSize - 8) {
            const bSize = view.getUint32(p, false);
            if (bSize < 8 || p + bSize > moovOffset + moovSize) break;
            const bType = String.fromCharCode(bytes[p+4], bytes[p+5], bytes[p+6], bytes[p+7]);
            if (bType === 'udta') {
                existingUdtaOffset = p;
                existingUdtaSize = bSize;
                break;
            }
            p += bSize;
        }

        let newBytes;
        let sizeDiff = 0;

        if (existingUdtaOffset !== -1) {
            sizeDiff = udtaSize - existingUdtaSize;
            newBytes = new Uint8Array(bytes.length + sizeDiff);
            newBytes.set(bytes.subarray(0, existingUdtaOffset), 0);
            newBytes.set(udtaBox, existingUdtaOffset);
            newBytes.set(bytes.subarray(existingUdtaOffset + existingUdtaSize), existingUdtaOffset + udtaSize);
        } else {
            sizeDiff = udtaSize;
            const insertPos = moovOffset + moovSize;
            newBytes = new Uint8Array(bytes.length + sizeDiff);
            newBytes.set(bytes.subarray(0, insertPos), 0);
            newBytes.set(udtaBox, insertPos);
            newBytes.set(bytes.subarray(insertPos), insertPos + sizeDiff);
        }

        const newView = new DataView(newBytes.buffer);
        newView.setUint32(moovOffset, moovSize + sizeDiff, false);

        let mdatOffset = -1;
        for (let i = 0; i < newBytes.length - 8; i++) {
            if (newBytes[i+4] === 0x6D && newBytes[i+5] === 0x64 && newBytes[i+6] === 0x61 && newBytes[i+7] === 0x74) {
                mdatOffset = i;
                break;
            }
        }

        if (sizeDiff !== 0 && moovOffset < mdatOffset) {
            const newMoovEnd = moovOffset + moovSize + sizeDiff;
            for (let i = moovOffset; i < newMoovEnd - 8; i++) {
                if (newBytes[i+4] === 0x73 && newBytes[i+5] === 0x74 && newBytes[i+6] === 0x63 && newBytes[i+7] === 0x6F) {
                    const count = newView.getUint32(i + 12, false);
                    for (let c = 0; c < count; c++) {
                        const oldOff = newView.getUint32(i + 16 + c * 4, false);
                        newView.setUint32(i + 16 + c * 4, oldOff + sizeDiff, false);
                    }
                }
                if (newBytes[i+4] === 0x63 && newBytes[i+5] === 0x6F && newBytes[i+6] === 0x36 && newBytes[i+7] === 0x34) {
                    const count = newView.getUint32(i + 12, false);
                    for (let c = 0; c < count; c++) {
                        const high = newView.getUint32(i + 16 + c * 8, false);
                        const low = newView.getUint32(i + 20 + c * 8, false);
                        let val = BigInt(high) * 4294967296n + BigInt(low) + BigInt(sizeDiff);
                        newView.setUint32(i + 16 + c * 8, Number(val >> 32n), false);
                        newView.setUint32(i + 20 + c * 8, Number(val & 0xffffffffn), false);
                    }
                }
            }
        }

        return newBytes;
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

        // Standardize output filename to (nama file)_hd.mp4 across all methods
        if (suffix === 'shield' || suffix === 'fps' || suffix === 'binary' || suffix === 'fry' || !suffix) {
            suffix = 'hd';
        }

        const s = window._tktk || {};


        // Ensure cutefish.my.id container metadata is present for userscript and analyzer detection
        if (ext === 'mp4' && finalBytes && finalBytes.length > 32) {
            try {
                finalBytes = applyCutefishMetadataPatch(finalBytes);
            } catch (metaErr) {
                console.warn('[Metadata] Error ensuring cutefish.my.id metadata:', metaErr);
            }
        }

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

    // CMT & Global exports
    window.finalizePatcherDownload = finalizePatcherDownload;
    window.finalizeCMT = finalizePatcherDownload;
    window.applyHdrColrPatch = applyHdrColrPatch;
    if (window._tktk) {
        window._tktk.finalizePatcherDownload = finalizePatcherDownload;
        window._tktk.applyHdrColrPatch = applyHdrColrPatch;
    }

})();
