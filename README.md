# Kit de démarrage SAFINUM Innovate Challenge 2026 — Node.js

Un middleware qui **respecte le contrat** de la sandbox sur plusieurs canaux :

- **USSD** : menu, consultation du solde, transfert de crédit (vers son numéro ou un autre), avec récapitulatif puis confirmation dans un tour séparé.
- **IVR** : les tours audio sont transcrits puis traités par le même parcours que l'USSD. Configurez `VOICE_STT_API_KEY` (et, si besoin, `VOICE_STT_URL` et `VOICE_STT_MODEL`) pour activer la transcription.
- **SMS** : mêmes parcours que l'USSD, avec contexte conservé par numéro lorsque `session_id` est absent.
- **Mobile, web et ATM** : traduction des écrans de l'application bancaire (`ui_translation`), avec les chaînes ATM présentes dans les dictionnaires.

Il fournit une couche linguistique pour les parcours bancaires simulés. Le middleware gère le format des réponses, les appels à la banque et `X-Trace-Id`.

Aucune dépendance à installer. Prérequis : Node.js 18 ou plus récent.

## 1. Lancer en local

```bash
cp .env.example .env        # puis collez votre clé d'équipe (sbx_...) dans SAFINUM_TEAM_KEY
node server.js
```

Vérification : ouvrez <http://localhost:8080> dans un navigateur, vous devez voir `{"ok":true,...}`.

## 2. Exposer une URL publique

La sandbox est sur Internet : elle ne peut pas joindre votre `localhost`. Ouvrez un tunnel :

```bash
cloudflared tunnel --url http://localhost:8080
# ou
ngrok http 8080
```

Notez l'URL `https://...` affichée. Les URL gratuites changent à chaque redémarrage du tunnel : refaites l'étape 3 à chaque fois.

## Déployer sur Render

Le dépôt contient un Blueprint `render.yaml`. Dans Render, créez un Blueprint depuis ce dépôt et fournissez `SAFINUM_TEAM_KEY` lorsque demandé. Render publiera le service en HTTPS; au démarrage, le serveur enregistrera automatiquement cette URL pour les canaux `ussd`, `mobile`, `web`, `sms`, `ivr` et `atm`.

La clé est un secret Render : ne la mettez pas dans `render.yaml`, dans Git ou dans une capture d'écran. Après le déploiement, vérifiez `/health` et consultez les journaux Render pour confirmer que chaque canal a été enregistré. `SAFINUM_AUTO_REGISTER` peut être désactivé si vous préférez configurer les URL manuellement.

Les états de conversation restent en mémoire : un redémarrage Render les efface. Gardez une seule instance pour cette version, et choisissez une instance toujours active pour éviter les délais de réveil pendant une démonstration. L'ATM est enregistré pour la traduction de ses écrans; les parcours de transaction ATM ne sont pas gérés par ce dépôt.

## 3. Déclarer votre URL

```bash
curl -X POST https://safinum.cm/api/v1/sandbox/endpoint \
  -H "X-Team-Key: sbx_VOTRE_CLE" -H "Content-Type: application/json" \
  -d '{"channel": "ussd", "url": "https://VOTRE-TUNNEL"}'
```

Pour l'inscription manuelle, envoyez une requête pour chaque canal activé (`ussd`, `mobile`, `web`, `sms`, `ivr` et `atm`) ; la même URL peut servir ces canaux, le kit aiguille selon le contenu de la requête.

## 4. Tester

- **Dans le simulateur** : https://safinum.cm/sandbox/ussd (USSD), https://safinum.cm/sandbox/channel/mobile (mobile), https://safinum.cm/sandbox/channel/web (web). Composez le code, tapez `1` (solde) ou `2` (crédit), puis confirmez au tour suivant.
- **Sans la sandbox**, en envoyant vous-même un tour au kit :

