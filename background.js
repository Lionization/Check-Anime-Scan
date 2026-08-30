/**
 * @fileoverview Service Worker principal (Manifest V3) pour Check Anime & Scans.
 * Gère les alarmes, le menu contextuel, la synchronisation et la persistance.
 */

import { checkBookmarksForUpdates } from './background/scraper.js';
import { CONSTANTS, extractEpisodeNumber, updateBadgeCount } from './utils.js';

// Initialisation à l'installation ou mise à jour de l'extension
chrome.runtime.onInstalled.addListener(async () => {
    console.log("Extension installée, configuration de l'alarme et des menus.");
    await migrateToSync();
    setupAlarm();
    setupContextMenus();
    checkBookmarksForUpdates();
});

// Initialisation au démarrage du navigateur
chrome.runtime.onStartup.addListener(async () => {
    await migrateToSync();
    setupAlarm();
    setupContextMenus();
    checkBookmarksForUpdates();
});

/**
 * Migration transparente de chrome.storage.local vers chrome.storage.sync
 */
async function migrateToSync() {
    try {
        const localData = await chrome.storage.local.get(null);
        if (Object.keys(localData).length > 0) {
            console.log("Migration des données locales vers sync...");
            await chrome.storage.sync.set(localData);
            await chrome.storage.local.clear();
            console.log("Migration terminée avec succès.");
        }
    } catch (error) {
        console.error("Erreur lors de la migration vers sync:", error);
    }
}

/**
 * Configuration des menus contextuels de clic droit
 */
function setupContextMenus() {
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
            id: 'add-anime',
            title: 'Ajouter aux Animes',
            contexts: ['page']
        });
        chrome.contextMenus.create({
            id: 'add-scan',
            title: 'Ajouter aux Scans',
            contexts: ['page']
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
        const { getAppSettings } = await import('./utils.js');
        const settings = await getAppSettings();
        chrome.alarms.clear(CONSTANTS.ALARM_NAME, () => {
            chrome.alarms.create(CONSTANTS.ALARM_NAME, { periodInMinutes: settings.checkInterval });
            console.log(`Alarme configurée toutes les ${settings.checkInterval} minutes.`);
        });
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
 * Marque un élément comme lu et synchronise les états
 */
async function handleMarkAsRead(request, sender) {
    const tabUrl = sender.tab ? sender.tab.url : request.url;
    if (!tabUrl) return;

    let progressText = request.progressText;

    if (request.action === 'markAsReadVideo' && sender.tab) {
        try {
            const response = await chrome.tabs.sendMessage(sender.tab.id, { action: "getAnimeSamaEpisode" });
            if (response?.episodeText) {
                progressText = response.episodeText;
            }
        } catch (e) {
            console.log("Erreur de récupération d'épisode vidéo:", e);
        }
    }

    try {
        const data = await chrome.storage.sync.get(null);
        let matchedKey = null;
        let matchedItem = null;

        for (const key in data) {
            const item = data[key];
            if (item?.url) {
                try {
                    const favUrl = new URL(item.url);
                    const currentUrl = new URL(tabUrl);
                    
                    let isMatch = false;
                    
                    if (favUrl.hostname === currentUrl.hostname) {
                        if (favUrl.hostname.includes('webtoons.com')) {
                            const favTitleNo = favUrl.searchParams.get('title_no');
                            const currentTitleNo = currentUrl.searchParams.get('title_no');
                            if (favTitleNo && currentTitleNo && favTitleNo === currentTitleNo) {
                                isMatch = true;
                            } else {
                                const basePath = favUrl.pathname.replace(/\/list\/?$/, '');
                                if (currentUrl.pathname.includes(basePath)) {
                                    isMatch = true;
                                }
                            }
                        } else {
                            const cleanFavPath = favUrl.pathname.replace(/\/$/, '');
                            if (currentUrl.pathname.includes(cleanFavPath)) {
                                isMatch = true;
                            }
                        }
                    }
                    
                    if (isMatch) {
                        matchedKey = key;
                        matchedItem = item;
                        break;
                    }
                } catch (e) {}
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
            } else {
                matchedItem.isNew = true;
            }

            await chrome.storage.sync.set({ [matchedKey]: matchedItem });
            
            // Mise à jour centralisée du badge
            const updatedData = await chrome.storage.sync.get(null);
            await updateBadgeCount(updatedData);
        }
    } catch (error) {
        console.error("Erreur lors du marquage comme lu:", error);
    }
}

// Nettoyage immédiat du storage lors de la suppression d'un favori Chrome
chrome.bookmarks.onRemoved.addListener((id) => {
    chrome.storage.sync.remove(id, () => {
        console.log(`Favori ${id} supprimé du stockage sync.`);
    });
});
