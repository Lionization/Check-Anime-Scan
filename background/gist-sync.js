/**
 * @fileoverview Module de synchronisation bidirectionnelle avec GitHub Gist pour Check Anime & Scans.
 * Permet l'échange d'état sans serveur entre l'extension PC et la PWA mobile.
 */

import { getAppSettings, extractEpisodeNumber, updateBadgeCount, CONSTANTS, isItemUnread, findTargetBookmarkFolders } from '../utils.js';

const GIST_FILENAME = 'suivi.json';
const GITHUB_API_URL = 'https://api.github.com/gists';

/**
 * Normalise une URL pour servir de clé unique valide (protocole + host + pathname sans trailing slash).
 * Conserve une URL navigable complète sans altérer le domaine.
 * @param {string} url 
 * @returns {string}
 */
export function normalizeUrlKey(url) {
    if (!url || typeof url !== 'string') return '';
    try {
        const parsed = new URL(url.trim());
        const path = parsed.pathname.replace(/\/+$/, '');
        return `${parsed.protocol}//${parsed.host}${path}`;
    } catch {
        return url.trim().replace(/\/+$/, '');
    }
}

/**
 * Calcule une empreinte agnostique de domaine pour comparer deux URLs ayant le même chemin et le même site racine.
 * Exemple : 'https://anime-sama.si/catalogue/dreamland/' et 'https://anime-sama.to/catalogue/dreamland'
 * ont la même empreinte : 'anime-sama:/catalogue/dreamland'.
 * @param {string} url 
 * @returns {string}
 */
export function getUrlFingerprint(url) {
    if (!url || typeof url !== 'string') return '';
    try {
        const parsed = new URL(url.trim());
        const path = parsed.pathname.toLowerCase().replace(/\/+$/, '');
        // Retrait générique du www et du TLD (.to, .si, .fr, .com, etc.)
        const hostBase = parsed.hostname.toLowerCase().replace(/^www\./, '').replace(/\.[a-z]{2,10}(?:\.[a-z]{2})?$/i, '');
        return `${hostBase}:${path}`;
    } catch {
        return url.trim().toLowerCase().replace(/\/+$/, '');
    }
}

/**
 * Récupère le contenu de suivi.json depuis le Gist GitHub.
 * @param {string} gistId 
 * @param {string} token 
 * @returns {Promise<{ items: Record<string, any>, updatedAt: number } | null>}
 */
export async function fetchGistData(gistId, token) {
    if (!gistId || !token) return null;

    try {
        const response = await fetch(`${GITHUB_API_URL}/${gistId.trim()}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token.trim()}`,
                'Accept': 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28'
            }
        });

        if (!response.ok) {
            console.error(`Erreur HTTP Gist fetch: ${response.status} ${response.statusText}`);
            return null;
        }

        const data = await response.json();
        const fileObj = data?.files?.[GIST_FILENAME];
        if (!fileObj || !fileObj.content) {
            return { items: {}, updatedAt: Date.now() };
        }

        const parsed = JSON.parse(fileObj.content);
        return {
            items: parsed.items || parsed.mangas || parsed || {},
            updatedAt: parsed.updatedAt || Date.now(),
            _pushSubscription: parsed._pushSubscription || null
        };
    } catch (error) {
        console.error('Erreur lors de la lecture du Gist:', error);
        return null;
    }
}

/**
 * Met à jour le fichier suivi.json sur le Gist GitHub.
 * @param {string} gistId 
 * @param {string} token 
 * @param {Record<string, any>} items 
 * @param {any} [pushSubscription]
 * @returns {Promise<boolean>}
 */
export async function updateGistData(gistId, token, items, pushSubscription = undefined) {
    if (!gistId || !token) return false;

    try {
        const payload = {
            version: 1,
            updatedAt: Date.now(),
            items: items
        };

        if (pushSubscription !== undefined) {
            payload._pushSubscription = pushSubscription;
        }

        const response = await fetch(`${GITHUB_API_URL}/${gistId.trim()}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${token.trim()}`,
                'Accept': 'application/vnd.github+json',
                'Content-Type': 'application/json',
                'X-GitHub-Api-Version': '2022-11-28'
            },
            body: JSON.stringify({
                files: {
                    [GIST_FILENAME]: {
                        content: JSON.stringify(payload, null, 2)
                    }
                }
            })
        });

        if (!response.ok) {
            console.error(`Erreur HTTP Gist update: ${response.status} ${response.statusText}`);
            return false;
        }

        return true;
    } catch (error) {
        console.error('Erreur lors de l\'écriture sur le Gist:', error);
        return false;
    }
}

