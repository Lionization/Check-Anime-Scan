/**
 * @fileoverview Module central d'utilitaires partagés pour l'extension Check Anime & Scans.
 * Isomorphe : fonctionne dans le Service Worker (background), les scripts de contenu, la popup et la page d'options.
 */

/**
 * Constantes globales et valeurs par défaut
 */
export const CONSTANTS = {
    ALARM_NAME: 'check-anime-scan-alarm',
    DEFAULT_INTERVAL_MINUTES: 240, // 4 heures
    DEFAULT_ICON: 'icons/favicon128.png',
    BADGE_COLOR: '#EF4444',
    DEFAULT_TARGET_FOLDERS: ['ANIMES', 'SCANS'],
    SETTINGS_STORAGE_KEY: '_app_settings'
};

/**
 * Dictionnaire d'entités HTML courantes pour décodage sans dépendance DOM
 * @type {Record<string, string>}
 */
const HTML_ENTITIES = {
    '&amp;': '&',
    '&rsquo;': '’',
    '&lsquo;': '‘',
    '&quot;': '"',
    '&#39;': "'",
    '&#x27;': "'",
    '&lt;': '<',
    '&gt;': '>',
    '&nbsp;': ' ',
    '&eacute;': 'é',
    '&egrave;': 'è',
    '&ecirc;': 'ê',
    '&agrave;': 'à',
    '&acirc;': 'â',
    '&ocirc;': 'ô',
    '&icirc;': 'î',
    '&iuml;': 'ï',
    '&ccedil;': 'ç',
    '&ugrave;': 'ù',
    '&ucirc;': 'û'
};

const ENTITY_REGEX = new RegExp(Object.keys(HTML_ENTITIES).join('|'), 'g');

/**
 * Décode les entités HTML d'une chaîne de caractères (avec support du double-encodage).
 * @param {string|null|undefined} text Chaîne brute à décoder
 * @returns {string} Chaîne propre et décodée
 */
export function decodeHTMLEntities(text) {
    if (!text || typeof text !== 'string') return '';
    let decoded = text.replace(ENTITY_REGEX, match => HTML_ENTITIES[match] || match);
    if (decoded.includes('&')) {
        decoded = decoded.replace(ENTITY_REGEX, match => HTML_ENTITIES[match] || match);
    }
    return decoded;
}

/**
 * Nettoie et extrait le titre principal d'un favori en supprimant les suffixes et entités HTML.
 * @param {string|null|undefined} rawTitle Titre brut du favori
 * @returns {string} Titre nettoyé
 */
export function cleanTitle(rawTitle) {
    if (!rawTitle || typeof rawTitle !== 'string') return '';
    const baseTitle = rawTitle.split(' | ')[0].trim();
    return decodeHTMLEntities(baseTitle);
}

/**
 * Extrait la valeur numérique d'un numéro d'épisode ou de chapitre pour comparaison mathématique.
 * @param {string|null|undefined} str Chaîne contenant le statut
 * @returns {number} Valeur numérique extraite (0 si aucune trouvée)
 */
