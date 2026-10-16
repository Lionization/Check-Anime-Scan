# Directives & Guide d'Orientation Agent - Check Anime & Scans

Ce fichier est le guide d'introspection rapide du projet pour économiser des tokens et orienter immédiatement tout agent sur l'architecture, la localisation des composants et les règles métier critiques.

---

## 1. Rôle & Architecture Globale

Le projet est un écosystème en 3 volets interconnecté sans serveur via **GitHub Gist (`suivi.json`)** :
1. **Extension Google Chrome (Manifest V3)** : Scanne les favoris du navigateur, alerte via badge/notifications, synchronise avec le Gist.
2. **PWA Mobile Tactile (`pwa/`)** : Application web installable (Android/iOS/Desktop), lecture hors-ligne, lecteur d'ambiance 24/7, validation de lecture et push notifications.
3. **Scraper Cloud Autonome (`scripts/cloud-scraper.mjs`)** : Exécuté toutes les 3 heures par GitHub Actions (`.github/workflows/check-scans.yml`) pour vérifier les sorties et envoyer les Web Push.

---

## 2. Carte des Fichiers & Localisation Rapide (« Où chercher ? »)

| Périmètre | Fichiers Clés | Rôle & Contenu |
| :--- | :--- | :--- |
| **PWA Mobile** | `pwa/index.html` | Interface PWA sémantique, lecteur audio zen, modales dialog, liste d'animes/scans. |
| **PWA Styles** | `pwa/app.css` | Thème sombre Vanilla, animations (`.read-out`, `.rotating`), responsive touch-first (zéro framework). |
| **PWA Logique** | `pwa/app.js` | Gestion client, file d'attente Gist debouncée (450ms), historique popstate, lecteur radio HTML5. |
| **PWA Version** | `pwa/version.js` | Source unique de vérité `self.APP_VERSION` partagée entre l'UI et le Service Worker. |
| **PWA Offline/Cache** | `pwa/sw.js` | Service Worker PWA (mise en cache App Shell, bypass flux audio et API GitHub, background sync). |
| **Extension Manifest** | `manifest.json` | Déclaration Manifest V3, permissions (`alarms`, `bookmarks`, `storage`, `notifications`). |
| **Extension Background** | `background/service-worker.js` | Tâche de fond Chrome, alarmes périodiques de vérification des favoris. |
| **Extension Gist Sync** | `background/gist-sync.js` | Réconciliation bidirectionnelle Chrome ↔ Gist, normalisation d'URLs (`normalizeUrlKey`). |
| **Scraping Extension** | `background/adapters/` | Adaptateurs DOM dédiés : `anime-sama.js`, `webtoons.js`, `mangago.js`. |
| **Extension UI** | `popup/` | Interface popup Chrome (`popup.html`, `popup.css`, `popup.js`). |
| **Extension Options** | `options/` | Page de réglages (`options.html`, `options.js`). |
| **Utilitaires Partagés** | `utils.js` | Fonctions pures : `extractEpisodeNumber`, `cleanTitle`, `cleanStateDisplay`, `decodeHTMLEntities`, `runWithConcurrency`. |
| **Cloud Scraper** | `scripts/cloud-scraper.mjs` | Script Node.js de scraping périodique exécuté en runner GitHub Actions. |
| **Tests & QA** | `test-adapters.mjs` | Suite de tests exhaustive avec assertions strictes (`npm test`). |

---

## 3. Règles Métier & Anti-Pièges Critiques

1. **Règle de Détection Lu / Non Lu (`isItemUnread`)** :
   - Toujours comparer les numéros mathématiques (`extractEpisodeNumber(userProgress) >= extractEpisodeNumber(latestEpisode)`).
   - Ne **jamais** comparer les chaînes brutes (les sites changent les sous-titres, par ex. *« Chapitre 105 »* vs *« Chapitre 105 : Fin »*).
   - `isNew: false` a toujours la priorité absolue si l'utilisateur a marqué l'élément comme lu.

2. **Synchronisation Gist (File d'Attente & Anti-Écrasement)** :
   - Tout appel d'écriture vers le Gist dans `pwa/app.js` doit passer par `scheduleSaveItemsToGist()` (debounce de 450ms) pour éviter les requêtes concurrentes HTTP 409/422.
   - Ne jamais laisser le scraper réécrire `isNew: true` si l'utilisateur a déjà progressé au même chapitre ou au-delà.

3. **Lecteur Radio d'Ambiance Zen (`pwa/app.js`)** :
   - Les flux radios actuels sont 100% sans publicité : `anime_ost` (Stereo Anime) et `plaza` (Nightwave Plaza).
   - Le volume est verrouillé à `1.0` pour déléguer intégralement la gestion au mixeur matériel du smartphone (aucun curseur de volume dans le DOM).
   - Ne pas déclencher de rechargement complet de la page (`window.location.reload`) lors du rafraîchissement des scans (le swipe vers le bas utilise uniquement `loadDataFromGist(true)` sans couper l'audio).
   - Seul le bouton `#refresh-btn` de l'en-tête est dédié à l'actualisation de la PWA et du Service Worker.

4. **Standards Techniques & Clean Code** :
   - JavaScript Vanilla ES6+ pur (zéro bundler, zéro React, zéro lodash).
   - CSS3 moderne avec variables `:root`, `:has()`, `@media (prefers-reduced-motion)`.
   - Zéro emoji dans les réponses et commits (règle projet stricte).

---

## 4. Commandes de Validation QA

Avant de clore toute tâche, exécuter impérativement :
```bash
# Contrôle de syntaxe global
for f in $(find . -maxdepth 3 -name "*.js" -not -path "*/node_modules/*" -not -path "*/.git/*"); do node -c "$f" || exit 1; done

# Suite de tests complète (10 assertions strictes et cas limites)
npm test
```
Code retour attendu : `0`.