/**
 * Synchronise les données locales de chrome.storage.local avec le Gist GitHub.
 * Fusionne les lectures mobiles et les nouveautés détectées par l'extension.
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export async function syncStorageWithGist() {
    const settings = await getAppSettings();
    if (!settings.gistId || !settings.gistToken) {
        return { success: false, message: 'Identifiants Gist non configurés' };
    }

    // 1. Identification stricte des favoris Chrome actifs dans les dossiers ciblés (ANIMES, SCANS)
    let validBookmarkUrls = null;
    let validBookmarkFps = null;
    if (chrome?.bookmarks?.getTree) {
        try {
            const bookmarks = await chrome.bookmarks.getTree();
            const targets = [];
            findTargetBookmarkFolders(bookmarks, settings.targetFolders, targets);
            validBookmarkUrls = new Set(targets.map(t => normalizeUrlKey(t.url)).filter(Boolean));
            validBookmarkFps = new Set(targets.map(t => getUrlFingerprint(t.url)).filter(Boolean));
        } catch (e) {
            console.warn('Impossible de lire les favoris Chrome pour la réconciliation:', e);
        }
    }

    const gistData = await fetchGistData(settings.gistId, settings.gistToken);
    const localData = await chrome.storage.local.get(null);

    const gistItems = gistData?.items || {};
    const localUpdates = {};
    const localKeysToRemove = [];
    const mergedGistItems = { ...gistItems };
    let hasLocalChanges = false;
    let hasGistChanges = false;

    // 2. Élimination des orphelins locaux et distants supprimés des favoris Chrome
    if (validBookmarkUrls && validBookmarkUrls.size > 0) {
        for (const [key, item] of Object.entries(localData)) {
            if (key === CONSTANTS.SETTINGS_STORAGE_KEY || !item) continue;
            const normUrl = normalizeUrlKey(item.url || '');
            const fp = getUrlFingerprint(item.url || '');
            if (!normUrl || (!validBookmarkUrls.has(normUrl) && !validBookmarkFps.has(fp))) {
                localKeysToRemove.push(key);
            }
        }

        for (const gistKey of Object.keys(mergedGistItems)) {
            const rawUrl = gistKey || mergedGistItems[gistKey]?.url || '';
            const normGistKey = normalizeUrlKey(rawUrl);
            const fp = getUrlFingerprint(rawUrl);
            if (!normGistKey || (!validBookmarkUrls.has(normGistKey) && !validBookmarkFps.has(fp))) {
                delete mergedGistItems[gistKey];
                hasGistChanges = true;
            }
        }
    }

    // 3. Indexer les éléments locaux valides par URL normalisée et par empreinte
    const localByUrl = new Map();
    const localByFp = new Map();
    for (const [key, item] of Object.entries(localData)) {
        if (key === CONSTANTS.SETTINGS_STORAGE_KEY || !item || !item.url) continue;
        if (localKeysToRemove.includes(key)) continue;
        const normUrl = normalizeUrlKey(item.url);
        const fp = getUrlFingerprint(item.url);
        localByUrl.set(normUrl, { key, item });
        if (fp) localByFp.set(fp, { key, item });
    }

    // 4. Fusion Gist -> Local (prise en compte des lectures faites sur mobile et nouveautés cloud)
    for (const [urlKey, gistItem] of Object.entries(gistItems)) {
        if (!gistItem || typeof gistItem !== 'object') continue;
        const normKey = normalizeUrlKey(urlKey || gistItem.url);
        const fp = getUrlFingerprint(urlKey || gistItem.url);
        const localEntry = localByUrl.get(normKey) || (fp ? localByFp.get(fp) : null);

        if (localEntry) {
            const { key: localKey, item: localItem } = localEntry;
            const gistProgressNum = extractEpisodeNumber(gistItem.userProgress);
            const localProgressNum = extractEpisodeNumber(localItem.userProgress);
            const gistLatest = gistItem.latestState || gistItem.latestEpisode || '';
            const gistLatestNum = extractEpisodeNumber(gistLatest);
            const localLatestNum = extractEpisodeNumber(localItem.latestState);

            let itemChanged = false;

            // Récupération de l'image si manquante localement
            if (!localItem.image && gistItem.image) {
                localItem.image = gistItem.image;
                itemChanged = true;
            }

            // Si le Gist a un latestState plus récent ou que le local n'en a pas
            if (gistLatest && (gistLatestNum > localLatestNum || !localItem.latestState)) {
                localItem.latestState = gistLatest;
                itemChanged = true;
            }

            // Si la progression du Gist est plus avancée que le local
            if (gistProgressNum > localProgressNum || (!localItem.userProgress && gistItem.userProgress)) {
                localItem.userProgress = gistItem.userProgress;
                itemChanged = true;
            }

            // Recalcul et réconciliation de l'indicateur isNew basé sur la règle unifiée
            const expectedIsNew = isItemUnread(localItem);
            if (localItem.isNew !== expectedIsNew) {
                localItem.isNew = expectedIsNew;
                itemChanged = true;
            }

            if (itemChanged) {
                localUpdates[localKey] = localItem;
                hasLocalChanges = true;
            }
        }
    }

    // 5. Fusion Local -> Gist (propagation des derniers chapitres scrapés et lectures PC)
    for (const [, { item: localItem }] of localByUrl) {
        const normKey = normalizeUrlKey(localItem.url);
        const localFp = getUrlFingerprint(localItem.url);

        let existingGist = mergedGistItems[normKey];
        let oldGistKey = normKey;

        // Si non trouvé par clé directe, chercher par empreinte agnostique de domaine
        if (!existingGist && localFp) {
            for (const [gKey, gItem] of Object.entries(mergedGistItems)) {
                if (getUrlFingerprint(gKey || gItem?.url) === localFp) {
                    existingGist = gItem;
                    oldGistKey = gKey;
                    break;
                }
            }
        }

        existingGist = existingGist || {};

        const localProgressNum = extractEpisodeNumber(localItem.userProgress);
        const gistProgressNum = extractEpisodeNumber(existingGist.userProgress);
        const localLatestNum = extractEpisodeNumber(localItem.latestState);
        const gistLatestNum = extractEpisodeNumber(existingGist.latestState);

        // Détermination du flag isNew : ne pas écraser une lecture mobile validée (isNew: false)
        let resolvedIsNew = localItem.isNew || false;
        if (localLatestNum > gistLatestNum) {
            resolvedIsNew = true;
        } else if (existingGist.isNew === false && gistProgressNum >= localProgressNum && localLatestNum <= gistLatestNum) {
            resolvedIsNew = false;
        } else if (localLatestNum > 0 && Math.max(localProgressNum, gistProgressNum) >= localLatestNum) {
            resolvedIsNew = false;
        }

        const shouldUpdateGist = 
            !mergedGistItems[normKey] ||
            oldGistKey !== normKey ||
            localLatestNum > gistLatestNum ||
            localProgressNum > gistProgressNum ||
            localItem.latestState !== existingGist.latestState ||
            resolvedIsNew !== existingGist.isNew ||
            (!existingGist.image && localItem.image);

        if (shouldUpdateGist) {
            // Si l'élément existait sous un ancien domaine, supprimer l'ancienne clé pour éviter le doublon
            if (oldGistKey !== normKey && mergedGistItems[oldGistKey]) {
                delete mergedGistItems[oldGistKey];
            }

            mergedGistItems[normKey] = {
                title: localItem.title,
                url: localItem.url,
                category: localItem.category || 'SCANS',
                userProgress: localProgressNum >= gistProgressNum ? (localItem.userProgress || '') : (existingGist.userProgress || ''),
                latestState: localItem.latestState || existingGist.latestState || '',
                isNew: resolvedIsNew,
                image: localItem.image || existingGist.image || null,
                updatedAt: Date.now()
            };
            hasGistChanges = true;
        }
    }

    // 6. Appliquer les suppressions et modifications locales
    if (localKeysToRemove.length > 0) {
        await chrome.storage.local.remove(localKeysToRemove);
        hasLocalChanges = true;
    }

    if (Object.keys(localUpdates).length > 0) {
        await chrome.storage.local.set(localUpdates);
        hasLocalChanges = true;
    }

    if (hasLocalChanges) {
        const refreshed = await chrome.storage.local.get(null);
        await updateBadgeCount(refreshed);
    }

    // 7. Pousser vers le Gist si l'état distant doit être actualisé ou purgé
    if (hasGistChanges || !gistData) {
        await updateGistData(settings.gistId, settings.gistToken, mergedGistItems, gistData?._pushSubscription);
    }

    return { success: true, message: 'Synchronisation et nettoyage réussis' };
}
