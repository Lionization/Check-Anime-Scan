/**
 * @fileoverview Logique de scraping concurrente et résiliente pour Check Anime & Scans.
 */

import { parseAnimeSama } from './adapters/anime-sama.js';
import { parseWebtoons } from './adapters/webtoons.js';
import { parseMangago } from './adapters/mangago.js';
import { 
    CONSTANTS, 
    decodeHTMLEntities, 
    cleanTitle, 
    extractEpisodeNumber, 
    updateBadgeCount, 
    findTargetBookmarkFolders,
    getAppSettings,
    runWithConcurrency
} from '../utils.js';

/**
 * Parcourt les favoris configurés en parallèle, extrait les derniers chapitres/épisodes et met à jour le storage et le badge.
 */
export async function checkBookmarksForUpdates() {
    try {
        const settings = await getAppSettings();
        const bookmarks = await chrome.bookmarks.getTree();
        const targets = [];
        findTargetBookmarkFolders(bookmarks, settings.targetFolders, targets);
        
        const updates = {};
        const storedAll = await chrome.storage.local.get(null);

        // Traitement parallèle par lots de 5 requêtes simultanées
        await runWithConcurrency(targets, 5, async (bookmark) => {
            if (!bookmark?.url) return;

            const scrapedResult = await scrapePage(bookmark.url);
            if (!scrapedResult) return;

            const title = cleanTitle(bookmark.title);
            const rawState = typeof scrapedResult === 'string' ? scrapedResult : scrapedResult.text;
            let currentState = decodeHTMLEntities(rawState);
            let imageUrl = typeof scrapedResult === 'object' && scrapedResult.image ? scrapedResult.image : null;

            // Récupération de l'état stocké précédemment
            const stored = storedAll[bookmark.id];
            let userProgress = currentState;
            let isNew = false;

            if (stored) {
                if (!imageUrl && stored.image) {
                    imageUrl = stored.image;
                }
                userProgress = stored.userProgress || stored.lastState || currentState;
            }

            if (userProgress !== currentState) {
                const numUser = extractEpisodeNumber(userProgress);
                const numCurrent = extractEpisodeNumber(currentState);

                if (numCurrent > numUser) {
                    if (!stored?.isNew && settings.notificationsEnabled) {
                        chrome.notifications.create({
                            type: 'basic',
                            iconUrl: imageUrl || CONSTANTS.DEFAULT_ICON,
                            title: 'Nouveau Chapitre / Épisode !',
                            message: `${title} - ${currentState} est disponible.`
                        });
                    }
                    isNew = true;
                } else if (numCurrent < numUser) {
                    if (numUser > 10000 && numCurrent < 10000) {
                        userProgress = currentState;
                    } else {
                        isNew = false;
                        currentState = userProgress;
                    }
                } else {
                    isNew = stored?.isNew || false;
                }
            } else {
                isNew = stored?.isNew || false;
            }

            // Gestion intelligente du timestamp : on conserve la date précédente sauf si une nouveauté est détectée
            let itemTimestamp = stored?.timestamp || Date.now();
            if (isNew && !stored?.isNew) {
                itemTimestamp = Date.now();
            } else if (stored?.latestState && stored.latestState !== currentState) {
                itemTimestamp = Date.now();
            }

            updates[bookmark.id] = {
                title: title,
                url: bookmark.url,
                category: bookmark.category,
                userProgress: userProgress,
                latestState: currentState,
                image: imageUrl,
                isNew: isNew,
                timestamp: itemTimestamp
            };
        });

        // Sauvegarde de l'état local
        await chrome.storage.local.set(updates);

        // Mise à jour centralisée du badge
        const currentData = await chrome.storage.local.get(null);
        await updateBadgeCount(currentData);

        // Nettoyage des favoris supprimés
        const validIds = targets.map(b => b.id);
        const keysToRemove = Object.keys(currentData).filter(key => key !== CONSTANTS.SETTINGS_STORAGE_KEY && !validIds.includes(key));
        if (keysToRemove.length > 0) {
            await chrome.storage.local.remove(keysToRemove);
        }

    } catch (error) {
        console.error("Erreur lors de la vérification des favoris:", error);
    } finally {
        await closeOffscreenDocument();
    }
}

/**
 * Effectue la requête HTTP avec timeout AbortController et délègue au bon adaptateur
 * @param {string} url URL cible
 * @returns {Promise<{ text: string, image?: string }|string|null>}
 */
async function scrapePage(url) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 secondes max par requête

    try {
        if (url.includes('anime-sama.')) {
            clearTimeout(timeoutId);
            return await scrapeAnimeSamaViaOffscreen(url);
        }

        const response = await fetch(url, { 
            cache: 'no-cache',
            signal: controller.signal 
        });
        clearTimeout(timeoutId);

        const text = await response.text();
        
        if (url.includes('webtoons.com')) {
            return parseWebtoons(text);
        }
        if (url.includes('mangago.me')) {
            return parseMangago(text);
        }
        
        return null;
    } catch (e) {
        clearTimeout(timeoutId);
        if (e.name !== 'AbortError') {
            console.warn(`Impossible de scraper l'URL: ${url}`, e);
        }
        return null;
    }
}

// Verrous et file d'attente pour le document Offscreen (Chromium n'autorise qu'un seul document offscreen)
let creatingOffscreenPromise = null;
let offscreenScrapeQueue = Promise.resolve();

/**
 * Configure le document invisible Offscreen si nécessaire de manière thread-safe (singleton)
 * @param {string} path Chemin du document HTML offscreen
 */
async function setupOffscreenDocument(path) {
    if (await chrome.offscreen.hasDocument()) return;
    
    if (!creatingOffscreenPromise) {
        creatingOffscreenPromise = chrome.offscreen.createDocument({
            url: path,
            reasons: ['DOM_PARSER'],
            justification: 'Scraping de pages avec protection navigateur'
        }).finally(() => {
            creatingOffscreenPromise = null;
        });
    }
    
    await creatingOffscreenPromise;
}

/**
 * Ferme le document invisible Offscreen pour libérer les ressources mémoires
 */
export async function closeOffscreenDocument() {
    try {
        if (chrome.offscreen && await chrome.offscreen.hasDocument()) {
            await chrome.offscreen.closeDocument();
        }
    } catch (e) {
        // Ignorer si déjà fermé ou indisponible
    }
}

/**
 * Exécute le scraping Anime-Sama via le document Offscreen isolé avec file d'attente séquentielle
 * @param {string} url URL de la page Anime-Sama
 * @returns {Promise<{ text: string, image?: string }|string|null>}
 */
async function scrapeAnimeSamaViaOffscreen(url) {
    return new Promise((resolve) => {
        offscreenScrapeQueue = offscreenScrapeQueue.then(async () => {
            try {
                await setupOffscreenDocument('offscreen/offscreen.html');
                
                const result = await new Promise((res) => {
                    chrome.runtime.sendMessage({
                        action: 'scrapeViaOffscreen',
                        url: url
                    }, (response) => {
                        if (chrome.runtime.lastError || !response?.result) {
                            res("Fallback (Erreur réseau)");
                        } else {
                            res(response.result);
                        }
                    });
                });
                resolve(result);
            } catch (e) {
                console.error("Erreur lors du scraping Offscreen:", e);
                resolve(null);
            }
        });
    });
}
