const fs = require('fs');
const path = require('path');

const config = require('./config');

async function analyzeTikTokUrl(pageUrl) {
    const apiBase = config.apiBase || 'https://cutefish.my.id';

    // 1. Resolve TikTok Page
    const resolveRes = await fetch(`${apiBase}/api/tiktok-resolve?url=${encodeURIComponent(pageUrl)}&nocache=1`);
    if (!resolveRes.ok) {
        const errText = await resolveRes.text();
        throw new Error(`Resolve failed (${resolveRes.status}): ${errText}`);
    }

    const resolveData = await resolveRes.json();
    if (resolveData.error) {
        throw new Error(`Resolve error: ${resolveData.error}`);
    }

    const videoUrl = resolveData.play || resolveData.hdplay || resolveData.videoUrl || (resolveData.raw && resolveData.raw.play) || resolveData.playUrl;
    if (!videoUrl) {
        throw new Error(`No video playback URL in resolve response.`);
    }

    const authorName = resolveData.author_unique_id || resolveData.author || '-';

    // 2. Inspect FPS, Resolution, and Bitrate via /api/tiktok-fps
    const fpsRes = await fetch(`${apiBase}/api/tiktok-fps?url=${encodeURIComponent(videoUrl)}`);
    let fpsData = {};
    if (fpsRes.ok) {
        fpsData = await fpsRes.json();
    }

    const durationSec = Number(resolveData.duration || fpsData.duration || 0);
    const sizeBytes = Number(fpsData.size || resolveData.size || 0);
    const sizeMb = (sizeBytes / (1024 * 1024)).toFixed(2);
    
    let bitrateBps = 0;
    if (durationSec > 0 && sizeBytes > 0) {
        bitrateBps = Math.round((sizeBytes * 8) / durationSec);
    }
    const bitrateMbps = (bitrateBps / 1000000).toFixed(2);

    const stats = {
        pageUrl,
        author: authorName,
        title: resolveData.title,
        duration: durationSec,
        width: fpsData.width || resolveData.w || 0,
        height: fpsData.height || resolveData.h || 0,
        fps: fpsData.fps || null,
        sizeBytes,
        sizeMb,
        bitrateBps,
        bitrateMbps,
        comment: fpsData.comment || '',
        videoStreamUrl: videoUrl,
        hdUrl: resolveData.hdplay || null
    };

    console.log(`[Analyze] Live CDN: ${stats.width}x${stats.height} @ ${stats.fps || 'N/A'}fps, ${stats.bitrateMbps}Mbps, ${stats.sizeMb}MB`);
    return stats;
}

module.exports = {
    analyzeTikTokUrl
};
