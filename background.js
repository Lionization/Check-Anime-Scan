/**
 * @fileoverview Service Worker principal (Manifest V3) pour Check Anime & Scans.
 * Gère les alarmes, le menu contextuel, la synchronisation et la persistance.
 */

import { checkBookmarksForUpdates } from './background/scraper.js';
import { CONSTANTS, extractEpisodeNumber, updateBadgeCount, getAppSettings } from './utils.js';

// Initialisation à l'installation ou mise à jour de l'extension
chrome.runtime.onInstalled.addListener(async () => {
    console.log("Extension installée, configuration de l'alarme et des menus.");
    await restoreBadge();
    setupAlarm();
    setupContextMenus();
    checkBookmarksForUpdates();
});

// Initialisation au démarrage du navigateur
chrome.runtime.onStartup.addListener(async () => {
    await restoreBadge();
    setupAlarm();
    checkBookmarksForUpdates();
});

/**
 * Restaure immédiatement le badge depuis le stockage local au réveil du navigateur
 */
async function restoreBadge() {
    try {
        const localData = await chrome.storage.local.get(null);
        await updateBadgeCount(localData);
    } catch (e) {
        // Ignorer
    }
}

/**
 * Configuration des menus contextuels de clic droit
 */
function setupContextMenus() {
    chrome.contextMenus.removeAll(() => {
        if (chrome.runtime.lastError) {
            // Consomme l'erreur éventuelle de purge
        }
        chrome.contextMenus.create({
            id: 'add-anime',
            title: 'Ajouter aux Animes',
            contexts: ['page']
        }, () => {
            if (chrome.runtime.lastError) {
                // Ignore l'erreur silencieusement si déjà existant
            }
        });
        chrome.contextMenus.create({
            id: 'add-scan',
            title: 'Ajouter aux Scans',
            contexts: ['page']
        }, () => {
            if (chrome.runtime.lastError) {
                // Ignore l'erreur silencieusement si déjà existant
            }
        });
    });
}

// Gestion des actions du menu contextuel
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (!tab?.url) return;
    const targetFolder = info.menuItemId === 'add-anime' ? 'ANIMES' : 'SCANS';
    
    try {
        const bookmarks = await chrome.bookmarks.getTree();
        let folderId = null;
        
        function findFolder(nodes) {
            for (const node of nodes) {
                if (node.title && node.title.toUpperCase() === targetFolder && !node.url) {
                    folderId = node.id;
                    return true;
                }
                if (node.children && findFolder(node.children)) {
                    return true;
                }
            }
            return false;
        }
        
        findFolder(bookmarks);
        
        if (folderId) {
            await chrome.bookmarks.create({
                parentId: folderId,
                title: tab.title || 'Nouveau favori',
                url: tab.url
            });
            chrome.notifications.create({
                type: 'basic',
                iconUrl: CONSTANTS.DEFAULT_ICON,
                title: 'Ajout réussi',
                message: `« ${tab.title || tab.url} » a été ajouté à vos favoris ${targetFolder} !`
            });
            checkBookmarksForUpdates();
        } else {
            chrome.notifications.create({
                type: 'basic',
                iconUrl: CONSTANTS.DEFAULT_ICON,
                title: 'Dossier introuvable',
                message: `Le dossier « ${targetFolder} » n'existe pas dans vos favoris Chrome.`
            });
        }
    } catch (error) {
        console.error("Erreur lors de l'ajout via menu contextuel:", error);
    }
});

/**
 * Configure l'alarme périodique de vérification en arrière-plan
 */
async function setupAlarm() {
    try {
        const settings = await getAppSettings();
        chrome.alarms.create(CONSTANTS.ALARM_NAME, { periodInMinutes: settings.checkInterval });
        console.log(`Alarme configurée toutes les ${settings.checkInterval} minutes.`);
    } catch (e) {
        chrome.alarms.create(CONSTANTS.ALARM_NAME, { periodInMinutes: CONSTANTS.DEFAULT_INTERVAL_MINUTES });
    }
}

// Déclencheur d'alarme
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === CONSTANTS.ALARM_NAME) {
        checkBookmarksForUpdates();
    }
});

// Écouteur central de messages inter-processus
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'forceCheck') {
        checkBookmarksForUpdates().then(() => sendResponse({ status: 'done' }));
        return true;
    }
    
    if (request.action === 'reconfigureAlarm') {
        setupAlarm().then(() => sendResponse({ status: 'alarm_updated' }));
        return true;
    }
    
    if (request.action === 'markAsRead' || request.action === 'markAsReadVideo') {
        handleMarkAsRead(request, sender);
    }
});