```bash
curl -X POST http://localhost:8080 -H "Content-Type: application/json" -d @samples/ussd-1-menu.json
curl -X POST http://localhost:8080 -H "Content-Type: application/json" -d @samples/ussd-2-solde.json
curl -X POST http://localhost:8080 -H "Content-Type: application/json" -d @samples/ui-accueil-en.json
```

Dans les exemples USSD, remplacez `237690000000` par un numéro de vos comptes de test (liste dans le simulateur), sinon la banque répond "Compte introuvable", ce qui prouve tout de même que la chaîne fonctionne.

## 5. Brancher votre couche linguistique

| Fichier | Rôle | À modifier ? |
| ------- | ---- | ------------ |

| `language.js` | Votre couche linguistique : `understand()` et `say()` | **Oui** |
| `ussd.js` | Parcours USSD et moteur bancaire partagé avec SMS | Non |
| `sms.js` | Adaptation SMS, contexte par numéro, estimation des segments facturés | Non |
| `ui.js` | Traduction des écrans mobile, web et ATM | Non |
| `bank.js` | Appels à l'API bancaire (`X-Team-Key`, `X-Trace-Id`) | Non |
| `server.js` | Serveur HTTP, aiguillage USSD / écrans | Non |
| `translations/<langue>.json` | Traductions des écrans mobile/web et des messages USSD | **Oui** |
| `samples/` | Requêtes d'exemple de la passerelle | Non |

- **USSD** : `understand(texte, langue)` ramène la saisie de l'utilisateur à un choix de menu ; `say(texte, langue)` traduit chaque phrase française du kit et **renvoie la langue réellement utilisée**.
- **SMS** : réponse synchrone HTTP 200 avec le contrat habituel. Les messages sont traités comme des tours indépendants, avec l'état de parcours associé au numéro (en mémoire). La réponse est mesurée en segments GSM-7 ou UCS-2; chaque segment supplémentaire est signalé dans les journaux. Les messages ne sont pas tronqués.
- Les traductions USSD sont stockées dans chaque dictionnaire sous les clés `ussd.*`. `language.js` associe les phrases du kit à ces clés et remplace les emplacements comme `{amount}` ; il ne contient pas les textes traduits. Les textes USSD doivent rester en GSM-7 et sous 182 caractères.
- Les SMS utilisent les tailles standard d'un segment (160 unités GSM-7 ou 70 unités UCS-2), puis les tailles concaténées (153 ou 67). Des caractères tels que `ɛ` ou l'apostrophe courbe font passer le SMS en UCS-2.
- **Mobile et web** : `translations/en.json` est fourni en exemple, complet. Les langues actuellement disponibles sont le français, l'anglais, le hausa, l'ewondo, le fulfulde et le kamtok (`wes`). Les textes source arrivent dans chaque requête (`strings.<clé>.text`, avec `context` et `max_chars`).

## Ce que la sandbox vérifie (et que le kit respecte déjà)

1. **`X-Trace-Id`** : recopié sur chaque appel bancaire. Sans lui, le jury ne voit aucun de vos appels.
2. **Confirmation dans un tour séparé** : l'opération est créée, l'utilisateur lit le récapitulatif, puis confirme au tour suivant.
3. **Intentions de la liste officielle** uniquement (`BALANCE_INQUIRY`, `AIRTIME_PURCHASE`, `CONFIRM`...). Une faute de casse rend la réponse invalide.
4. **USSD** : 182 caractères au plus, alphabet GSM-7. Les lettres ɛ ɔ ŋ ə et l'apostrophe courbe ne passent pas sur un vrai réseau ; le kit l'affiche dans la console.
5. **Langue déclarée honnête** : sans traduction, déclarez `fr`. Renvoyer du français en déclarant `dua` est repéré.
6. **Écrans** : emplacements `{amount}`, `{name}` intacts, `max_chars` respecté, clés absentes remplacées par le français (et signalées).
7. **Délais** : 3 secondes pour un tour USSD, 10 secondes pour un écran.

Documentation complète : https://safinum.cm/sandbox/docs
