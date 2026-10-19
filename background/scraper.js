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
    runWithConcurrency,
    isItemUnread
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
            const title = cleanTitle(bookmark.title);
            const rawState = typeof scrapedResult === 'string' ? scrapedResult : scrapedResult?.text;
            let currentState = rawState ? decodeHTMLEntities(rawState) : '';
            let imageUrl = typeof scrapedResult === 'object' && scrapedResult?.image ? scrapedResult.image : null;

            // Récupération de l'état stocké précédemment
            const stored = storedAll[bookmark.id];
            let userProgress = '';
            let isNew = false;

            if (stored) {
                if (!imageUrl && stored.image) {
                    imageUrl = stored.image;
                }
                userProgress = stored.userProgress || stored.lastState || '';
                if (!currentState || currentState === 'En attente') {
                    if (stored.latestState && stored.latestState !== 'En attente') {
                        currentState = stored.latestState;
                    } else if (userProgress) {
                        currentState = userProgress;
                    } else {
                        currentState = 'Non commencé';
                    }
                }
            } else {
                // Nouvel animé ou scan ajouté
                userProgress = '';
                currentState = currentState || 'Non commencé';
                isNew = Boolean(scrapedResult && currentState !== 'Non commencé');
            }

            if (stored && currentState && userProgress !== currentState) {
                const numUser = extractEpisodeNumber(userProgress);
                const numCurrent = extractEpisodeNumber(currentState);

                if (numCurrent > numUser && numCurrent > 0) {
                    if (!stored?.isNew && settings.notificationsEnabled) {
                        chrome.notifications.create({
                            type: 'basic',
                            iconUrl: imageUrl || CONSTANTS.DEFAULT_ICON,
                            title: 'Nouveau Chapitre / Épisode !',
                            message: `${title} - ${currentState} est disponible.`
                        });
                    }
                    isNew = true;
                } else if (numCurrent < numUser && numCurrent > 0) {
                    if (numUser > 10000 && numCurrent < 10000) {
                        userProgress = currentState;
                    } else {
                        isNew = false;
                        currentState = userProgress;
                    }
                } else {
                    isNew = isItemUnread({ userProgress, latestState: currentState, isNew: stored?.isNew });
                }
            } else if (stored) {
                isNew = isItemUnread({ userProgress, latestState: currentState, isNew: stored?.isNew });
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
                url: scrapedResult?.resolvedUrl || bookmark.url,
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

        // Nettoyage des favoris supprimés
        const currentData = await chrome.storage.local.get(null);
        const validIds = targets.map(b => b.id);
        const keysToRemove = Object.keys(currentData).filter(key => key !== CONSTANTS.SETTINGS_STORAGE_KEY && !validIds.includes(key));
        if (keysToRemove.length > 0) {
            await chrome.storage.local.remove(keysToRemove);
            for (const key of keysToRemove) {
                delete currentData[key];
            }
        }

        // Mise à jour centralisée du badge
        await updateBadgeCount(currentData);

    } catch (error) {
        console.error("Erreur lors de la vérification des favoris:", error);
    } finally {
        await closeOffscreenDocument();
    }
}

// Mémoïsation du domaine actif Anime-Sama découvert dynamiquement par redirection réseau
let _activeAnimeSamaDomain = null;

/**
 * Scrape une page Anime-Sama de façon directe, résiliente et avec support des redirections de domaine.
 * @param {string} rawUrl 
 * @returns {Promise<{ text: string, image?: string|null, resolvedUrl?: string }|null>}
 */