/**
 * Vérifie si une URL de favori correspond à l'URL de l'onglet actif
 * @param {string} favUrlStr 
 * @param {string} currentUrlStr 
 * @returns {boolean}
 */
function isMatchingBookmarkUrl(favUrlStr, currentUrlStr) {
    try {
        const favUrl = new URL(favUrlStr);
        const currentUrl = new URL(currentUrlStr);

        // Cas 1 : Anime-Sama (support multi-domaines .fr, .si, .me, etc. et slugs de catalogue)
        if (favUrl.hostname.includes('anime-sama') && currentUrl.hostname.includes('anime-sama')) {
            const favSlug = favUrl.pathname.match(/\/catalogue\/([^/]+)/i);
            const currSlug = currentUrl.pathname.match(/\/catalogue\/([^/]+)/i);
            if (favSlug && currSlug) {
                return favSlug[1].toLowerCase() === currSlug[1].toLowerCase();
            }
            const cleanFav = favUrl.pathname.replace(/\/$/, '');
            return currentUrl.pathname.includes(cleanFav);
        }

        // Cas 2 : Webtoons
        if (favUrl.hostname.includes('webtoons.com') && currentUrl.hostname.includes('webtoons.com')) {
            const favTitleNo = favUrl.searchParams.get('title_no');
            const currentTitleNo = currentUrl.searchParams.get('title_no');
            if (favTitleNo && currentTitleNo && favTitleNo === currentTitleNo) {
                return true;
            }
            const basePath = favUrl.pathname.replace(/\/list\/?$/, '');
            return currentUrl.pathname.includes(basePath);
        }

        // Cas 3 : Autres plateformes
        if (favUrl.hostname === currentUrl.hostname) {
            const cleanFavPath = favUrl.pathname.replace(/\/$/, '');
            return currentUrl.pathname.includes(cleanFavPath);
        }

        return false;
    } catch {
        return false;
    }
}

/**
 * Marque un élément comme lu et synchronise les états
 */
async function handleMarkAsRead(request, sender) {
    const tabUrl = sender.tab ? sender.tab.url : request.url;
    if (!tabUrl) return;

    let progressText = request.progressText;

    if (request.action === 'markAsReadVideo' && sender.tab) {
        try {
            // Envoi ciblé au top frame (frameId: 0) qui contient le DOM principal d'Anime-Sama
            const response = await chrome.tabs.sendMessage(sender.tab.id, { action: "getAnimeSamaEpisode" }, { frameId: 0 });
            if (response?.episodeText) {
                progressText = response.episodeText;
            }
        } catch (e) {
            console.log("Erreur de récupération d'épisode vidéo:", e);
        }
    }

    try {
        const data = await chrome.storage.local.get(null);
        let matchedKey = null;
        let matchedItem = null;

        for (const key in data) {
            const item = data[key];
            if (item?.url && isMatchingBookmarkUrl(item.url, tabUrl)) {
                matchedKey = key;
                matchedItem = item;
                break;
            }
        }

        if (matchedItem && matchedKey) {
            matchedItem.userProgress = progressText || matchedItem.latestState;
            
            const numUser = extractEpisodeNumber(matchedItem.userProgress);
            const numLatest = extractEpisodeNumber(matchedItem.latestState);
            
            if (numUser >= numLatest && numUser > 0) {
                matchedItem.isNew = false;
            } else if (matchedItem.userProgress === matchedItem.latestState) {
                matchedItem.isNew = false;
            } else if (!numLatest && progressText) {
                matchedItem.isNew = false;
            } else {
                matchedItem.isNew = (numUser < numLatest);
            }

            await chrome.storage.local.set({ [matchedKey]: matchedItem });
            
            // Mise à jour centralisée du badge
            const updatedData = await chrome.storage.local.get(null);
            await updateBadgeCount(updatedData);
        }
    } catch (error) {
        console.error("Erreur lors du marquage comme lu:", error);
    }
}

// Nettoyage immédiat du storage lors de la suppression d'un favori Chrome
chrome.bookmarks.onRemoved.addListener((id) => {
    chrome.storage.local.remove(id, () => {
        console.log(`Favori ${id} supprimé du stockage local.`);
    });
});
