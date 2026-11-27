// Canal USSD : menus numérotés, solde et transfert de crédit.
//
// Ce que la passerelle envoie (extrait) :
//   { trace_id, session_id, phone: "237699000001", language: "dua" | null,
//     input: { type: "text", text: "1", ussd_text: "*123#*1" },
//     constraints: { max_chars: 182, charset: "gsm7" },
//     bank_api: { base_url: "https://…/api/v1" } }
//
// Ce qu'il faut répondre, à chaque tour :
//   { response: { text, end_session, options },
//     interpretation: { intent, parameters, language },
//     transaction: { id, status } }
//
// Règle du jury : une opération est CRÉÉE dans un tour, puis CONFIRMÉE dans un
// tour suivant, après que l'utilisateur a lu le récapitulatif. Confirmer dans
// le même tour que la saisie du montant est signalé comme non réaliste.

const { createBank } = require('./bank');
const {
    understand,
    say,
    parseInput,
    getLanguagePreference,
    setLanguagePreference,
} = require('./language');

const MAX_CHARS = 182;

// État des sessions en mémoire, indexé par session_id. Suffisant pour le
// développement ; perdu au redémarrage. En production : Redis, fichier, base.
const sessions = new Map();

const MENU = [
    'Mon solde',
    "Transfert d'argent",
    'Credit telephone',
    'Frais',
    'Historique',
    'Aide',
    'Langue',
];

async function handleUssd(payload, traceId) {
    const sessionId = payload.session_id || 'sans-session';
    const phone = String(payload.phone || '');
    const state = sessions.get(sessionId) || { step: 'idle' };
    const requestedLanguage = payload.language || state.language || getLanguagePreference(phone);
    const raw = String((payload.input && payload.input.text) || '').trim();
    const text = understand(raw, requestedLanguage);
    const input = parseInput(text, requestedLanguage);
    const bank = createBank(payload.bank_api && payload.bank_api.base_url, traceId);

    if (payload.language) setLanguagePreference(phone, payload.language);
    applyRequestedLanguage(state, requestedLanguage);
    const body = await route(state, text, input, phone, bank);

    if (body.response.end_session) sessions.delete(sessionId);
    else sessions.set(sessionId, state);
    if (state.language) setLanguagePreference(phone, state.language);

    return finalize(body, state.language || requestedLanguage);
}

function applyRequestedLanguage(state, requestedLanguage) {
    if (!requestedLanguage) return;

    if (!state.gatewayLanguage || requestedLanguage !== state.gatewayLanguage) {
        state.gatewayLanguage = requestedLanguage;
        state.language = requestedLanguage;
        state.languageOverride = false;
        return;
    }

    if (!state.languageOverride) state.language = requestedLanguage;
}

