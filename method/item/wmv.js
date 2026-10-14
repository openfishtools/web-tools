(function() {
'use strict';

async function patchVideoWMV(buffer, ctx) {
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
        const stMsg = `${window.getTranslation ? window.getTranslation('status_encoding') : 'Encoding'}...`;
        if (s.statusText) s.statusText.innerHTML = `<span style="color: var(--md-sys-color-primary);">${stMsg}</span>`;
        if (window.ToolProgressManager && file) {
            window.ToolProgressManager.set('tool-tiktok-patcher', { isProcessing: true, percent, status: stMsg, file });
        }
    });
    let warnRepeatCount = 0;
    ffmpeg.on('log', ({ message }) => {
        const lc = message.toLowerCase();
        if (lc.includes('oom') || lc.includes('out of memory')) {
            oomDetected = true;
            oomLine = message;
        }
        if (lc.includes('missing picture in access') || lc.includes('no frame!') || lc.includes('invalid data found when processing')) {
            warnRepeatCount++;
            if (warnRepeatCount % 100 !== 1) return;
        }
        if (typeof s.appendToLogsEl === 'function') s.appendToLogsEl(message);
    });

    logSection('FFmpeg WMV — Writing Input');
    const inputBytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    log(`  Buffer size : ${inputBytes.byteLength} bytes`);
    await ffmpeg.writeFile('input.mp4', inputBytes);
    log('  Write       : DONE');
    logEnd();

    const hardwareThreads = navigator.hardwareConcurrency || 4;
    const threads = Math.min(4, hardwareThreads).toString();
    logSection('FFmpeg WMV — Command');
    log(`  Hardware threads : ${hardwareThreads}`);
    log(`  Using threads    : ${threads}`);
    const maxDim = (mode === '720p') ? 720 : 1080;
    const command = [
        '-i', 'input.mp4',
        '-threads', threads,
        '-map_metadata', '-1',
        '-map_chapters', '-1',
        '-vf', `scale='if(lt(iw,ih),trunc(min(iw,${maxDim})/2)*2,-2)':'if(lt(iw,ih),-2,trunc(min(ih,${maxDim})/2)*2)'`,
        '-c:v', 'wmv2',
        '-qscale:v', '1',
        '-c:a', 'wmav2',
        '-b:a', '320k',
        'output.wmv'
    ];
    if (s.logsEl) s.logsEl.textContent += `Executing command: ffmpeg ${command.join(' ')}\n`;
    log(`  Full command: ffmpeg ${command.join(' ')}`);
    logEnd();

    logSection('FFmpeg WMV — Encoding');
    try {
        await ffmpeg.exec(command);
    } catch (execError) {
        try {
            const testData = await ffmpeg.readFile('output.wmv');
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

    logSection('FFmpeg WMV — Output');
    const data = await ffmpeg.readFile('output.wmv');
    log(`  Output bytes : ${data ? data.byteLength : 0}`);
    log(`  Output size  : ${data ? (data.byteLength / (1024 * 1024)).toFixed(2) + ' MB' : 'EMPTY'}`);
    if (!data || data.byteLength < 1024) {
        log('  ERROR: Output too small or empty!');
        throw new Error('Processing failed (output is empty or too small).');
    }
    logEnd();

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
    id: 'wmv',
    aliases: ['v1'],
    name: 'WMV',
    category: 'backup',
    order: 2,
    supportsCompress: false,
    remuxFaststart: false,
    requiresUserscript: false,
    handlesOwn60FpsSlowmo: false,
    outputOptions: { suffix: 'hd', ext: 'wmv', mimeType: 'video/x-ms-wmv' },
    descriptions: {
        id: {
            off: `
                [format] .wmv
                [codec] WMV2
                [info] Mengonversi video ke format Windows Media Video (.wmv) melalui penyandian ulang lossless.
            `
        },
        en: {
            off: `
                [format] .wmv
                [codec] WMV2
                [info] Converts video into Windows Media Video (.wmv) format via lossless re-encoding.
            `
        }
    },
    patch: patchVideoWMV
});

})();
