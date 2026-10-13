const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function getFfmpegPath() {
    try {
        const p = execSync('which ffmpeg').toString().trim();
        if (p) return p;
    } catch (_) {}
    return 'ffmpeg';
}

function getFfprobeMeta(filePath) {
    try {
        const cmd = `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate,duration,bit_rate -show_entries format=size,bit_rate -of json "${filePath}"`;
        const res = JSON.parse(execSync(cmd).toString());
        const stream = res.streams && res.streams[0] ? res.streams[0] : {};
        const format = res.format || {};
        
        let fps = 30;
        if (stream.r_frame_rate) {
            const parts = stream.r_frame_rate.split('/');
            fps = parts.length === 2 && Number(parts[1]) > 0 ? Math.round(Number(parts[0]) / Number(parts[1])) : Number(stream.r_frame_rate);
        }

        const size = Number(format.size || fs.statSync(filePath).size);
        const bitRate = Number(stream.bit_rate || format.bit_rate || 0);

        return {
            width: stream.width || 0,
            height: stream.height || 0,
            fps,
            duration: Number(stream.duration || format.duration || 0),
            size,
            sizeMb: (size / (1024 * 1024)).toFixed(2),
            bitrate: bitRate,
            bitrateMbps: (bitRate / 1000000).toFixed(2)
        };
    } catch (e) {
        return null;
    }
}

async function encodeVideo(inputFile, method, outputFile) {
    const ffmpeg = getFfmpegPath();

    if (method === 'passthrough') {
        fs.copyFileSync(inputFile, outputFile);
        console.log(`[Encode] passthrough: ${outputFile}`);
        return getFfprobeMeta(outputFile);
    }

    if (method === 'remux') {
        const cmd = `"${ffmpeg}" -y -i "${inputFile}" -c copy -map 0:v:0 -map "0:a:0?" -dn -map_metadata -1 -movflags +faststart "${outputFile}"`;
        execSync(cmd, { stdio: 'pipe' });
        console.log(`[Encode] remux: ${outputFile}`);
        return getFfprobeMeta(outputFile);
    }

    if (method === 'quicktime') {
        const cmd = `"${ffmpeg}" -y -i "${inputFile}" -c copy -map 0:v:0 -map "0:a:0?" -dn -map_metadata -1 -f mov -movflags +faststart "${outputFile}"`;
        execSync(cmd, { stdio: 'pipe' });
        console.log(`[Encode] quicktime: ${outputFile}`);
        return getFfprobeMeta(outputFile);
    }

    if (method === 'binary') {
        global.window = global;
        const p1 = path.join(__dirname, '../method/item/binarypatch.js');
        const p2 = path.join(__dirname, '../scripts/Tools/Method/binarypatch.js');
        if (fs.existsSync(p1)) require(p1);
        else if (fs.existsSync(p2)) require(p2);
        else throw new Error('binarypatch.js not found in method/item/');
        const inBuffer = fs.readFileSync(inputFile);
        const arrayBuf = inBuffer.buffer.slice(inBuffer.byteOffset, inBuffer.byteOffset + inBuffer.byteLength);
        const patched = global.window.patchMp4BinaryMethod(arrayBuf);
        fs.writeFileSync(outputFile, Buffer.from(patched));
        console.log(`[Encode] binary: ${outputFile}`);
        return getFfprobeMeta(outputFile);
    }

    if (method === 'stream-shield') {
        const { patchStreamShield } = require('./streamshield');
        patchStreamShield(inputFile, outputFile);
        console.log(`[Encode] stream-shield: ${outputFile}`);
        return getFfprobeMeta(outputFile);
    }

    if (method === 'fish-v2') {
        const { patchFishV2 } = require('./fishV2');
        patchFishV2(inputFile, outputFile);
        console.log(`[Encode] fish-v2: ${outputFile}`);
        return getFfprobeMeta(outputFile);
    }

    throw new Error(`Unknown method: ${method}`);
}

module.exports = {
    encodeVideo,
    getFfprobeMeta
};
