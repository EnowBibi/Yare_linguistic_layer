// USSD language handling. Screen translations live in translations/<language>.json.

const fs = require('node:fs');
const path = require('node:path');

const DICTIONARIES = path.join(__dirname, 'translations');

const SOURCE_KEYS = {
    'Mon solde': 'ussd.balance_option',
    'Transfert de credit': 'ussd.airtime_option',
    Confirmer: 'ussd.confirm',
    Annuler: 'ussd.cancel',
    'Safinum. Choisissez:\n1. Mon solde\n2. Transfert de credit': 'ussd.menu',
    'Choix invalide.\n1. Mon solde\n2. Transfert de credit': 'ussd.invalid_menu',
    'Credit pour:\n1. Mon numero\n2. Un autre numero': 'ussd.target_prompt',
    'Tapez 1 (mon numero) ou 2 (un autre numero).': 'ussd.target_invalid',
    'Numero a recharger (9 chiffres):': 'ussd.phone_prompt',
    'Montant du credit (FCFA):': 'ussd.amount_prompt',
    'Montant invalide. Tapez un nombre, ex: 1000': 'ussd.amount_invalid_example',
    'Choix invalide.': 'ussd.invalid_choice',
    'Numero invalide. 9 chiffres, ex: 699000002': 'ussd.phone_invalid',
    'Repondez 1 pour confirmer ou 2 pour annuler.': 'ussd.confirm_prompt',
    'Operation annulee. Aucun montant debite.': 'ussd.cancelled',
    'Solde insuffisant pour cette operation.': 'ussd.error_insufficient_funds',
    'Montant invalide.': 'ussd.error_invalid_amount',
    'Montant trop eleve pour une seule operation.': 'ussd.error_limit_exceeded',
    'Numero inconnu ou invalide.': 'ussd.error_unknown_beneficiary',
    'Operateur non reconnu pour ce numero.': 'ussd.error_unknown_biller',
    'Compte introuvable.': 'ussd.error_unknown_account',
    'Service momentanement indisponible. Reessayez plus tard.': 'ussd.error_unreachable',
    'Operation impossible. Reessayez plus tard.': 'ussd.error_generic',
};

const DYNAMIC_SOURCES = [
    {
        pattern: /^Votre solde est de (?<balance>.+)\.$/,
        key: 'ussd.balance',
    },
    {
        pattern: /^Credit (?<operator>.+) de (?<amount>.+) pour le (?<phone>.+)\. Frais (?<fee>.+), total (?<total>.+)\.\n1\. Confirmer\n2\. Annuler$/,
        key: 'ussd.airtime_review',
    },
    {
        pattern: /^Credit de (?<amount>.+) envoye au (?<phone>.+)\. Ref (?<reference>.+)\.$/,
        key: 'ussd.airtime_sent',
    },
];

const INPUT_ALIASES = {
    ewo: {
        '1': ['1', 'un', 'une', 'premier', 'premiere', 'mon solde', 'solde', 'balance', 'moni a lii', 'moni'],
        '2': ['2', 'deux', 'deuxieme', 'transfert', 'transfert de credit', 'credit', 'kus kredi', 'kredi', 'autre numero'],
    },
    hau: {
        '1': ['1', 'un', 'une', 'premier', 'premiere', 'mon solde', 'solde', 'balance', 'ragowar kudi', 'kudin asusu', 'daya', 'na farko'],
        '2': ['2', 'deux', 'deuxieme', 'transfert', 'transfert de credit', 'credit', 'sayi katin waya', 'katin waya', 'biyu', 'na biyu', 'wata lamba'],
    },
};

const CONFIRM_ALIASES = {
    ewo: {
        '1': ['oui', 'yes', 'confirmer', 'confirme', 'yemete', 'kome yemete'],
        '2': ['non', 'no', 'annuler', 'annule', 'vaa'],
    },
    hau: {
        '1': ['oui', 'yes', 'confirmer', 'confirme', 'tabbatar', 'eh', 'e'],
        '2': ['non', 'no', 'annuler', 'annule', 'soke', 'aa', "a'a"],
    },
};

function normalize(text) {
    return String(text)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[ɓ]/g, 'b')
        .replace(/[ɗ]/g, 'd')
        .replace(/[ƙ]/g, 'k')
        .replace(/[ɛ]/g, 'e')
        .replace(/[ɔ]/g, 'o')
        .replace(/[ŋ]/g, 'ng')
        .toLowerCase()
        .replace(/[’'`]/g, '')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}

function languageCode(language) {
    const code = String(language || '').trim().toLowerCase();

    return /^[a-z]{2,3}$/.test(code) ? code : null;
}

function loadDictionary(language) {
    const file = path.join(DICTIONARIES, `${language}.json`);

    if (!fs.existsSync(file)) return null;

    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
        console.warn(`translations/${language}.json unreadable:`, error.message);

        return null;
    }
}

function findSource(text) {
    if (Object.prototype.hasOwnProperty.call(SOURCE_KEYS, text)) {
        return { key: SOURCE_KEYS[text], values: {} };
    }

    for (const source of DYNAMIC_SOURCES) {
        const match = text.match(source.pattern);

        if (match) return { key: source.key, values: match.groups };
    }

    return null;
}

function render(template, values) {
    return template.replace(/\{([a-z_]+)\}/g, (placeholder, name) =>
        Object.prototype.hasOwnProperty.call(values, name) ? values[name] : placeholder,
    );
}

/**
 * Normalize menu choices and confirmation words to the digits used by USSD.
 * Numeric amounts and unrecognized text are left unchanged.
 */
function understand(text, language) {
    const value = String(text == null ? '' : text).trim();
    const digits = value.replace(/[٠-٩۰-۹]/g, (digit) => {
        const code = digit.charCodeAt(0);

        return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
    });
    const lang = languageCode(language);

    if (!lang || !Object.prototype.hasOwnProperty.call(INPUT_ALIASES, lang)) return digits;

    const normalized = normalize(digits);

    for (const aliases of [INPUT_ALIASES[lang], CONFIRM_ALIASES[lang]]) {
        for (const [choice, words] of Object.entries(aliases)) {
            if (words.some((word) => normalize(word) === normalized)) return choice;
        }
    }

    return digits;
}

/**
 * Translate a kit USSD message from the requested language dictionary.
 * If its key or phrase is unavailable, keep the French source and declare fr.
 */
function say(text, language) {
    const original = String(text == null ? '' : text);
    const lang = languageCode(language);

    if (!lang) return { text: original, language: 'fr' };

    const source = findSource(original);
    if (!source) return { text: original, language: 'fr' };

    const dictionary = loadDictionary(lang);
    const template = dictionary && dictionary[source.key];

    if (typeof template !== 'string' || template.trim() === '') {
        return { text: original, language: 'fr' };
    }

    return { text: render(template, source.values), language: lang };
}

module.exports = { understand, say };
