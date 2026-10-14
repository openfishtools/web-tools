const fs = require('fs');
const path = require('path');
const { encodeVideo, getFfprobeMeta } = require('./tools/encode');
const { uploadToZernio } = require('./tools/upload');
const { analyzeTikTokUrl } = require('./tools/analyze');
const config = require('./tools/config');

const INPUT_DIR = path.join(__dirname, 'input');
const OUTPUT_DIR = path.join(__dirname, 'output');

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function findDefaultInput() {
    // 1. Explicit input/input.mp4 if present
    const explicitInFolder = path.join(INPUT_DIR, 'input.mp4');
    if (fs.existsSync(explicitInFolder)) return explicitInFolder;

    // 2. Any .mp4 or .mov file in input/ folder
    if (fs.existsSync(INPUT_DIR)) {
        const inEntries = fs.readdirSync(INPUT_DIR);
        const inCandidate = inEntries.find(f => {
            const l = f.toLowerCase();
            return (l.endsWith('.mp4') || l.endsWith('.mov')) && !l.startsWith('temp_');
        });
        if (inCandidate) return path.join(INPUT_DIR, inCandidate);
    }

    // 3. Fallback: Any .mp4 or .mov in root create-method/
    const entries = fs.readdirSync(__dirname);
    const candidate = entries.find(f => {
        const l = f.toLowerCase();
        return (l.endsWith('.mp4') || l.endsWith('.mov')) && !l.startsWith('output_') && !l.startsWith('temp_');
    });

    return candidate ? path.join(__dirname, candidate) : null;
}

function parseArgs() {
    const args = process.argv.slice(2);
    let method = 'fish-v3';
    let input = null;
    let output = null;
    let caption = null;
    let privacyLevel = 'PUBLIC_TO_EVERYONE';
    let skipUpload = false;
    let force = false;
    let analyzeUrl = null;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if ((arg === '--method' || arg === '-m') && args[i + 1]) {
            method = args[i + 1].toLowerCase();
            i++;
        } else if ((arg === '--input' || arg === '-i') && args[i + 1]) {
            input = args[i + 1];
            i++;
        } else if ((arg === '--output' || arg === '-o') && args[i + 1]) {
            output = args[i + 1];
            i++;
        } else if ((arg === '--caption' || arg === '-c') && args[i + 1]) {
            caption = args[i + 1];
            i++;
        } else if (arg === '--private') {
            privacyLevel = 'SELF_ONLY';
        } else if (arg === '--skip-upload') {
            skipUpload = true;
        } else if (arg === '--force' || arg === '-f') {
            force = true;
        } else if (arg === '--analyze-only' && args[i + 1]) {
            analyzeUrl = args[i + 1];
            i++;
        } else if (!arg.startsWith('-') && !input) {
            input = arg;
        }
    }

    return { method, input, output, caption, privacyLevel, skipUpload, force, analyzeUrl };
}

