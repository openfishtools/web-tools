(function() {
'use strict';

/**
 * MPEG-TS Masquerade Method (mpts.js)
 *
 * Berdasarkan CompressBase 720p60 Method (terverifikasi SUCCESS 720p60 di
 * RawTik benchmark, 2026-11-10):
 *   ffmpeg -i input.mp4 -c copy -f mpegts output.mp4
 *
 * Cara kerja:
 * - Container MP4 (ISOBMFF moov/mdat) diganti menjadi MPEG-TS Transport Stream
 *   murni, TAPI file output tetap berekstensi .mp4.
 * - Form upload TikTok Studio menerima file (.mp4), ingest membaca video valid,
 *   namun demuxer rule ISOBMFF yang menghukum 60 FPS tidak terpicu.
 * - 100% lossless (-c copy), zero re-encode, kualitas & bitrate asli utuh.
 */
async function patchVideoMpegTs(buffer, ctx) {
    const s = (ctx && ctx._tktk) || window._tktk;
    const file = ctx && ctx.file;
    const mode = (ctx && ctx.mode) || 'off';
    const log = (ctx && ctx.log) || (s && s.log) || (() => {});
    const logSection = (ctx && ctx.logSection) || (s && s.logSection) || (() => {});
    const logEnd = (ctx && ctx.logEnd) || (s && s.logEnd) || (() => {});

    const isReady = await s.loadFFmpegLibraries();
    if (!isReady) {
        throw new Error('FFmpeg library failed to load. Please check your network connection and reload the page.');
    }
    const { toBlobURL } = window.FFmpegUtil;
    const ffmpeg = await s.loadFFmpegHelper(null, toBlobURL);
    let oomDetected = false;
    let oomLine = '';
    ffmpeg.on('progress', ({ progress }) => {
        const percent = Math.max(0, Math.min(100, Math.round(progress * 100)));
        if (s.progressFill) s.progressFill.style.width = `${percent}%`;
        if (s.progressPercent) s.progressPercent.textContent = `${percent}%`;
        const stMsg = `${window.getTranslation ? window.getTranslation('status_encoding') : 'Remuxing'}...`;
        if (s.statusText) s.statusText.innerHTML = `<span style="color: var(--md-sys-color-primary);">${stMsg}</span>`;
        if (window.ToolProgressManager && file) {
            window.ToolProgressManager.set('tool-tiktok-patcher', { isProcessing: true, percent, status: stMsg, file });
        }
    });
    ffmpeg.on('log', ({ message }) => {
        const lc = (message || '').toLowerCase();
        if (lc.includes('oom') || lc.includes('out of memory')) {
            oomDetected = true;
            oomLine = message;
        }
        if (typeof s.appendToLogsEl === 'function') s.appendToLogsEl(message);
    });

    logSection('FFmpeg MPEG-TS — Writing Input');
    const inputBytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    log(`  Buffer size : ${inputBytes.byteLength} bytes`);
    await ffmpeg.writeFile('input.mp4', inputBytes);
    log('  Write       : DONE');
    logEnd();

    logSection('FFmpeg MPEG-TS — Command');
    const command = [
        '-i', 'input.mp4',
        '-c', 'copy',
        '-f', 'mpegts',
        'output.mp4'
    ];
    if (s.logsEl) s.logsEl.textContent += `Executing command: ffmpeg ${command.join(' ')}\n`;
    log(`  Full command: ffmpeg ${command.join(' ')}`);
    logEnd();

    logSection('FFmpeg MPEG-TS — Remux');
    try {
        await ffmpeg.exec(command);
    } catch (execError) {
        try {
            const testData = await ffmpeg.readFile('output.mp4');
            if (!testData || testData.byteLength < 1024) throw execError;
        } catch (readError) {
            throw execError;
        }
    }
    logEnd();

    if (oomDetected) {
        log(`  OOM detected! Triggered by: ${oomLine}`);
        throw new Error(`Out of memory during video processing. (Triggered by log: "${oomLine}")`);
    }

    logSection('FFmpeg MPEG-TS — Output');
    const data = await ffmpeg.readFile('output.mp4');
    log(`  Output bytes : ${data ? data.byteLength : 0}`);
    log(`  Output size  : ${data ? (data.byteLength / (1024 * 1024)).toFixed(2) + ' MB' : 'EMPTY'}`);
    if (!data || data.byteLength < 1024) {
        log('  ERROR: Output too small or empty!');
        throw new Error('Processing failed (output is empty or too small).');
    }
    logEnd();

    // Memory hygiene: release WebAssembly FS buffers after read.
    try { await ffmpeg.deleteFile('input.mp4'); } catch (_) {}
    try { await ffmpeg.deleteFile('output.mp4'); } catch (_) {}

    return data;
}

(window.TikTokMethods = window.TikTokMethods || {
    _items: [],
    register(m) {
        const i = this._items.findIndex(x => x.id === m.id);
        if (i >= 0) this._items[i] = m; else this._items.push(m);
        this._items.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
    }
}).register({
    id: 'mpts',
    aliases: ['mpegts', 'ts', 'compressbase', 'v1'],
    name: 'MPEG-TS',
    category: 'backup',
    order: 2,
    supportsCompress: false,
    remuxFaststart: false,
    requiresUserscript: false,
    handlesOwn60FpsSlowmo: false,
    outputOptions: { suffix: 'hd', ext: 'mp4', mimeType: 'video/mp4' },
    descriptions: {
        id: {
            off: `
                [format] .mp4
                [codec] Stream Copy (H.264/AAC 1:1)
                [info] Membungkus stream video dan audio asli ke dalam MPEG Transport Stream tanpa encode ulang, dengan ekstensi .mp4 agar lolos verifikasi 60 FPS di TikTok tanpa pinalti transcode.
            `
        },
        en: {
            off: `
                [format] .mp4
                [codec] Stream Copy (H.264/AAC 1:1)
                [info] Wraps the original video and audio streams into an MPEG Transport Stream without re-encoding, keeping the .mp4 extension so 60 FPS passes TikTok verification without transcoding penalty.
            `
        }
    },
    patch: patchVideoMpegTs
});

})();
