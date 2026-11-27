// USSD language handling. Screen translations live in translations/<language>.json.

const fs = require('node:fs');
const path = require('node:path');

const DICTIONARIES = path.join(__dirname, 'translations');
const languagePreferences = new Map();

const SOURCE_KEYS = {
    'Mon solde': 'ussd.balance_option',
    "Transfert d'argent": 'ussd.transfer_option',
    'Credit telephone': 'ussd.airtime_option',
    'Frais': 'ussd.fees_option',
    'Historique': 'ussd.history_option',
    'Aide': 'ussd.help_option',
    'Langue': 'ussd.language_option',
    'Correction': 'ussd.correction_option',
    'Demande incomplete': 'ussd.ambiguous_option',
    'Solde insuffisant': 'ussd.insufficient_option',
    'Voir plus': 'ussd.more_option',
    'Autre canal': 'ussd.multichannel_option',
    'Terminologie financiere': 'ussd.terms_option',
    'Retour': 'ussd.back_option',
    'Continuez sur un autre canal avec le meme numero.': 'ussd.multichannel_prompt',
    'Transfert': 'ussd.history_type_transfer',
    'Paiement de facture': 'ussd.history_type_bill',
    'Retrait': 'ussd.history_type_withdrawal',
    'Operation': 'ussd.history_type_other',
    'En attente': 'ussd.history_status_pending',
    'Terminee': 'ussd.history_status_confirmed',
    'Echouee': 'ussd.history_status_failed',
    'Annulee': 'ussd.history_status_cancelled',
    Confirmer: 'ussd.confirm',
    Annuler: 'ussd.cancel',
    'Safinum. Choisissez:\n1. Mon solde\n2. Transfert\n3. Frais\n4. Historique\n5. Correction\n6. Demande incomplete\n7. Solde insuffisant\n00. Voir plus': 'ussd.menu',
    'Suite:\n8. Langue\n9. Autre canal\n10. Terminologie financiere\n0. Retour': 'ussd.menu_more',
    "Je n'ai pas compris. Voulez-vous consulter votre solde, faire un transfert, acheter du credit, voir l'historique ou demander les frais ?": 'ussd.clarify_intent',
    'Beneficiaire (numero ou nom):': 'ussd.beneficiary_prompt',
    'Montant du transfert (FCFA):': 'ussd.transfer_amount_prompt',
    'Montant des frais a calculer (FCFA):': 'ussd.fee_amount_prompt',
    'Quel terme voulez-vous comprendre ? Frais, plafond ou beneficiaire.': 'ussd.term_prompt',
    'Choisissez une langue:\n1. Francais\n2. Hausa\n3. Ewondo\n4. English\n5. Fulfulde': 'ussd.language_prompt',
    'Choisissez 1 pour francais, 2 pour hausa, 3 pour ewondo, 4 pour anglais ou 5 pour fulfulde.': 'ussd.language_invalid',
    'Choisissez un numero de la liste.': 'ussd.choice_invalid',
    'Aucune operation recente.': 'ussd.history_empty',
    'Correction: indiquez le nouveau montant ou le beneficiaire.': 'ussd.correction_prompt',
    'Les frais sont le montant preleve par la banque pour effectuer une operation.': 'ussd.term_fee',
    'Le plafond est le montant maximum autorise par operation.': 'ussd.term_limit',
    "Le beneficiaire est la personne qui recoit l'argent.": 'ussd.term_beneficiary',
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
    'Reponse invalide du service bancaire.': 'ussd.error_invalid_response',
    'Plusieurs beneficiaires portent ce nom. Choisissez un numero.': 'ussd.multiple_beneficiaries',
};

