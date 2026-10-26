const fs = require('fs');
const path = require('path');

function loadEnvConfig() {
    const candidates = [
        path.join(__dirname, '..', '.env.temp'),
        path.join(__dirname, '..', 'env.temp'),
        path.join(__dirname, '..', '.env'),
        path.join(__dirname, '.env.temp'),
        path.join(__dirname, 'env.temp'),
        path.join(__dirname, '.env')
    ];
    let apiKey = process.env.ZERNIO_API_KEY || '';
    let accountId = process.env.ZERNIO_ACCOUNT_ID || '';
    let profileId = process.env.ZERNIO_PROFILE_ID || '';

    for (const envPath of candidates) {
        if (fs.existsSync(envPath)) {
            const content = fs.readFileSync(envPath, 'utf8');
            const keyMatch = content.match(/^ZERNIO_API_KEY\s*=\s*(.*)$/m);
            if (!apiKey && keyMatch) apiKey = keyMatch[1].trim().replace(/^["']|["']$/g, '');
            const accMatch = content.match(/^ZERNIO_ACCOUNT_ID\s*=\s*(.*)$/m);
            if (!accountId && accMatch) accountId = accMatch[1].trim().replace(/^["']|["']$/g, '');
            const profMatch = content.match(/^ZERNIO_PROFILE_ID\s*=\s*(.*)$/m);
            if (!profileId && profMatch) profileId = profMatch[1].trim().replace(/^["']|["']$/g, '');
        }
    }
    return { apiKey, accountId, profileId };
}

const envConf = loadEnvConfig();

const config = {
    zernioApiKey: envConf.apiKey,
    zernioAccountId: envConf.accountId,
    zernioProfileId: envConf.profileId,
    zernioBaseUrl: 'https://zernio.com/api/v1',
    apiBase: process.env.API_BASE || 'https://cutefish.my.id'
};

/**
 * Otomatis mengambil profileId, accountId, dan username TikTok yang terhubung di Zernio
 */
async function resolveTikTokAccount() {
    if (!config.zernioApiKey) {
        throw new Error('ZERNIO_API_KEY tidak ditemukan di .env atau .env.temp');
    }
    const res = await fetch(`${config.zernioBaseUrl}/accounts`, {
        headers: { 'Authorization': `Bearer ${config.zernioApiKey}` }
    });
    if (!res.ok) {
        throw new Error(`Gagal mengambil akun Zernio: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    const accounts = data.accounts || [];

    if (config.zernioAccountId) {
        const targeted = accounts.find(a => a._id === config.zernioAccountId);
        if (targeted) {
            return {
                profileId: typeof targeted.profileId === 'object' ? targeted.profileId._id : targeted.profileId,
                accountId: targeted._id,
                username: targeted.username || 'unknown'
            };
        }
        const fallbackProfile = accounts[0] ? (typeof accounts[0].profileId === 'object' ? accounts[0].profileId._id : accounts[0].profileId) : '6abaf4164cf7090d7e4b4c66';
        return {
            profileId: config.zernioProfileId || fallbackProfile,
            accountId: config.zernioAccountId,
            username: 'custom_account'
        };
    }

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
