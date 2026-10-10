/* =========================================================================
 * Cutefish Emergency FPS Method (emergencymethod.js)
 * Automatically converts >60fps videos (e.g. 120fps) into 60fps slowmo,
 * which speeds up on mobile TikTok player into ultra-smooth 120fps playback.
 * Pure JS MP4 atom manipulator.
 * ========================================================================= */

(function () {
'use strict';

const CONTAINER_BOXES = new Set([
    'moov', 'trak', 'mdia', 'minf', 'stbl',
    'edts', 'dinf', 'udta', 'meta', 'ilst',
]);

function _em_getBoxType(data, offset) {
    return String.fromCharCode(data[offset], data[offset + 1], data[offset + 2], data[offset + 3]);
}

function _em_assertUint32(value, label) {
    if (!Number.isFinite(value) || value < 0 || value > 0xffffffff)
        throw new Error(`${label} out of uint32 range: ${value}`);
}

function _em_readBox(view, data, offset, end, parentPath) {
    if (offset + 8 > end) return null;
    const smallSize = view.getUint32(offset, false);
    const type = _em_getBoxType(data, offset + 4);
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

function _em_childStartForBox(box) {
    return box.type === 'meta' ? box.contentStart + 4 : box.contentStart;
}

function _em_parseBoxes(data, view, start, end, parentPath) {
    const boxes = [];
    let offset = start;
    while (offset + 8 <= end) {
        const box = _em_readBox(view, data, offset, end, parentPath || '');
        if (!box) break;
        if (CONTAINER_BOXES.has(box.type)) {
            const childStart = _em_childStartForBox(box);
            if (childStart <= box.end) {
                box.prefixStart = box.contentStart;
                box.prefixEnd   = childStart;
                box.children    = _em_parseBoxes(data, view, childStart, box.end, box.path);
            }
        }
        boxes.push(box);
        offset = box.end;
    }
    return boxes;
}

function _em_findChild(box, type) {
    return box ? box.children.find(c => c.type === type) || null : null;
}

function _em_findDescendant(box, typePath) {
    let cur = box;
    for (const t of typePath) {
        cur = _em_findChild(cur, t);
        if (!cur) return null;
    }
    return cur;
}

function _em_findTopLevel(boxes, type) {
    return boxes.find(b => b.type === type) || null;
}

function _em_handlerTypeForTrak(trak) {
    const hdlr = _em_findDescendant(trak, ['mdia', 'hdlr']);
    if (!hdlr || hdlr.offset + 20 > hdlr.end) return null;
    return _em_getBoxType(hdlr.data, hdlr.offset + 16);
}

function _em_getTimescale(trak) {
    const mdhd = _em_findDescendant(trak, ['mdia', 'mdhd']);
    if (!mdhd) return 90000;
    const ver = mdhd.data[mdhd.offset + 8];
    return ver === 0
        ? mdhd.view.getUint32(mdhd.offset + 20, false)
        : mdhd.view.getUint32(mdhd.offset + 28, false);
}

function _em_parseStsz(stsz) {
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

function _em_parseStco(stcoBox) {
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

function _em_parseStts(stts) {
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

function _em_makeBox(type, payload) {
    const size = 8 + payload.byteLength;
    _em_assertUint32(size, `${type}.size`);
    const box = new Uint8Array(size);
    const dv  = new DataView(box.buffer);
    dv.setUint32(0, size, false);
    for (let i = 0; i < 4; i++) box[4 + i] = type.charCodeAt(i);
    box.set(new Uint8Array(payload.buffer || payload, payload.byteOffset || 0, payload.byteLength), 8);
    return box;
}

function _em_concatBytes(parts) {
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

function _em_boxBytes(box) {
    return new Uint8Array(box.data.buffer, box.data.byteOffset + box.offset, box.size);
}

function _em_writeU32BE(arr, offset, value) {
    const dv = new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
    dv.setUint32(offset, value, false);
}

function _em_buildStco(newOffsets) {
    const payload = new Uint8Array(8 + newOffsets.length * 4);
    _em_writeU32BE(payload, 4, newOffsets.length);
    let off = 8;
    for (const o of newOffsets) {
        _em_assertUint32(o, 'stco.chunk_offset');
        _em_writeU32BE(payload, off, o);
        off += 4;
    }
    return _em_makeBox('stco', payload);
}

function _em_buildStts(entries) {
    const payload = new Uint8Array(8 + entries.length * 8);
    _em_writeU32BE(payload, 4, entries.length);
    let off = 8;
    for (const [count, delta] of entries) {
        _em_writeU32BE(payload, off, count);
        _em_writeU32BE(payload, off + 4, delta);
        off += 8;
    }
    return _em_makeBox('stts', payload);
}

function _em_rebuildBox(box, replacements) {
    if (replacements.has(box)) return replacements.get(box);
    if (!box.children || !box.children.length) return _em_boxBytes(box);
    const prefix = new Uint8Array(box.data.buffer, box.data.byteOffset + box.prefixStart, box.prefixEnd - box.prefixStart);
    const parts  = [prefix];
    for (const child of box.children) {
        const r = _em_rebuildBox(child, replacements);
        if (r) parts.push(r);
    }
    return _em_makeBox(box.type, _em_concatBytes(parts));
}

/**
 * Checks if a video buffer has FPS > 60.
 * @param {ArrayBuffer|Uint8Array} inputData
 * @returns {number|null} detected FPS, or null if cannot be determined
 */
function isEmergencyFpsNeeded(inputData) {
    try {
        const srcArr = inputData instanceof Uint8Array ? inputData : new Uint8Array(inputData);
        const view = new DataView(srcArr.buffer, srcArr.byteOffset, srcArr.byteLength);

        try {
            const topLevel = _em_parseBoxes(srcArr, view, 0, srcArr.length, '');
            const moov = _em_findTopLevel(topLevel, 'moov');
            if (moov) {
                const videoTrak = moov.children.find(c => c.type === 'trak' && _em_handlerTypeForTrak(c) === 'vide');
                if (videoTrak) {
                    const timescale = _em_getTimescale(videoTrak);
                    const stts = _em_findDescendant(videoTrak, ['mdia', 'minf', 'stbl', 'stts']);
                    if (stts) {
                        const entries = _em_parseStts(stts);
                        if (entries.length > 0 && entries[0][1] > 0) {
                            const fps = Math.round(timescale / entries[0][1]);
                            if (fps > 60 && fps <= 300) return fps;
                            return null;
                        }
                    }
                }
            }
        } catch (_) {}

        for (let i = 0; i < srcArr.byteLength - 8; i++) {
            if (srcArr[i] === 0x76 && srcArr[i+1] === 0x69 && srcArr[i+2] === 0x64 && srcArr[i+3] === 0x65) {
                const searchStart = Math.max(0, i - 300);
                const searchEnd = Math.min(srcArr.byteLength, i + 8000);
                let timescale = 0;
                let sampleDelta = 0;
                for (let j = searchStart; j < searchEnd - 8; j++) {
                    if (srcArr[j] === 0x6D && srcArr[j+1] === 0x64 && srcArr[j+2] === 0x68 && srcArr[j+3] === 0x64) {
                        const version = view.getUint8(j + 4);
                        timescale = version === 1 ? view.getUint32(j + 24) : view.getUint32(j + 16);
                    }
                    if (srcArr[j] === 0x73 && srcArr[j+1] === 0x74 && srcArr[j+2] === 0x74 && srcArr[j+3] === 0x73) {
                        const entryCount = view.getUint32(j + 8);
                        if (entryCount > 0) {
                            sampleDelta = view.getUint32(j + 16);
                        }
                    }
                    if (timescale && sampleDelta) {
                        const fps = Math.round(timescale / sampleDelta);
                        if (fps > 60 && fps <= 300) return fps;
                        return null;
                    }
                }
            }
        }
    } catch (e) {}
    return null;
}

/**
 * Emergency FPS patcher for videos > 60fps (e.g. 120fps).
 * Halves the framerate to 60fps slowmo by doubling the sample delta,
 * perfectly syncing audio and video. When played on mobile TikTok,
 * the player renders it at full 120fps speed.
 *
 * @param {ArrayBuffer|Uint8Array} inputData
 * @param {Function} [_logFn] Optional log callback
 * @returns {Uint8Array} Patched MP4 bytes (or original bytes if <= 60fps)
 */
function patchEmergencyFpsMethod(inputData, _logFn) {
    const _log = _logFn || (() => {});
    const srcArr = inputData instanceof Uint8Array ? inputData : new Uint8Array(inputData);
    const data   = new Uint8Array(srcArr.byteLength);
    data.set(srcArr);
    const view = new DataView(data.buffer);

    const topLevel = _em_parseBoxes(data, view, 0, data.length, '');
    const ftyp = _em_findTopLevel(topLevel, 'ftyp');
    const moov = _em_findTopLevel(topLevel, 'moov');
    const mdat = _em_findTopLevel(topLevel, 'mdat');
    if (!ftyp || !moov || !mdat) return srcArr;

    const ftypBytes = _em_boxBytes(ftyp);
    const origMdatPayload = data.subarray(mdat.contentStart, mdat.end);
    const origMdatContentStart = mdat.contentStart;

    const traks = moov.children.filter(c => c.type === 'trak');
    const videoTrak = traks.find(c => _em_handlerTypeForTrak(c) === 'vide');
    const audioTrak = traks.find(c => _em_handlerTypeForTrak(c) === 'soun');
    if (!videoTrak) return srcArr;

    const vStbl    = _em_findDescendant(videoTrak, ['mdia', 'minf', 'stbl']);
    const vStcoBox = _em_findChild(vStbl, 'stco') || _em_findChild(vStbl, 'co64');
    const vSttsBox = _em_findChild(vStbl, 'stts');
    const vStszBox = _em_findChild(vStbl, 'stsz');

    const vOrigOffsets = _em_parseStco(vStcoBox);
    const vRelOffsets  = vOrigOffsets.map(off => off - origMdatContentStart);
    const vStsz        = _em_parseStsz(vStszBox);
    const vStts        = _em_parseStts(vSttsBox);

    const vTimescale   = _em_getTimescale(videoTrak);
    const vSampleCount = vStsz.length;
    const vBaseDelta   = vStts[0] ? vStts[0][1] : 1000;
    const inputFps     = Math.round(vTimescale / vBaseDelta);

    // Only apply if video is actually above 60fps!
    if (inputFps <= 60) {
        _log(`  [Emergency FPS] Video is ${inputFps}fps (<=60fps), emergency patch not needed.`);
        return srcArr;
    }

    _log(`  [Emergency FPS] Detected ${inputFps}fps (>60fps). Converting to 60fps slowmo...`);

    // Double the delta to halve the FPS (e.g. 120fps -> 60fps slowmo)
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
        const aTimescale = _em_getTimescale(audioTrak);
        const aStbl      = _em_findDescendant(audioTrak, ['mdia', 'minf', 'stbl']);
        aStcoBox = _em_findChild(aStbl, 'stco') || _em_findChild(aStbl, 'co64');
        const aStszBox = _em_findChild(aStbl, 'stsz');
        const aSttsBox = _em_findChild(aStbl, 'stts');

        const aOrigSizes = _em_parseStsz(aStszBox);
        const aOrigOffsets = _em_parseStco(aStcoBox);
        aRelOffsets = aOrigOffsets.map(off => off - origMdatContentStart);
        const aOrigStts = _em_parseStts(aSttsBox);
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

    for (let pass = 0; pass < 3; pass++) {
        const newMdatContentStart = ftypBytes.byteLength + moovHeaderLen + 8;
        const replacements = new Map();

        const newVOffsets = vRelOffsets.map(off => off + newMdatContentStart);
        replacements.set(vStcoBox, _em_buildStco(newVOffsets));
        replacements.set(vSttsBox, _em_buildStts(newVStts));

        const vMdhd = _em_findDescendant(videoTrak, ['mdia', 'mdhd']);
        if (vMdhd) {
            const vMdhdData = _em_boxBytes(vMdhd);
            const isV1 = vMdhdData[8] === 1;
            const durOff = isV1 ? 32 : 24;
            _em_writeU32BE(vMdhdData, durOff, vMdhdDur);
            replacements.set(vMdhd, vMdhdData);
        }

        const vTkhd = _em_findChild(videoTrak, 'tkhd');
        if (vTkhd) {
            const vTkhdData = _em_boxBytes(vTkhd);
            const isV1 = vTkhdData[8] === 1;
            const durOff = isV1 ? 32 : 28;
            _em_writeU32BE(vTkhdData, durOff, vMvhdDur);
            replacements.set(vTkhd, vTkhdData);
        }

        const vElst = _em_findDescendant(videoTrak, ['edts', 'elst']);
        if (vElst) {
            const vElstData = _em_boxBytes(vElst);
            const isV1 = vElstData[8] === 1;
            const durOff = isV1 ? 20 : 16;
            _em_writeU32BE(vElstData, durOff, vMvhdDur);
            replacements.set(vElst, vElstData);
        }

        if (audioTrak) {
            const newAOffsets = aRelOffsets.map(off => off + newMdatContentStart);
            replacements.set(aStcoBox, _em_buildStco(newAOffsets));
            const aSttsBox = _em_findDescendant(audioTrak, ['mdia', 'minf', 'stbl', 'stts']);
            replacements.set(aSttsBox, _em_buildStts(newAStts));

            const aMdhd = _em_findDescendant(audioTrak, ['mdia', 'mdhd']);
            if (aMdhd) {
                const aMdhdData = _em_boxBytes(aMdhd);
                const isV1 = aMdhdData[8] === 1;
                const durOff = isV1 ? 32 : 24;
                _em_writeU32BE(aMdhdData, durOff, aMdhdDur);
                replacements.set(aMdhd, aMdhdData);
            }

            const aTkhd = _em_findChild(audioTrak, 'tkhd');
            if (aTkhd) {
                const aTkhdData = _em_boxBytes(aTkhd);
                const isV1 = aTkhdData[8] === 1;
                const durOff = isV1 ? 32 : 28;
                _em_writeU32BE(aTkhdData, durOff, aMvhdDur);
                replacements.set(aTkhd, aTkhdData);
            }

            const aElst = _em_findDescendant(audioTrak, ['edts', 'elst']);
            if (aElst) {
                const aElstData = _em_boxBytes(aElst);
                const isV1 = aElstData[8] === 1;
                const durOff = isV1 ? 20 : 16;
                _em_writeU32BE(aElstData, durOff, aMvhdDur);
                replacements.set(aElst, aElstData);
            }
        }

        const mvhd = _em_findChild(moov, 'mvhd');
        if (mvhd) {
            const mvhdData = _em_boxBytes(mvhd);
            const isV1 = mvhdData[8] === 1;
            const durOff = isV1 ? 32 : 24;
            const maxMvhdDur = Math.max(vMvhdDur, aMvhdDur);
            _em_writeU32BE(mvhdData, durOff, maxMvhdDur);
            replacements.set(mvhd, mvhdData);
        }

        const moovFinal = _em_rebuildBox(moov, replacements);
        moovHeaderLen   = moovFinal.byteLength;

        if (pass === 2) {
            const newMdatBox = _em_makeBox('mdat', origMdatPayload);
            finalOutput      = _em_concatBytes([ftypBytes, moovFinal, newMdatBox]);
        }
    }

    _log(`  [Emergency FPS] Complete: ${inputFps}fps -> ${Math.round(vTimescale / (vBaseDelta * 2))}fps slowmo.`);
    return finalOutput;
}

window.isEmergencyFpsNeeded = isEmergencyFpsNeeded;
window.patchEmergencyFpsMethod = patchEmergencyFpsMethod;

if (window._tktk) {
    window._tktk.isEmergencyFpsNeeded = isEmergencyFpsNeeded;
    window._tktk.patchEmergencyFpsMethod = patchEmergencyFpsMethod;
}

})();
