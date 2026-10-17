# Règles de l'Agent - Projet Check Anime & Scans

Ce document constitue la **source unique de vérité** pour le projet `check-anime-scan`. Il est conçu pour donner à tout agent IA un **modèle mental immédiat et sans ambiguïté** dès la première lecture, afin de résoudre les tâches chirurgicalement et d'économiser un maximum de tokens.

---

## 0. Modèle Mental en 10 Secondes (TL;DR)

- **Objectif du projet** : Suivre automatiquement les sorties d'animes et de chapitres de scans sans dépendre d'un serveur applicatif lourd.
- **Le Pivot Central** : Un fichier JSON unique `suivi.json` stocké sur un **GitHub Gist secret**.
- **Qui écrit quoi ?** :
  - **L'Extension Chrome (PC)** et le **Scraper Cloud (GitHub Actions)** scannent le Web et renseignent `latestEpisode` et `isNew: true`.
  - **La PWA Mobile** permet à l'utilisateur de lire, cliquer sur `+1` ou `Valider lu`, mettant à jour `userProgress` et forçant `isNew: false`.
- **Règle d'or** : Jamais de comparaison textuelle sur les chapitres. Toujours une extraction numérique (`extractEpisodeNumber`).

---

## 1. Schéma Canonique des Données (`suivi.json`)

Toutes les briques du projet partagent ce format de données strict, indexé par l'URL normalisée (`normalizeUrlKey`) :

```json
{
  "https://anime-sama.fr/catalogue/solo-leveling": {
    "url": "https://anime-sama.fr/catalogue/solo-leveling",
    "title": "Solo Leveling",
    "latestEpisode": "Épisode 24",
    "userProgress": "Épisode 23",
    "isNew": true,
    "lastChecked": 1729123456789,
    "category": "ANIMES",
    "image": "https://anime-sama.fr/images/cover.jpg"
  }
}
```

- Si `extractEpisodeNumber(userProgress) >= extractEpisodeNumber(latestEpisode)` ➔ L'élément est **lu** (`isItemUnread = false`).
- Si `extractEpisodeNumber(userProgress) < extractEpisodeNumber(latestEpisode)` ET `isNew !== false` ➔ L'élément est **non lu** (`isItemUnread = true`).

---

## 2. Table d'Orientation Immédiate (« Si la demande concerne X ➔ Aller dans Y »)

