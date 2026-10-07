/**
 * @fileoverview Module de synchronisation bidirectionnelle avec GitHub Gist pour Check Anime & Scans.
 * Permet l'échange d'état sans serveur entre l'extension PC et la PWA mobile.
 */

import { getAppSettings, extractEpisodeNumber, updateBadgeCount, CONSTANTS } from '../utils.js';

const GIST_FILENAME = 'suivi.json';
const GITHUB_API_URL = 'https://api.github.com/gists';

/**
 * Normalise une URL pour servir de clé unique fiable.
 * @param {string} url 
 * @returns {string}
 */
export function normalizeUrlKey(url) {
    if (!url || typeof url !== 'string') return '';
    try {
        const parsed = new URL(url);
        // Conserve protocole, host et pathname sans trailing slash
        const path = parsed.pathname.replace(/\/+$/, '');
        return `${parsed.origin}${path}`;
    } catch {
        return url.trim().replace(/\/+$/, '');
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

    const gistData = await fetchGistData(settings.gistId, settings.gistToken);
    const localData = await chrome.storage.local.get(null);

    const gistItems = gistData?.items || {};
    const localUpdates = {};
    const mergedGistItems = { ...gistItems };
    let hasLocalChanges = false;
    let hasGistChanges = false;

    // 1. Indexer les éléments locaux par URL normalisée
    const localByUrl = new Map();
    for (const [key, item] of Object.entries(localData)) {
        if (key === CONSTANTS.SETTINGS_STORAGE_KEY || !item || !item.url) continue;
        const normUrl = normalizeUrlKey(item.url);
        localByUrl.set(normUrl, { key, item });
    }

    // 2. Fusion Gist -> Local (prise en compte des lectures faites sur mobile)
    for (const [urlKey, gistItem] of Object.entries(gistItems)) {
        if (!gistItem || typeof gistItem !== 'object') continue;
        const normKey = normalizeUrlKey(urlKey || gistItem.url);
        const localEntry = localByUrl.get(normKey);

        if (localEntry) {
            const { key: localKey, item: localItem } = localEntry;
            const gistProgressNum = extractEpisodeNumber(gistItem.userProgress);
            const localProgressNum = extractEpisodeNumber(localItem.userProgress);

            // Si la progression du Gist est plus avancée que le local
            if (gistProgressNum > localProgressNum || (!localItem.userProgress && gistItem.userProgress)) {
                localItem.userProgress = gistItem.userProgress;

                // Recalcul de l'indicateur isNew
                const latestNum = extractEpisodeNumber(localItem.latestState);
                if (gistProgressNum >= latestNum && latestNum > 0) {
                    localItem.isNew = false;
                }

                localUpdates[localKey] = localItem;
                hasLocalChanges = true;
            }
        }
    }

    // 3. Fusion Local -> Gist (propagation des derniers chapitres scrapés et lectures PC)
    for (const [, { item: localItem }] of localByUrl) {
        const normKey = normalizeUrlKey(localItem.url);
        const existingGist = mergedGistItems[normKey] || {};

        const localProgressNum = extractEpisodeNumber(localItem.userProgress);
        const gistProgressNum = extractEpisodeNumber(existingGist.userProgress);
        const localLatestNum = extractEpisodeNumber(localItem.latestState);
        const gistLatestNum = extractEpisodeNumber(existingGist.latestState);

        const shouldUpdateGist = 
            !mergedGistItems[normKey] ||
            localLatestNum > gistLatestNum ||
            localProgressNum > gistProgressNum ||
            localItem.latestState !== existingGist.latestState ||
            localItem.isNew !== existingGist.isNew ||
            (!existingGist.image && localItem.image);

        if (shouldUpdateGist) {
            mergedGistItems[normKey] = {
                title: localItem.title,
                url: localItem.url,
                category: localItem.category || 'SCANS',
                userProgress: localProgressNum >= gistProgressNum ? (localItem.userProgress || '') : (existingGist.userProgress || ''),
                latestState: localItem.latestState || existingGist.latestState || '',
                isNew: localItem.isNew || false,
                image: localItem.image || existingGist.image || null,
                updatedAt: Date.now()
            };
            hasGistChanges = true;
        }
    }

    // 4. Appliquer les modifications locales si nécessaire
    if (hasLocalChanges) {
        await chrome.storage.local.set(localUpdates);
        const refreshed = await chrome.storage.local.get(null);
        await updateBadgeCount(refreshed);
    }

    // 5. Pousser vers le Gist si l'état distant doit être actualisé
    if (hasGistChanges || !gistData) {
        await updateGistData(settings.gistId, settings.gistToken, mergedGistItems, gistData?._pushSubscription);
    }

    return { success: true, message: 'Synchronisation réussie' };
}
