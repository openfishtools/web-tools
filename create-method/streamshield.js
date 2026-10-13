/**
 * Cutefish StreamShield Method
 * Injects 64-bit V1 mvhd infinite duration and a 16-byte micro-shield trap (Track 3).
 * Preserves original Video (Track 1) and Audio (Track 2) 100% losslessly.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function readU32(buf, offset) {
    return (buf[offset] << 24 | buf[offset + 1] << 16 | buf[offset + 2] << 8 | buf[offset + 3]) >>> 0;
}

function makeBox(type, payload) {
    const size = 8 + payload.length;
    const box = Buffer.alloc(size);
    box.writeUInt32BE(size, 0);
    box.write(type, 4, 4, 'ascii');
    payload.copy(box, 8);
    return box;
}

function parseBoxes(buf, start, end) {
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

/**
 * Patches a faststarted MP4 buffer in memory with Cutefish StreamShield architecture.
 * @param {Buffer|Uint8Array} inputBuffer
 * @returns {Buffer} Patched MP4 bytes
 */
function patchStreamShieldBuffer(inputBuffer) {
    const buf = Buffer.isBuffer(inputBuffer) ? inputBuffer : Buffer.from(inputBuffer.buffer, inputBuffer.byteOffset, inputBuffer.byteLength);

    const topBoxes = parseBoxes(buf, 0, buf.length);
    const ftyp = topBoxes.find(b => b.type === 'ftyp');
    const moov = topBoxes.find(b => b.type === 'moov');
    const mdat = topBoxes.find(b => b.type === 'mdat');

    if (!ftyp || !moov || !mdat) {
        throw new Error('Missing standard MP4 boxes (ftyp, moov, mdat). Faststart container required.');
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

    // 1. mvhd Version 1 (64-bit) with infinite duration
    const newMvhdPayload = Buffer.alloc(112);
    newMvhdPayload[0] = 1;
    newMvhdPayload.writeUInt32BE(1000, 20); // timescale 1000
    newMvhdPayload.writeBigUInt64BE(0xFFFFFFFFFFFFFFFFn, 24); // duration infinite
    newMvhdPayload.writeUInt32BE(0x00010000, 32);
    newMvhdPayload.writeUInt16BE(0x0100, 36);
    newMvhdPayload.writeUInt32BE(0x00010000, 48);
    newMvhdPayload.writeUInt32BE(0x00010000, 64);
    newMvhdPayload.writeUInt32BE(0x40000000, 80);
    newMvhdPayload.writeUInt32BE(4, 108); // next_track_id = 4
    const newMvhdBox = makeBox('mvhd', newMvhdPayload);

    // 2. Extract Video & Audio tracks and chunk offsets
    const videoTrak = traks[0];
    const audioTrak = traks.length > 1 ? traks[1] : null;

    function findDeep(startOffset, endOffset, targetType) {
        const boxes = parseBoxes(buf, startOffset, endOffset);
        for (const b of boxes) {
            if (b.type === targetType) return b;
            if (['trak', 'mdia', 'minf', 'stbl'].includes(b.type)) {
                const sub = findDeep(b.contentStart, b.end, targetType);
                if (sub) return sub;
            }
        }
        return null;
    }

    const vStcoBox = findDeep(videoTrak.contentStart, videoTrak.end, 'stco') || findDeep(videoTrak.contentStart, videoTrak.end, 'co64');
    const aStcoBox = audioTrak ? (findDeep(audioTrak.contentStart, audioTrak.end, 'stco') || findDeep(audioTrak.contentStart, audioTrak.end, 'co64')) : null;

    if (!vStcoBox) throw new Error('Video stco box not found');

    const vChunkCount = readU32(buf, vStcoBox.contentStart + 4);
    const vRelOffsets = [];
    for (let i = 0; i < vChunkCount; i++) {
        const off = readU32(buf, vStcoBox.contentStart + 8 + i * 4);
        vRelOffsets.push(off - origMdatContentStart);
    }

    let aRelOffsets = [];
    if (aStcoBox) {
        const aChunkCount = readU32(buf, aStcoBox.contentStart + 4);
        for (let i = 0; i < aChunkCount; i++) {
            const off = readU32(buf, aStcoBox.contentStart + 8 + i * 4);
            aRelOffsets.push(off - origMdatContentStart);
        }
    }

    // 3. Build Micro-Shield Track 3
    const trapPayload = Buffer.from([
        0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x00, // 8 bytes dummy sample
        0x00, 0x00, 0x00, 0x08, 0x66, 0x72, 0x65, 0x65  // 8 bytes free box
    ]);

    const t3TkhdPayload = Buffer.alloc(84);
    t3TkhdPayload.writeUInt32BE(0x00000007, 0);
    t3TkhdPayload.writeUInt32BE(3, 12);
    t3TkhdPayload.writeUInt32BE(1000, 20);
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
    t3HdlrPayload.write('StreamShield', 24, 'ascii');
    const t3Hdlr = makeBox('hdlr', t3HdlrPayload);

    let t3Stsd = null;
    const aStsdBox = audioTrak ? findDeep(audioTrak.contentStart, audioTrak.end, 'stsd') : null;
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

    // 4. Assemble and iterate offsets
    const vTrakBytes = buf.slice(videoTrak.offset, videoTrak.end);
    const aTrakBytes = audioTrak ? buf.slice(audioTrak.offset, audioTrak.end) : null;

    let moovBytes = null;
    let finalOutput = null;

    for (let iter = 0; iter < 3; iter++) {
        const estMoovLen = moovBytes ? moovBytes.length : (moov.size + 1024);
        const newMdatContentStart = ftypBytes.length + estMoovLen + 8;
        const fakeChunkOffset = newMdatContentStart + origMdatPayload.length;

        const t3StcoPayload = Buffer.alloc(12);
        t3StcoPayload.writeUInt32BE(1, 4);
        t3StcoPayload.writeUInt32BE(fakeChunkOffset, 8);
        const t3Stco = makeBox('stco', t3StcoPayload);

        const t3Stbl = makeBox('stbl', Buffer.concat([t3Stsd, t3Stts, t3Stsz, t3Stsc, t3Stco]));
        const t3Minf = makeBox('minf', Buffer.concat([t3Smhd, t3Dinf, t3Stbl]));
        const t3Mdia = makeBox('mdia', Buffer.concat([t3Mdhd, t3Hdlr, t3Minf]));
        const t3Trak = makeBox('trak', Buffer.concat([t3Tkhd, t3Mdia]));

        const vStcoRel = vStcoBox.offset - videoTrak.offset;
        const vNewTrak = Buffer.from(vTrakBytes);
        for (let i = 0; i < vChunkCount; i++) {
            vNewTrak.writeUInt32BE(vRelOffsets[i] + newMdatContentStart, vStcoRel + 16 + i * 4);
        }

        let aNewTrak = null;
        if (audioTrak && aTrakBytes) {
            const aStcoRel = aStcoBox.offset - audioTrak.offset;
            aNewTrak = Buffer.from(aTrakBytes);
            for (let i = 0; i < aRelOffsets.length; i++) {
                aNewTrak.writeUInt32BE(aRelOffsets[i] + newMdatContentStart, aStcoRel + 16 + i * 4);
            }
        }

        const trakList = [vNewTrak];
        if (aNewTrak) trakList.push(aNewTrak);
        trakList.push(t3Trak);

        moovBytes = makeBox('moov', Buffer.concat([newMvhdBox, ...trakList]));

        if (iter === 2) {
            const newMdatBox = makeBox('mdat', origMdatPayload);
            finalOutput = Buffer.concat([ftypBytes, moovBytes, newMdatBox, trapPayload]);
        }
    }

    return finalOutput;
}

function patchStreamShield(inputMp4Path, outputMp4Path) {
    const tempFaststart = path.join(path.dirname(outputMp4Path), 'temp_shield_fs.mp4');
    const cmd = `ffmpeg -y -i "${inputMp4Path}" -c copy -map 0:v:0 -map "0:a:0?" -dn -map_metadata -1 -movflags +faststart "${tempFaststart}"`;
    execSync(cmd, { stdio: 'pipe' });

    const buf = fs.readFileSync(tempFaststart);
    try { fs.unlinkSync(tempFaststart); } catch (_) {}

    const patched = patchStreamShieldBuffer(buf);
    fs.writeFileSync(outputMp4Path, patched);
    return outputMp4Path;
}

module.exports = {
    patchStreamShield,
    patchStreamShieldBuffer
};