async function scrapeAnimeSama(rawUrl) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    try {
        const origUrlObj = new URL(rawUrl);
        let fetchUrl = rawUrl;

        // Pré-optimisation : si le domaine Anime-Sama diffère du domaine actif découvert dynamiquement, tenter directement le domaine actif
        if (_activeAnimeSamaDomain && origUrlObj.hostname.includes('anime-sama') && origUrlObj.hostname !== _activeAnimeSamaDomain) {
            const preOptimized = new URL(rawUrl);
            preOptimized.hostname = _activeAnimeSamaDomain;
            fetchUrl = preOptimized.href;
        }

        let response = await fetch(fetchUrl, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            },
            redirect: 'follow'
        }).catch(async () => {
            // Repli sur l'URL brute d'origine si l'hôte en cache échoue
            return await fetch(rawUrl, {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                },
                redirect: 'follow'
            });
        });

        // En cas de redirection (ex: anime-sama.si -> anime-sama.to racine sans pathname)
        let effectiveUrl = response.url;
        const effUrlObj = new URL(effectiveUrl);
        if ((effUrlObj.pathname === '/' || effUrlObj.pathname === '') && origUrlObj.pathname.length > 1) {
            effUrlObj.pathname = origUrlObj.pathname;
            effUrlObj.search = origUrlObj.search;
            effectiveUrl = effUrlObj.href;
            response = await fetch(effectiveUrl, {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                    'Referer': response.url
                },
                redirect: 'follow'
            });
            effectiveUrl = response.url;
        }

        // Mémorisation du domaine actif vérifié
        const finalHost = new URL(effectiveUrl).hostname;
        if (finalHost.includes('anime-sama') && finalHost !== _activeAnimeSamaDomain) {
            _activeAnimeSamaDomain = finalHost;
        }

        clearTimeout(timeoutId);
        if (!response.ok) return null;
        const htmlText = await response.text();

        // 1. Essai avec parseAnimeSama standard (couverture + éventuel select/options déjà présents)
        const parsed = parseAnimeSama(htmlText);
        let coverImage = typeof parsed === 'object' && parsed?.image ? parsed.image : null;
        let detectedText = typeof parsed === 'string' ? parsed : parsed?.text;

        // Image de secours dans imgOeuvre si non trouvée
        if (!coverImage) {
            const coverMatch = htmlText.match(/<img[^>]+(?:id=["']imgOeuvre["'][^>]*src=["']([^"']+)["']|src=["']([^"']+)["'][^>]*id=["']imgOeuvre["'])/i);
            if (coverMatch) {
                coverImage = coverMatch[1] || coverMatch[2];
            }
        }

        // 2. Si pas d'épisode détecté, inspecter le script episodes.js
        if (!detectedText) {
            const epScriptMatch = htmlText.match(/<script[^>]+src=['"]([^'"]*episodes\.js[^'"]*)['"]/i);
            if (epScriptMatch) {
                try {
                    const epUrl = new URL(epScriptMatch[1], effectiveUrl).href;
                    const epRes = await fetch(epUrl, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                            'Referer': effectiveUrl
                        }
                    });
                    if (epRes.ok) {
                        const epCode = await epRes.text();
                        const epsMatch = epCode.match(/(?:var\s+)?eps1\s*=\s*\[([\s\S]*?)\];/);
                        if (epsMatch) {
                            const count = epsMatch[1].split(',').map(s => s.trim()).filter(s => s.length > 4 && (s.startsWith('"') || s.startsWith("'"))).length;
                            if (count > 0) {
                                detectedText = `Épisode ${count}`;
                            }
                        }
                    }
                } catch (e) {
                    // Ignorer
                }
            }
        }

        // 3. Si c'est une page de scans Anime-Sama, interroger l'API get_nb_chap_et_img.php
        if (!detectedText && effectiveUrl.includes('/scan/')) {
            const titreMatch = htmlText.match(/<h[1-3][^>]+id=["']titreOeuvre["'][^>]*>([\s\S]*?)<\/h[1-3]>/i);
            if (titreMatch) {
                try {
                    const nomOeuvre = titreMatch[1].trim();
                    const apiUrl = new URL(`/s2/scans/get_nb_chap_et_img.php?oeuvre=${encodeURIComponent(nomOeuvre)}`, effectiveUrl).href;
                    const apiRes = await fetch(apiUrl, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0',
                            'Referer': effectiveUrl
                        }
                    });
                    if (apiRes.ok) {
                        const data = await apiRes.json();
                        const keys = Object.keys(data).map(Number).filter(n => !isNaN(n));
                        if (keys.length > 0) {
                            const maxChap = Math.max(...keys);
                            detectedText = `Chapitre ${maxChap}`;
                        }
                    }
                } catch (e) {
                    // Ignorer
                }
            }
        }

        // 4. Si page catalogue pure (ex: /catalogue/<slug>/), tenter de suivre le premier lien de saison
        if (!detectedText && !effectiveUrl.includes('/saison') && !effectiveUrl.includes('/scan/')) {
            const seasonLinkMatch = htmlText.match(/href=["'](\/catalogue\/[^"']+\/(?:saison\d+|scan)\/[^"']*)["']/i);
            if (seasonLinkMatch) {
                const subUrl = new URL(seasonLinkMatch[1], effectiveUrl).href;
                const subScraped = await scrapeAnimeSama(subUrl);
                if (subScraped) {
                    return {
                        text: subScraped.text,
                        image: coverImage || subScraped.image,
                        resolvedUrl: subScraped.resolvedUrl || effectiveUrl
                    };
                }
            }
        }

        // 5. Plancher de secours pour les lecteurs de saisons actifs
        if (!detectedText) {
            const hasEpisodeIndicator = htmlText.includes('episodes.js') || 
                                       htmlText.includes('selectEpisodes') || 
                                       /finirListe\s*\(/i.test(htmlText);
            if (hasEpisodeIndicator) {
                detectedText = 'Épisode 1';
            }
        }

        if (detectedText) {
            return { text: detectedText, image: coverImage, resolvedUrl: effectiveUrl };
        }

        if (coverImage) {
            return { text: 'Non commencé', image: coverImage, resolvedUrl: effectiveUrl };
        }

        return null;
    } catch (e) {
        clearTimeout(timeoutId);
        // Fallback rapide de secours si nécessaire via offscreen
        return await scrapeAnimeSamaViaOffscreen(rawUrl);
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
            return await scrapeAnimeSama(url);
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
                    const guardTimer = setTimeout(() => res(null), 3500);
                    chrome.runtime.sendMessage({
                        action: 'scrapeViaOffscreen',
                        url: url
                    }, (response) => {
                        clearTimeout(guardTimer);
                        if (chrome.runtime.lastError || !response?.result) {
                            res(null);
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
