import { parseAnimeSama } from './adapters/anime-sama.js';
import { parseWebtoons } from './adapters/webtoons.js';
import { parseMangago } from './adapters/mangago.js';

/**
 * Fonction principale qui parcourt les favoris ciblés, va chercher la page,
 * détermine l'état (dernier épisode/chapitre), et met à jour le badge.
 */
export async function checkBookmarksForUpdates() {
    try {
        const bookmarks = await chrome.bookmarks.getTree();
        const targets = [];
        findTargetFolders(bookmarks, ["ANIMES", "SCANS"], targets);
        
        let newCount = 0;
        const updates = {}; // stocke l'état courant

        for (const bookmark of targets) {
            if (!bookmark.url) continue;

            let scrapedResult = await scrapePage(bookmark.url);
            if (scrapedResult) {
                // Fonction de décodage des entités HTML compatible Service Worker (sans DOMParser)
                const decodeHTMLEntities = (text) => {
                    if (!text) return "";
                    // On fait deux passes pour gérer le double encodage (ex: &amp;rsquo;)
                    let decoded = text;
                    for (let i = 0; i < 2; i++) {
                        decoded = decoded
                            .replace(/&amp;/g, "&")
                            .replace(/&rsquo;/g, "’")
                            .replace(/&lsquo;/g, "‘")
                            .replace(/&quot;/g, '"')
                            .replace(/&#39;/g, "'")
                            .replace(/&lt;/g, "<")
                            .replace(/&gt;/g, ">")
                            .replace(/&nbsp;/g, " ")
                            .replace(/&#x27;/g, "'")
                            .replace(/&eacute;/g, "é")
                            .replace(/&egrave;/g, "è")
                            .replace(/&ecirc;/g, "ê")
                            .replace(/&agrave;/g, "à")
                            .replace(/&acirc;/g, "â")
                            .replace(/&ocirc;/g, "ô")
                            .replace(/&icirc;/g, "î");
                    }
                    return decoded;
                };

                const rawTitle = bookmark.title.split(' | ')[0].trim();
                const cleanTitle = decodeHTMLEntities(rawTitle);
                
                // Gérer la rétrocompatibilité (si ça renvoie une string ou un objet {text, image})
                let rawState = typeof scrapedResult === 'string' ? scrapedResult : scrapedResult.text;
                let currentState = decodeHTMLEntities(rawState);
                let imageUrl = typeof scrapedResult === 'object' && scrapedResult.image ? scrapedResult.image : null;
                
                // Vérifier la progression de l'utilisateur
                const stored = await chrome.storage.sync.get(bookmark.id);
                let userProgress = currentState;
                let isNew = false;
                
                if (stored[bookmark.id]) {
                    // Si on n'a pas pu extraire d'image mais qu'on en avait une avant, on la garde
                    if (!imageUrl && stored[bookmark.id].image) {
                        imageUrl = stored[bookmark.id].image;
                    }
                    
                    // Récupérer l'ancienne progression (ou rétrocompatibilité avec lastState)
                    userProgress = stored[bookmark.id].userProgress || stored[bookmark.id].lastState || currentState;
                }
                    
                    if (userProgress !== currentState) {
                        // Extraire les numéros pour faire une vraie comparaison mathématique
                        // On cherche d'abord s'il y a un tag caché type |#122|
                        const extractNum = (str) => {
                            if (!str) return 0;
                            const hiddenMatch = str.match(/\|#(\d+(?:\.\d+)?)\|/);
                            if (hiddenMatch) return parseFloat(hiddenMatch[1]);
                            const normalMatch = str.match(/(\d+(?:\.\d+)?)/);
                            return normalMatch ? parseFloat(normalMatch[1]) : 0;
                        };
                        
                        const numUser = extractNum(userProgress);
                        const numCurrent = extractNum(currentState);
                        
                        // C'est nouveau UNIQUEMENT si le numéro dispo est supérieur à celui lu
                        if (numCurrent > numUser) {
                            if (!stored[bookmark.id].isNew) {
                                // Nouveau chapitre fraîchement détecté !
                                chrome.notifications.create({
                                    type: 'basic',
                                    iconUrl: imageUrl || 'icons/icon128.png',
                                    title: 'Nouveau Chapitre/Épisode !',
                                    message: `${cleanTitle} - ${currentState} est disponible.`
                                });
                            }
                            isNew = true;
                            newCount++;
                        } else if (numCurrent < numUser) {
                            // Si l'utilisateur est plus avancé que le scraper (erreur de cache du site par ex)
                            // SAUF si le userProgress est un identifiant géant (bug précédent de Mangago)
                            if (numUser > 10000 && numCurrent < 10000) {
                                // C'était un faux numéro, on écrase l'ancienne valeur avec la vraie du scraper
                                userProgress = currentState;
                            } else {
                                // On garde la progression de l'utilisateur comme le dernier état connu
                                isNew = false;
                                currentState = userProgress; // On corrige le latestState
                            }
                        } else {
                            // Même numéro mais texte différent (ex: "Chapitre 4" vs "Épisode 4")
                            isNew = stored[bookmark.id].isNew || false;
                            if (isNew) newCount++;
                        }
                    } else {
                        // L'utilisateur est à jour, ou on garde le statut "nouveau" si pas encore cliqué
                        isNew = stored[bookmark.id]?.isNew || false;
                        if (isNew) newCount++;
                    }

                updates[bookmark.id] = {
                    title: cleanTitle,
                    url: bookmark.url,
                    category: bookmark.category,
                    userProgress: userProgress,
                    latestState: currentState,
                    image: imageUrl, // Ajout de l'image de couverture
                    isNew: isNew,
                    timestamp: Date.now()
                };
            }
        }

        // Sauvegarder dans le storage
        await chrome.storage.sync.set(updates);

        // Mettre à jour le badge
        if (newCount > 0) {
            chrome.action.setBadgeText({ text: newCount.toString() });
            chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
        } else {
            chrome.action.setBadgeText({ text: '' });
        }

        // Nettoyer les favoris supprimés (garbage collection)
        const storedAll = await chrome.storage.sync.get(null);
        const validIds = targets.map(b => b.id);
        const keysToRemove = Object.keys(storedAll).filter(key => !validIds.includes(key));
        if (keysToRemove.length > 0) {
            await chrome.storage.sync.remove(keysToRemove);
        }

    } catch (e) {
        console.error("Erreur lors de la vérification des favoris:", e);
    }
}

/**
 * Trouve récursivement les dossiers de favoris correspondants aux noms ciblés
 * et ajoute leurs enfants (URLs) au tableau 'targets'.
 */
function findTargetFolders(nodes, folderNames, targets) {
    for (const node of nodes) {
        if (node.children) {
            if (folderNames.includes(node.title.toUpperCase())) {
                // Ajouter tous les enfants de ce dossier qui sont des liens
                const categoryName = node.title.toUpperCase();
                targets.push(...node.children.filter(c => c.url).map(c => ({...c, category: categoryName})));
            }
            findTargetFolders(node.children, folderNames, targets);
        }
    }
}

/**
 * Va chercher la page et utilise le bon adaptateur selon le domaine.
 */
async function scrapePage(url) {
    try {
        const response = await fetch(url, { cache: 'no-cache' });
        const text = await response.text();
        
        if (url.includes('anime-sama.')) {
            // Anime-sama requiert de passer par l'offscreen pour contourner Cloudflare
            return await scrapeAnimeSamaViaOffscreen(url);
        } else if (url.includes('webtoons.com')) {
            return parseWebtoons(text);
        } else if (url.includes('mangago.me')) {
            return parseMangago(text);
        }
        
        // Fallback si domaine inconnu (on cherche une balise date ou autre)
        return null;
    } catch (e) {
        console.warn(`Impossible de fetch ${url}`, e);
        return null;
    }
}

/**
 * Configure le document invisible
 */
async function setupOffscreenDocument(path) {
    if (await chrome.offscreen.hasDocument()) return;
    
    await chrome.offscreen.createDocument({
        url: path,
        reasons: ['DOM_PARSER'],
        justification: 'Scraping protected pages'
    });
}

/**
 * Scrape Anime-Sama via le document invisible
 */
async function scrapeAnimeSamaViaOffscreen(url) {
    try {
        await setupOffscreenDocument('offscreen/offscreen.html');
        
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({
                action: 'scrapeViaOffscreen',
                url: url
            }, (response) => {
                if (chrome.runtime.lastError || !response || !response.result) {
                    resolve("Fallback (Erreur réseau / Cloudflare total)");
                } else {
                    resolve(response.result);
                }
            });
        });
    } catch (e) {
        console.error("Erreur offscreen:", e);
        return null;
    }
}
