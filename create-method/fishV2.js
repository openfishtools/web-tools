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
        if (['moov', 'trak', 'mdia', 'minf', 'stbl'].includes(b.type)) {
            const sub = findDeep(buf, b.contentStart, b.end, targetType);
            if (sub) return sub;
        }
    }
    return null;
}

/**
 * Cutefish FishV2 Method (Dual-Anchor Time-Trap)
 * 1. Strict 2-Track Container (Video Track 1 + Audio Track 2).
 * 2. 64-bit V1 mvhd infinite duration with audio timescale (48000).
 * 3. In-track zero-delta video sample anchor (stts + stsz + stsc + stco) without Track 3.
 * 4. Ultra-clean overhead (+24 bytes).
 */
function patchFishV2(inputMp4Path, outputMp4Path) {
    const tempFaststart = path.join(path.dirname(outputMp4Path), 'temp_fishv2_fs.mp4');
    const cmd = `ffmpeg -y -i "${inputMp4Path}" -c copy -map 0:v:0 -map "0:a:0?" -dn -map_metadata -1 -movflags +faststart "${tempFaststart}"`;
    execSync(cmd, { stdio: 'pipe' });

    const buf = fs.readFileSync(tempFaststart);
    try { fs.unlinkSync(tempFaststart); } catch (_) {}

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

    // 1. mvhd Version 1 (64-bit) with infinite duration and audio timescale 48000
    const newMvhdPayload = Buffer.alloc(112);
    newMvhdPayload[0] = 1; // Version 1
    newMvhdPayload.writeUInt32BE(48000, 20); // Timescale 48000
    newMvhdPayload.writeBigUInt64BE(0xFFFFFFFFFFFFFFFFn, 24); // Duration infinite
    newMvhdPayload.writeUInt32BE(0x00010000, 32); // Rate 1.0
    newMvhdPayload.writeUInt16BE(0x0100, 36); // Volume 1.0
    newMvhdPayload.writeUInt32BE(0x00010000, 48); // Matrix
    newMvhdPayload.writeUInt32BE(0x00010000, 64);
    newMvhdPayload.writeUInt32BE(0x40000000, 80);
    newMvhdPayload.writeUInt32BE(3, 108); // next_track_id = 3 (strictly 2 tracks)
    const newMvhdBox = makeBox('mvhd', newMvhdPayload);

    // 2. Video & Audio tracks
    const videoTrak = traks[0];
    const audioTrak = traks.length > 1 ? traks[1] : null;

    // Video stbl boxes
    const vSttsBox = findDeep(buf, videoTrak.contentStart, videoTrak.end, 'stts');
    const vStscBox = findDeep(buf, videoTrak.contentStart, videoTrak.end, 'stsc');
    const vStszBox = findDeep(buf, videoTrak.contentStart, videoTrak.end, 'stsz');
    const vStcoBox = findDeep(buf, videoTrak.contentStart, videoTrak.end, 'stco') || findDeep(buf, videoTrak.contentStart, videoTrak.end, 'co64');
    const aStcoBox = audioTrak ? (findDeep(buf, audioTrak.contentStart, audioTrak.end, 'stco') || findDeep(buf, audioTrak.contentStart, audioTrak.end, 'co64')) : null;

    if (!vSttsBox || !vStscBox || !vStszBox || !vStcoBox) {
        throw new Error('Video stbl table boxes not found.');
    }

    // Video original offsets
    const vChunkCount = readU32(buf, vStcoBox.contentStart + 4);
    const vRelOffsets = [];
    for (let i = 0; i < vChunkCount; i++) {
        const off = readU32(buf, vStcoBox.contentStart + 8 + i * 4);
        vRelOffsets.push(off - origMdatContentStart);
    }

    // Audio original offsets
    let aRelOffsets = [];
    if (aStcoBox) {
        const aChunkCount = readU32(buf, aStcoBox.contentStart + 4);
        for (let i = 0; i < aChunkCount; i++) {
            const off = readU32(buf, aStcoBox.contentStart + 8 + i * 4);
            aRelOffsets.push(off - origMdatContentStart);
        }
    }

    // 3. Anchor Payload: 8 bytes clean free marker appended to mdat
    const anchorPayload = Buffer.from([0x00, 0x00, 0x00, 0x08, 0x66, 0x72, 0x65, 0x65]);

    // Build new Video STTS with +1 zero-delta sample
    const origSttsEntries = readU32(buf, vSttsBox.contentStart + 4);
    const newSttsPayload = Buffer.alloc(8 + (origSttsEntries + 1) * 8);
    newSttsPayload.writeUInt32BE(origSttsEntries + 1, 4);
    buf.copy(newSttsPayload, 8, vSttsBox.contentStart + 8, vSttsBox.contentStart + 8 + origSttsEntries * 8);
    // Add trailing zero-delta entry
    newSttsPayload.writeUInt32BE(1, 8 + origSttsEntries * 8); // 1 sample
    newSttsPayload.writeUInt32BE(0, 8 + origSttsEntries * 8 + 4); // delta = 0
    const newSttsBox = makeBox('stts', newSttsPayload);

    // Build new Video STSZ with +1 sample of size 8
    const origSampleSize = readU32(buf, vStszBox.contentStart + 4);
    const origSampleCount = readU32(buf, vStszBox.contentStart + 8);
    let newStszBox;
    if (origSampleSize === 0) {
        const newStszPayload = Buffer.alloc(12 + (origSampleCount + 1) * 4);
        newStszPayload.writeUInt32BE(0, 4); // sample_size = 0 (variable)
        newStszPayload.writeUInt32BE(origSampleCount + 1, 8); // count + 1
        buf.copy(newStszPayload, 12, vStszBox.contentStart + 12, vStszBox.contentStart + 12 + origSampleCount * 4);
        newStszPayload.writeUInt32BE(8, 12 + origSampleCount * 4); // size = 8 bytes
        newStszBox = makeBox('stsz', newStszPayload);
    } else {
        const newStszPayload = Buffer.alloc(12 + (origSampleCount + 1) * 4);
        newStszPayload.writeUInt32BE(0, 4);
        newStszPayload.writeUInt32BE(origSampleCount + 1, 8);
        for (let i = 0; i < origSampleCount; i++) {
            newStszPayload.writeUInt32BE(origSampleSize, 12 + i * 4);
        }
        newStszPayload.writeUInt32BE(8, 12 + origSampleCount * 4);
        newStszBox = makeBox('stsz', newStszPayload);
    }

    // Build new Video STSC mapping the anchor chunk (chunk ID = vChunkCount + 1)
    const origStscEntries = readU32(buf, vStscBox.contentStart + 4);
    const newStscPayload = Buffer.alloc(8 + (origStscEntries + 1) * 12);
    newStscPayload.writeUInt32BE(origStscEntries + 1, 4);
    buf.copy(newStscPayload, 8, vStscBox.contentStart + 8, vStscBox.contentStart + 8 + origStscEntries * 12);
    // Add entry for the anchor chunk
    newStscPayload.writeUInt32BE(vChunkCount + 1, 8 + origStscEntries * 12); // first_chunk
    newStscPayload.writeUInt32BE(1, 8 + origStscEntries * 12 + 4); // samples_per_chunk = 1
    newStscPayload.writeUInt32BE(1, 8 + origStscEntries * 12 + 8); // sample_description_index = 1
    const newStscBox = makeBox('stsc', newStscPayload);

    // Video STBL reconstruction helper (replace stts, stsc, stsz with new boxes)
    const vStblBox = findDeep(buf, videoTrak.contentStart, videoTrak.end, 'stbl');
    const vStblChildren = parseBoxes(buf, vStblBox.contentStart, vStblBox.end);

    // Audio unchanged track bytes
    const aTrakBytes = audioTrak ? buf.slice(audioTrak.offset, audioTrak.end) : null;

    let moovBytes = null;
    let finalOutput = null;

    // Iteratively resolve chunk offsets
    for (let iter = 0; iter < 3; iter++) {
        const estMoovLen = moovBytes ? moovBytes.length : (moov.size + 512);
        const newMdatContentStart = ftypBytes.length + estMoovLen + 8;
        const anchorChunkOffset = newMdatContentStart + origMdatPayload.length;

        // Build new Video STCO
        const newStcoPayload = Buffer.alloc(8 + (vChunkCount + 1) * 4);
        newStcoPayload.writeUInt32BE(vChunkCount + 1, 4);
        for (let i = 0; i < vChunkCount; i++) {
            newStcoPayload.writeUInt32BE(vRelOffsets[i] + newMdatContentStart, 8 + i * 4);
        }
        // Last chunk is the anchor
        newStcoPayload.writeUInt32BE(anchorChunkOffset, 8 + vChunkCount * 4);
        const newStcoBox = makeBox('stco', newStcoPayload);

        // Reassemble stbl
        const stblParts = [];
        for (const child of vStblChildren) {
            if (child.type === 'stts') stblParts.push(newSttsBox);
            else if (child.type === 'stsc') stblParts.push(newStscBox);
            else if (child.type === 'stsz') stblParts.push(newStszBox);
            else if (child.type === 'stco') stblParts.push(newStcoBox);
            else stblParts.push(buf.slice(child.offset, child.end));
        }
        const newStbl = makeBox('stbl', Buffer.concat(stblParts));

        // Reassemble minf
        const vMinfBox = findDeep(buf, videoTrak.contentStart, videoTrak.end, 'minf');
        const vMinfChildren = parseBoxes(buf, vMinfBox.contentStart, vMinfBox.end);
        const minfParts = [];
        for (const child of vMinfChildren) {
            if (child.type === 'stbl') minfParts.push(newStbl);
            else minfParts.push(buf.slice(child.offset, child.end));
        }
        const newMinf = makeBox('minf', Buffer.concat(minfParts));

        // Reassemble mdia
        const vMdiaBox = findDeep(buf, videoTrak.contentStart, videoTrak.end, 'mdia');
        const vMdiaChildren = parseBoxes(buf, vMdiaBox.contentStart, vMdiaBox.end);
        const mdiaParts = [];
        for (const child of vMdiaChildren) {
            if (child.type === 'minf') mdiaParts.push(newMinf);
            else mdiaParts.push(buf.slice(child.offset, child.end));
        }
        const newMdia = makeBox('mdia', Buffer.concat(mdiaParts));

        // Reassemble trak
        const vTrakChildren = parseBoxes(buf, videoTrak.contentStart, videoTrak.end);
        const trakParts = [];
        for (const child of vTrakChildren) {
            if (child.type === 'mdia') trakParts.push(newMdia);
            else trakParts.push(buf.slice(child.offset, child.end));
        }
        const newVTrak = makeBox('trak', Buffer.concat(trakParts));

        // Rebuild Audio Track offsets
        let newATrak = null;
        if (audioTrak && aTrakBytes) {
            const aStcoRel = aStcoBox.offset - audioTrak.offset;
            newATrak = Buffer.from(aTrakBytes);
            for (let i = 0; i < aRelOffsets.length; i++) {
                newATrak.writeUInt32BE(aRelOffsets[i] + newMdatContentStart, aStcoRel + 8 + 4 + i * 4);
            }
        }

        const traksList = [newVTrak];
        if (newATrak) traksList.push(newATrak);

        moovBytes = makeBox('moov', Buffer.concat([newMvhdBox, ...traksList]));

        if (iter === 2) {
            const newMdatPayload = Buffer.concat([origMdatPayload, anchorPayload]);
            const newMdatBox = makeBox('mdat', newMdatPayload);
            finalOutput = Buffer.concat([ftypBytes, moovBytes, newMdatBox]);
        }
    }

    fs.writeFileSync(outputMp4Path, finalOutput);
    return outputMp4Path;
}

module.exports = {
    patchFishV2
};