async function route(state, text, input, phone, bank) {
    const { intent, amount, recipient, term, language } = input;

    if (text === '' && state.step !== 'confirm') {
        state.step = 'menu';

        return reply('Safinum. Choisissez:\n' + numbered(MENU), 'UNKNOWN', {}, { options: MENU });
    }

    if (intent === 'LANGUAGE_SWITCH') {
        state.language = language;
        state.languageOverride = true;

        return reply(`Langue changee: ${languageName(language)}.`, 'LANGUAGE_SWITCH');
    }

    if (state.step === 'confirm') {
        if (intent === 'CORRECTION') return correctPending(state, amount, recipient, phone, bank);
        if (intent === 'CONFIRM' || input.choice === '1') return confirm(state, bank);
        if (intent === 'CANCEL' || input.choice === '2') return cancel(state, bank);

        return reply('Repondez 1 pour confirmer, 2 pour annuler ou indiquez la correction.', 'CLARIFICATION_NEEDED', {}, { transaction: pending(state) });
    }

    switch (state.step) {
        case 'transfer_recipient':
            return resolveTransferRecipient(state, recipient || text, amount, phone, bank);

        case 'transfer_amount':
            return setAmountAndCreate(state, amountValue(amount, text), phone, bank);

        case 'airtime_target':
            if (text === '1' || input.choice === '1') {
                state.to = phone;

                return askAmount(state);
            }
            if (text === '2' || input.choice === '2') {
                state.step = 'airtime_phone';

                return reply('Numero a recharger (9 chiffres):', 'CLARIFICATION_NEEDED');
            }

            return reply('Tapez 1 (mon numero) ou 2 (un autre numero).', 'CLARIFICATION_NEEDED');

        case 'airtime_phone': {
            const target = normalizePhone(text);
            if (!target) return reply('Numero invalide. 9 chiffres, ex: 699000002', 'CLARIFICATION_NEEDED');
            state.to = target;

            return askAmount(state);
        }

        case 'airtime_amount':
            return setAmountAndCreate(state, amountValue(amount, text), phone, bank);

        case 'fee_amount':
            return feeQuote(state, amountValue(amount, text), phone, bank);

        case 'term':
            return explainTerm(term || termChoice(input.choice || text) || termFromInput(text));

        case 'language':
            return selectLanguage(state, input.choice || text);

        case 'beneficiary_choice':
            return chooseBeneficiary(state, input.choice || text, phone, bank);

        case 'correction':
            {
                const correctedAmount = amountValue(amount, text);
                return correctPending(state, correctedAmount, recipient || (correctedAmount ? null : text), phone, bank);
            }

        case 'correction_beneficiary_choice':
            return chooseCorrectionBeneficiary(state, input.choice || text, phone, bank);

        case 'idle':
        case 'menu':
            return handleMenu(state, text, input, phone, bank);

        default:
            state.step = 'menu';

            return reply('Safinum. Choisissez:\n' + numbered(MENU), 'UNKNOWN', {}, { options: MENU });
    }
}

async function handleMenu(state, text, input, phone, bank) {
    if (text === '1' || input.choice === '1' || input.intent === 'BALANCE_INQUIRY') return balance(phone, bank);
    if (text === '2' || input.choice === '2' || input.intent === 'TRANSFER') return beginTransfer(state, input, phone, bank);
    if (text === '3' || input.choice === '3' || input.intent === 'AIRTIME_PURCHASE') return beginAirtime(state, input, phone, bank);
    if (text === '4' || input.choice === '4' || input.intent === 'FEE_INQUIRY') return beginFeeInquiry(state, input, phone, bank);
    if (text === '5' || input.choice === '5' || input.intent === 'TRANSACTION_HISTORY') return history(phone, bank, state);
    if (text === '6' || input.choice === '6' || input.intent === 'TERM_EXPLANATION') {
        if (input.term) return explainTerm(input.term);
        state.step = 'term';

        return reply('Quel terme voulez-vous comprendre ? Frais, plafond ou beneficiaire.', 'TERM_EXPLANATION');
    }
    if (text === '7' || input.choice === '7') {
        state.step = 'language';

        return reply('Choisissez une langue:\n1. Francais\n2. Hausa\n3. Ewondo', 'LANGUAGE_SWITCH');
    }

    return clarifyIntent();
}

async function beginTransfer(state, input, phone, bank) {
    state.operation = 'transfer';
    state.amount = input.amount || null;
    state.to = null;
    state.recipientName = null;

    if (input.recipient) return resolveTransferRecipient(state, input.recipient, input.amount, phone, bank);

    state.step = 'transfer_recipient';

    return reply('Beneficiaire (numero ou nom):', 'CLARIFICATION_NEEDED');
}

