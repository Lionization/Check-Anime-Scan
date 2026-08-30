import { checkBookmarksForUpdates } from './background/scraper.js';

const ALARM_NAME = 'check-anime-scan-alarm';

// Déclenchement à l'installation ou au démarrage
chrome.runtime.onInstalled.addListener(async () => {
    console.log("Extension installée, configuration de l'alarme et des menus.");
    await migrateToSync();
    setupAlarm();
    setupContextMenus();
    checkBookmarksForUpdates(); // Première vérification immédiate
});

chrome.runtime.onStartup.addListener(async () => {
    await migrateToSync();
    setupAlarm();
    setupContextMenus();
    checkBookmarksForUpdates();
});

// Migration de chrome.storage.local vers chrome.storage.sync
async function migrateToSync() {
    const localData = await chrome.storage.local.get(null);
    if (Object.keys(localData).length > 0) {
        console.log("Migration des données locales vers sync...");
        await chrome.storage.sync.set(localData);
        await chrome.storage.local.clear();
        console.log("Migration terminée.");
    }
}

// Configuration du menu contextuel (clic droit)
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

// Gestion du clic droit
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (!tab || !tab.url) return;
    const targetFolder = info.menuItemId === 'add-anime' ? 'ANIMES' : 'SCANS';
    
    const bookmarks = await chrome.bookmarks.getTree();
    let folderId = null;
    
    function findFolder(nodes) {
        for (const node of nodes) {
            if (node.title && node.title.toUpperCase() === targetFolder && !node.url) {
                folderId = node.id;
                return true;
            }
            if (node.children) {
                if (findFolder(node.children)) return true;
            }
        }
        return false;
    }
    
    findFolder(bookmarks);
    
    if (folderId) {
        await chrome.bookmarks.create({
            parentId: folderId,
            title: tab.title,
            url: tab.url
        });
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: 'Ajout réussi',
            message: `${tab.title} ajouté à ${targetFolder}!`
        });
        // On relance un check pour l'inclure immédiatement
        checkBookmarksForUpdates();
    } else {
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: 'Dossier introuvable',
            message: `Le dossier ${targetFolder} n'existe pas dans vos favoris Chrome.`
        });
    }
});

function setupAlarm() {
    chrome.alarms.get(ALARM_NAME, (alarm) => {
        if (!alarm) {
            // Vérification toutes les 4 heures (240 minutes) pour ne pas spammer
            chrome.alarms.create(ALARM_NAME, { periodInMinutes: 240 });
        }
    });
}

// Écoute de l'alarme
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) {
        checkBookmarksForUpdates();
    }
});

// Écoute des messages venant de la popup ou du content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'forceCheck') {
        checkBookmarksForUpdates().then(() => sendResponse({ status: 'done' }));
        return true; // Asynchrone
    }
    
    if (request.action === 'markAsRead' || request.action === 'markAsReadVideo') {
        handleMarkAsRead(request, sender);
    }
});

async function handleMarkAsRead(request, sender) {
    const tabUrl = sender.tab ? sender.tab.url : request.url;
    if (!tabUrl) return;

    let progressText = request.progressText;

    if (request.action === 'markAsReadVideo' && sender.tab) {
        try {
            // Demander au top-frame de la page Anime-Sama l'épisode en cours
            const response = await chrome.tabs.sendMessage(sender.tab.id, { action: "getAnimeSamaEpisode" });
            if (response && response.episodeText) {
                progressText = response.episodeText;
            }
        } catch (e) {
            console.log("Erreur de récupération d'épisode:", e);
        }
    }

    const data = await chrome.storage.sync.get(null);
    let matchedKey = null;
    let matchedItem = null;

    for (const key in data) {
        const item = data[key];
        if (item && item.url) {
            try {
                const favUrl = new URL(item.url);
                const currentUrl = new URL(tabUrl);
                
                let isMatch = false;
                
                if (favUrl.hostname === currentUrl.hostname) {
                    if (favUrl.hostname.includes('webtoons.com')) {
                        // Pour Webtoons, on compare prioritairement le title_no
                        const favTitleNo = favUrl.searchParams.get('title_no');
                        const currentTitleNo = currentUrl.searchParams.get('title_no');
                        if (favTitleNo && currentTitleNo && favTitleNo === currentTitleNo) {
                            isMatch = true;
                        } else {
                            // Fallback si pas de title_no (peu probable) : on enlève /list du chemin
                            const basePath = favUrl.pathname.replace(/\/list\/?$/, '');
                            if (currentUrl.pathname.includes(basePath)) {
                                isMatch = true;
                            }
                        }
                    } else {
                        // Pour Mangago, Anime-Sama, etc. : vérification classique
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

    if (matchedItem) {
        if (progressText) {
            matchedItem.userProgress = progressText;
        } else {
            matchedItem.userProgress = matchedItem.latestState;
        }
        
        const extractNum = (str) => {
            if (!str) return 0;
            const hiddenMatch = str.match(/\|#(\d+(?:\.\d+)?)\|/);
            if (hiddenMatch) return parseFloat(hiddenMatch[1]);
            const normalMatch = str.match(/(\d+(?:\.\d+)?)/);
            return normalMatch ? parseFloat(normalMatch[1]) : 0;
        };
        
        const numUser = extractNum(matchedItem.userProgress);
        const numLatest = extractNum(matchedItem.latestState);
        
        // Casser la boucle : si le numéro lu est >= au dernier numéro connu (ou égalité stricte), on enlève le badge "nouveau"
        if (numUser >= numLatest && numUser > 0) {
            matchedItem.isNew = false;
        } else if (matchedItem.userProgress === matchedItem.latestState) {
            matchedItem.isNew = false;
        } else {
            // S'il reste du retard, on garde isNew = true
            matchedItem.isNew = true;
        }

        await chrome.storage.sync.set({ [matchedKey]: matchedItem });
        
        // Mise à jour du badge global
        const newData = await chrome.storage.sync.get(null);
        const newCount = Object.values(newData).filter(i => i && i.isNew).length;
        if (newCount > 0) {
            chrome.action.setBadgeText({ text: newCount.toString() });
            chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
        } else {
            chrome.action.setBadgeText({ text: '' });
        }
    }
}

// Nettoyage immédiat lors de la suppression d'un favori dans Chrome
chrome.bookmarks.onRemoved.addListener((id, removeInfo) => {
    chrome.storage.sync.remove(id, () => {
        console.log(`Favori ${id} supprimé du stockage sync.`);
    });
});