async function main() {
    const { method, input, output, caption, privacyLevel, skipUpload, force, analyzeUrl } = parseArgs();

    if (!fs.existsSync(INPUT_DIR)) fs.mkdirSync(INPUT_DIR, { recursive: true });
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    // Mode: Hanya analisa URL
    if (analyzeUrl) {
        console.log(`[Analyze-Only] URL: ${analyzeUrl}`);
        const tikTokMeta = await analyzeTikTokUrl(analyzeUrl);
        const resolvedInput = input ? path.resolve(process.cwd(), input) : findDefaultInput();

        if (resolvedInput && fs.existsSync(resolvedInput)) {
            const inputMeta = getFfprobeMeta(resolvedInput);
            const is1080p = tikTokMeta.width >= 1080 || tikTokMeta.height >= 1920;
            const is60fps = tikTokMeta.fps >= 55;
            const verdict = (is1080p && is60fps) ? 'SUCCESS (1080p 60fps preserved)' : `FAILED (${tikTokMeta.width}x${tikTokMeta.height} @ ${tikTokMeta.fps || 'N/A'}fps)`;

            console.table([
                { Stage: 'Input', Res: `${inputMeta.width}x${inputMeta.height}`, FPS: inputMeta.fps, Bitrate: `${inputMeta.bitrateMbps} Mbps`, Size: `${inputMeta.sizeMb} MB` },
                { Stage: 'TikTok CDN', Res: `${tikTokMeta.width}x${tikTokMeta.height}`, FPS: tikTokMeta.fps, Bitrate: `${tikTokMeta.bitrateMbps} Mbps`, Size: `${tikTokMeta.sizeMb} MB` }
            ]);
            console.log(`Verdict: ${verdict}`);
            console.log(`Post URL: ${analyzeUrl}`);
        }
        return;
    }

    // Resolusi video input
    const inputPath = input ? path.resolve(process.cwd(), input) : findDefaultInput();
    if (!inputPath || !fs.existsSync(inputPath)) {
        console.error(`\x1b[31m[Error] Video input tidak ditemukan!\x1b[0m`);
        console.error(`Petunjuk:`);
        console.error(`  1. Taruh video uji coba di folder: create-method/input/input.mp4`);
        console.error(`  2. Atau jalankan: node run.js --input /path/ke/video.mp4`);
        process.exit(1);
    }

    const inputMeta = getFfprobeMeta(inputPath);
    if (!inputMeta) {
        console.error(`[Error] Gagal membaca metadata video dari: ${inputPath}`);
        process.exit(1);
    }

    console.log(`[Input] ${path.relative(__dirname, inputPath)} (${inputMeta.width}x${inputMeta.height} @ ${inputMeta.fps}fps, ${inputMeta.bitrateMbps}Mbps, ${inputMeta.sizeMb}MB)`);

    // Resolusi output file (di dalam folder output/)
    const ext = method === 'quicktime' ? 'mov' : 'mp4';
    const outputPath = output ? path.resolve(process.cwd(), output) : path.join(OUTPUT_DIR, `output_${method}.${ext}`);
    let encodedMeta = null;

    if (fs.existsSync(outputPath) && !force) {
        console.log(`[Cache] Menggunakan output yang sudah ada: ${path.relative(__dirname, outputPath)} (gunakan --force untuk re-encode)`);
        encodedMeta = getFfprobeMeta(outputPath);
    } else {
        encodedMeta = await encodeVideo(inputPath, method, outputPath);
    }

    console.log(`[Encoded] ${method}: ${encodedMeta.width}x${encodedMeta.height} @ ${encodedMeta.fps}fps, ${encodedMeta.sizeMb}MB`);

    if (skipUpload) {
        console.log(`[Done] Video tersimpan di: ${outputPath} (upload dilewati sesuai flag --skip-upload)`);
        return;
    }

    // Upload via Zernio API
    const postCaption = caption || `Benchmark [${method}] #${method} #test`;
    const uploadResult = await uploadToZernio(outputPath, { caption: postCaption, privacyLevel });

    let tiktokUrl = uploadResult.postUrl;
    if (!tiktokUrl && uploadResult.platformPostId && uploadResult.username) {
        tiktokUrl = `https://www.tiktok.com/@${uploadResult.username}/video/${uploadResult.platformPostId}`;
    }

    if (!tiktokUrl) {
        console.log(`[Polling] Menunggu URL publik dari Zernio...`);
        await sleep(15000);
        const poll = await fetch(`${config.zernioBaseUrl}/posts/${uploadResult.postId}`, {
            headers: { 'Authorization': `Bearer ${config.zernioApiKey}` }
        });
        if (poll.ok) {
            const pData = await poll.json();
            const tt = (pData.post?.platforms || []).find(p => p.platform === 'tiktok');
            tiktokUrl = tt?.platformPostUrl || tt?.publishedUrl || null;
        }
    }

    if (!tiktokUrl) {
        const userHint = uploadResult.username ? `@${uploadResult.username}` : 'profil Anda';
        console.error(`[Warning] TikTok URL belum ter-resolve. Silakan cek postingan di ${userHint}`);
        return;
    }

    // Tunggu proses transcode CDN TikTok
    console.log(`[CDN] Menunggu 20 detik agar transcode CDN ByteDance selesai...`);
    await sleep(20000);

    // Analisa Live Stream CDN
    console.log(`[CDN] Memeriksa live stream metadata dari TikTok CDN...`);
    try {
        const tikTokMeta = await analyzeTikTokUrl(tiktokUrl);

        const is1080p = tikTokMeta.width >= 1080 || tikTokMeta.height >= 1920;
        const is60fps = tikTokMeta.fps >= 55;
        const verdict = (is1080p && is60fps)
            ? '🏆 SUCCESS (1080p 60fps lolos tanpa penurunan resolusi!)'
            : `❌ FAILED (Diturunkan ke ${tikTokMeta.width}x${tikTokMeta.height} @ ${tikTokMeta.fps || 'N/A'}fps)`;

        console.log('\n================ HASIL ANALISIS TIKTOK CDN ================');
        console.table([
            { Stage: 'Input Asli', Res: `${inputMeta.width}x${inputMeta.height}`, FPS: inputMeta.fps, Bitrate: `${inputMeta.bitrateMbps} Mbps`, Size: `${inputMeta.sizeMb} MB` },
            { Stage: 'File Patched', Res: `${encodedMeta.width}x${encodedMeta.height}`, FPS: encodedMeta.fps, Bitrate: `${encodedMeta.bitrateMbps} Mbps`, Size: `${encodedMeta.sizeMb} MB` },
            { Stage: 'TikTok CDN', Res: `${tikTokMeta.width}x${tikTokMeta.height}`, FPS: tikTokMeta.fps || 'N/A', Bitrate: `${tikTokMeta.bitrateMbps} Mbps`, Size: `${tikTokMeta.sizeMb} MB` }
        ]);
        console.log(`Verdict: ${verdict}`);
        console.log(`Post URL: ${tiktokUrl}`);
        console.log(`\nSilakan hapus video uji coba di TikTok jika benchmark sudah selesai.`);
    } catch (err) {
        console.error(`[Error] Analisis CDN gagal: ${err.message}`);
        console.log(`URL Postingan: ${tiktokUrl}`);
    }
}

main().catch(err => {
    console.error(`[Fatal]`, err.message);
    process.exit(1);
});