async function resolveTransferRecipient(state, value, amount, phone, bank) {
    const recipient = String(value || '').trim();
    const normalizedPhone = normalizePhone(recipient);

    if (normalizedPhone) {
        state.to = normalizedPhone;
        state.recipientName = local(normalizedPhone);
        state.amount = amount || state.amount;

        return state.amount ? createTransfer(state, phone, bank) : askTransferAmount(state);
    }

    if (!recipient) {
        state.step = 'transfer_recipient';

        return reply('Beneficiaire (numero ou nom):', 'CLARIFICATION_NEEDED');
    }

    const result = await bank.beneficiaries(recipient, phone);
    if (!result.ok) {
        const ambiguous = result.data && result.data.error === 'AMBIGUOUS_BENEFICIARY'
            ? getCandidates(result.data)
            : [];
        if (ambiguous.length > 1) {
            state.step = 'beneficiary_choice';
            state.candidates = ambiguous;
            state.amount = amount || state.amount;

            return reply('Plusieurs beneficiaires portent ce nom. Choisissez un numero.', 'CLARIFICATION_NEEDED', {}, {
                options: ambiguous.map((candidate, index) => `${index + 1}. ${candidateName(candidate)}`),
            });
        }

        return bankError(result, 'TRANSFER');
    }

    const candidates = getCandidates(result.data);
    if (!candidates.length) return bankError({ ok: false, status: 404, data: { error: 'UNKNOWN_BENEFICIARY' } }, 'TRANSFER');

    if (candidates.length > 1) {
        state.step = 'beneficiary_choice';
        state.candidates = candidates;
        state.amount = amount || state.amount;

        const options = candidates.map((candidate, index) => `${index + 1}. ${candidateName(candidate)}`);

        return reply('Plusieurs beneficiaires portent ce nom. Choisissez un numero.', 'CLARIFICATION_NEEDED', {}, { options });
    }

    const candidate = candidates[0];
    const target = candidatePhone(candidate);
    if (!target) return bankError({ ok: false, status: 502, data: { error: 'INVALID_RESPONSE' } }, 'TRANSFER');

    state.to = target;
    state.recipientName = candidateName(candidate);
    state.amount = amount || state.amount;

    return state.amount ? createTransfer(state, phone, bank) : askTransferAmount(state);
}

function chooseBeneficiary(state, text, phone, bank) {
    const index = Number(text) - 1;
    const candidate = state.candidates && state.candidates[index];

    if (!candidate) {
        return reply('Choisissez un numero de la liste.', 'CLARIFICATION_NEEDED', {}, {
            options: (state.candidates || []).map((item, itemIndex) => `${itemIndex + 1}. ${candidateName(item)}`),
        });
    }

    state.to = candidatePhone(candidate);
    state.recipientName = candidateName(candidate);
    state.candidates = null;
    if (!state.to) return bankError({ ok: false, status: 502, data: { error: 'INVALID_RESPONSE' } }, 'TRANSFER');

    return state.amount ? createTransfer(state, phone, bank) : askTransferAmount(state);
}

function askTransferAmount(state) {
    state.step = 'transfer_amount';

    return reply('Montant du transfert (FCFA):', 'CLARIFICATION_NEEDED', { to: state.to });
}

function setAmountAndCreate(state, amount, phone, bank) {
    if (!Number.isInteger(amount) || amount <= 0) {
        return reply('Montant invalide. Tapez un nombre, ex: 1000', 'CLARIFICATION_NEEDED');
    }

    state.amount = amount;

    return state.operation === 'transfer' ? createTransfer(state, phone, bank) : createAirtime(state, String(amount), phone, bank);
}

async function createTransfer(state, phone, bank) {
    const result = await bank.createTransaction({
        type: 'transfer',
        from: phone,
        to: state.to,
        amount: state.amount,
    });

    if (!result.ok) return bankError(result, 'TRANSFER');

    return prepareConfirmation(state, result.data, 'TRANSFER');
}

async function beginAirtime(state, input, phone, bank) {
    state.operation = 'airtime';
    state.amount = input.amount || null;
    state.to = null;

    if (input.recipient) {
        const target = normalizePhone(input.recipient);
        if (!target) return reply('Numero invalide. 9 chiffres, ex: 699000002', 'CLARIFICATION_NEEDED');
        state.to = target;
        return state.amount ? createAirtime(state, String(state.amount), phone, bank) : askAmount(state);
    }

    state.step = 'airtime_target';

    return reply('Credit pour:\n1. Mon numero\n2. Un autre numero', 'CLARIFICATION_NEEDED');
}

function beginFeeInquiry(state, input, phone, bank) {
    state.operation = 'transfer';
    if (input.amount) return feeQuote(state, input.amount, phone, bank);
    state.step = 'fee_amount';

    return reply('Montant des frais a calculer (FCFA):', 'CLARIFICATION_NEEDED');
}

