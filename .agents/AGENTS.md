# Règles de l'Agent - Projet Check Anime & Scans

Ce document constitue la source unique de vérité pour le projet `check-anime-scan`. Il rassemble les directives impératives de sécurité, les conventions d'ingénierie, l'orientation rapide des fichiers et les règles métier critiques du triptyque (Extension Chrome MV3, PWA Mobile et Scraper Cloud).

---

## 1. Rôle & Cadrage Général

- **Expertise** : Ingénieur logiciel senior spécialisé en **JavaScript Vanilla (ES6+)**, **HTML5 sémantique**, **CSS3 moderne**, **Service Workers** et **Chrome Extensions Manifest V3**.
- **Philosophie Front-End** : Zéro framework lourd (pas de React, pas de Vue), zéro bundler (pas de Webpack, pas de Vite), zéro utilitaire CSS imposé (pas de Tailwind). Code source pur, lisible, modulaire et directement exécutable par le navigateur.
- **Modifications chirurgicales** : Remplacements ciblés des blocs modifiés (diffs précis). Ne jamais régénérer un fichier complet sauf demande expresse.
- **Langue & Documentation** : Commentaires techniques, commits conventionnels et documentation exclusivement en **Français**. Code auto-porteur privilégié (*self-documenting code*).
- **Communication sobre** : Réponses concises, centrées sur la cause racine, la mécanique et le patch concret (zéro flatterie, et strictement aucun emoji).

---

## 2. Règles Strictes (Lignes Rouges)

Il est formellement interdit de déroger aux règles suivantes :

1. **Sanctuaire des Secrets** : Interdiction absolue de consigner des jetons GitHub (*Personal Access Tokens*), clés VAPID ou identifiants sensibles en dur dans le code, même pour des tests ou des mocks.
2. **Commandes Réseau Non Sollicitées** : Aucun appel réseau externe arbitraire en ligne de commande (`curl`, `wget`, requêtes distantes non demandées).
3. **Persistance des Données de Lecture** : Ne jamais écraser l'état lu validé par l'utilisateur (`isNew: false`) lors de réconciliations ou de passages de scrapers automatisés.
4. **Volume Matériel Dédié** : Ne jamais réintroduire de curseur logiciel de volume dans le DOM de la PWA. Le volume logiciel de l'élément `<audio>` reste verrouillé à `1.0` pour déléguer la dynamique au mixeur physique du smartphone.
5. **Gestion du Rechargement de Page** : Ne jamais appeler `window.location.reload()` lors du rafraîchissement des mangas/animes (swipe vers le bas). Seul le bouton `#refresh-btn` de l'en-tête est autorisé à recharger l'App Shell pour appliquer les mises à jour PWA/SW.

---

## 3. Architecture Triptyque & Flux de Données

Le projet fonctionne sans serveur applicatif central (*serverless*), interconnecté via un **Gist GitHub secret (`suivi.json`)** :

```text
[Extension Chrome MV3]  <--- (PATCH / GET Gist) --->  [GitHub Gist : suivi.json]
                                                             ^
                                                             | (GET public / PATCH token)
[PWA Mobile Tactile]   <------------------------------------+
                                                             |
[Scraper Cloud GitHub Actions] --- (Cron 3h / Web Push) -----+
```

1. **Extension Chrome Desktop (MV3)** : Scanne les dossiers de favoris du navigateur (`ANIMES`, `SCANS`), détecte les nouveaux épisodes/chapitres et met à jour le Gist.
2. **PWA Mobile Tactile (`pwa/`)** : Client autonome installable (smartphone et desktop), lecture hors-ligne, lecteur d'ambiance zen 24/7, boutons d'action rapide (+1, Lu).
3. **Scraper Cloud Autonome (`scripts/cloud-scraper.mjs`)** : Exécuté toutes les 3 heures via GitHub Actions (`.github/workflows/check-scans.yml`) pour vérifier les sorties quand les terminaux sont fermés et expédier les notifications Web Push.

---

## 4. Carte d'Orientation Rapide des Fichiers (« Où chercher ? »)

| Périmètre | Emplacement | Rôle, Logique & Composants |
| :--- | :--- | :--- |
| **PWA - Structure** | `pwa/index.html` | Gabarit HTML5 sémantique, modales `<dialog>`, lecteur audio zen, conteneur de liste. |
| **PWA - Styles** | `pwa/app.css` | Thème sombre Vanilla, variables `:root`, animations fluides (`.read-out`, `.rotating`), responsive tactile. |
| **PWA - Logique Client** | `pwa/app.js` | File d'attente Gist debouncée (450ms), historique popstate, lecteur radio HTML5 et background sync. |
| **PWA - Versioning** | `pwa/version.js` | Source unique de vérité `self.APP_VERSION` partagée entre l'interface et le Service Worker. |
| **PWA - Service Worker** | `pwa/sw.js` | Stratégie Network-First sur l'App Shell, bypass des flux audio et de GitHub API, cache versionné. |
| **Extension - Manifest** | `manifest.json` | Déclaration Manifest V3, permissions (`alarms`, `bookmarks`, `storage`, `notifications`). |
| **Extension - Tâche de Fond** | `background/service-worker.js` | Gestionnaire d'alarmes périodiques de l'extension Chrome et calcul du badge numérique. |
| **Extension - Synchronisation** | `background/gist-sync.js` | Réconciliation bidirectionnelle Gist ↔ local, normalisation d'URL (`normalizeUrlKey`). |
| **Extension - Scrapers** | `background/adapters/` | Modules d'extraction DOM : `anime-sama.js`, `webtoons.js`, `mangago.js`. |
| **Extension - Popup** | `popup/` | Interface popup de l'extension Chrome (`popup.html`, `popup.css`, `popup.js`). |
| **Extension - Options** | `options/` | Page des réglages de l'extension (`options.html`, `options.js`). |
| **Utilitaires Partagés** | `utils.js` | Fonctions pures : `extractEpisodeNumber`, `cleanTitle`, `cleanStateDisplay`, `decodeHTMLEntities`, `runWithConcurrency`. |
| **Scraper Cloud** | `scripts/cloud-scraper.mjs` | Script Node.js autonome exécuté en runner GitHub Actions avec envoi Web Push (`web-push`). |
| **Automatisation CI** | `.github/workflows/check-scans.yml` | Workflow GitHub Actions déclenché toutes les 3 heures via cron. |
| **Tests & QA** | `test-adapters.mjs` | Suite complète de validation avec assertions strictes (`npm test`). |

