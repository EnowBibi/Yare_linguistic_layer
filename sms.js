const { createHash, randomBytes } = require('node:crypto');
const { handleUssd, isGsm7, gsm7Length } = require('./ussd');

const sessionSalt = randomBytes(32);

async function handleSms(payload, traceId) {
    const phone = String(payload.phone || '').trim();
    if (!phone) throw requestError('SMS payload is missing phone.');

    const input = payload.input && typeof payload.input === 'object' && !Array.isArray(payload.input)
        ? payload.input
        : {};
    const text = typeof input.text === 'string'
        ? input.text
        : typeof payload.message === 'string'
            ? payload.message
            : typeof payload.text === 'string'
                ? payload.text
                : null;

    if (text === null) throw requestError('SMS payload is missing message text.');

    const sessionId = createHash('sha256')
        .update(sessionSalt)
        .update('\0')
        .update(phone)
        .digest('hex');
    const reply = await handleUssd({
        ...payload,
        session_id: `sms-${sessionId}`,
        input: { ...input, type: input.type || 'text', text },
    }, traceId, 'sms');

    const { encoding, units, segments } = smsSegments(reply.response.text);
    console.log(`[SMS] response uses ${segments} ${encoding} segment(s), ${units} units.`);

    return reply;
}

function smsSegments(text) {
    if (isGsm7(text)) {
        const units = gsm7Length(text);

        return {
            encoding: 'GSM-7',
            units,
            segments: units <= 160 ? 1 : Math.ceil(units / 153),
        };
    }

    const units = String(text).length;

    return {
        encoding: 'UCS-2',
        units,
        segments: units <= 70 ? 1 : Math.ceil(units / 67),
    };
}

function requestError(message) {
    const error = new Error(message);
    error.statusCode = 400;

    return error;
}

module.exports = { handleSms, smsSegments };