async function feeQuote(state, amount, phone, bank) {
    if (!Number.isInteger(amount) || amount <= 0) {
        return reply('Montant invalide. Tapez un nombre, ex: 1000', 'CLARIFICATION_NEEDED');
    }

    const result = await bank.fees('transfer', amount);
    if (!result.ok) return bankError(result, 'FEE_INQUIRY');

    const fee = result.data.fee;
    const total = result.data.total;
    if (fee === undefined || total === undefined) {
        console.warn('Réponse de frais bancaire invalide :', result.data);
        return bankError({ ok: false, status: 502, data: { error: 'INVALID_RESPONSE' } }, 'FEE_INQUIRY');
    }

    state.step = 'menu';

    return reply(`Frais pour ${money(amount)}: ${money(fee)}. Total: ${money(total)}.`, 'FEE_INQUIRY', {
        amount,
        fee,
        total,
    }, { end: true });
}

function history(phone, bank, state) {
    return bank.history(phone, 5).then((result) => {
        if (!result.ok) return bankError(result, 'TRANSACTION_HISTORY');

        const transactions = getTransactions(result.data);
        if (!transactions) {
            console.warn('Réponse d’historique bancaire invalide :', result.data);
            return bankError({ ok: false, status: 502, data: { error: 'INVALID_RESPONSE' } }, 'TRANSACTION_HISTORY');
        }
        if (!transactions.length) return reply('Aucune operation recente.', 'TRANSACTION_HISTORY', {}, { end: true });

        const entries = transactions.slice(0, 3).map((transaction) => {
            const type = say(historyType(transaction.type), state.language).text;
            const status = say(historyStatus(transaction.status), state.language).text;

            return `${type}, ${money(transaction.amount)}, ${status}`;
        }).join('; ');

        return reply(
            `Vous avez ${transactions.length} operation(s). Dernieres: ${entries}.`,
            'TRANSACTION_HISTORY',
            { count: transactions.length, transactions: transactions.slice(0, 3) },
            { end: true },
        );
    });
}

function explainTerm(term) {
    const messages = {
        fee: 'Les frais sont le montant preleve par la banque pour effectuer une operation.',
        limit: 'Le plafond est le montant maximum autorise par operation.',
        beneficiary: "Le beneficiaire est la personne qui recoit l'argent.",
    };

    if (!messages[term]) return reply('Quel terme voulez-vous comprendre ? Frais, plafond ou beneficiaire.', 'CLARIFICATION_NEEDED');

    return reply(messages[term], 'TERM_EXPLANATION', { term }, { end: true });
}

function selectLanguage(state, text) {
    const choices = { '1': 'fr', '2': 'hau', '3': 'ewo' };
    const language = choices[text];

    if (!language) return reply('Choisissez 1 pour francais, 2 pour hausa ou 3 pour ewondo.', 'CLARIFICATION_NEEDED');

    state.language = language;
    state.languageOverride = true;
    state.step = 'menu';

    return reply(`Langue changee: ${languageName(language)}.`, 'LANGUAGE_SWITCH');
}

function termFromInput(text) {
    const normalized = String(text).toLowerCase();

    if (/frais|fee|manga/.test(normalized)) return 'fee';
    if (/plafond|limite|limit/.test(normalized)) return 'limit';
    if (/beneficiaire|beneficiary|recipient/.test(normalized)) return 'beneficiary';

    return null;
}

function termChoice(text) {
    return { '1': 'fee', '2': 'limit', '3': 'beneficiary' }[text] || null;
}

function amountValue(amount, text) {
    if (Number.isInteger(amount) && amount > 0) return amount;

    return /^\d{1,6}$/.test(String(text)) ? Number(text) : null;
}

function languageName(language) {
    return { fr: 'francais', hau: 'Hausa', ewo: 'Ewondo' }[language] || language;
}

function normalizePhone(value) {
    const digits = String(value || '').replace(/\D/g, '');
    const localNumber = digits.startsWith('237') ? digits.slice(3) : digits;

    return /^6\d{8}$/.test(localNumber) ? `237${localNumber}` : null;
}

