// Speech-to-text for IVR audio turns.
// Uses an OpenAI-compatible /audio/transcriptions endpoint when configured.

function sttLanguage(language) {
    const codes = { fr: 'fr', en: 'en', hau: 'ha', fub: 'ff', wes: 'en', ewo: 'fr' };
    return codes[String(language || '').toLowerCase()] || null;
}

async function transcribe(audio, language) {
    if (!audio || audio.encoding !== 'base64' || typeof audio.data !== 'string') {
        return { ok: false, error: 'Aucun audio valide reçu.' };
    }

    const apiKey = process.env.VOICE_STT_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) {
        return {
            ok: false,
            error: 'Reconnaissance vocale non configurée. Définissez VOICE_STT_API_KEY.',
        };
    }

    const baseUrl = String(process.env.VOICE_STT_URL || 'https://api.openai.com/v1')
        .replace(/\/+$/, '');
    const model = process.env.VOICE_STT_MODEL || 'whisper-1';
    const wav = Buffer.from(audio.data, 'base64');

    if (!wav.length) return { ok: false, error: 'Enregistrement vocal vide.' };

    const form = new FormData();
    form.set('file', new Blob([wav], { type: 'audio/wav' }), 'speech.wav');
    form.set('model', model);
    form.set('response_format', 'text');

    const hint = sttLanguage(language);
    if (hint) form.set('language', hint);

    try {
        const response = await fetch(`${baseUrl}/audio/transcriptions`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}` },
            body: form,
            signal: AbortSignal.timeout(Number(process.env.VOICE_STT_TIMEOUT_MS || 6500)),
        });

        if (!response.ok) {
            const detail = await response.text().catch(() => '');
            console.warn('[voice STT] transcription failed', response.status, detail);
            return { ok: false, error: 'La voix n’a pas pu être reconnue.' };
        }

        const text = String(await response.text()).trim();
        return text ? { ok: true, text } : { ok: false, error: 'Je n’ai pas entendu de mots.' };
    } catch (error) {
        console.warn('[voice STT] unavailable', error.message);
        return { ok: false, error: 'La reconnaissance vocale est momentanément indisponible.' };
    }
}

module.exports = { transcribe };
