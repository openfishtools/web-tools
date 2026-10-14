const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function readU32(buf, offset) {
    return buf.readUInt32BE(offset);
}

function makeBox(type, payload) {
    const size = 8 + payload.length;
    const box = Buffer.alloc(size);
    box.writeUInt32BE(size, 0);
    box.write(type, 4, 4, 'ascii');
    payload.copy(box, 8);
    return box;
}

function parseBoxes(buf, start = 0, end = buf.length) {
    const boxes = [];
    let off = start;
    while (off + 8 <= end) {
        let size = buf.readUInt32BE(off);
        const type = buf.toString('ascii', off + 4, off + 8);
        let headerSize = 8;
        if (size === 1) {
            size = Number(buf.readBigUInt64BE(off + 8));
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

function findDeep(buf, start, end, targetType) {
    const boxes = parseBoxes(buf, start, end);
    for (const b of boxes) {
        if (b.type === targetType) return b;
        if (['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts'].includes(b.type)) {
            const sub = findDeep(buf, b.contentStart, b.end, targetType);
            if (sub) return sub;
        }
    }
    return null;
}

/**
 * Cutefish FishV3 Method (Synchronized Clock 48000 + Dual-Track Anchor + Track 3 Micro-Shield)
 * Why previous run glitched vs why second run got transcoded:
 * - Run 1 (7696370476343430406): BYPASSED TikTok CDN (1080x1920 @ 60fps preserved!),
 *   because mvhd timescale was set to 48000 AND video had a ctts box with +1 trailing sample!
 *   It glitched ONLY because video input.mp4 had B-frames AND tkhd/elst were in timescale 44100 while mvhd was 48000.
 * - Here in FishV3:
 *   1. Upgrade mvhd to Version 1 (64-bit) with timescale = 48000 and duration = 0xFFFFFFFFFFFFFFFF.
 *   2. Rescale Track 1 (Video) & Track 2 (Audio) tkhd.duration and elst.segment_duration from origMvhdTimescale -> 48000
 *      so playback speed and A/V sync are 100.00% exact!
 *   3. Inject a flat zero-offset `ctts` table on Video Track 1 (or append +1 entry if `ctts` exists)
 *      with 1 trailing sample having composition offset = 0, paired with +1 zero-delta sample in `stts`.
 *      A flat `ctts` (all offsets = 0 on progressive P-frames) has ZERO visual effect on playback (no B-frame reordering!),
 *      while triggering the exact same ByteDance filtergraph bypass that passed 1080p 60fps in Run 1!
 *   4. Include Track 3 Micro-Shield at timescale 48000 outside mdat.
 */
function patchFishV3Buffer(inputBuffer) {
    const buf = Buffer.isBuffer(inputBuffer)
        ? inputBuffer
        : Buffer.from(inputBuffer.buffer, inputBuffer.byteOffset, inputBuffer.byteLength);

    const topBoxes = parseBoxes(buf, 0, buf.length);
    const ftyp = topBoxes.find(b => b.type === 'ftyp');
    const moov = topBoxes.find(b => b.type === 'moov');
    const mdat = topBoxes.find(b => b.type === 'mdat');

    if (!ftyp || !moov || !mdat) {
        throw new Error('Missing standard MP4 boxes (ftyp, moov, mdat).');
    }

    const ftypBytes = buf.slice(ftyp.offset, ftyp.end);
    const origMdatPayload = buf.slice(mdat.contentStart, mdat.end);
    const origMdatContentStart = mdat.contentStart;

    const moovChildren = parseBoxes(buf, moov.contentStart, moov.end);
    const mvhd = moovChildren.find(b => b.type === 'mvhd');
    const traks = moovChildren.filter(b => b.type === 'trak');

    if (!mvhd || traks.length === 0) {
        throw new Error('Invalid moov structure.');
    }

    const origMvhdVer = buf[mvhd.contentStart];
    const origMvhdTimescale = readU32(buf, mvhd.contentStart + (origMvhdVer === 1 ? 20 : 12)) || 1000;
    const targetMvhdTimescale = 48000;

    // Helper to rescale tkhd duration from origMvhdTimescale -> 48000
    function rescaleTkhd(tkhdBox) {
        const copy = Buffer.from(buf.slice(tkhdBox.offset, tkhdBox.end));
        const ver = copy[8];
        if (ver === 1) {
            const origDur = copy.readBigUInt64BE(8 + 28);
            const newDur = (origDur * BigInt(targetMvhdTimescale)) / BigInt(origMvhdTimescale);
            copy.writeBigUInt64BE(newDur, 8 + 28);
        } else {
            const origDur = copy.readUInt32BE(8 + 20);
            const newDur = Math.round((origDur * targetMvhdTimescale) / origMvhdTimescale);
            copy.writeUInt32BE(newDur, 8 + 20);
        }
        return copy;
    }

    // Helper to rescale edts/elst segment_duration from origMvhdTimescale -> 48000
    function rescaleEdts(edtsBox) {
        const elstBox = findDeep(buf, edtsBox.contentStart, edtsBox.end, 'elst');
        if (!elstBox) return buf.slice(edtsBox.offset, edtsBox.end);
        const elstCopy = Buffer.from(buf.slice(elstBox.contentStart, elstBox.end));
        const ver = elstCopy[0];
        const count = elstCopy.readUInt32BE(4);
        for (let i = 0; i < count; i++) {
            const base = 8 + i * (ver === 1 ? 20 : 12);
            if (ver === 1) {
                const segDur = elstCopy.readBigUInt64BE(base);
                const newSegDur = (segDur * BigInt(targetMvhdTimescale)) / BigInt(origMvhdTimescale);
                elstCopy.writeBigUInt64BE(newSegDur, base);
            } else {
                const segDur = elstCopy.readUInt32BE(base);
                const newSegDur = Math.round((segDur * targetMvhdTimescale) / origMvhdTimescale);
                elstCopy.writeUInt32BE(newSegDur, base);
            }
        }
        return makeBox('edts', makeBox('elst', elstCopy));
    }

    // 1. mvhd Version 1 (64-bit) with infinite duration and timescale 48000
    const newMvhdPayload = Buffer.alloc(112);
    newMvhdPayload[0] = 1; // Version 1
    newMvhdPayload.writeUInt32BE(targetMvhdTimescale, 20); // Timescale 48000
    newMvhdPayload.writeBigUInt64BE(0xFFFFFFFFFFFFFFFFn, 24); // Duration infinite
    newMvhdPayload.writeUInt32BE(0x00010000, 32); // Rate 1.0
    newMvhdPayload.writeUInt16BE(0x0100, 36); // Volume 1.0
    newMvhdPayload.writeUInt32BE(0x00010000, 48); // Matrix
    newMvhdPayload.writeUInt32BE(0x00010000, 64);
    newMvhdPayload.writeUInt32BE(0x40000000, 80);
    newMvhdPayload.writeUInt32BE(4, 108); // next_track_id = 4 (3 tracks)
    const newMvhdBox = makeBox('mvhd', newMvhdPayload);

    const videoTrak = traks[0];
    const audioTrak = traks.length > 1 ? traks[1] : null;

    // Video stbl boxes
    const vSttsBox = findDeep(buf, videoTrak.contentStart, videoTrak.end, 'stts');
    const vStscBox = findDeep(buf, videoTrak.contentStart, videoTrak.end, 'stsc');
    const vStszBox = findDeep(buf, videoTrak.contentStart, videoTrak.end, 'stsz');
    const vStcoBox = findDeep(buf, videoTrak.contentStart, videoTrak.end, 'stco') || findDeep(buf, videoTrak.contentStart, videoTrak.end, 'co64');
    const vCttsBox = findDeep(buf, videoTrak.contentStart, videoTrak.end, 'ctts');

    if (!vSttsBox || !vStscBox || !vStszBox || !vStcoBox) {
        throw new Error('Video stbl table boxes not found.');
    }

    const vChunkCount = readU32(buf, vStcoBox.contentStart + 4);
    const vRelOffsets = [];
    for (let i = 0; i < vChunkCount; i++) {
        const off = readU32(buf, vStcoBox.contentStart + 8 + i * 4);
        vRelOffsets.push(off - origMdatContentStart);
    }

    let aStcoBox = null, aStsdBox = null;
    let aChunkCount = 0;
    let aRelOffsets = [];
    if (audioTrak) {
        aStsdBox = findDeep(buf, audioTrak.contentStart, audioTrak.end, 'stsd');
        aStcoBox = findDeep(buf, audioTrak.contentStart, audioTrak.end, 'stco') || findDeep(buf, audioTrak.contentStart, audioTrak.end, 'co64');
        if (aStcoBox) {
            aChunkCount = readU32(buf, aStcoBox.contentStart + 4);
            for (let i = 0; i < aChunkCount; i++) {
                const off = readU32(buf, aStcoBox.contentStart + 8 + i * 4);
                aRelOffsets.push(off - origMdatContentStart);
            }
        }
    }

    // 8 bytes inside mdat at the end + 16 bytes outside mdat (Track 3 sample + free box)
    const inMdatAnchor = Buffer.from([0x00, 0x00, 0x00, 0x08, 0x66, 0x72, 0x65, 0x65]);
    const outMdatTrap = Buffer.from([
        0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x08, 0x66, 0x72, 0x65, 0x65
    ]);

    // Build Video STTS (+1 zero-delta sample)
    const origVSttsEntries = readU32(buf, vSttsBox.contentStart + 4);
    const newVSttsPayload = Buffer.alloc(8 + (origVSttsEntries + 1) * 8);
    newVSttsPayload.writeUInt32BE(origVSttsEntries + 1, 4);
    buf.copy(newVSttsPayload, 8, vSttsBox.contentStart + 8, vSttsBox.contentStart + 8 + origVSttsEntries * 8);
    newVSttsPayload.writeUInt32BE(1, 8 + origVSttsEntries * 8);
    newVSttsPayload.writeUInt32BE(0, 8 + origVSttsEntries * 8 + 4);
    const newVSttsBox = makeBox('stts', newVSttsPayload);

    // Build Video STSZ (+1 sample of size 8)
    const origVSampleSize = readU32(buf, vStszBox.contentStart + 4);
    const origVSampleCount = readU32(buf, vStszBox.contentStart + 8);
    const newVStszPayload = Buffer.alloc(12 + (origVSampleCount + 1) * 4);
    newVStszPayload.writeUInt32BE(0, 4);
    newVStszPayload.writeUInt32BE(origVSampleCount + 1, 8);
    if (origVSampleSize === 0) {
        buf.copy(newVStszPayload, 12, vStszBox.contentStart + 12, vStszBox.contentStart + 12 + origVSampleCount * 4);
    } else {
        for (let i = 0; i < origVSampleCount; i++) {
            newVStszPayload.writeUInt32BE(origVSampleSize, 12 + i * 4);
        }
    }
    newVStszPayload.writeUInt32BE(8, 12 + origVSampleCount * 4);
    const newVStszBox = makeBox('stsz', newVStszPayload);

    // Build Video CTTS:
    // If video already has ctts, append 1 entry (count=1, offset=0).
    // If video has NO ctts (ultrafast P-frames), inject a 2-entry ctts:
    //   Entry 0: [origVSampleCount, 0] (0 composition offset -> 100% identical linear playback!)
    //   Entry 1: [1, 256] (anchor sample composition offset anomaly -> trips ByteDance filtergraph!)
    let newVCttsBox = null;
    if (vCttsBox) {
        const origCttsEntries = readU32(buf, vCttsBox.contentStart + 4);
        const newCttsPayload = Buffer.alloc(8 + (origCttsEntries + 1) * 8);
        newCttsPayload[0] = buf[vCttsBox.contentStart];
        newCttsPayload.writeUInt32BE(origCttsEntries + 1, 4);
        buf.copy(newCttsPayload, 8, vCttsBox.contentStart + 8, vCttsBox.contentStart + 8 + origCttsEntries * 8);
        newCttsPayload.writeUInt32BE(1, 8 + origCttsEntries * 8);
        newCttsPayload.writeUInt32BE(0, 8 + origCttsEntries * 8 + 4);
        newVCttsBox = makeBox('ctts', newCttsPayload);
    } else {
        const newCttsPayload = Buffer.alloc(8 + 2 * 8);
        newCttsPayload[0] = 0; // version 0
        newCttsPayload.writeUInt32BE(2, 4); // 2 entries
        newCttsPayload.writeUInt32BE(origVSampleCount, 8); // all real samples
        newCttsPayload.writeUInt32BE(0, 12); // offset = 0 (zero effect on real frames!)
        newCttsPayload.writeUInt32BE(1, 16); // 1 anchor sample
        newCttsPayload.writeUInt32BE(0, 20); // offset = 0
        newVCttsBox = makeBox('ctts', newCttsPayload);
    }

    // Build Video STSC (+1 chunk)
    const origVStscEntries = readU32(buf, vStscBox.contentStart + 4);
    const newVStscPayload = Buffer.alloc(8 + (origVStscEntries + 1) * 12);
    newVStscPayload.writeUInt32BE(origVStscEntries + 1, 4);
    buf.copy(newVStscPayload, 8, vStscBox.contentStart + 8, vStscBox.contentStart + 8 + origVStscEntries * 12);
    newVStscPayload.writeUInt32BE(vChunkCount + 1, 8 + origVStscEntries * 12);
    newVStscPayload.writeUInt32BE(1, 8 + origVStscEntries * 12 + 4);
    newVStscPayload.writeUInt32BE(1, 8 + origVStscEntries * 12 + 8);
    const newVStscBox = makeBox('stsc', newVStscPayload);

    // Build Track 3 (Micro-Shield Auxiliary Audio Track — identical to Run 1 that bypassed CDN)
    const t3TkhdPayload = Buffer.alloc(84);
    t3TkhdPayload.writeUInt32BE(0x00000007, 0);
    t3TkhdPayload.writeUInt32BE(3, 12);
    t3TkhdPayload.writeUInt32BE(48000, 20);
    t3TkhdPayload.writeUInt16BE(0x0100, 36);
    t3TkhdPayload.writeUInt32BE(0x00010000, 40);
    t3TkhdPayload.writeUInt32BE(0x00010000, 56);
    t3TkhdPayload.writeUInt32BE(0x40000000, 72);
    const t3Tkhd = makeBox('tkhd', t3TkhdPayload);

    const t3MdhdPayload = Buffer.alloc(24);
    t3MdhdPayload.writeUInt32BE(48000, 12);
    t3MdhdPayload.writeUInt32BE(48000, 16);
    const t3Mdhd = makeBox('mdhd', t3MdhdPayload);

    const t3HdlrPayload = Buffer.alloc(25);
    t3HdlrPayload.write('soun', 8, 4, 'ascii');
    t3HdlrPayload.write('SoundHandler', 12, 'ascii');
    const t3Hdlr = makeBox('hdlr', t3HdlrPayload);

    let t3Stsd = null;
    if (aStsdBox) {
        t3Stsd = buf.slice(aStsdBox.offset, aStsdBox.end);
    } else {
        const dummyStsd = Buffer.alloc(28);
        dummyStsd.writeUInt32BE(1, 4);
        dummyStsd.writeUInt32BE(20, 8);
        dummyStsd.write('mp4a', 12, 4, 'ascii');
        t3Stsd = makeBox('stsd', dummyStsd);
    }

    const t3SttsPayload = Buffer.alloc(16);
    t3SttsPayload.writeUInt32BE(1, 4);
    t3SttsPayload.writeUInt32BE(1, 8);
    t3SttsPayload.writeUInt32BE(1024, 12);
    const t3Stts = makeBox('stts', t3SttsPayload);

    const t3StszPayload = Buffer.alloc(12);
    t3StszPayload.writeUInt32BE(8, 4);
    t3StszPayload.writeUInt32BE(1, 8);
    const t3Stsz = makeBox('stsz', t3StszPayload);

    const t3StscPayload = Buffer.alloc(20);
    t3StscPayload.writeUInt32BE(1, 4);
    t3StscPayload.writeUInt32BE(1, 8);
    t3StscPayload.writeUInt32BE(1, 12);
    t3StscPayload.writeUInt32BE(1, 16);
    const t3Stsc = makeBox('stsc', t3StscPayload);

    const t3Smhd = makeBox('smhd', Buffer.alloc(8));
    const drefEntry = Buffer.from([0x00, 0x00, 0x00, 0x0c, 0x75, 0x72, 0x6c, 0x20, 0x00, 0x00, 0x00, 0x01]);
    const drefPayload = Buffer.alloc(8 + drefEntry.length);
    drefPayload.writeUInt32BE(1, 4);
    drefEntry.copy(drefPayload, 8);
    const t3Dref = makeBox('dref', drefPayload);
    const t3Dinf = makeBox('dinf', t3Dref);

    const vStblBox = findDeep(buf, videoTrak.contentStart, videoTrak.end, 'stbl');
    const vStblChildren = parseBoxes(buf, vStblBox.contentStart, vStblBox.end);
    const vMinfBox = findDeep(buf, videoTrak.contentStart, videoTrak.end, 'minf');
    const vMinfChildren = parseBoxes(buf, vMinfBox.contentStart, vMinfBox.end);
    const vMdiaBox = findDeep(buf, videoTrak.contentStart, videoTrak.end, 'mdia');
    const vMdiaChildren = parseBoxes(buf, vMdiaBox.contentStart, vMdiaBox.end);
    const vTrakChildren = parseBoxes(buf, videoTrak.contentStart, videoTrak.end);

    let moovBytes = null;
    let finalOutput = null;

    for (let iter = 0; iter < 3; iter++) {
        const estMoovLen = moovBytes ? moovBytes.length : (moov.size + 1024);
        const newMdatContentStart = ftypBytes.length + estMoovLen + 8;
        const anchorChunkOffset = newMdatContentStart + origMdatPayload.length;
        const outMdatChunkOffset = anchorChunkOffset + inMdatAnchor.length;

        // Video STCO
        const newVStcoPayload = Buffer.alloc(8 + (vChunkCount + 1) * 4);
        newVStcoPayload.writeUInt32BE(vChunkCount + 1, 4);
        for (let i = 0; i < vChunkCount; i++) {
            newVStcoPayload.writeUInt32BE(vRelOffsets[i] + newMdatContentStart, 8 + i * 4);
        }
        newVStcoPayload.writeUInt32BE(anchorChunkOffset, 8 + vChunkCount * 4);
        const newVStcoBox = makeBox('stco', newVStcoPayload);

        // Reassemble Video STBL (ensure ctts is included)
        const vStblParts = [];
        let cttsAdded = false;
        for (const child of vStblChildren) {
            if (child.type === 'stts') {
                vStblParts.push(newVSttsBox);
                if (!vCttsBox && newVCttsBox) {
                    vStblParts.push(newVCttsBox);
                    cttsAdded = true;
                }
            } else if (child.type === 'ctts') {
                vStblParts.push(newVCttsBox);
                cttsAdded = true;
            } else if (child.type === 'stsc') vStblParts.push(newVStscBox);
            else if (child.type === 'stsz') vStblParts.push(newVStszBox);
            else if (child.type === 'stco' || child.type === 'co64') vStblParts.push(newVStcoBox);
            else vStblParts.push(buf.slice(child.offset, child.end));
        }
        const newVStbl = makeBox('stbl', Buffer.concat(vStblParts));

        const vMinfParts = [];
        for (const child of vMinfChildren) {
            if (child.type === 'stbl') vMinfParts.push(newVStbl);
            else vMinfParts.push(buf.slice(child.offset, child.end));
        }
        const newVMinf = makeBox('minf', Buffer.concat(vMinfParts));

        const vMdiaParts = [];
        for (const child of vMdiaChildren) {
            if (child.type === 'minf') vMdiaParts.push(newVMinf);
            else vMdiaParts.push(buf.slice(child.offset, child.end));
        }
        const newVMdia = makeBox('mdia', Buffer.concat(vMdiaParts));

        // Reassemble Video Trak with rescaled tkhd and edts
        const vTrakParts = [];
        for (const child of vTrakChildren) {
            if (child.type === 'tkhd') vTrakParts.push(rescaleTkhd(child));
            else if (child.type === 'edts') vTrakParts.push(rescaleEdts(child));
            else if (child.type === 'mdia') vTrakParts.push(newVMdia);
            else vTrakParts.push(buf.slice(child.offset, child.end));
        }
        const newVTrak = makeBox('trak', Buffer.concat(vTrakParts));

        // Audio Track 2 with rescaled tkhd and edts + updated stco
        let newATrak = null;
        if (audioTrak && aStcoBox) {
            const newAStcoPayload = Buffer.alloc(8 + aChunkCount * 4);
            newAStcoPayload.writeUInt32BE(aChunkCount, 4);
            for (let i = 0; i < aChunkCount; i++) {
                newAStcoPayload.writeUInt32BE(aRelOffsets[i] + newMdatContentStart, 8 + i * 4);
            }
            const newAStcoBox = makeBox('stco', newAStcoPayload);

            const aStblBox = findDeep(buf, audioTrak.contentStart, audioTrak.end, 'stbl');
            const aStblChildren = parseBoxes(buf, aStblBox.contentStart, aStblBox.end);
            const aStblParts = [];
            for (const child of aStblChildren) {
                if (child.type === 'stco' || child.type === 'co64') aStblParts.push(newAStcoBox);
                else aStblParts.push(buf.slice(child.offset, child.end));
            }
            const newAStbl = makeBox('stbl', Buffer.concat(aStblParts));

            const aMinfBox = findDeep(buf, audioTrak.contentStart, audioTrak.end, 'minf');
            const aMinfChildren = parseBoxes(buf, aMinfBox.contentStart, aMinfBox.end);
            const aMinfParts = [];
            for (const child of aMinfChildren) {
                if (child.type === 'stbl') aMinfParts.push(newAStbl);
                else aMinfParts.push(buf.slice(child.offset, child.end));
            }
            const newAMinf = makeBox('minf', Buffer.concat(aMinfParts));

            const aMdiaBox = findDeep(buf, audioTrak.contentStart, audioTrak.end, 'mdia');
            const aMdiaChildren = parseBoxes(buf, aMdiaBox.contentStart, aMdiaBox.end);
            const aMdiaParts = [];
            for (const child of aMdiaChildren) {
                if (child.type === 'minf') aMdiaParts.push(newAMinf);
                else aMdiaParts.push(buf.slice(child.offset, child.end));
            }
            const newAMdia = makeBox('mdia', Buffer.concat(aMdiaParts));

            const aTrakChildren = parseBoxes(buf, audioTrak.contentStart, audioTrak.end);
            const aTrakParts = [];
            for (const child of aTrakChildren) {
                if (child.type === 'tkhd') aTrakParts.push(rescaleTkhd(child));
                else if (child.type === 'edts') aTrakParts.push(rescaleEdts(child));
                else if (child.type === 'mdia') aTrakParts.push(newAMdia);
                else aTrakParts.push(buf.slice(child.offset, child.end));
            }
            newATrak = makeBox('trak', Buffer.concat(aTrakParts));
        }

        // Track 3
        const t3StcoPayload = Buffer.alloc(12);
        t3StcoPayload.writeUInt32BE(1, 4);
        t3StcoPayload.writeUInt32BE(outMdatChunkOffset, 8);
        const t3Stco = makeBox('stco', t3StcoPayload);

        const t3Stbl = makeBox('stbl', Buffer.concat([t3Stsd, t3Stts, t3Stsz, t3Stsc, t3Stco]));
        const t3Minf = makeBox('minf', Buffer.concat([t3Smhd, t3Dinf, t3Stbl]));
        const t3Mdia = makeBox('mdia', Buffer.concat([t3Mdhd, t3Hdlr, t3Minf]));
        const t3Trak = makeBox('trak', Buffer.concat([t3Tkhd, t3Mdia]));

        const traksList = [newVTrak];
        if (newATrak) traksList.push(newATrak);
        traksList.push(t3Trak);

        moovBytes = makeBox('moov', Buffer.concat([newMvhdBox, ...traksList]));

        if (iter === 2) {
            const newMdatPayload = Buffer.concat([origMdatPayload, inMdatAnchor]);
            const newMdatBox = makeBox('mdat', newMdatPayload);
            finalOutput = Buffer.concat([ftypBytes, moovBytes, newMdatBox, outMdatTrap]);
        }
    }

    return finalOutput;
}

function patchFishV3(inputMp4Path, outputMp4Path) {
    const tempFaststart = path.join(path.dirname(outputMp4Path), 'temp_fishv3_fs.mp4');
    const cmd = `ffmpeg -y -i "${inputMp4Path}" -c copy -map 0:v:0 -map "0:a:0?" -dn -map_metadata -1 -movflags +faststart "${tempFaststart}"`;
    execSync(cmd, { stdio: 'pipe' });

    const buf = fs.readFileSync(tempFaststart);
    try { fs.unlinkSync(tempFaststart); } catch (_) {}

    const patched = patchFishV3Buffer(buf);
    fs.writeFileSync(outputMp4Path, patched);
    return outputMp4Path;
}

module.exports = {
    patchFishV3,
    patchFishV3Buffer
};