function getCandidates(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.candidates)) return data.candidates;
    if (data && Array.isArray(data.beneficiaries)) return data.beneficiaries;
    if (data && Array.isArray(data.results)) return data.results;
    if (data && data.data && Array.isArray(data.data.candidates)) return data.data.candidates;
    if (data && data.data && Array.isArray(data.data.beneficiaries)) return data.data.beneficiaries;

    return [];
}

function candidateName(candidate) {
    if (!candidate) return '';
    if (typeof candidate === 'string') return candidate;

    return String(candidate.name || candidate.full_name || candidate.label || candidate.phone || candidate.number || '');
}

function candidatePhone(candidate) {
    if (!candidate) return null;
    if (typeof candidate === 'string') return normalizePhone(candidate);

    return normalizePhone(candidate.phone || candidate.number || candidate.msisdn || candidate.account);
}

function getTransactions(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.transactions)) return data.transactions;
    if (data && Array.isArray(data.history)) return data.history;
    if (data && Array.isArray(data.items)) return data.items;
    if (data && data.data && Array.isArray(data.data.transactions)) return data.data.transactions;
    if (data && data.data && Array.isArray(data.data.history)) return data.data.history;

    return null;
}

function historyType(type) {
    const types = {
        transfer: 'Transfert',
        airtime: 'Credit telephone',
        bill: 'Paiement de facture',
        withdrawal: 'Retrait',
    };

    return types[String(type || '').toLowerCase()] || 'Operation';
}

function historyStatus(status) {
    const statuses = {
        pending: 'En attente',
        confirmed: 'Terminee',
        failed: 'Echouee',
        cancelled: 'Annulee',
    };

    return statuses[String(status || '').toLowerCase()] || String(status || 'inconnu');
}

function clarifyIntent() {
    return reply(
        "Je n'ai pas compris. Voulez-vous consulter votre solde, faire un transfert, acheter du credit, voir l'historique ou demander les frais ?",
        'CLARIFICATION_NEEDED',
        {},
        { options: MENU },
    );
}

// ── Opérations ─────────────────────────────────────────────────────────────

async function balance(phone, bank) {
    const result = await bank.balance(phone);

    if (!result.ok) return bankError(result, 'BALANCE_INQUIRY');

    return reply(`Votre solde est de ${money(result.data.balance)}.`, 'BALANCE_INQUIRY', { account: phone }, { end: true });
}

function askAmount(state) {
    state.step = 'airtime_amount';

    return reply('Montant du credit (FCFA):', 'CLARIFICATION_NEEDED', { to: state.to });
}

async function createAirtime(state, text, phone, bank) {
    const amount = Number(text.replace(/[\s.]/g, ''));

    if (!Number.isInteger(amount) || amount <= 0) return reply('Montant invalide. Tapez un nombre, ex: 1000', 'CLARIFICATION_NEEDED');

    // L'opérateur est déduit du numéro par la banque : inutile de l'envoyer.
    const result = await bank.createTransaction({ type: 'airtime', from: phone, to: state.to, amount });

    if (!result.ok) return bankError(result, 'AIRTIME_PURCHASE');

    return prepareConfirmation(state, result.data, 'AIRTIME_PURCHASE');
}

function prepareConfirmation(state, data, intent) {
    const tx = data && data.transaction ? data.transaction : data;
    const reference = tx && (tx.id || tx.transaction_id);

    if (!reference || tx.amount === undefined) {
        throw new Error('Bank API returned an incomplete pending transaction');
    }

    state.step = 'confirm';
    state.reference = reference;
    state.amount = Number(tx.amount);
    state.fee = Number(tx.fee || 0);
    state.total = Number(tx.total === undefined ? state.amount + state.fee : tx.total);
    state.to = tx.to || state.to;

    const text = state.operation === 'transfer'
        ? `Transfert de ${money(state.amount)} a ${state.recipientName || local(state.to)}. Frais ${money(state.fee)}, total ${money(state.total)}.\n1. Confirmer\n2. Annuler`
        : `Credit ${tx.operator || 'telephone'} de ${money(state.amount)} pour le ${local(state.to)}. Frais ${money(state.fee)}, total ${money(state.total)}.\n1. Confirmer\n2. Annuler`;

    return reply(
        text,
        intent,
        { amount: state.amount, to: state.to, fee: state.fee, total: state.total },
        { options: ['Confirmer', 'Annuler'], transaction: { id: reference, status: 'pending' } },
    );
}