export function extractEpisodeNumber(str) {
    if (!str || typeof str !== 'string') return 0;
    
    const hiddenMatch = str.match(/\|#(\d+(?:\.\d+)?)\|/);
    if (hiddenMatch) {
        return parseFloat(hiddenMatch[1]);
    }
    
    const standardMatch = str.match(/(\d+(?:\.\d+)?)/);
    return standardMatch ? parseFloat(standardMatch[1]) : 0;
}

/**
 * Nettoie une chaîne de statut pour l'affichage utilisateur (supprime le tag masqué |#122|).
 * @param {string|null|undefined} stateStr Chaîne de statut brute
 * @returns {string} Statut prêt pour l'affichage
 */
export function cleanStateDisplay(stateStr) {
    if (!stateStr || typeof stateStr !== 'string') return 'État inconnu';
    return stateStr.replace(/\s*\|#\d+(?:\.\d+)?\|\s*/g, '').trim();
}

/**
 * Formate un horodatage (timestamp) en indication de temps relatif en français.
 * @param {number|undefined|null} timestamp Millisecondes Unix
 * @returns {string} Texte relatif (ex: "À l'instant", "Il y a 10 min", "Hier", "Il y a 3j")
 */
export function formatRelativeTime(timestamp) {
    if (!timestamp || typeof timestamp !== 'number') return '';
    
    const now = Date.now();
    const diffSeconds = Math.max(0, Math.floor((now - timestamp) / 1000));
    
    if (diffSeconds < 60) {
        return "À l'instant";
    }
    
    const diffMinutes = Math.floor(diffSeconds / 60);
    if (diffMinutes < 60) {
        return `Il y a ${diffMinutes} min`;
    }
    
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) {
        return `Il y a ${diffHours}h`;
    }
    
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) {
        return 'Hier';
    }
    if (diffDays < 7) {
        return `Il y a ${diffDays}j`;
    }
    
    const date = new Date(timestamp);
    return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

/**
 * Calcule le nombre total d'éléments non lus et met à jour le badge Chrome.
 * @param {Record<string, { isNew?: boolean }>} data Objet des données d'extensions
 * @returns {Promise<number>} Le nombre d'éléments nouveaux calculé
 */
export async function updateBadgeCount(data) {
    if (!chrome?.action?.setBadgeText) return 0;
    
    const items = data ? Object.values(data) : [];
    const newCount = items.filter(item => item && item.isNew).length;
    
    if (newCount > 0) {
        await chrome.action.setBadgeText({ text: newCount.toString() });
        if (chrome.action.setBadgeBackgroundColor) {
            await chrome.action.setBadgeBackgroundColor({ color: CONSTANTS.BADGE_COLOR });
        }
    } else {
        await chrome.action.setBadgeText({ text: '' });
    }
    
    return newCount;
}

/**
 * Récupère les paramètres de configuration de l'extension avec valeurs par défaut.
 * @returns {Promise<{ checkInterval: number, notificationsEnabled: boolean, targetFolders: string[], gistId: string, gistToken: string }>}
 */
export async function getAppSettings() {
    try {
        const stored = await chrome.storage.local.get(CONSTANTS.SETTINGS_STORAGE_KEY);
        const savedSettings = stored[CONSTANTS.SETTINGS_STORAGE_KEY] || {};
        
        return {
            checkInterval: savedSettings.checkInterval || CONSTANTS.DEFAULT_INTERVAL_MINUTES,
            notificationsEnabled: savedSettings.notificationsEnabled !== false, // Actif par défaut
            targetFolders: Array.isArray(savedSettings.targetFolders) && savedSettings.targetFolders.length > 0
                ? savedSettings.targetFolders.map(f => f.toUpperCase().trim())
                : [...CONSTANTS.DEFAULT_TARGET_FOLDERS],
            gistId: typeof savedSettings.gistId === 'string' ? savedSettings.gistId.trim() : '',
            gistToken: typeof savedSettings.gistToken === 'string' ? savedSettings.gistToken.trim() : ''
        };
    } catch {
        return {
            checkInterval: CONSTANTS.DEFAULT_INTERVAL_MINUTES,
            notificationsEnabled: true,
            targetFolders: [...CONSTANTS.DEFAULT_TARGET_FOLDERS],
            gistId: '',
            gistToken: ''
        };
    }
}

/**
 * Enregistre les paramètres de configuration de l'extension dans le stockage local.
 * @param {{ checkInterval?: number, notificationsEnabled?: boolean, targetFolders?: string[], gistId?: string, gistToken?: string }} settings 
 */
export async function saveAppSettings(settings) {
    const current = await getAppSettings();
    const updated = {
        ...current,
        ...settings,
        targetFolders: settings.targetFolders
            ? settings.targetFolders.map(f => f.toUpperCase().trim()).filter(Boolean)
            : current.targetFolders,
        gistId: settings.gistId !== undefined ? settings.gistId.trim() : current.gistId,
        gistToken: settings.gistToken !== undefined ? settings.gistToken.trim() : current.gistToken
    };
    
    await chrome.storage.local.set({ [CONSTANTS.SETTINGS_STORAGE_KEY]: updated });
    return updated;
}

/**
 * Recherche récursivement les dossiers de favoris ciblés dans l'arbre Chrome Bookmarks.
 * @param {chrome.bookmarks.BookmarkTreeNode[]} nodes Arbre de favoris
 * @param {string[]} folderNames Noms de dossiers cibles en majuscules (ex: ['ANIMES', 'SCANS'])
 * @param {Array<chrome.bookmarks.BookmarkTreeNode & { category: string }>} targets Tableau récepteur
 */
export function findTargetBookmarkFolders(nodes, folderNames, targets) {
    const normalizedFolders = folderNames.map(f => f.toUpperCase().trim());
    
    for (const node of nodes) {
        if (node.children) {
            const upperTitle = (node.title || '').toUpperCase().trim();
            if (normalizedFolders.includes(upperTitle)) {
                const validChildren = node.children
                    .filter(child => child.url)
                    .map(child => ({ ...child, category: upperTitle }));
                targets.push(...validChildren);
            }
            findTargetBookmarkFolders(node.children, folderNames, targets);
        }
    }
}

/**
 * Exécute un tableau d'éléments avec une fonction asynchrone en limitant la concurrence.
 * @template T, R
 * @param {T[]} items Tableau des éléments à traiter
 * @param {number} concurrency Limite de tâches simultanées
 * @param {(item: T, index: number) => Promise<R>} fn Fonction asynchrone à exécuter
 * @returns {Promise<R[]>} Tableau des résultats ordonnés
 */
export async function runWithConcurrency(items, concurrency, fn) {
    const results = new Array(items.length);
    let currentIndex = 0;
    
    const workers = new Array(Math.min(concurrency, items.length)).fill(null).map(async () => {
        while (currentIndex < items.length) {
            const index = currentIndex++;
            try {
                results[index] = await fn(items[index], index);
            } catch (err) {
                results[index] = null;
            }
        }
    });
    
    await Promise.all(workers);
    return results;
}
