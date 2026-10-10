(function () {
'use strict';

const CONTAINER_BOXES = new Set([
    'moov', 'trak', 'mdia', 'minf', 'stbl',
    'edts', 'dinf', 'udta', 'meta', 'ilst',
]);

function _v3_getBoxType(data, offset) {
    return String.fromCharCode(data[offset], data[offset + 1], data[offset + 2], data[offset + 3]);
}
function _v3_assertUint32(value, label) {
    if (!Number.isFinite(value) || value < 0 || value > 0xffffffff)
        throw new Error(`${label} out of uint32 range: ${value}`);
}
function _v3_readBox(view, data, offset, end, parentPath) {
    if (offset + 8 > end) return null;
    const smallSize = view.getUint32(offset, false);
    const type = _v3_getBoxType(data, offset + 4);
    let size = smallSize;
    let headerSize = 8;
    if (smallSize === 1) {
        if (offset + 16 > end) return null;
        const high = view.getUint32(offset + 8, false);
        const low  = view.getUint32(offset + 12, false);
        size = high * 4294967296 + low;
        headerSize = 16;
    } else if (smallSize === 0) {
        size = end - offset;
    }
    if (size < headerSize || offset + size > end) return null;
    return {
        type, offset, size, headerSize,
        contentStart: offset + headerSize,
        end: offset + size,
        path: parentPath ? `${parentPath}/${type}` : type,
        data, view,
        children: [],
        prefixStart: offset + headerSize,
        prefixEnd:   offset + headerSize,
    };
}
function _v3_childStartForBox(box) {
    return box.type === 'meta' ? box.contentStart + 4 : box.contentStart;
}
function _v3_boxPayload(box) {
    return box.data.subarray(box.contentStart, box.end);
}
function _v3_readU32BE(arr, offset) {
    return ((arr[offset] << 24) | (arr[offset + 1] << 16) | (arr[offset + 2] << 8) | arr[offset + 3]) >>> 0;
}
function _v3_parseBoxes(data, view, start, end, parentPath) {
    const boxes = [];
    let offset = start;
    while (offset + 8 <= end) {
        const box = _v3_readBox(view, data, offset, end, parentPath || '');
        if (!box) break;
        if (CONTAINER_BOXES.has(box.type)) {
            const childStart = _v3_childStartForBox(box);
            if (childStart <= box.end) {
                box.prefixStart = box.contentStart;
                box.prefixEnd   = childStart;
                box.children    = _v3_parseBoxes(data, view, childStart, box.end, box.path);
            }
        }
        boxes.push(box);
        offset = box.end;
    }
    return boxes;
}
function _v3_findChild(box, type) {
    return box ? box.children.find(c => c.type === type) || null : null;
}
function _v3_findDescendant(box, typePath) {
    let cur = box;
    for (const t of typePath) {
        cur = _v3_findChild(cur, t);
        if (!cur) return null;
    }
    return cur;
}
function _v3_findTopLevel(boxes, type) {
    return boxes.find(b => b.type === type) || null;
}
function _v3_handlerTypeForTrak(trak) {
    const hdlr = _v3_findDescendant(trak, ['mdia', 'hdlr']);
    if (!hdlr || hdlr.offset + 20 > hdlr.end) return null;
    return _v3_getBoxType(hdlr.data, hdlr.offset + 16);
}
function _v3_getTimescale(trak) {
    const mdhd = _v3_findDescendant(trak, ['mdia', 'mdhd']);
    if (!mdhd) return 90000;
    const ver = mdhd.data[mdhd.offset + 8];
    return ver === 0
        ? mdhd.view.getUint32(mdhd.offset + 20, false)
        : mdhd.view.getUint32(mdhd.offset + 28, false);
}
function _v3_parseStsz(stsz) {
    const sampleSize = stsz.view.getUint32(stsz.offset + 12, false);
    const count      = stsz.view.getUint32(stsz.offset + 16, false);
    if (sampleSize) return new Array(count).fill(sampleSize);
    const tableStart = stsz.offset + 20;
    if (tableStart + count * 4 > stsz.end)
        throw new Error('stsz too small for declared sample count.');
    const sizes = [];
    for (let i = 0; i < count; i++)
        sizes.push(stsz.view.getUint32(tableStart + i * 4, false));
    return sizes;
}
function _v3_parseStco(stcoBox) {
    const isCo64 = stcoBox.type === 'co64';
    const count = stcoBox.view.getUint32(stcoBox.offset + 12, false);
    const tableStart = stcoBox.offset + 16;
    const itemSize = isCo64 ? 8 : 4;
    if (tableStart + count * itemSize > stcoBox.end)
        throw new Error(`${stcoBox.type} too small for declared chunk count.`);
    const offsets = [];
    for (let i = 0; i < count; i++) {
        if (isCo64) {
            const high = stcoBox.view.getUint32(tableStart + i * 8, false);
            const low  = stcoBox.view.getUint32(tableStart + i * 8 + 4, false);
            offsets.push(high * 4294967296 + low);
        } else {
            offsets.push(stcoBox.view.getUint32(tableStart + i * 4, false));
        }
    }
    return offsets;
}
function _v3_parseStsc(stsc) {
    const count      = stsc.view.getUint32(stsc.offset + 12, false);
    const tableStart = stsc.offset + 16;
    if (tableStart + count * 12 > stsc.end)
        throw new Error('stsc too small for declared entry count.');
    const rows = [];
    for (let i = 0; i < count; i++) {
        const off = tableStart + i * 12;
        rows.push([
            stsc.view.getUint32(off,     false),
            stsc.view.getUint32(off + 4, false),
            stsc.view.getUint32(off + 8, false),
        ]);
    }
    return rows;
}
function _v3_parseStts(stts) {
    const count = stts.view.getUint32(stts.offset + 12, false);
    const tableStart = stts.offset + 16;
    const entries = [];
    for (let i = 0; i < count; i++) {
        const off = tableStart + i * 8;
        entries.push([
            stts.view.getUint32(off, false),
            stts.view.getUint32(off + 4, false)
        ]);
    }
    return entries;
}
function _v3_makeBox(type, payload) {
    const size = 8 + payload.byteLength;
    _v3_assertUint32(size, `${type}.size`);
    const box = new Uint8Array(size);
    const dv  = new DataView(box.buffer);
    dv.setUint32(0, size, false);
    for (let i = 0; i < 4; i++) box[4 + i] = type.charCodeAt(i);
    box.set(new Uint8Array(payload.buffer || payload, payload.byteOffset || 0, payload.byteLength), 8);
    return box;
}
function _v3_concatBytes(parts) {
    let totalLen = 0;
    for (const p of parts) totalLen += (p ? p.byteLength : 0);
    const result = new Uint8Array(totalLen);
    let off = 0;
    for (const p of parts) {
        if (!p) continue;
        result.set(new Uint8Array(p.buffer || p, p.byteOffset || 0, p.byteLength), off);
        off += p.byteLength;
    }
    return result;
}
function _v3_boxBytes(box) {
    return new Uint8Array(box.data.buffer, box.data.byteOffset + box.offset, box.size);
}
function _v3_writeU32BE(arr, offset, value) {
    const dv = new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
    dv.setUint32(offset, value, false);
}
function _v3_buildStco(newOffsets) {
    const payload = new Uint8Array(8 + newOffsets.length * 4);
    _v3_writeU32BE(payload, 4, newOffsets.length);
    let off = 8;
    for (const o of newOffsets) {
        _v3_assertUint32(o, 'stco.chunk_offset');
        _v3_writeU32BE(payload, off, o);
        off += 4;
    }
    return _v3_makeBox('stco', payload);
}
function _v3_buildStsc(rows) {
    const payload = new Uint8Array(8 + rows.length * 12);
    _v3_writeU32BE(payload, 4, rows.length);
    let off = 8;
    for (const [fc, spc, sdi] of rows) {
        _v3_writeU32BE(payload, off, fc);
        _v3_writeU32BE(payload, off + 4, spc);
        _v3_writeU32BE(payload, off + 8, sdi);
        off += 12;
    }
    return _v3_makeBox('stsc', payload);
}
function _v3_buildStsz(sizes) {
    const payload = new Uint8Array(12 + sizes.length * 4);
    _v3_writeU32BE(payload, 8, sizes.length);
    let off = 12;
    for (const sz of sizes) { _v3_writeU32BE(payload, off, sz); off += 4; }
    return _v3_makeBox('stsz', payload);
}
function _v3_buildStts(entries) {
    const payload = new Uint8Array(8 + entries.length * 8);
    _v3_writeU32BE(payload, 4, entries.length);
    let off = 8;
    for (const [count, delta] of entries) {
        _v3_writeU32BE(payload, off, count);
        _v3_writeU32BE(payload, off + 4, delta);
        off += 8;
    }
    return _v3_makeBox('stts', payload);
}
function _v3_rebuildBox(box, replacements) {
    if (replacements.has(box)) return replacements.get(box);
    if (!box.children.length) return _v3_boxBytes(box);
    const prefix = new Uint8Array(box.data.buffer, box.data.byteOffset + box.prefixStart, box.prefixEnd - box.prefixStart);
    const parts  = [prefix];
    for (const child of box.children) {
        const r = _v3_rebuildBox(child, replacements);
        if (r) parts.push(r);
    }
    return _v3_makeBox(box.type, _v3_concatBytes(parts));
}

function _v3_patchMp4FPS(inputData, _logFn) {
    const _log  = _logFn || (() => {});
    const srcArr = inputData instanceof Uint8Array ? inputData : new Uint8Array(inputData);
    const data   = new Uint8Array(srcArr.byteLength);
    data.set(srcArr);
    const view = new DataView(data.buffer);
    _log(`Input buffer size: ${data.byteLength} bytes`);

    const topLevel  = _v3_parseBoxes(data, view, 0, data.length, '');
    const ftyp      = _v3_findTopLevel(topLevel, 'ftyp');
    const moov      = _v3_findTopLevel(topLevel, 'moov');
    const mdat      = _v3_findTopLevel(topLevel, 'mdat');
    if (!ftyp || !moov || !mdat) throw new Error('Missing required MP4 boxes.');

    const ftypPayload = new Uint8Array([
        0x69, 0x73, 0x6f, 0x6d,
        0x00, 0x00, 0x02, 0x00,
        0x69, 0x73, 0x6f, 0x6d,
        0x69, 0x73, 0x6f, 0x32,
        0x61, 0x76, 0x63, 0x31,
        0x6d, 0x70, 0x34, 0x31
    ]);
    const ftypBytes = _v3_makeBox('ftyp', ftypPayload);

    const origMdatPayload = data.subarray(mdat.contentStart, mdat.end);
    const origMdatContentStart = mdat.contentStart;

    const traks     = moov.children.filter(c => c.type === 'trak');
    const videoTrak = traks.find(c => _v3_handlerTypeForTrak(c) === 'vide');
    const audioTrak = traks.find(c => _v3_handlerTypeForTrak(c) === 'soun');
    if (!videoTrak) throw new Error('Video track not found.');

    const vStbl    = _v3_findDescendant(videoTrak, ['mdia', 'minf', 'stbl']);
    const vStcoBox = _v3_findChild(vStbl, 'stco') || _v3_findChild(vStbl, 'co64');
    const vSttsBox = _v3_findChild(vStbl, 'stts');
    const vStszBox = _v3_findChild(vStbl, 'stsz');

    const vOrigOffsets = _v3_parseStco(vStcoBox);
    const vRelOffsets  = vOrigOffsets.map(off => off - origMdatContentStart);
    const vStsz        = _v3_parseStsz(vStszBox);
    const vStts        = _v3_parseStts(vSttsBox);

    const vTimescale   = _v3_getTimescale(videoTrak);
    const vSampleCount = vStsz.length;
    const vBaseDelta   = vStts[0] ? vStts[0][1] : 1500;
    const newVStts = [
        [vSampleCount - 1, vBaseDelta * 2],
        [1, vBaseDelta]
    ];
    const vMdhdDur = (vSampleCount - 1) * (vBaseDelta * 2) + vBaseDelta;
    const vMvhdDur = Math.floor(vMdhdDur * 1000 / vTimescale);

    let aRelOffsets = [];
    let aStcoBox = null;
    let newAStts = [];
    let aMdhdDur = 0;
    let aMvhdDur = 0;

    if (audioTrak) {
        const aTimescale = _v3_getTimescale(audioTrak);
        const aStbl      = _v3_findDescendant(audioTrak, ['mdia', 'minf', 'stbl']);
        aStcoBox = _v3_findChild(aStbl, 'stco') || _v3_findChild(aStbl, 'co64');
        const aStszBox = _v3_findChild(aStbl, 'stsz');
        const aSttsBox = _v3_findChild(aStbl, 'stts');

        const aOrigSizes = _v3_parseStsz(aStszBox);
        const aOrigOffsets = _v3_parseStco(aStcoBox);
        aRelOffsets = aOrigOffsets.map(off => off - origMdatContentStart);
        const aOrigStts = _v3_parseStts(aSttsBox);
        const aBaseDelta = aOrigStts[0] ? aOrigStts[0][1] : 1024;
        const aSampleCount = aOrigSizes.length;
        const lastDelta = aOrigStts.length > 1 ? aOrigStts[aOrigStts.length - 1][1] : 992;
        newAStts = [
            [aSampleCount - 1, aBaseDelta * 2],
            [1, lastDelta]
        ];
        aMdhdDur = (aSampleCount - 1) * (aBaseDelta * 2) + lastDelta;
        aMvhdDur = Math.floor(aMdhdDur * 1000 / aTimescale);
    }

    let moovHeaderLen = moov.size;
    let finalOutput   = null;
    let patchResultStats = null;

    for (let pass = 0; pass < 3; pass++) {
        const newMdatContentStart = ftypBytes.byteLength + moovHeaderLen + 8;
        const replacements = new Map();

        const newVOffsets = vRelOffsets.map(off => off + newMdatContentStart);
        replacements.set(vStcoBox, _v3_buildStco(newVOffsets));
        replacements.set(vSttsBox, _v3_buildStts(newVStts));

        const vMdhd = _v3_findDescendant(videoTrak, ['mdia', 'mdhd']);
        if (vMdhd) {
            const vMdhdData = _v3_boxBytes(vMdhd);
            const isV1 = vMdhdData[8] === 1;
            const durOff = isV1 ? 32 : 24;
            _v3_writeU32BE(vMdhdData, durOff, vMdhdDur);
            replacements.set(vMdhd, vMdhdData);
        }

        const vTkhd = _v3_findChild(videoTrak, 'tkhd');
        if (vTkhd) {
            const vTkhdData = _v3_boxBytes(vTkhd);
            const isV1 = vTkhdData[8] === 1;
            const durOff = isV1 ? 32 : 28;
            _v3_writeU32BE(vTkhdData, durOff, vMvhdDur);
            replacements.set(vTkhd, vTkhdData);
        }

        const vElst = _v3_findDescendant(videoTrak, ['edts', 'elst']);
        if (vElst) {
            const vElstData = _v3_boxBytes(vElst);
            const isV1 = vElstData[8] === 1;
            const durOff = isV1 ? 20 : 16;
            _v3_writeU32BE(vElstData, durOff, vMvhdDur);
            replacements.set(vElst, vElstData);
        }

        if (audioTrak) {
            const newAOffsets = aRelOffsets.map(off => off + newMdatContentStart);
            replacements.set(aStcoBox, _v3_buildStco(newAOffsets));
            const aSttsBox = _v3_findDescendant(audioTrak, ['mdia', 'minf', 'stbl', 'stts']);
            replacements.set(aSttsBox, _v3_buildStts(newAStts));

            const aMdhd = _v3_findDescendant(audioTrak, ['mdia', 'mdhd']);
            if (aMdhd) {
                const aMdhdData = _v3_boxBytes(aMdhd);
                const isV1 = aMdhdData[8] === 1;
                const durOff = isV1 ? 32 : 24;
                _v3_writeU32BE(aMdhdData, durOff, aMdhdDur);
                replacements.set(aMdhd, aMdhdData);
            }

            const aTkhd = _v3_findChild(audioTrak, 'tkhd');
            if (aTkhd) {
                const aTkhdData = _v3_boxBytes(aTkhd);
                const isV1 = aTkhdData[8] === 1;
                const durOff = isV1 ? 32 : 28;
                _v3_writeU32BE(aTkhdData, durOff, aMvhdDur);
                replacements.set(aTkhd, aTkhdData);
            }

            const aElst = _v3_findDescendant(audioTrak, ['edts', 'elst']);
            if (aElst) {
                const aElstData = _v3_boxBytes(aElst);
                const isV1 = aElstData[8] === 1;
                const durOff = isV1 ? 20 : 16;
                _v3_writeU32BE(aElstData, durOff, aMvhdDur);
                replacements.set(aElst, aElstData);
            }
        }

        const mvhd = _v3_findChild(moov, 'mvhd');
        if (mvhd) {
            const mvhdData = _v3_boxBytes(mvhd);
            const isV1 = mvhdData[8] === 1;
            const durOff = isV1 ? 32 : 24;
            const maxMvhdDur = Math.max(vMvhdDur, aMvhdDur);
            _v3_writeU32BE(mvhdData, durOff, maxMvhdDur);
            replacements.set(mvhd, mvhdData);
        }

        const moovFinal = _v3_rebuildBox(moov, replacements);
        moovHeaderLen   = moovFinal.byteLength;

        if (pass === 2) {
            const newMdatBox = _v3_makeBox('mdat', origMdatPayload);
            finalOutput      = _v3_concatBytes([ftypBytes, moovFinal, newMdatBox]);
            const inputFps   = Math.round(vTimescale / vBaseDelta);
            const patchedFps = Math.round(vTimescale / (vBaseDelta * 2));
            patchResultStats = {
                output: finalOutput,
                realSamples:  vStsz.length,
                fakeSamples:  0,
                timescale:    vTimescale,
                sampleDelta:  vBaseDelta * 2,
                duration:     vMdhdDur,
                chunkCount:   vRelOffsets.length,
                inputFps,
                patchedFps
            };
        }
    }

    _log(`FPS MP4 patch completed successfully. Total output: ${finalOutput.byteLength} bytes.`);
    return patchResultStats;
}

function _v3_patchMp4FPSMethod(inputBuffer) {
    const result = _v3_patchMp4FPS(inputBuffer, null);
    return result.output;
}
window.patchMp4FPSMethod = _v3_patchMp4FPSMethod;

window.processVideoFPS = async function processVideoFPS(file, mode) {
    if (mode === undefined) mode = 'off';
    const s = window._tktk;
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
    s.progressText.textContent = 'Processing FPS...';

    const modeLabel = isOff ? 'Direct Pass-Through (OFF)' : (mode === '720p' ? 'HD 720p Compress + Patch' : 'Full HD 1080p Compress + Patch');
    s.logSection('FPS PROCESSING');
    s.log(`  File   : ${safeName}`);
    s.log(`  Mode   : ${modeLabel}`);
    s.logEnd();

    if (isOff) {
        s.log(`  [1/2] Executing Pure JS FPS Patch...`);
        try {
            const patchedBytes = _v3_patchMp4FPSMethod(s.currentFileBuffer);
            s.log(`  [2/2] Finalizing output package...`);
            const finalizeFn = window.finalizePatcherDownload || (s && s.finalizePatcherDownload);
            if (typeof finalizeFn === 'function') {
                finalizeFn(file, patchedBytes, 'hd');
            } else {
                const blob     = new Blob([patchedBytes], { type: 'video/mp4' });
                const url      = URL.createObjectURL(blob);
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
        } catch (jsErr) {
            s.log(`  [Error] Pure JS patch failed: ${jsErr.message}`);
            throw jsErr;
        }
    }

    try {
        const compressFn = window.compressVideo || (s && s.compressVideo);
        if (typeof compressFn !== 'function') {
            throw new Error('Compression module (compress.js) is not loaded.');
        }

        const rawOutput = await compressFn(file, mode, s.currentFileBuffer);

        s.log(`  Executing FPS metadata patch on compressed video...`);
        let finalResultBytes;
        try {
            finalResultBytes = _v3_patchMp4FPSMethod(rawOutput);
        } catch (pErr) {
            s.log(`  [Notice] FPS patch failed, using compressed output as-is: ${pErr.message}`);
            finalResultBytes = rawOutput;
        }
        s.logEnd();

        const finalizeFn = window.finalizePatcherDownload || (s && s.finalizePatcherDownload);
        if (typeof finalizeFn === 'function') {
            finalizeFn(file, finalResultBytes, 'hd');
        } else {
            const blob     = new Blob([finalResultBytes], { type: 'video/mp4' });
            const url      = URL.createObjectURL(blob);
            const filename = `${file.name.replace(/\.[^.]+$/, '')}_hd.mp4`;
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
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

})();
