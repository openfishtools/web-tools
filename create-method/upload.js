const fs = require('fs');
const path = require('path');

const config = require('./config');

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function uploadToZernio(videoPath, options = {}) {
    const caption = typeof options === 'string' ? options : (options.caption || 'Benchmark Test #test');
    const privacyLevel = typeof options === 'object' && options.privacyLevel ? options.privacyLevel : 'PUBLIC_TO_EVERYONE';

    const filename = path.basename(videoPath);
    const fileBytes = fs.readFileSync(videoPath);
    const fileSizeMb = (fileBytes.byteLength / (1024 * 1024)).toFixed(2);
    const ext = path.extname(videoPath).toLowerCase();
    const contentType = ext === '.mov' ? 'video/quicktime' : 'video/mp4';

    console.log(`[Upload] Starting: ${filename} (${fileSizeMb} MB, ${contentType})`);

    // 0. Auto-resolve TikTok Account & Profile
    const { profileId, accountId, username } = await config.resolveTikTokAccount();
    console.log(`[Upload] TikTok Target Account: @${username}`);

    // 1. Get Presigned URL
    const presignRes = await fetch(`${config.zernioBaseUrl}/media/presign`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${config.zernioApiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ filename, contentType })
    });

    if (!presignRes.ok) {
        const err = await presignRes.text();
        throw new Error(`Failed to get presigned URL: ${presignRes.status} - ${err}`);
    }

    const { uploadUrl, publicUrl } = await presignRes.json();

    // 2. Upload file to Storage
    const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: fileBytes
    });

    if (!uploadRes.ok) {
        const err = await uploadRes.text();
        throw new Error(`Failed to upload to storage: ${uploadRes.status} - ${err}`);
    }

    // 3. Create TikTok Post
    const postPayload = {
        profileId,
        publishNow: true,
        content: caption,
        mediaItems: [{ type: 'video', url: publicUrl }],
        platforms: [
            {
                platform: 'tiktok',
                accountId,
                platformSpecificData: {
                    tiktokSettings: {
                        privacyLevel,
                        allowComment: false,
                        allowDuet: false,
                        allowStitch: false,
                        contentPreviewConfirmed: true,
                        expressConsentGiven: true
                    }
                }
            }
        ]
    };

    const postRes = await fetch(`${config.zernioBaseUrl}/posts`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${config.zernioApiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(postPayload)
    });

    if (!postRes.ok) {
        const err = await postRes.text();
        throw new Error(`Failed to create post: ${postRes.status} - ${err}`);
    }

    const postData = await postRes.json();
    const postId = (postData.post && postData.post._id) || postData._id || postData.id;
    console.log(`[Upload] Post created: ${postId}`);

    // 4. Poll until published
    const maxWaitSec = 300;
    const startTime = Date.now();

    while ((Date.now() - startTime) < maxWaitSec * 1000) {
        await sleep(8000);
        const checkRes = await fetch(`${config.zernioBaseUrl}/posts/${postId}`, {
            headers: { 'Authorization': `Bearer ${config.zernioApiKey}` }
        });

        if (!checkRes.ok) continue;

        const data = await checkRes.json();
        const post = data.post || data;
        const status = post.status;
        const elapsed = Math.round((Date.now() - startTime) / 1000);

        if (status === 'published') {
            let ttEntry = (post.platforms || []).find(p => p.platform === 'tiktok');
            let postUrl = (ttEntry && (ttEntry.platformPostUrl || ttEntry.publishedUrl)) || post.publishedUrl || null;
            let platformPostId = ttEntry && ttEntry.platformPostId;

            // Wait for reconciliation if URL is pending
            if (!postUrl || (platformPostId && platformPostId.startsWith('v_pub_url'))) {
                for (let r = 0; r < 8; r++) {
                    await sleep(4000);
                    const rCheck = await fetch(`${config.zernioBaseUrl}/posts/${postId}`, {
                        headers: { 'Authorization': `Bearer ${config.zernioApiKey}` }
                    });
                    if (rCheck.ok) {
                        const rData = await rCheck.json();
                        const rPost = rData.post || rData;
                        ttEntry = (rPost.platforms || []).find(p => p.platform === 'tiktok');
                        if (ttEntry && ttEntry.platformPostUrl) {
                            postUrl = ttEntry.platformPostUrl;
                            platformPostId = ttEntry.platformPostId;
                            break;
                        }
                    }
                }
            }

            console.log(`[Upload] Published in ${elapsed}s: ${postUrl || 'pending'}`);

            return {
                postId,
                postUrl,
                platformPostId,
                publicUrl,
                status: 'published',
                username
            };
        }

        if (status === 'failed' || status === 'cancelled') {
            const reason = JSON.stringify(post.failureReason || post.error || data);
            throw new Error(`TikTok publishing ${status}: ${reason}`);
        }
    }

    throw new Error(`Timeout waiting for post ${postId} after ${maxWaitSec}s`);
}

module.exports = {
    uploadToZernio
};