async function correctPending(state, amount, recipient, phone, bank) {
    const changes = {};
    if (Number.isInteger(amount) && amount > 0) changes.amount = amount;

    if (recipient && recipient !== String(state.to)) {
        const target = normalizePhone(recipient);
        if (target) {
            changes.to = target;
        } else {
            const lookup = await bank.beneficiaries(recipient, phone);
            if (!lookup.ok) return bankError(lookup, 'CORRECTION', state.reference, true);

            const candidates = getCandidates(lookup.data);
            if (candidates.length > 1) {
                state.step = 'correction_beneficiary_choice';
                state.candidates = candidates;
                state.pendingCorrectionAmount = changes.amount;

                return reply('Plusieurs beneficiaires portent ce nom. Choisissez un numero.', 'CLARIFICATION_NEEDED', {}, {
                    options: candidates.map((item, index) => `${index + 1}. ${candidateName(item)}`),
                    transaction: pending(state),
                });
            }
            if (!candidates.length || !candidatePhone(candidates[0])) {
                return bankError({ ok: false, status: 404, data: { error: 'UNKNOWN_BENEFICIARY' } }, 'CORRECTION', state.reference, true);
            }

            changes.to = candidatePhone(candidates[0]);
            state.recipientName = candidateName(candidates[0]);
        }
    }

    if (!Object.keys(changes).length) {
        state.step = 'correction';

        return reply('Correction: indiquez le nouveau montant ou le beneficiaire.', 'CORRECTION', {}, {
            transaction: pending(state),
        });
    }

    return updatePending(state, changes, bank);
}

async function chooseCorrectionBeneficiary(state, text, phone, bank) {
    const candidate = state.candidates && state.candidates[Number(text) - 1];
    if (!candidate) {
        return reply('Choisissez un numero de la liste.', 'CLARIFICATION_NEEDED', {}, {
            options: (state.candidates || []).map((item, index) => `${index + 1}. ${candidateName(item)}`),
            transaction: pending(state),
        });
    }

    const to = candidatePhone(candidate);
    if (!to) return bankError({ ok: false, status: 502, data: { error: 'INVALID_RESPONSE' } }, 'CORRECTION', state.reference, true);

    state.recipientName = candidateName(candidate);
    state.candidates = null;
    const changes = { to };
    if (state.pendingCorrectionAmount) changes.amount = state.pendingCorrectionAmount;
    state.pendingCorrectionAmount = null;

    return updatePending(state, changes, bank);
}

async function updatePending(state, changes, bank) {
    const result = await bank.update(state.reference, changes);
    if (!result.ok) return bankError(result, 'CORRECTION', state.reference, true);

    return prepareConfirmation(state, result.data, 'CORRECTION');
}

async function confirm(state, bank) {
    const result = await bank.confirm(state.reference);

    if (!result.ok) return bankError(result, 'CONFIRM', state.reference);

    const tx = result.data && result.data.transaction ? result.data.transaction : result.data;
    const amount = money(tx.amount === undefined ? state.amount : tx.amount);
    const destination = local(tx.to || state.to);

    const message = state.operation === 'transfer'
        ? `Transfert de ${amount} envoye a ${state.recipientName || destination}. Reference ${tx.id || state.reference}.`
        : `Credit de ${amount} envoye au ${destination}. Ref ${tx.id || state.reference}.`;

    return reply(
        message,
        'CONFIRM',
        { transaction_id: tx.id },
        {
            end: true,
            transaction: { id: tx.id, status: 'confirmed' },
        },
    );
}

