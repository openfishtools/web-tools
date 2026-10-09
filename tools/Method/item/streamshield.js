/* =========================================================================
 * Cutefish StreamShield MP4 Architecture Engine
 * 
 * 100% Lossless TikTok Quality Bypass:
 * - V1 64-bit Infinite Duration Sentinel (mvhd timescale 1000, duration 0xFFFFFFFFFFFFFFFF)
 * - Micro-Shield Stream Trap on Track 3 (single 8-byte dummy sample placed right after mdat)
 * - Trailing 8-byte 'free' atom for strict ISO BMFF compliance
 * - Pure binary atom manipulation: 0% compression, 0% quality loss, 0.1s execution
 * ========================================================================= */

(function () {
'use strict';

function _ss_readU32(arr, off) {
    return ((arr[off] << 24) | (arr[off + 1] << 16) | (arr[off + 2] << 8) | arr[off + 3]) >>> 0;
}

function _ss_writeU32(arr, off, val) {
    arr[off]     = (val >>> 24) & 0xff;
    arr[off + 1] = (val >>> 16) & 0xff;
    arr[off + 2] = (val >>> 8)  & 0xff;
    arr[off + 3] = val & 0xff;
}

function _ss_makeBox(type, payload) {
    const size = 8 + payload.byteLength;
    const box = new Uint8Array(size);
    _ss_writeU32(box, 0, size);
    for (let i = 0; i < 4; i++) box[4 + i] = type.charCodeAt(i);
    box.set(payload, 8);
    return box;
}

function _ss_parseBoxes(buf, start, end) {
    const boxes = [];
    let off = start;
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    while (off + 8 <= end) {
        let size = dv.getUint32(off, false);
        const type = String.fromCharCode(buf[off + 4], buf[off + 5], buf[off + 6], buf[off + 7]);
        let headerSize = 8;
        if (size === 1) {
            if (off + 16 > end) break;
            const high = dv.getUint32(off + 8, false);
            const low  = dv.getUint32(off + 12, false);
            size = high * 4294967296 + low;
            headerSize = 16;
        } else if (size === 0) {
            size = end - off;
        }
        if (size < headerSize || off + size > end) break;
        boxes.push({
            type,
            offset: off,
            size,
            headerSize,
            contentStart: off + headerSize,
            end: off + size
        });
        off += size;
    }
    return boxes;
}

function _ss_findDeep(buf, startOffset, endOffset, targetType) {
    const boxes = _ss_parseBoxes(buf, startOffset, endOffset);
    for (const b of boxes) {
        if (b.type === targetType) return b;
        if (['trak', 'mdia', 'minf', 'stbl'].includes(b.type)) {
            const sub = _ss_findDeep(buf, b.contentStart, b.end, targetType);
            if (sub) return sub;
        }
    }
    return null;
}

/**
 * Pure In-Memory Cutefish StreamShield Patch
 * @param {ArrayBuffer|Uint8Array} inputBuffer
 * @param {Function} logFn
 * @returns {Uint8Array}
 */
function _ss_patchMp4StreamShield(inputBuffer, logFn) {
    const log = logFn || (() => {});
    const buf = inputBuffer instanceof Uint8Array ? inputBuffer : new Uint8Array(inputBuffer);
    const topBoxes = _ss_parseBoxes(buf, 0, buf.length);

    const ftyp = topBoxes.find(b => b.type === 'ftyp');
    const moov = topBoxes.find(b => b.type === 'moov');
    const mdat = topBoxes.find(b => b.type === 'mdat');

    if (!ftyp || !moov || !mdat) {
        throw new Error('Format MP4 tidak standar (ftyp, moov, atau mdat tidak ditemukan).');
    }

    const ftypBytes = buf.subarray(ftyp.offset, ftyp.end);
    const origMdatPayload = buf.subarray(mdat.contentStart, mdat.end);
    const origMdatContentStart = mdat.contentStart;

    const moovChildren = _ss_parseBoxes(buf, moov.contentStart, moov.end);
    const mvhd = moovChildren.find(b => b.type === 'mvhd');
    const traks = moovChildren.filter(b => b.type === 'trak');

    if (!mvhd || traks.length === 0) {
        throw new Error('Struktur atom moov tidak valid.');
    }

    // 1. mvhd Version 1 (64-bit) Infinite Duration
    const newMvhdPayload = new Uint8Array(112);
    const mvhdDv = new DataView(newMvhdPayload.buffer);
    newMvhdPayload[0] = 1; // Version 1
    mvhdDv.setUint32(20, 1000, false); // timescale 1000
    mvhdDv.setBigUint64(24, 0xFFFFFFFFFFFFFFFFn, false); // duration infinite
    mvhdDv.setUint32(32, 0x00010000, false); // rate 1.0
    mvhdDv.setUint16(36, 0x0100, false); // volume 1.0
    mvhdDv.setUint32(48, 0x00010000, false); // matrix
    mvhdDv.setUint32(64, 0x00010000, false);
    mvhdDv.setUint32(80, 0x40000000, false);
    mvhdDv.setUint32(108, 4, false); // next_track_id = 4
    const newMvhdBox = _ss_makeBox('mvhd', newMvhdPayload);

    // 2. Video & Audio Tracks
    const videoTrak = traks[0];
    const audioTrak = traks.length > 1 ? traks[1] : null;

    const vStcoBox = _ss_findDeep(buf, videoTrak.contentStart, videoTrak.end, 'stco') || _ss_findDeep(buf, videoTrak.contentStart, videoTrak.end, 'co64');
    const aStcoBox = audioTrak ? (_ss_findDeep(buf, audioTrak.contentStart, audioTrak.end, 'stco') || _ss_findDeep(buf, audioTrak.contentStart, audioTrak.end, 'co64')) : null;

    if (!vStcoBox) throw new Error('Atom video stco tidak ditemukan.');

    const vChunkCount = _ss_readU32(buf, vStcoBox.contentStart + 4);
    const vRelOffsets = [];
    for (let i = 0; i < vChunkCount; i++) {
        const off = _ss_readU32(buf, vStcoBox.contentStart + 8 + i * 4);
        vRelOffsets.push(off - origMdatContentStart);
    }

    let aRelOffsets = [];
    if (aStcoBox) {
        const aChunkCount = _ss_readU32(buf, aStcoBox.contentStart + 4);
        for (let i = 0; i < aChunkCount; i++) {
            const off = _ss_readU32(buf, aStcoBox.contentStart + 8 + i * 4);
            aRelOffsets.push(off - origMdatContentStart);
        }
    }

    // 3. Micro-Shield Track 3 Payload (8 bytes dummy sample + 8 bytes free box)
    const trapPayload = new Uint8Array([
        0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x08, 0x66, 0x72, 0x65, 0x65
    ]);

    const t3TkhdPayload = new Uint8Array(84);
    const t3TkhdDv = new DataView(t3TkhdPayload.buffer);
    t3TkhdDv.setUint32(0, 0x00000007, false);
    t3TkhdDv.setUint32(12, 3, false); // Track ID 3
    t3TkhdDv.setUint32(20, 1000, false);
    t3TkhdDv.setUint16(36, 0x0100, false);
    t3TkhdDv.setUint32(40, 0x00010000, false);
    t3TkhdDv.setUint32(56, 0x00010000, false);
    t3TkhdDv.setUint32(72, 0x40000000, false);
    const t3Tkhd = _ss_makeBox('tkhd', t3TkhdPayload);

    const t3MdhdPayload = new Uint8Array(24);
    const t3MdhdDv = new DataView(t3MdhdPayload.buffer);
    t3MdhdDv.setUint32(12, 48000, false);
    t3MdhdDv.setUint32(16, 48000, false);
    const t3Mdhd = _ss_makeBox('mdhd', t3MdhdPayload);

    const t3HdlrPayload = new Uint8Array(25);
    t3HdlrPayload.set([0x73, 0x6f, 0x75, 0x6e], 8); // 'soun'
    const nameStr = 'StreamShield';
    for (let i = 0; i < nameStr.length; i++) t3HdlrPayload[24 + i] = nameStr.charCodeAt(i);
    const t3Hdlr = _ss_makeBox('hdlr', t3HdlrPayload);

    let t3Stsd = null;
    const aStsdBox = audioTrak ? _ss_findDeep(buf, audioTrak.contentStart, audioTrak.end, 'stsd') : null;
    if (aStsdBox) {
        t3Stsd = buf.subarray(aStsdBox.offset, aStsdBox.end);
    } else {
        const dummyStsd = new Uint8Array(28);
        const dDv = new DataView(dummyStsd.buffer);
        dDv.setUint32(4, 1, false);
        dDv.setUint32(8, 20, false);
        dummyStsd.set([0x6d, 0x70, 0x34, 0x61], 12); // 'mp4a'
        t3Stsd = _ss_makeBox('stsd', dummyStsd);
    }

    const t3SttsPayload = new Uint8Array(16);
    const t3SttsDv = new DataView(t3SttsPayload.buffer);
    t3SttsDv.setUint32(4, 1, false);
    t3SttsDv.setUint32(8, 1, false);
    t3SttsDv.setUint32(12, 1024, false);
    const t3Stts = _ss_makeBox('stts', t3SttsPayload);

    const t3StszPayload = new Uint8Array(12);
    const t3StszDv = new DataView(t3StszPayload.buffer);
    t3StszDv.setUint32(4, 8, false);
    t3StszDv.setUint32(8, 1, false);
    const t3Stsz = _ss_makeBox('stsz', t3StszPayload);

    const t3StscPayload = new Uint8Array(20);
    const t3StscDv = new DataView(t3StscPayload.buffer);
    t3StscDv.setUint32(4, 1, false);
    t3StscDv.setUint32(8, 1, false);
    t3StscDv.setUint32(12, 1, false);
    t3StscDv.setUint32(16, 1, false);
    const t3Stsc = _ss_makeBox('stsc', t3StscPayload);

    const t3Smhd = _ss_makeBox('smhd', new Uint8Array(8));
    const drefEntry = new Uint8Array([0x00, 0x00, 0x00, 0x0c, 0x75, 0x72, 0x6c, 0x20, 0x00, 0x00, 0x00, 0x01]);
    const drefPayload = new Uint8Array(8 + drefEntry.length);
    new DataView(drefPayload.buffer).setUint32(4, 1, false);
    drefPayload.set(drefEntry, 8);
    const t3Dref = _ss_makeBox('dref', drefPayload);
    const t3Dinf = _ss_makeBox('dinf', t3Dref);

    function concatArrays(arrs) {
        let total = 0;
        for (const a of arrs) total += (a ? a.byteLength : 0);
        const out = new Uint8Array(total);
        let off = 0;
        for (const a of arrs) {
            if (!a) continue;
            out.set(a, off);
            off += a.byteLength;
        }
        return out;
    }

    const vTrakBytes = buf.subarray(videoTrak.offset, videoTrak.end);
    const aTrakBytes = audioTrak ? buf.subarray(audioTrak.offset, audioTrak.end) : null;

    let moovBytes = null;
    let finalOutput = null;

    for (let iter = 0; iter < 3; iter++) {
        const estMoovLen = moovBytes ? moovBytes.length : (moov.size + 1024);
        const newMdatContentStart = ftypBytes.length + estMoovLen + 8;
        const fakeChunkOffset = newMdatContentStart + origMdatPayload.length;

        const t3StcoPayload = new Uint8Array(12);
        const t3StcoDv = new DataView(t3StcoPayload.buffer);
        t3StcoDv.setUint32(4, 1, false);
        t3StcoDv.setUint32(8, fakeChunkOffset, false);
        const t3Stco = _ss_makeBox('stco', t3StcoPayload);

        const t3Stbl = _ss_makeBox('stbl', concatArrays([t3Stsd, t3Stts, t3Stsz, t3Stsc, t3Stco]));
        const t3Minf = _ss_makeBox('minf', concatArrays([t3Smhd, t3Dinf, t3Stbl]));
        const t3Mdia = _ss_makeBox('mdia', concatArrays([t3Mdhd, t3Hdlr, t3Minf]));
        const t3Trak = _ss_makeBox('trak', concatArrays([t3Tkhd, t3Mdia]));

        const vStcoRel = vStcoBox.offset - videoTrak.offset;
        const vNewTrak = new Uint8Array(vTrakBytes.length);
        vNewTrak.set(vTrakBytes);
        for (let i = 0; i < vChunkCount; i++) {
            _ss_writeU32(vNewTrak, vStcoRel + 16 + i * 4, vRelOffsets[i] + newMdatContentStart);
        }

        let aNewTrak = null;
        if (audioTrak && aTrakBytes) {
            const aStcoRel = aStcoBox.offset - audioTrak.offset;
            aNewTrak = new Uint8Array(aTrakBytes.length);
            aNewTrak.set(aTrakBytes);
            for (let i = 0; i < aRelOffsets.length; i++) {
                _ss_writeU32(aNewTrak, aStcoRel + 16 + i * 4, aRelOffsets[i] + newMdatContentStart);
            }
        }

        const trakList = [vNewTrak];
        if (aNewTrak) trakList.push(aNewTrak);
        trakList.push(t3Trak);

        moovBytes = _ss_makeBox('moov', concatArrays([newMvhdBox, ...trakList]));

        if (iter === 2) {
            const newMdatBox = _ss_makeBox('mdat', origMdatPayload);
            finalOutput = concatArrays([ftypBytes, moovBytes, newMdatBox, trapPayload]);
        }
    }

    log(`StreamShield patch applied (+16 bytes overhead). Total size: ${finalOutput.byteLength} bytes.`);
    return finalOutput;
}

window.patchMp4StreamShield = _ss_patchMp4StreamShield;

/**
 * Main Web Integration for Cutefish StreamShield Method
 */
window.processVideoStreamShield = async function processVideoStreamShield(file, mode) {
    if (mode === undefined) mode = 'off';
    const s = window._tktk;
    if (!s) throw new Error('TikTok tool state (_tktk) is not initialized.');
    s.isProcessing = true;

    const isOff    = mode === 'off';
    const safeName = s.escapeHTML(file.name);

    if (s.btnStart) s.btnStart.disabled = true;
    if (s.progressContainer) s.progressContainer.classList.remove('hidden');
    if (s.logsContainer) s.logsContainer.classList.remove('hidden');
    const dlBtn = document.getElementById('tool-download-btn');
    if (dlBtn) dlBtn.classList.add('hidden');

    s.statusText.innerHTML = `<span style="color: var(--md-sys-color-primary);">${window.getTranslation('status_loading_engine')}</span>`;
    s.progressFill.style.width = '0%';
    s.progressPercent.textContent = '0%';
    s.progressText.textContent = 'Preparing StreamShield...';

    const modeLabel = isOff ? 'Direct Pass-Through (0% Compression Lossless)' : (mode === '720p' ? 'HD 720p Compress + Shield' : 'Full HD 1080p Compress + Shield');
    s.logSection('STREAMSHIELD PROCESSING');
    s.log(`  File   : ${safeName}`);
    s.log(`  Mode   : ${modeLabel}`);
    s.log(`  Engine : Cutefish StreamShield (V1 64-bit Infinite + Micro-Trap)`);
    s.logEnd();

    try {
        let baseBuffer = s.currentFileBuffer;
        if (!baseBuffer) throw new Error('Video buffer is empty.');

        if (isOff) {
            s.logSection('Stream Normalization');
            s.log(`  Standardizing MP4 streams (Faststart Remux)...`);

            const remuxFn = window.remuxFaststart || (s && s.remuxFaststart);
            if (typeof remuxFn === 'function') {
                try {
                    baseBuffer = await remuxFn(file, s.currentFileBuffer);
                    s.log(`  Stream normalization complete.`);
                } catch (remuxErr) {
                    s.log(`  [Notice] Stream remux skipped, using source buffer: ${remuxErr.message}`);
                    baseBuffer = s.currentFileBuffer;
                }
            }
            s.logEnd();

            s.logSection('Applying StreamShield');
            s.log(`  Injecting 64-bit infinite header & micro-shield trap...`);
            const patchedBytes = _ss_patchMp4StreamShield(baseBuffer, s.log);
            s.log(`  StreamShield successfully applied!`);
            s.logEnd();

            const finalizeFn = window.finalizePatcherDownload || (s && s.finalizePatcherDownload);
            if (typeof finalizeFn === 'function') {
                finalizeFn(file, patchedBytes, 'hd');
            } else {
                const blob = new Blob([patchedBytes], { type: 'video/mp4' });
                const url = URL.createObjectURL(blob);
                const filename = `${file.name.replace(/\.[^.]+$/, '')}_hd.mp4`;
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }
            return;
        }

        // If compression mode requested (720p / 1080p)
        const compressFn = window.compressVideo || (s && s.compressVideo);
        if (typeof compressFn !== 'function') {
            throw new Error('Compression module (compress.js) is not loaded.');
        }

        s.logSection('Smart Compression');
        const rawOutput = await compressFn(file, mode, s.currentFileBuffer);
        s.logEnd();

        s.logSection('Applying StreamShield');
        s.log(`  Protecting compressed video stream with StreamShield...`);
        const finalResultBytes = _ss_patchMp4StreamShield(rawOutput, s.log);
        s.logEnd();

        const finalizeFn = window.finalizePatcherDownload || (s && s.finalizePatcherDownload);
        if (typeof finalizeFn === 'function') {
            finalizeFn(file, finalResultBytes, 'hd');
        } else {
            const blob = new Blob([finalResultBytes], { type: 'video/mp4' });
            const url = URL.createObjectURL(blob);
            const filename = `${file.name.replace(/\.[^.]+$/, '')}_hd.mp4`;
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }

    } catch (error) {
        s.log(`  !! Process Error: ${s.escapeHTML(error.message)}`);
        console.error(error);
        s.showStatusError(`Error: ${s.escapeHTML(error.message)}`);
        if (s.btnStart) s.btnStart.disabled = false;
    } finally {
        s.isProcessing = false;
        if (s.btnStart) s.btnStart.disabled = false;
    }
};

// Backwards compatibility alias
window.processVideoTBT = window.processVideoStreamShield;

})();
