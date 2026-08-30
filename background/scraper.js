/**
 * @fileoverview Logique de scraping et de détection de mises à jour pour Check Anime & Scans.
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
    findTargetBookmarkFolders 
} from '../utils.js';

/**
 * Parcourt les favoris ciblés, extrait le dernier épisode/chapitre et met à jour le storage et le badge.
 */
export async function checkBookmarksForUpdates() {
    try {
        const bookmarks = await chrome.bookmarks.getTree();
        const targets = [];
        findTargetBookmarkFolders(bookmarks, CONSTANTS.TARGET_FOLDERS, targets);
        
        const updates = {};
        const storedAll = await chrome.storage.sync.get(null);

        for (const bookmark of targets) {
            if (!bookmark.url) continue;

            const scrapedResult = await scrapePage(bookmark.url);
            if (!scrapedResult) continue;

            const title = cleanTitle(bookmark.title);
            const rawState = typeof scrapedResult === 'string' ? scrapedResult : scrapedResult.text;
            let currentState = decodeHTMLEntities(rawState);
            let imageUrl = typeof scrapedResult === 'object' && scrapedResult.image ? scrapedResult.image : null;

            // Récupération de l'état précédemment stocké
            const stored = storedAll[bookmark.id];
            let userProgress = currentState;
            let isNew = false;

            if (stored) {
                // Conservation de l'image si celle-ci n'a pas pu être re-extraite
                if (!imageUrl && stored.image) {
                    imageUrl = stored.image;
                }
                userProgress = stored.userProgress || stored.lastState || currentState;
            }

            if (userProgress !== currentState) {
                const numUser = extractEpisodeNumber(userProgress);
                const numCurrent = extractEpisodeNumber(currentState);

                if (numCurrent > numUser) {
                    if (!stored?.isNew) {
                        // Alerte notification de nouveauté
                        chrome.notifications.create({
                            type: 'basic',
                            iconUrl: imageUrl || CONSTANTS.DEFAULT_ICON,
                            title: 'Nouveau Chapitre / Épisode !',
                            message: `${title} - ${currentState} est disponible.`
                        });
                    }
                    isNew = true;
                } else if (numCurrent < numUser) {
                    // Si l'utilisateur est plus avancé que la source distante (ex: cache CDN du site source)
                    if (numUser > 10000 && numCurrent < 10000) {
                        // Réinitialisation en cas d'identifiant aberrant
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

            updates[bookmark.id] = {
                title: title,
                url: bookmark.url,
                category: bookmark.category,
                userProgress: userProgress,
                latestState: currentState,
                image: imageUrl,
                isNew: isNew,
                timestamp: Date.now()
            };
        }

        // Sauvegarde de l'état synchronisé
        await chrome.storage.sync.set(updates);

        // Mise à jour centralisée du badge
        const currentData = await chrome.storage.sync.get(null);
        await updateBadgeCount(currentData);

        // Nettoyage des anciens favoris supprimés
        const validIds = targets.map(b => b.id);
        const keysToRemove = Object.keys(currentData).filter(key => !validIds.includes(key));
        if (keysToRemove.length > 0) {
            await chrome.storage.sync.remove(keysToRemove);
        }

    } catch (error) {
        console.error("Erreur lors de la vérification des favoris:", error);
    }
}

/**
 * Effectue la requête HTTP et délègue au bon parseur selon le domaine
 * @param {string} url URL cible
 * @returns {Promise<{ text: string, image?: string }|string|null>}
 */
async function scrapePage(url) {
    try {
        const response = await fetch(url, { cache: 'no-cache' });
        const text = await response.text();
        
        if (url.includes('anime-sama.')) {
            return await scrapeAnimeSamaViaOffscreen(url);
        }
        if (url.includes('webtoons.com')) {
            return parseWebtoons(text);
        }
        if (url.includes('mangago.me')) {
            return parseMangago(text);
        }
        
        return null;
    } catch (e) {
        console.warn(`Impossible de scraper l'URL: ${url}`, e);
        return null;
    }
}

/**
 * Prépare et crée le document invisible Offscreen si nécessaire
 * @param {string} path Chemin du document HTML offscreen
 */
async function setupOffscreenDocument(path) {
    if (await chrome.offscreen.hasDocument()) return;
    
    await chrome.offscreen.createDocument({
        url: path,
        reasons: ['DOM_PARSER'],
        justification: 'Scraping de pages avec protection navigateur'
    });
}

/**
 * Exécute le scraping Anime-Sama via le document Offscreen isolé
 * @param {string} url URL de la page Anime-Sama
 * @returns {Promise<{ text: string, image?: string }|string|null>}
 */
async function scrapeAnimeSamaViaOffscreen(url) {
    try {
        await setupOffscreenDocument('offscreen/offscreen.html');
        
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({
                action: 'scrapeViaOffscreen',
                url: url
            }, (response) => {
                if (chrome.runtime.lastError || !response?.result) {
                    resolve("Fallback (Erreur réseau)");
                } else {
                    resolve(response.result);
                }
            });
        });
    } catch (e) {
        console.error("Erreur lors du scraping Offscreen:", e);
        return null;
    }
}
