const fs = require('fs');
const path = require('path');

function getApiKey() {
    if (process.env.ZERNIO_API_KEY) return process.env.ZERNIO_API_KEY.trim();
    const candidates = [
        path.join(__dirname, '..', '.env'),
        path.join(__dirname, '.env')
    ];
    for (const envPath of candidates) {
        if (fs.existsSync(envPath)) {
            const content = fs.readFileSync(envPath, 'utf8');
            const match = content.match(/^ZERNIO_API_KEY\s*=\s*(.*)$/m);
            if (match) return match[1].trim().replace(/^["']|["']$/g, '');
        }
    }
    return '';
}

const config = {
    zernioApiKey: getApiKey(),
    zernioBaseUrl: 'https://zernio.com/api/v1',
    apiBase: process.env.API_BASE || 'https://cutefish.my.id'
};

/**
 * Otomatis mengambil profileId, accountId, dan username TikTok yang terhubung di Zernio
 */
async function resolveTikTokAccount() {
    if (!config.zernioApiKey) {
        throw new Error('ZERNIO_API_KEY tidak ditemukan di .env');
    }
    const res = await fetch(`${config.zernioBaseUrl}/accounts`, {
        headers: { 'Authorization': `Bearer ${config.zernioApiKey}` }
    });
    if (!res.ok) {
        throw new Error(`Gagal mengambil akun Zernio: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    const accounts = data.accounts || [];
    const tiktokAcc = accounts.find(a => a.platform === 'tiktok') || accounts[0];
    if (!tiktokAcc) {
        throw new Error('Tidak ada akun TikTok yang terhubung di Zernio.');
    }
    return {
        profileId: typeof tiktokAcc.profileId === 'object' ? tiktokAcc.profileId._id : tiktokAcc.profileId,
        accountId: tiktokAcc._id,
        username: tiktokAcc.username || 'unknown'
    };
}

config.resolveTikTokAccount = resolveTikTokAccount;

module.exports = config;