async function cancel(state, bank) {
    const result = await bank.cancel(state.reference);

    if (!result.ok) return bankError(result, 'CANCEL', state.reference);

    return reply(
        'Operation annulee. Aucun montant debite.',
        'CANCEL',
        { transaction_id: state.reference },
        {
            end: true,
            transaction: { id: state.reference, status: 'cancelled' },
        },
    );
}

// Phrases lisibles pour les erreurs les plus courantes de l'API bancaire.
const ERRORS = {
    INSUFFICIENT_FUNDS: 'Solde insuffisant pour cette operation.',
    INVALID_AMOUNT: 'Montant invalide.',
    LIMIT_EXCEEDED: 'Montant trop eleve pour une seule operation.',
    UNKNOWN_BENEFICIARY: 'Numero inconnu ou invalide.',
    AMBIGUOUS_BENEFICIARY: 'Plusieurs beneficiaires portent ce nom. Choisissez un numero.',
    UNKNOWN_BILLER: 'Operateur non reconnu pour ce numero.',
    UNKNOWN_ACCOUNT: 'Compte introuvable.',
    TX_NOT_FOUND: 'Operation introuvable.',
    TX_NOT_PENDING: 'Cette operation ne peut plus etre modifiee.',
    INVALID_REQUEST: 'Demande invalide.',
    INVALID_RESPONSE: 'Reponse invalide du service bancaire.',
    UNREACHABLE: 'Service momentanement indisponible. Reessayez plus tard.',
};

function bankError(result, intent, reference = null, keepPending = false) {
    const code = (result.data && result.data.error) || 'ERROR';

    console.warn(`Banque : ${result.status} ${code}`, result.data && result.data.message);
    if (code === 'UNAUTHORIZED') console.warn('Clé refusée : vérifiez SAFINUM_TEAM_KEY dans .env.');

    return reply(
        ERRORS[code] || 'Operation impossible. Reessayez plus tard.',
        intent,
        { error: code },
        {
            end: !keepPending,
            transaction: keepPending
                ? { id: reference, status: 'pending' }
                : reference
                  ? { id: reference, status: 'failed' }
                  : undefined,
        },
    );
}

// ── Construction de la réponse ─────────────────────────────────────────────

function reply(text, intent, parameters = {}, { options = [], end = false, transaction } = {}) {
    return {
        response: { text, end_session: end, options },
        interpretation: { intent, parameters, language: 'fr' },
        transaction: transaction || { id: null, status: 'none' },
    };
}

/** Applique la couche linguistique, puis vérifie les contraintes du canal. */
function finalize(body, language) {
    const translated = say(body.response.text, language);

    body.response.text = translated.text;
    body.response.options = body.response.options.map((option) => say(option, language).text);
    body.interpretation.language = translated.language;

    if (!isGsm7(body.response.text)) console.warn('Hors GSM-7 (le texte sera mal affiché sur un vrai téléphone) :', body.response.text);
    if (gsm7Length(body.response.text) > MAX_CHARS) console.warn(`Plus de ${MAX_CHARS} caractères :`, body.response.text);

    return body;
}

function pending(state) {
    return { id: state.reference || null, status: state.reference ? 'pending' : 'none' };
}

function numbered(items) {
    return items.map((item, index) => `${index + 1}. ${item}`).join('\n');
}

function money(amount) {
    return `${String(Math.round(Number(amount) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} FCFA`;
}

function local(phone) {
    return String(phone || '').replace(/^237/, '');
}

// ── GSM-7 (alphabet des SMS et de l'USSD) ──────────────────────────────────

const GSM7_BASIC =
    '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' + '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM7_EXTENDED = '^{}\\[~]|€\f';

/** Vrai si le texte passe sur un vrai réseau USSD sans être transcodé. */
function isGsm7(text) {
    return [...text].every((char) => GSM7_BASIC.includes(char) || GSM7_EXTENDED.includes(char));
}

/** Longueur en septets : les caractères étendus (€, [, ]…) comptent double. */
function gsm7Length(text) {
    return [...text].reduce((total, char) => total + (GSM7_EXTENDED.includes(char) ? 2 : 1), 0);
}

module.exports = { handleUssd, isGsm7, gsm7Length };
