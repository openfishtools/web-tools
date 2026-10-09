window.processVideoV1 = async function processVideoV1(file, mode) {
    if (mode === undefined) mode = 'off';
    const s = window._tktk;
    s.isProcessing = true;
    if (s.btnStart) s.btnStart.disabled = true;
    if (s.progressContainer) s.progressContainer.classList.remove('hidden');
    if (s.logsContainer) s.logsContainer.classList.remove('hidden');
    const dlBtn = document.getElementById('tool-download-btn');
    if (dlBtn) dlBtn.classList.add('hidden');
    s.statusText.innerHTML = `<span style="color: var(--md-sys-color-primary);">${window.getTranslation('status_loading_engine')}</span>`;
    s.progressFill.style.width = '0%';
    s.progressPercent.textContent = '0%';
    s.progressText.textContent = window.getTranslation('status_processing');
    s.logSection('WMV PROCESS START');
    s.log(`  File : ${file.name}`);
    s.log(`  Mode : WMV lossless re-encode (${mode.toUpperCase()})`);
    s.logEnd();
    try {
        if (typeof window.isEmergencyFpsNeeded === 'function' && window.isEmergencyFpsNeeded(s.currentFileBuffer)) {
            s.log(`  [Emergency FPS] Video > 60fps terdeteksi. Menerapkan patch 60fps slowmo...`);
            try {
                const emOut = window.patchEmergencyFpsMethod(s.currentFileBuffer, s.log);
                s.currentFileBuffer = (emOut && emOut.buffer) ? emOut.buffer : emOut;
            } catch (emErr) {
                s.log(`  [Notice] Emergency FPS patch error: ${emErr.message}`);
            }
        }

        const isReady = await s.loadFFmpegLibraries();
        if (!isReady) {
            throw new Error('FFmpeg library failed to load. Please check your network connection and reload the page.');
        }
        const { toBlobURL } = window.FFmpegUtil;
        let ffmpeg = await s.loadFFmpegHelper(null, toBlobURL);
        let oomDetected = false;
        let oomLine = '';
        ffmpeg.on('progress', ({ progress }) => {
            const percent = Math.max(0, Math.min(100, Math.round(progress * 100)));
            s.progressFill.style.width = `${percent}%`;
            s.progressPercent.textContent = `${percent}%`;
            const stMsg = `${window.getTranslation('status_encoding')}...`;
            s.statusText.innerHTML = `<span style="color: var(--md-sys-color-primary);">${stMsg}</span>`;
            if (window.ToolProgressManager) {
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
            s.appendToLogsEl(message);
        });
        s.logSection('FFmpeg V1 — Writing Input');
        s.log(`  Buffer size : ${s.currentFileBuffer.byteLength} bytes`);
        await ffmpeg.writeFile('input.mp4', new Uint8Array(s.currentFileBuffer));
        s.log(`  Write       : DONE`);
        s.logEnd();
        const hardwareThreads = navigator.hardwareConcurrency || 4;
        const threads = Math.min(4, hardwareThreads).toString();
        s.logSection('FFmpeg V1 — Command');
        s.log(`  Hardware threads : ${hardwareThreads}`);
        s.log(`  Using threads    : ${threads}`);
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
        s.logsEl.textContent += `Executing command: ffmpeg ${command.join(' ')}\n`;
        s.log(`  Full command: ffmpeg ${command.join(' ')}`);
        s.logEnd();
        s.logSection('FFmpeg V1 — Encoding');
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
        s.logEnd();
        if (oomDetected) {
            s.log(`  OOM detected! Triggered by: ${oomLine}`);
            throw new Error(`Out of memory during video processing. (Triggered by log: "${oomLine}")`);
        }
        s.logSection('FFmpeg V1 — Output');
        s.statusText.innerHTML = `<span style="color: var(--md-sys-color-primary);">${window.getTranslation('status_finalizing')}</span>`;
        if (window.ToolProgressManager) {
            window.ToolProgressManager.set('tool-tiktok-patcher', { isProcessing: true, percent: 99, status: window.getTranslation('status_finalizing'), file });
        }
        const data = await ffmpeg.readFile('output.wmv');
        s.log(`  Output bytes : ${data ? data.byteLength : 0}`);
        s.log(`  Output size  : ${data ? (data.byteLength / (1024 * 1024)).toFixed(2) + ' MB' : 'EMPTY'}`);
        if (!data || data.byteLength < 1024) {
            s.log(`  ERROR: Output too small or empty!`);
            throw new Error('Processing failed (output is empty or too small).');
        }
        s.logEnd();
        const finalizeFn = window.finalizePatcherDownload || (s && s.finalizePatcherDownload);
        if (typeof finalizeFn === 'function') {
            finalizeFn(file, data, { suffix: 'hd', ext: 'wmv', mimeType: 'video/x-ms-wmv' });
        } else {
            const blob = new Blob([data.buffer || data], { type: 'video/x-ms-wmv' });
            const url = URL.createObjectURL(blob);
            const outName = `${file.name.replace(/\.[^.]+$/, '')}_hd.wmv`;
            const a = document.createElement('a');
            a.href = url;
            a.download = outName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }
    } catch (error) {
        s.log(`  !! V1 ERROR: ${error.name} — ${error.message}`);
        if (error.stack) s.log(`  Stack: ${error.stack.split('\n').slice(0, 3).join(' | ')}`);
        s.logEnd();
        console.error(error);
        s.showStatusError(`Error: ${error.message}`);
        if (s.btnStart) s.btnStart.disabled = false;
    } finally {
        s.isProcessing = false;
        if (s.btnStart) s.btnStart.disabled = false;
    }
};