const DYNAMIC_SOURCES = [
    {
        pattern: /^Langue changee: (?<language>.+)\.$/,
        key: 'ussd.language_changed',
    },
    {
        pattern: /^Frais pour (?<amount>.+): (?<fee>.+)\. Total: (?<total>.+)\.$/,
        key: 'ussd.fee_quote',
    },
    {
        pattern: /^Transfert de (?<amount>.+) a (?<recipient>.+)\. Frais (?<fee>.+), total (?<total>.+)\.\n1\. Confirmer\n2\. Annuler$/,
        key: 'ussd.transfer_review',
    },
    {
        pattern: /^Transfert de (?<amount>.+) envoye a (?<recipient>.+)\. Reference (?<reference>.+)\.$/,
        key: 'ussd.transfer_sent',
    },
    {
        pattern: /^Credit (?<operator>.+) de (?<amount>.+) pour le (?<phone>.+)\. Frais (?<fee>.+), total (?<total>.+)\.\n1\. Confirmer\n2\. Annuler$/,
        key: 'ussd.airtime_review',
    },
    {
        pattern: /^Vous avez (?<count>\d+) operation\(s\)\. Dernieres: (?<entries>.+)\.$/,
        key: 'ussd.history_summary',
    },
    {
        pattern: /^Votre solde est de (?<balance>.+)\.$/,
        key: 'ussd.balance',
    },
    {
        pattern: /^Credit de (?<amount>.+) envoye au (?<phone>.+)\. Ref (?<reference>.+)\.$/,
        key: 'ussd.airtime_sent',
    },
];

const CHOICE_WORDS = {
    '1': ['un', 'une', 'premier', 'premiere', 'daya', 'na farko'],
    '2': ['deux', 'deuxieme', 'biyu', 'na biyu'],
};

const LANGUAGE_NAMES = {
    fr: ['fr', 'fra', 'fre', 'francais', 'french'],
    ewo: ['ewo', 'ewondo'],
    hau: ['hau', 'hausa', 'haoussa'],
    en: ['en', 'eng', 'english', 'anglais'],
    fub: ['fub', 'ful', 'ff', 'fulfulde', 'fula', 'pulaar'],
};

