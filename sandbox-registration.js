const DEFAULT_CHANNELS = ['ussd', 'mobile', 'web', 'sms'];
const ALLOWED_CHANNELS = new Set(DEFAULT_CHANNELS);
const DEFAULT_REGISTRATION_URL = 'https://safinum.cm/api/v1/sandbox/endpoint';
const MAX_ATTEMPTS = 3;

async function registerSandboxEndpoints() {
    const teamKey = process.env.SAFINUM_TEAM_KEY;
    if (!teamKey) {
        console.warn('[Sandbox registration] skipped: SAFINUM_TEAM_KEY is not set.');
        return;
    }

    const publicUrl = process.env.RENDER_EXTERNAL_URL || process.env.SAFINUM_PUBLIC_URL;
    if (!publicUrl) {
        console.warn('[Sandbox registration] skipped: no public URL is available.');
        return;
    }

    const endpointUrl = process.env.SAFINUM_REGISTRATION_URL || DEFAULT_REGISTRATION_URL;
    requireHttpsUrl(publicUrl, 'Public service URL');
    requireHttpsUrl(endpointUrl, 'Sandbox registration URL');

    const channels = parseChannels(process.env.SAFINUM_CHANNELS);
    const failures = [];

    for (const channel of channels) {
        try {
            await registerChannel(channel, publicUrl.replace(/\/+$/, ''), endpointUrl, teamKey);
            console.log(`[Sandbox registration] ${channel} endpoint registered.`);
        } catch (error) {
            failures.push(channel);
            console.error(`[Sandbox registration] ${channel} registration failed: ${error.message}`);
        }
    }

    if (failures.length) {
        throw new Error(`Sandbox registration failed for: ${failures.join(', ')}`);
    }
}

function parseChannels(value) {
    const channels = [...new Set((value || DEFAULT_CHANNELS.join(','))
        .split(',')
        .map((channel) => channel.trim().toLowerCase())
        .filter(Boolean))];

    if (!channels.length) throw new Error('SAFINUM_CHANNELS must include at least one channel.');

    const unsupported = channels.filter((channel) => !ALLOWED_CHANNELS.has(channel));
    if (unsupported.length) {
        throw new Error(`Unsupported sandbox channel(s): ${unsupported.join(', ')}.`);
    }

    return channels;
}

function requireHttpsUrl(value, label) {
    let url;

    try {
        url = new URL(value);
    } catch {
        throw new Error(`${label} must be a valid HTTPS URL.`);
    }

    if (url.protocol !== 'https:') throw new Error(`${label} must use HTTPS.`);
}

async function registerChannel(channel, publicUrl, endpointUrl, teamKey) {
    let lastError;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        try {
            const response = await fetch(endpointUrl, {
                method: 'POST',
                headers: {
                    'X-Team-Key': teamKey,
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                },
                body: JSON.stringify({ channel, url: publicUrl }),
                signal: AbortSignal.timeout(10000),
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return;
        } catch (error) {
            lastError = error;
            console.error(`[Sandbox registration] ${channel}, attempt ${attempt}/${MAX_ATTEMPTS}: ${error.message}`);
            if (attempt < MAX_ATTEMPTS) await delay(attempt * 1000);
        }
    }

    throw lastError;
}

function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

module.exports = { registerSandboxEndpoints };
