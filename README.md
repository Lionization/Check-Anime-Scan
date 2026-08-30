<p align="center">
  <img src="./assets/icon-transparent.png" alt="Check Anime & Scans Logo" width="120" />
</p>

<h1 align="center">Check Anime & Scans</h1>

<p align="center">
  <strong>Extension Google Chrome moderne pour tracker et vérifier automatiquement les sorties d'animes et de scans.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Manifest-V3-blue.svg" alt="Manifest V3" />
  <img src="https://img.shields.io/badge/Platform-Google%20Chrome-orange.svg" alt="Google Chrome" />
  <img src="https://img.shields.io/badge/Status-Active-success.svg" alt="Status" />
</p>

<p align="center">
  <img src="./assets/promo-banner.png" alt="Bannière Promo Check Anime & Scans" width="100%" />
</p>

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
├── assets/          # Visuels HD (logo transparent, bannière promo)
├── background/      # Adaptateurs de scraping et service worker
├── background.js    # Service Worker (Manifest V3)
├── content/         # Scripts de contenu injectés
├── icons/           # Déclinaisons d'icônes (16px, 48px, 128px, 500px)
├── offscreen/       # Document offscreen pour le parsing DOM
├── popup/           # Interface utilisateur (HTML5 / CSS3 / Vanilla JS)
└── manifest.json    # Déclaration de l'extension Chrome MV3
```