const TERM_ALIASES = {
    fee: ['frais', 'fee', 'fees', 'manga', 'maŋga', 'kudin sabis'],
    limit: ['plafond', 'limite', 'limit', 'iyaka', 'nne'],
    beneficiary: ['beneficiaire', 'beneficiary', 'recipient', 'mai karba', 'nyo a kos'],
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

function containsAny(text, words) {
    return words.some((word) => text.includes(normalize(word)));
}

function extractAmount(text) {
    const match = text.match(/(?:^|\D)(\d{1,6}(?:[ .,]\d{3})?)(?!\d)/);

    if (!match) return null;

    const amount = Number(match[1].replace(/[ .,]/g, ''));

    return Number.isInteger(amount) && amount > 0 ? amount : null;
}

function extractRecipient(text) {
    const phone = text.match(/(?:237)?6\d{8}/);
    if (phone) return phone[0];

    const match = text.match(/(?:to|for|pour|a|à|zuwa|ga)\s+([\p{L}][\p{L}\s'-]{1,40})/iu);

    if (!match) return null;

    const recipient = match[1].trim();

    return /^\d[\d\s.,]*$/.test(recipient) ? null : recipient;
}

function parseInput(text, language) {
    const original = String(text == null ? '' : text).trim();
    const normalized = normalize(original);
    const amount = /^[1-7]$/.test(normalized) ? null : extractAmount(original);
    const recipient = extractRecipient(original);
    let choice = /^[1-7]$/.test(normalized) ? normalized : null;

    if (!choice) {
        for (const [number, words] of Object.entries(CHOICE_WORDS)) {
            if (words.some((word) => normalize(word) === normalized)) {
                choice = number;
                break;
            }
        }
    }

    for (const [code, names] of Object.entries(LANGUAGE_NAMES)) {
        if (
            new RegExp(`(?:language|langue|harshe|switch|change|changer|parle|speak)\\s+(?:to|en|vers|zuwa)?\\s*(?:${names.join('|')})\\b`).test(normalized) ||
            (names.includes(normalized) && normalized !== String(language || '').toLowerCase())
        ) {
            return { intent: 'LANGUAGE_SWITCH', language: code };
        }
    }

    if (choice) return { intent: 'UNKNOWN', choice, amount, recipient };

    if (containsAny(normalized, ['corrige', 'correction', 'modifier', 'change', 'correct', 'instead', 'gyara'])) {
        return { intent: 'CORRECTION', amount, recipient };
    }

    if (['oui', 'yes', 'eh', 'tabbatar', 'confirmer', 'yemete'].includes(normalized)) {
        return { intent: 'CONFIRM', amount, recipient };
    }
    if (['non', 'no', 'soke', 'annuler', 'vaa', 'aa'].includes(normalized)) {
        return { intent: 'CANCEL', amount, recipient };
    }

    const term = Object.entries(TERM_ALIASES).find(([, words]) => containsAny(normalized, words));
    if (term && containsAny(normalized, ['explique', 'signifie', 'definition', 'meaning', 'explain', 'what is', 'cest quoi', 'bayani', 'fombo'])) {
        return { intent: 'TERM_EXPLANATION', term: term[0], amount, recipient };
    }

    if (containsAny(normalized, ['historique', 'history', 'transactions', 'tarihi', 'mam me nga bôban', 'mam me moni'])) {
        return { intent: 'TRANSACTION_HISTORY', amount, recipient };
    }

    if (containsAny(normalized, ['frais', 'fee', 'fees', 'combien coute', 'combien ca coute', 'cost', 'how much', 'kudin sabis', 'manga', 'maŋga'])) {
        return { intent: 'FEE_INQUIRY', term: term && term[0], amount, recipient };
    }

    if (containsAny(normalized, ['solde', 'balance', 'moni a lii', 'ragowar kudi', 'kudin asusu'])) {
        return { intent: 'BALANCE_INQUIRY', amount, recipient };
    }

    if (containsAny(normalized, ['airtime', 'credit', 'kredi', 'recharge', 'recharger', 'katin waya', 'top up'])) {
        return { intent: 'AIRTIME_PURCHASE', amount, recipient };
    }

    if (containsAny(normalized, ['transfer', 'transfert', 'transfere', 'envoyer', 'envoie', 'send', 'aika kudi', 'lom moni'])) {
        return { intent: 'TRANSFER', amount, recipient };
    }

    if (containsAny(normalized, ['beneficiaire', 'beneficiary', 'recipient'])) {
        return { intent: 'TERM_EXPLANATION', term: 'beneficiary', amount, recipient };
    }

    if (containsAny(normalized, ['plafond', 'limite', 'limit', 'iyaka'])) {
        return { intent: 'TERM_EXPLANATION', term: 'limit', amount, recipient };
    }
    if (term) return { intent: 'TERM_EXPLANATION', term: term[0], amount, recipient };

    return { intent: 'UNKNOWN', amount, recipient };
}

function languageCode(language) {
    const raw = String(language || '').trim().toLowerCase();
    const code = normalize(raw.split(/[-_]/, 1)[0]);
    const aliases = {
        anglais: 'en',
        eng: 'en',
        english: 'en',
        francais: 'fr',
        french: 'fr',
        fra: 'fr',
        fre: 'fr',
        ful: 'fub',
        fulfulde: 'fub',
        fula: 'fub',
        ff: 'fub',
        pulaar: 'fub',
    };

    return aliases[code] || (/^[a-z]{2,3}$/.test(code) ? code : null);
}

function phoneKey(phone) {
    return String(phone || '').replace(/\D/g, '');
}

function getLanguagePreference(phone) {
    return languagePreferences.get(phoneKey(phone)) || null;
}

function setLanguagePreference(phone, language) {
    const key = phoneKey(phone);
    const code = languageCode(language);

    if (key && code) languagePreferences.set(key, code);
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
    return value.replace(/[٠-٩۰-۹]/g, (digit) => {
        const code = digit.charCodeAt(0);

        return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
    });
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

module.exports = { understand, say, parseInput, languageCode, getLanguagePreference, setLanguagePreference };