| Intention ou Problème Signalé | Fichier(s) à Ouvrir | Fonctions ou Sélecteurs Clés |
| :--- | :--- | :--- |
| **Bouton +1, Marquage lu, Tri, Filtres PWA** | `pwa/app.js` | `markAsRead()`, `isItemUnread()`, `renderItems()`, `updateStatusUI()` |
| **Geste Swipe vers le bas (Pull-to-Refresh)** | `pwa/app.js` | `initPullToRefresh()` (déclenche `loadDataFromGist(true)` sans reload) |
| **Lecteur Radio Zen (musique d'ambiance 24/7)** | `pwa/app.js`, `pwa/index.html` | Constante `ZEN_STATIONS`, fonction `initZenAudioPlayer()`, `audioElement` |
| **Design, Thème sombre, Animations PWA** | `pwa/app.css` | `.zen-player`, `.read-out`, `.icon-btn.rotating`, variables `:root` |
| **Version PWA, Cache ou Problème Service Worker** | `pwa/version.js`, `pwa/sw.js` | `self.APP_VERSION`, cache `APP_SHELL`, événements `install`/`activate` |
| **Bouton d'actualisation de l'application PWA** | `pwa/app.js`, `pwa/index.html` | `#refresh-btn` (déclenche `reg.update()` et `window.location.reload()`) |
| **Synchronisation Gist & File d'attente mobile** | `pwa/app.js` | `scheduleSaveItemsToGist()` (debounce 450ms), `executeSaveItemsToGist()` |
| **Ajout/Correction d'un scraper de site manga/anime**| `background/adapters/` | `anime-sama.js`, `webtoons.js`, `mangago.js` |
| **Synchronisation Gist côté Extension Chrome** | `background/gist-sync.js` | `syncStorageWithGist()`, `normalizeUrlKey()`, `reconcileGistData()` |
| **Tâche de fond Extension Chrome (alarmes)** | `background/service-worker.js`| Événement `chrome.alarms.onAlarm`, `updateBadgeCount()` |
| **Scraper Cloud programmé (GitHub Actions)** | `scripts/cloud-scraper.mjs` | `checkAllBookmarks()`, `sendWebPush()`, `.github/workflows/check-scans.yml` |
| **Utilitaires communs (nombres, titres, dates)** | `utils.js` | `extractEpisodeNumber()`, `cleanTitle()`, `cleanStateDisplay()`, `formatRelativeTime()` |
| **Tests & Validation de non-régression** | `test-adapters.mjs` | `npm test` (10 assertions strictes `node:assert/strict`) |

---

## 3. Matrice « CE QU'IL FAUT FAIRE » vs « CE QU'IL NE FAUT PAS FAIRE » (DO vs DON'T)

| Domaine | ❌ CE QU'IL NE FAUT PAS FAIRE (Anti-Patterns) | ✅ CE QU'IL FAUT FAIRE (Bonnes Pratiques) |
| :--- | :--- | :--- |
| **Détection Lu/Non lu** | Comparer les chaînes textuelles : `userProgress === latestEpisode` (échoue si un site ajoute *: Fin du combat*). | Comparer numériquement : `extractEpisodeNumber(userProgress) >= extractEpisodeNumber(latestEpisode)`. |
| **Rafraîchissement Scans**| Appeler `window.location.reload()` lors du swipe vers le bas (coupe brutalement la radio en cours). | Appeler `loadDataFromGist(true)` qui met à jour le DOM sans recharger la page. |
| **Volume Audio** | Ajouter un curseur `<input type="range">` dans le DOM (inopérant sur OS mobile). | Fixer `audioElement.volume = 1.0` et déléguer intégralement aux touches physiques du téléphone. |
| **Écriture Gist** | Lancer des requêtes PATCH directes à chaque clic (provoque des erreurs HTTP 409/422). | Passer par `scheduleSaveItemsToGist()` qui debounce à 450ms et fusionne les actions rapides. |
| **Frameworks & Build** | Introduire du React, Vue, Tailwind ou un bundler (Vite, Webpack). | Écrire exclusivement du JavaScript Vanilla (ES6+), HTML5 et CSS3 pur non minifié. |
| **Communication** | Utiliser des emojis, des flatteries ou paraphraser les demandes. | Réponses sobres, techniques, chirurgicales et en français sans aucun emoji. |

---

## 4. Règles Strictes d'Ingénierie (Lignes Rouges)

1. **Zéro Secret en Dur** : Ne jamais écrire de tokens GitHub, identifiants ou clés privées VAPID dans le code source.
2. **Aucun Appel Réseau Arbitraire** : Ne pas lancer de requêtes réseau en ligne de commande (`curl`, `wget`) sans demande explicite.
3. **Priorité à l'Action Utilisateur** : Si un manga a été marqué lu sur mobile (`isNew: false`), aucun scraper automatique ne doit réécraser `isNew: true`.
4. **Flux Radio 100% Sans Pub** : Ne référencer que des stations communautaires sans publicité (`anime_ost`: Stereo Anime, `plaza`: Nightwave Plaza).
5. **Modifications Chirurgicales** : Toujours privilégier `replace_file_content` sur des blocs précis plutôt que de réécrire des fichiers entiers.

---

## 5. Détails Spécifiques PWA & Service Worker

- **Source de Vérité de Version & Règle Pré-Push** : Le numéro de version réside exclusivement dans `pwa/version.js` (`self.APP_VERSION`).
  - **OBLIGATION SYSTÉMATIQUE** : Avant chaque commit et push (`git push`), l'agent **DOIT IMPÉRATIVEMENT** incrémenter le numéro de version (SemVer patch, ex: `2.1.2` ➔ `2.1.3`) dans `pwa/version.js` de manière autonome, sans attendre de rappel de l'utilisateur.
  - L'exécution de `npm test` synchronise ensuite automatiquement `manifest.json` et `package.json` via `scripts/sync-version.mjs`.
  - `pwa/index.html`, le popup et les options affichent cette version dynamique.
  - `pwa/sw.js` l'utilise pour nommer son cache : `check-scans-v${self.APP_VERSION}`.
- **Règle de Cache PWA (`pwa/sw.js`)** :
  - **App Shell mis en cache** : `./`, `index.html`, `app.css`, `app.js`, `version.js`, `manifest.json`, icônes.
  - **Bypass absolu** : Toute requête vers l'API GitHub (`api.github.com`) ou le streaming audio (`.mp3` ou `destination === 'audio'`) doit traverser directement vers le réseau sans passer par le cache.
- **Navigation Tactile Android** : Les modales `<dialog>` s'ouvrent via `openModalWithHistory(dialog)` qui injecte un état `history.pushState`. Le geste retour Android ferme naturellement la modale via l'écouteur `popstate`.

---

## 6. Protocole de Validation QA Obligatoire

Avant de considérer une modification comme achevée, exécuter impérativement la commande suivante à la racine :

```bash
npm test
```

Cette commande exécute automatiquement :
1. Le contrôle syntaxique de l'ensemble des 14 fichiers `.js` via `node -c`.
2. Les tests des 3 adaptateurs de scraping (`anime-sama`, `webtoons`, `mangago`) en cas nominaux et dégradés.
3. La validation du décodage d'entités HTML et assainissement des titres.
4. L'extraction précise des numéros d'épisodes et chapitres (entiers, décimaux `.5` et tags masqués `|#145|`).
5. La conformité de la règle métier Lu / Non Lu anti-régression (`isItemUnread`).
6. La normalisation des clés d'URL Gist (`normalizeUrlKey`).
7. Le formatage temporel relatif en français (`formatRelativeTime`).
8. La limitation de concurrence et la résilience aux erreurs asynchrones (`runWithConcurrency`).

Critère d'acceptation : **Code retour 0 et 10/10 tests validés.**
