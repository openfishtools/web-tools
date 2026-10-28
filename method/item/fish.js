/* =========================================================================
 * Cutefish FISH Architecture Engine (fish.js) - Ultimate Clean Sentinel Edition
 * 
 * 100% Lossless TikTok Quality Bypass:
 * - V1 64-bit Infinite Duration Sentinel (mvhd timescale 48000, duration 0xFFFFFFFFFFFFFFFF)
 * - Pure 2-Track Container (Video Track 1 + Audio Track 2) - Tanpa Track 3 trap
 * - Proportional Rescaling for Video (Track 1) & Audio (Track 2) tkhd and elst to 48000 clock
 *   (Preserves 100% exact playback speed, eliminates fast-forward/glitching)
 * - In-track Video Anchor Sample (stts delta=0, stsz=8, stsc+stco) murni inside mdat
 * - Zero bytes outside mdat: Strict ISO compliance (ftyp -> moov -> mdat)
 * - Tanpa CTTS injection (menghindari deteksi manipulasi frame oleh parser ByteDance)
 * - Retain udta box asli
 * - Pure binary atom manipulation: 0% compression, 0% quality loss, ~0.05s execution
 * ========================================================================= */

(function () {
'use strict';

function _fish_readU32(arr, off) {
    return ((arr[off] << 24) | (arr[off + 1] << 16) | (arr[off + 2] << 8) | arr[off + 3]) >>> 0;
}

function _fish_writeU32(arr, off, val) {
    arr[off]     = (val >>> 24) & 0xff;
    arr[off + 1] = (val >>> 16) & 0xff;
    arr[off + 2] = (val >>> 8)  & 0xff;
    arr[off + 3] = val & 0xff;
}

function _fish_makeBox(type, payload) {
    const size = 8 + payload.byteLength;
    const box = new Uint8Array(size);
    _fish_writeU32(box, 0, size);
    for (let i = 0; i < 4; i++) box[4 + i] = type.charCodeAt(i);
    box.set(payload, 8);
    return box;
}

function _fish_parseBoxes(buf, start, end) {
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

function _fish_findDeep(buf, startOffset, endOffset, targetType) {
    const boxes = _fish_parseBoxes(buf, startOffset, endOffset);
    for (const b of boxes) {
        if (b.type === targetType) return b;
        if (['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts'].includes(b.type)) {
            const sub = _fish_findDeep(buf, b.contentStart, b.end, targetType);
            if (sub) return sub;
        }
    }
    return null;
}

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

function _fish_createCutefishUdtaBox(existingUdtaBytes) {
    const textBytes = new TextEncoder().encode('cutefish.my.id');
    const cmtBox = new Uint8Array(16 + textBytes.length);
    new DataView(cmtBox.buffer).setUint32(0, cmtBox.length, false);
    cmtBox[4] = 0xA9; cmtBox[5] = 0x63; cmtBox[6] = 0x6D; cmtBox[7] = 0x74; // '©cmt'
    cmtBox.set(textBytes, 16);

    if (existingUdtaBytes && existingUdtaBytes.byteLength >= 8) {
        const bytes = existingUdtaBytes instanceof Uint8Array ? existingUdtaBytes : new Uint8Array(existingUdtaBytes);
        const target = [99, 117, 116, 101, 102, 105, 115, 104, 46, 109, 121, 46, 105, 100];
        for (let i = 0; i <= bytes.length - target.length; i++) {
            if (bytes[i] === target[0]) {
                let match = true;
                for (let j = 1; j < target.length; j++) {
                    if (bytes[i + j] !== target[j]) { match = false; break; }
                }
                if (match) return bytes;
            }
        }

        const origPayload = bytes.subarray(8);
        const newPayload = new Uint8Array(origPayload.length + cmtBox.length);
        newPayload.set(origPayload, 0);
        newPayload.set(cmtBox, origPayload.length);

        const newUdta = new Uint8Array(8 + newPayload.length);
        new DataView(newUdta.buffer).setUint32(0, newUdta.length, false);
        newUdta[4] = 0x75; newUdta[5] = 0x64; newUdta[6] = 0x74; newUdta[7] = 0x61;
        newUdta.set(newPayload, 8);
        return newUdta;
    } else {
        const newUdta = new Uint8Array(8 + cmtBox.length);
        new DataView(newUdta.buffer).setUint32(0, newUdta.length, false);
        newUdta[4] = 0x75; newUdta[5] = 0x64; newUdta[6] = 0x74; newUdta[7] = 0x61;
        newUdta.set(cmtBox, 8);
        return newUdta;
    }
}

/**
 * Pure In-Memory Cutefish FISH Patch (Ultimate Clean Sentinel Mechanism)
 * @param {ArrayBuffer|Uint8Array} inputBuffer
 * @param {Function} logFn
 * @returns {Uint8Array}
 */
function _ss_patchMp4Fish(inputBuffer, logFn) {
    const log = logFn || (() => {});
    const buf = inputBuffer instanceof Uint8Array ? inputBuffer : new Uint8Array(inputBuffer);
    const topBoxes = _fish_parseBoxes(buf, 0, buf.length);

    const ftyp = topBoxes.find(b => b.type === 'ftyp');
    const moov = topBoxes.find(b => b.type === 'moov');
    const mdat = topBoxes.find(b => b.type === 'mdat');

    if (!ftyp || !moov || !mdat) {
        throw new Error('Format MP4 tidak standar (ftyp, moov, atau mdat tidak ditemukan).');
    }

    const ftypBytes = buf.subarray(ftyp.offset, ftyp.end);
    const origMdatPayload = buf.subarray(mdat.contentStart, mdat.end);
    const origMdatContentStart = mdat.contentStart;

    const moovChildren = _fish_parseBoxes(buf, moov.contentStart, moov.end);
    const mvhd = moovChildren.find(b => b.type === 'mvhd');
    const traks = moovChildren.filter(b => b.type === 'trak');

    if (!mvhd || traks.length === 0) {
        throw new Error('Struktur atom moov tidak valid: mvhd atau trak hilang.');
    }

    const origMvhdVer = buf[mvhd.contentStart];
    const origMvhdTimescale = _fish_readU32(buf, mvhd.contentStart + (origMvhdVer === 1 ? 20 : 12)) || 1000;
    const targetTimescale = 48000;

    function rescaleDuration(val) {
        if (!val || val === 0n || val === 0) return 0;
        return Math.round((Number(val) * targetTimescale) / origMvhdTimescale);
    }

    function rescaleTkhd(tkhdBox) {
        const payload = new Uint8Array(tkhdBox.size - tkhdBox.headerSize);
        payload.set(buf.subarray(tkhdBox.contentStart, tkhdBox.end));
        const ver = payload[0];
        const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
        const durOffset = ver === 1 ? 24 : 20;
        const origDur = ver === 1 ? dv.getBigUint64(durOffset, false) : dv.getUint32(durOffset, false);
        const newDur = rescaleDuration(origDur);
        if (ver === 1) {
            dv.setBigUint64(durOffset, BigInt(newDur), false);
        } else {
            dv.setUint32(durOffset, newDur >>> 0, false);
        }
        return _fish_makeBox('tkhd', payload);
    }

    function rescaleEdts(edtsBox) {
        const elstBox = _fish_findDeep(buf, edtsBox.contentStart, edtsBox.end, 'elst');
        if (!elstBox) return buf.subarray(edtsBox.offset, edtsBox.end);
        const elstPayload = new Uint8Array(elstBox.size - elstBox.headerSize);
        elstPayload.set(buf.subarray(elstBox.contentStart, elstBox.end));
        const elstDv = new DataView(elstPayload.buffer, elstPayload.byteOffset, elstPayload.byteLength);
        const ver = elstPayload[0];
        const entryCount = elstDv.getUint32(4, false);
        let cur = 8;
        for (let i = 0; i < entryCount; i++) {
            if (ver === 1) {
                const segDur = elstDv.getBigUint64(cur, false);
                elstDv.setBigUint64(cur, BigInt(rescaleDuration(segDur)), false);
                cur += 8 + 8 + 4;
            } else {
                const segDur = elstDv.getUint32(cur, false);
                elstDv.setUint32(cur, rescaleDuration(segDur) >>> 0, false);
                cur += 4 + 4 + 4;
            }
        }
        const newElstBox = _fish_makeBox('elst', elstPayload);
        return _fish_makeBox('edts', newElstBox);
    }

    // 1. mvhd Version 1 (64-bit), timescale 48000, infinite duration
    const newMvhdPayload = new Uint8Array(112);
    const mvhdDv = new DataView(newMvhdPayload.buffer);
    newMvhdPayload[0] = 1;
    mvhdDv.setBigUint64(4, 0n, false);
    mvhdDv.setBigUint64(12, 0n, false);
    mvhdDv.setUint32(20, targetTimescale, false);
    mvhdDv.setBigUint64(24, 0xFFFFFFFFFFFFFFFFn, false);
    mvhdDv.setUint32(32, 0x00010000, false);
    mvhdDv.setUint16(36, 0x0100, false);
    mvhdDv.setUint32(48, 0x00010000, false);
    mvhdDv.setUint32(64, 0x00010000, false);
    mvhdDv.setUint32(80, 0x40000000, false);
    mvhdDv.setUint32(108, traks.length > 1 ? 3 : 2, false);
    const newMvhdBox = _fish_makeBox('mvhd', newMvhdPayload);

    const videoTrak = traks[0];
    const audioTrak = traks.length > 1 ? traks[1] : null;

    const vSttsBox = _fish_findDeep(buf, videoTrak.contentStart, videoTrak.end, 'stts');
    const vStscBox = _fish_findDeep(buf, videoTrak.contentStart, videoTrak.end, 'stsc');
    const vStszBox = _fish_findDeep(buf, videoTrak.contentStart, videoTrak.end, 'stsz');
    const vStcoBox = _fish_findDeep(buf, videoTrak.contentStart, videoTrak.end, 'stco') || _fish_findDeep(buf, videoTrak.contentStart, videoTrak.end, 'co64');

    if (!vSttsBox || !vStscBox || !vStszBox || !vStcoBox) {
        throw new Error('Video stbl table boxes not found.');
    }

    const vChunkCount = _fish_readU32(buf, vStcoBox.contentStart + 4);
    const vRelOffsets = [];
    for (let i = 0; i < vChunkCount; i++) {
        const off = _fish_readU32(buf, vStcoBox.contentStart + 8 + i * 4);
        vRelOffsets.push(off - origMdatContentStart);
    }

    let aStcoBox = null;
    let aChunkCount = 0;
    const aRelOffsets = [];
    if (audioTrak) {
        aStcoBox = _fish_findDeep(buf, audioTrak.contentStart, audioTrak.end, 'stco') || _fish_findDeep(buf, audioTrak.contentStart, audioTrak.end, 'co64');
        if (aStcoBox) {
            aChunkCount = _fish_readU32(buf, aStcoBox.contentStart + 4);
            for (let i = 0; i < aChunkCount; i++) {
                const off = _fish_readU32(buf, aStcoBox.contentStart + 8 + i * 4);
                aRelOffsets.push(off - origMdatContentStart);
            }
        }
    }

    // 8-byte in-mdat anchor (clean ISO free atom, strictly in mdat)
    const inMdatAnchor = new Uint8Array([0x00, 0x00, 0x00, 0x08, 0x66, 0x72, 0x65, 0x65]);

    // Video STTS (+1 zero-delta sample minimum)
    const origVSttsEntries = _fish_readU32(buf, vSttsBox.contentStart + 4);
    const newVSttsPayload = new Uint8Array(8 + (origVSttsEntries + 1) * 8);
    const vSttsDv = new DataView(newVSttsPayload.buffer);
    vSttsDv.setUint32(4, origVSttsEntries + 1, false);
    newVSttsPayload.set(buf.subarray(vSttsBox.contentStart + 8, vSttsBox.contentStart + 8 + origVSttsEntries * 8), 8);
    vSttsDv.setUint32(8 + origVSttsEntries * 8, 1, false);
    vSttsDv.setUint32(8 + origVSttsEntries * 8 + 4, 0, false);
    const newVSttsBox = _fish_makeBox('stts', newVSttsPayload);

    // Video STSZ (+1 sample of size 8)
    const origVSampleSize = _fish_readU32(buf, vStszBox.contentStart + 4);
    const origVSampleCount = _fish_readU32(buf, vStszBox.contentStart + 8);
    const newVStszPayload = new Uint8Array(12 + (origVSampleCount + 1) * 4);
    const vStszDv = new DataView(newVStszPayload.buffer);
    vStszDv.setUint32(0, 0, false);
    vStszDv.setUint32(4, 0, false);
    vStszDv.setUint32(8, origVSampleCount + 1, false);
    if (origVSampleSize === 0) {
        newVStszPayload.set(buf.subarray(vStszBox.contentStart + 12, vStszBox.contentStart + 12 + origVSampleCount * 4), 12);
    } else {
        for (let i = 0; i < origVSampleCount; i++) {
            vStszDv.setUint32(12 + i * 4, origVSampleSize, false);
        }
    }
    vStszDv.setUint32(12 + origVSampleCount * 4, 8, false);
    const newVStszBox = _fish_makeBox('stsz', newVStszPayload);

    // Video STSC (+1 chunk)
    const origVStscEntries = _fish_readU32(buf, vStscBox.contentStart + 4);
    const newVStscPayload = new Uint8Array(8 + (origVStscEntries + 1) * 12);
    const vStscDv = new DataView(newVStscPayload.buffer);
    vStscDv.setUint32(4, origVStscEntries + 1, false);
    newVStscPayload.set(buf.subarray(vStscBox.contentStart + 8, vStscBox.contentStart + 8 + origVStscEntries * 12), 8);
    vStscDv.setUint32(8 + origVStscEntries * 12, vChunkCount + 1, false);
    vStscDv.setUint32(8 + origVStscEntries * 12 + 4, 1, false);
    vStscDv.setUint32(8 + origVStscEntries * 12 + 8, 1, false);
    const newVStscBox = _fish_makeBox('stsc', newVStscPayload);

    const vStblBox = _fish_findDeep(buf, videoTrak.contentStart, videoTrak.end, 'stbl');
    const vStblChildren = _fish_parseBoxes(buf, vStblBox.contentStart, vStblBox.end);
    const vMinfBox = _fish_findDeep(buf, videoTrak.contentStart, videoTrak.end, 'minf');
    const vMinfChildren = _fish_parseBoxes(buf, vMinfBox.contentStart, vMinfBox.end);
    const vMdiaBox = _fish_findDeep(buf, videoTrak.contentStart, videoTrak.end, 'mdia');
    const vMdiaChildren = _fish_parseBoxes(buf, vMdiaBox.contentStart, vMdiaBox.end);
    const vTrakChildren = _fish_parseBoxes(buf, videoTrak.contentStart, videoTrak.end);

    let moovBytes = null;
    let finalOutput = null;

    for (let iter = 0; iter < 3; iter++) {
        const estMoovLen = moovBytes ? moovBytes.byteLength : (moov.size + 1024);
        const newMdatContentStart = ftypBytes.byteLength + estMoovLen + 8;
        const anchorChunkOffset = newMdatContentStart + origMdatPayload.byteLength;

        // Video STCO
        const newVStcoPayload = new Uint8Array(8 + (vChunkCount + 1) * 4);
        const vStcoDv = new DataView(newVStcoPayload.buffer);
        vStcoDv.setUint32(4, vChunkCount + 1, false);
        for (let i = 0; i < vChunkCount; i++) {
            vStcoDv.setUint32(8 + i * 4, vRelOffsets[i] + newMdatContentStart, false);
        }
        vStcoDv.setUint32(8 + vChunkCount * 4, anchorChunkOffset, false);
        const newVStcoBox = _fish_makeBox('stco', newVStcoPayload);

        // Reassemble Video STBL (No CTTS injection)
        const vStblParts = [];
        for (const child of vStblChildren) {
            if (child.type === 'stts') vStblParts.push(newVSttsBox);
            else if (child.type === 'ctts') vStblParts.push(buf.subarray(child.offset, child.end));
            else if (child.type === 'stsc') vStblParts.push(newVStscBox);
            else if (child.type === 'stsz') vStblParts.push(newVStszBox);
            else if (child.type === 'stco' || child.type === 'co64') vStblParts.push(newVStcoBox);
            else vStblParts.push(buf.subarray(child.offset, child.end));
        }
        const newVStbl = _fish_makeBox('stbl', concatArrays(vStblParts));

        const vMinfParts = [];
        for (const child of vMinfChildren) {
            if (child.type === 'stbl') vMinfParts.push(newVStbl);
            else vMinfParts.push(buf.subarray(child.offset, child.end));
        }
        const newVMinf = _fish_makeBox('minf', concatArrays(vMinfParts));

        const vMdiaParts = [];
        for (const child of vMdiaChildren) {
            if (child.type === 'minf') vMdiaParts.push(newVMinf);
            else vMdiaParts.push(buf.subarray(child.offset, child.end));
        }
        const newVMdia = _fish_makeBox('mdia', concatArrays(vMdiaParts));

        // Reassemble Video Trak
        const vTrakParts = [];
        for (const child of vTrakChildren) {
            if (child.type === 'tkhd') vTrakParts.push(rescaleTkhd(child));
            else if (child.type === 'edts') vTrakParts.push(rescaleEdts(child));
            else if (child.type === 'mdia') vTrakParts.push(newVMdia);
            else vTrakParts.push(buf.subarray(child.offset, child.end));
        }
        const newVTrak = _fish_makeBox('trak', concatArrays(vTrakParts));

        let newATrak = null;
        if (audioTrak) {
            const aStblBox = _fish_findDeep(buf, audioTrak.contentStart, audioTrak.end, 'stbl');
            const aStblChildren = _fish_parseBoxes(buf, aStblBox.contentStart, aStblBox.end);
            const aMinfBox = _fish_findDeep(buf, audioTrak.contentStart, audioTrak.end, 'minf');
            const aMinfChildren = _fish_parseBoxes(buf, aMinfBox.contentStart, aMinfBox.end);
            const aMdiaBox = _fish_findDeep(buf, audioTrak.contentStart, audioTrak.end, 'mdia');
            const aMdiaChildren = _fish_parseBoxes(buf, aMdiaBox.contentStart, aMdiaBox.end);
            const aTrakChildren = _fish_parseBoxes(buf, audioTrak.contentStart, audioTrak.end);

            const newAStcoPayload = new Uint8Array(8 + aChunkCount * 4);
            const aStcoDv = new DataView(newAStcoPayload.buffer);
            aStcoDv.setUint32(4, aChunkCount, false);
            for (let i = 0; i < aChunkCount; i++) {
                aStcoDv.setUint32(8 + i * 4, aRelOffsets[i] + newMdatContentStart, false);
            }
            const newAStcoBox = _fish_makeBox('stco', newAStcoPayload);

            const aStblParts = [];
            for (const child of aStblChildren) {
                if (child.type === 'stco' || child.type === 'co64') aStblParts.push(newAStcoBox);
                else aStblParts.push(buf.subarray(child.offset, child.end));
            }
            const newAStbl = _fish_makeBox('stbl', concatArrays(aStblParts));

            const aMinfParts = [];
            for (const child of aMinfChildren) {
                if (child.type === 'stbl') aMinfParts.push(newAStbl);
                else aMinfParts.push(buf.subarray(child.offset, child.end));
            }
            const newAMinf = _fish_makeBox('minf', concatArrays(aMinfParts));

            const aMdiaParts = [];
            for (const child of aMdiaChildren) {
                if (child.type === 'minf') aMdiaParts.push(newAMinf);
                else aMdiaParts.push(buf.subarray(child.offset, child.end));
            }
            const newAMdia = _fish_makeBox('mdia', concatArrays(aMdiaParts));

            const aTrakParts = [];
            for (const child of aTrakChildren) {
                if (child.type === 'tkhd') aTrakParts.push(rescaleTkhd(child));
                else if (child.type === 'edts') aTrakParts.push(rescaleEdts(child));
                else if (child.type === 'mdia') aTrakParts.push(newAMdia);
                else aTrakParts.push(buf.subarray(child.offset, child.end));
            }
            newATrak = _fish_makeBox('trak', concatArrays(aTrakParts));
        }

        const moovChildrenBoxes = [newMvhdBox, newVTrak];
        if (newATrak) moovChildrenBoxes.push(newATrak);

        // Retain original udta and ensure non-destructive ©cmt 'cutefish.my.id' comment is present
        const origUdta = moovChildren.find(b => b.type === 'udta');
        const origUdtaBytes = origUdta ? buf.subarray(origUdta.offset, origUdta.end) : null;
        moovChildrenBoxes.push(_fish_createCutefishUdtaBox(origUdtaBytes));

        moovBytes = _fish_makeBox('moov', concatArrays(moovChildrenBoxes));

        const updatedMdatStart = ftypBytes.byteLength + moovBytes.byteLength + 8;
        if (Math.abs(updatedMdatStart - newMdatContentStart) === 0 || iter === 2) {
            const finalMdatPayload = concatArrays([origMdatPayload, inMdatAnchor]);
            const newMdatBox = _fish_makeBox('mdat', finalMdatPayload);
            finalOutput = concatArrays([ftypBytes, moovBytes, newMdatBox]);
            break;
        }
    }

    log(`FISH patch applied (Ultimate Sentinel, +8 bytes overhead). Total size: ${finalOutput.byteLength} bytes.`);
    return finalOutput;
}

window.patchMp4Fish = _ss_patchMp4Fish;
window.patchMp4StreamShield = _ss_patchMp4Fish;

(window.TikTokMethods = window.TikTokMethods || {
    _items: [],
    register(m) {
        const i = this._items.findIndex(x => x.id === m.id);
        if (i >= 0) this._items[i] = m; else this._items.push(m);
        this._items.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
    }
}).register({
    id: 'fish',
    aliases: ['streamshield'],
    name: 'FISH',
    category: 'recommended',
    order: 1,
    supportsCompress: true,
    remuxFaststart: true,
    requiresUserscript: false,
    handlesOwn60FpsSlowmo: false,
    outputOptions: 'hd',
    descriptions: {
        id: {
            off: `
                [format] .mp4
                [mode] Direct Pass-Through
                [info] Menata ulang struktur atom MP4 secara instan dengan arsitektur Ultimate Clean Sentinel (murni 2-track, tanpa trailing bytes), menjaga resolusi serta kualitas video dan audio tetap 100% asli.
            `,
            '720p': `
                [format] .mp4
                [resolution] 720p
                [info] Mengompresi video ke 720p agar ukuran file lebih ringan, lalu menata ulang metadata MP4 dengan arsitektur Ultimate Sentinel.
            `,
            '1080p': `
                [format] .mp4
                [resolution] 1080p
                [info] Mengompresi video ke Full HD 1080p untuk menjaga ketajaman, lalu menata ulang metadata MP4 dengan arsitektur Ultimate Sentinel.
            `
        },
        en: {
            off: `
                [format] .mp4
                [mode] Direct Pass-Through
                [info] Instantly rearranges MP4 atom structure using Ultimate Clean Sentinel architecture (pure 2-track, zero trailing bytes), preserving 100% original video and audio quality.
            `,
            '720p': `
                [format] .mp4
                [resolution] 720p
                [info] Compresses video to 720p for lighter file size, then applies Ultimate Sentinel MP4 atom restructuring.
            `,
            '1080p': `
                [format] .mp4
                [resolution] 1080p
                [info] Compresses video to Full HD 1080p to preserve sharpness, then applies Ultimate Sentinel MP4 atom restructuring.
            `
        }
    },
    patch(buffer, ctx) {
        const log = (ctx && ctx.log) || (() => {});
        log('  Injecting Ultimate Sentinel synchronized 48k infinite header & clean in-mdat anchor...');
        const patchedBytes = _ss_patchMp4Fish(buffer, log);
        log('  FISH method successfully applied!');
        return patchedBytes;
    }
});

})();
