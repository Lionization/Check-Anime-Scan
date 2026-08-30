<div align="center">

  <img src="assets/icon-transparent.png" alt="Check Anime & Scans Logo" width="100" height="100" />

  # Check Anime & Scans

  **Extension Google Chrome moderne pour tracker et vérifier automatiquement les sorties d'animes et de scans.**

  [![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
  [![Platform](https://img.shields.io/badge/Platform-Google%20Chrome-orange.svg)](https://www.google.com/chrome/)
  [![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

  <br />

  <img src="assets/promo-banner.jpg" alt="Check Anime & Scans Banner" width="100%" />

</div>

---

## ✨ Fonctionnalités clés

- ⚡ **Vérification automatique en arrière-plan** : Détection des nouveaux épisodes et chapitres à intervalles réguliers.
- 🎯 **Organisation duale Anime / Scan** : Affichage séparé et structuré dans la popup pour distinguer vos séries vidéo et vos lectures de manga / webtoon.
- 🔔 **Compteur & Badges dynamiques** : Badge numérique sur l'icône de l'extension pour ne manquer aucune sortie.
- 🎨 **Interface Dark Mode soignée** : Thème sombre inspiré de l'univers cyber/anime avec affichage des jaquettes (*covers*).
- 👁️ **Gestion des lectures** : Marquage rapide comme lu / non lu individuel ou groupé.

---

## 🚀 Installation (Mode Développeur)

1. **Cloner le dépôt** :
   ```bash
   git clone git@github.com:Lionization/Check-Anime-Scan.git
   ```
2. Ouvrez Google Chrome et accédez à : `chrome://extensions/`
3. Activez le **Mode développeur** (interrupteur en haut à droite).
4. Cliquez sur **Charger l'extension non empaquetée** (*Load unpacked*).
5. Sélectionnez le dossier du projet `check-anime-scan`.

---

## 📁 Architecture du Projet

```text
check-anime-scan/
├── assets/          # Visuels haute définition (logo transparent, bannière promo)
├── background/      # Adaptateurs de scraping et logique de détection en tâche de fond
├── background.js    # Service Worker (Manifest V3)
├── content/         # Scripts de contenu injectés
├── icons/           # Déclinaisons d'icônes (16px, 48px, 128px, 500px)
├── offscreen/       # Document offscreen pour le parsing DOM
├── popup/           # Interface utilisateur (HTML5 / CSS3 / Vanilla JS)
└── manifest.json    # Déclaration de l'extension Chrome MV3
```