---

## 5. Règles Métier & Anti-Pièges Critiques

### 1. Comparaison Numérique des Chapitres (`isItemUnread`)
- **Règle absolue** : La détection d'un nouvel épisode ou chapitre repose exclusivement sur la comparaison numérique issue de `extractEpisodeNumber()` :
  ```js
  const numUser = extractEpisodeNumber(item.userProgress || '');
  const numLatest = extractEpisodeNumber(item.latestEpisode || '');
  if (numUser > 0 && numLatest > 0) {
      return numUser < numLatest; // Lu dès que numUser >= numLatest
  }
  ```
- **Anti-piège** : Ne jamais comparer l'égalité stricte des chaînes textuelles. Les sites modifient fréquemment les sous-titres (ex: *« Chapitre 105 »* devient *« Chapitre 105 : Conclusion »*), ce qui engendrait des faux positifs non lus.

### 2. Synchronisation Gist : File d'Attente & Debounce
- Dans `pwa/app.js`, tout enregistrement vers GitHub Gist doit transiter par `scheduleSaveItemsToGist()` (debounce de 450ms).
- Cela garantit la coalescence des actions rapides (clics successifs sur +1 ou marquages en série) et neutralise les conflits HTTP 409/422 côté GitHub.

### 3. Lecteur Radio Zen & Flux sans Publicité
- Les flux configurés dans `ZEN_STATIONS` sont strictement associatifs et sans publicité commerciale :
  - `anime_ost` : Stereo Anime (OST d'animes & jeux vidéo).
  - `plaza` : Nightwave Plaza (Tokyo City Pop & Vaporwave).
- **Reconnexion automatique** : Écouteur `window.addEventListener('online')` pour relancer silencieusement le stream après passage en zone blanche ou tunnel.
- **MediaSession** : Intégration systématique des métadonnées et handlers sur `navigator.mediaSession` pour l'affichage écran de verrouillage / centre de contrôle.

### 4. Navigation & Historique Mobile (Popstate)
- Sur mobile Android, l'ouverture d'une modale (`<dialog>`) empile un état dans l'historique (`history.pushState`).
- L'appui sur le bouton retour matériel ou le geste tactile de glissement ferme la modale sans quitter l'application.

---

## 6. PWA, Service Worker & Stratégie de Cache

- **Mise à jour du code PWA** : Le fichier `pwa/version.js` est la source de vérité (`self.APP_VERSION`). Lors d'une montée de version, le Service Worker s'installe en tâche de fond (`skipWaiting`), purge les anciens caches dans l'événement `activate`, et prend le contrôle via `clients.claim()`.
- **Bypass de cache impératif** : Le Service Worker dans `pwa/sw.js` ne doit **jamais** intercepter ni mettre en cache :
  - Les flux de streaming audio (`.mp3` ou `destination === 'audio'`).
  - Les requêtes directes à l'API GitHub (`api.github.com`).
- **Distinction des actualisations** :
  - *Swipe vers le bas (Pull-to-Refresh)* : Déclenché par `initPullToRefresh()`, appelle `loadDataFromGist(true)` pour rafraîchir les données de lecture sans recharger la page et sans couper la radio.
  - *Bouton d'en-tête (`#refresh-btn`)* : Dédié à la mise à jour de la PWA, appelle `reg.update()` et recharge l'application (`window.location.reload()`).

---

## 7. Macro / Déclencheur d'Audit & Contrôle de Bout en Bout

Dès que l'utilisateur soumet l'une des expressions suivantes :
- `audit`, `/audit`, `vérifie`, `check`, `contrôle`, ou toute demande de vérification de bout en bout ;

L'agent applique **immédiatement et automatiquement** le protocole d'audit complet suivant sans demander confirmation :

1. **Contrôle Syntaxique Exhaustif** :
   ```bash
   for f in $(find . -maxdepth 3 -name "*.js" -not -path "*/node_modules/*" -not -path "*/.git/*"); do node -c "$f" || exit 1; done
   ```
2. **Suite de Tests d'Intégration Stricte** :
   ```bash
   npm test
   ```
   Exécute les 10 domaines de tests avec assertions strictes (`node:assert/strict`) :
   - Syntaxe globale du projet.
   - Cas nominaux et dégradés des adaptateurs Anime-Sama, Webtoons et Mangago.
   - Décodage des entités HTML doubles et nettoyage des titres.
   - Extraction numérique des décimaux et balises masquées.
   - Règle métier Lu / Non Lu anti-régression.
   - Normalisation des clés d'URL Gist.
   - Formatage des temps relatifs en français.
   - Gestion de la concurrence et résilience aux pannes réseau (`runWithConcurrency`).
3. **Purge du Code Mort** : Traque systématique des variables locales orphelines, clés de stockage inutilisées, classes CSS abandonnées et fonctions dupliquées.
4. **Restitution Sobre** : Présentation directe du bilan technique et des correctifs appliqués, sans aucun emoji.
