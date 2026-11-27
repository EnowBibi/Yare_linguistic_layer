// Kit de démarrage SAFINUM Innovate Challenge 2026 — Node.js 18+, aucune dépendance.
//
// La passerelle POSTe chaque tour ici. Deux sortes de requêtes arrivent sur
// la même URL :
//   - USSD            : payload.input.text  → ussd.js (menus + appels bancaires)
//   - mobile et web   : payload.type === 'ui_translation' → ui.js (traduire un écran)
//
// Lancer : node server.js   (puis exposer le port avec un tunnel, voir README.md)

const http = require('node:http');
const { loadEnv } = require('./env');

loadEnv();

const { handleUssd } = require('./ussd');
const { handleUi } = require('./ui');

const PORT = Number(process.env.PORT || 8080);

function send(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
    // Pratique pour vérifier que le tunnel arrive bien jusqu'ici.
    if (req.method === 'GET') return send(res, 200, { ok: true, service: 'safinum-starter-node' });
    if (req.method !== 'POST') return send(res, 405, { error: 'POST attendu' });

    let body = '';
    for await (const chunk of req) body += chunk;

    let payload;
    try {
        payload = JSON.parse(body || '{}');
    } catch {
        return send(res, 400, { error: 'JSON invalide' });
    }

    // X-Trace-Id : à renvoyer tel quel sur CHAQUE appel bancaire de ce tour.
    // Sans lui, le jury ne peut pas relier vos appels à ce que vous déclarez.
    const traceId = req.headers['x-trace-id'] || payload.trace_id || null;

    try {
        if (payload.type !== 'ui_translation') logScenarioPayload(payload);

        const reply = payload.type === 'ui_translation' ? handleUi(payload) : await handleUssd(payload, traceId);

        send(res, 200, reply);
    } catch (error) {
        // Un vrai bug : on le laisse visible (statut 500, message dans le
        // journal de la sandbox) plutôt que de le masquer.
        console.error(error);
        send(res, 500, { error: String(error && error.message ? error.message : error) });
    }
});

function logScenarioPayload(payload) {
    const scenarioFields = [];

    function inspect(value, prefix = '', depth = 0) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return;

        for (const [key, fieldValue] of Object.entries(value)) {
            const field = prefix ? `${prefix}.${key}` : key;

            if (/(scenario|test.?case|flow.?name)/i.test(key)) {
                let summary;

                if (['string', 'number', 'boolean'].includes(typeof fieldValue)) {
                    summary = String(fieldValue).slice(0, 100);
                } else if (Array.isArray(fieldValue)) {
                    summary = `array(${fieldValue.length})`;
                } else if (fieldValue && typeof fieldValue === 'object') {
                    const labels = Object.entries(fieldValue)
                        .filter(([name, value]) =>
                            /^(id|name|label|slug|code|value)$/i.test(name)
                            && ['string', 'number', 'boolean'].includes(typeof value),
                        )
                        .map(([name, value]) => `${name}=${String(value).slice(0, 100)}`);

                    summary = `object keys: ${Object.keys(fieldValue).join(', ')}${labels.length ? `; ${labels.join(', ')}` : ''}`;
                } else {
                    summary = String(fieldValue);
                }

                scenarioFields.push({ field, value: summary });
            }

            if (depth < 2 && fieldValue && typeof fieldValue === 'object' && !Array.isArray(fieldValue)) {
                inspect(fieldValue, field, depth + 1);
            }
        }
    }

    inspect(payload);
    console.log('[USSD scenario diagnostic]', JSON.stringify({
        payloadKeys: Object.keys(payload),
        inputKeys: Object.keys(payload.input || {}),
        scenarioFields,
    }));
}

server.listen(PORT, () => {
    console.log(`Middleware à l'écoute sur http://localhost:${PORT}`);

    if (!process.env.SAFINUM_TEAM_KEY) {
        console.warn('ATTENTION : SAFINUM_TEAM_KEY est vide. Copiez .env.example en .env et collez votre clé.');
    }
});
