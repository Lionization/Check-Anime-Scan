/**
 * @fileoverview Module central d'utilitaires partagés pour l'extension Check Anime & Scans.
 * Isomorphe : fonctionne dans le Service Worker (background), les scripts de contenu et la popup.
 */

/**
 * Constantes globales de l'extension
 */
export const CONSTANTS = {
    ALARM_NAME: 'check-anime-scan-alarm',
    ALARM_INTERVAL_MINUTES: 240, // 4 heures
    DEFAULT_ICON: 'icons/favicon128.png',
    BADGE_COLOR: '#EF4444',
    TARGET_FOLDERS: ['ANIMES', 'SCANS']
};

/**
 * Dictionnaire d'entités HTML courantes pour un décodage rapide et sécurisé sans dépendance DOM.
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
 * Compatible Service Worker (ne nécessite pas DOMParser).
 * 
 * @param {string|null|undefined} text Chaîne brute à décoder
 * @returns {string} Chaîne propre et décodée
 */
export function decodeHTMLEntities(text) {
    if (!text || typeof text !== 'string') return '';
    
    // Deux passes pour gérer le double-encodage éventuel (ex: &amp;rsquo; -> &rsquo; -> ’)
    let decoded = text.replace(ENTITY_REGEX, match => HTML_ENTITIES[match] || match);
    if (decoded.includes('&')) {
        decoded = decoded.replace(ENTITY_REGEX, match => HTML_ENTITIES[match] || match);
    }
    return decoded;
}

/**
 * Nettoie et extrait le titre principal d'un favori en supprimant les suffixes et entités HTML.
 * 
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
 * Gère les identifiants masqués type |#122| et les formats décimaux (ex: "Chapitre 12.5").
 * 
 * @param {string|null|undefined} str Chaîne contenant le statut
 * @returns {number} Valeur numérique extraite (0 si aucune trouvée)
 */
export function extractEpisodeNumber(str) {
    if (!str || typeof str !== 'string') return 0;
    
    // Recherche prioritaire du tag masqué standardisé |#122.5|
    const hiddenMatch = str.match(/\|#(\d+(?:\.\d+)?)\|/);
    if (hiddenMatch) {
        return parseFloat(hiddenMatch[1]);
    }
    
    // Recherche d'un numéro standard
    const standardMatch = str.match(/(\d+(?:\.\d+)?)/);
    return standardMatch ? parseFloat(standardMatch[1]) : 0;
}

/**
 * Nettoie une chaîne de statut pour l'affichage utilisateur (supprime le tag masqué |#122|).
 * 
 * @param {string|null|undefined} stateStr Chaîne de statut brute
 * @returns {string} Statut prêt pour l'affichage
 */
export function cleanStateDisplay(stateStr) {
    if (!stateStr || typeof stateStr !== 'string') return 'État inconnu';
    return stateStr.replace(/\s*\|#\d+(?:\.\d+)?\|\s*/g, '').trim();
}

/**
 * Calcule le nombre total d'éléments non lus et met à jour le badge Chrome.
 * 
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
 * Recherche récursivement les dossiers de favoris ciblés dans l'arbre Chrome Bookmarks.
 * 
 * @param {chrome.bookmarks.BookmarkTreeNode[]} nodes Arbre de favoris
 * @param {string[]} folderNames Noms de dossiers cibles en majuscules (ex: ['ANIMES', 'SCANS'])
 * @param {Array<chrome.bookmarks.BookmarkTreeNode & { category: string }>} targets Tableau récepteur
 */
export function findTargetBookmarkFolders(nodes, folderNames, targets) {
    for (const node of nodes) {
        if (node.children) {
            const upperTitle = (node.title || '').toUpperCase();
            if (folderNames.includes(upperTitle)) {
                // Ajouter tous les enfants ayant une URL valide
                const validChildren = node.children
                    .filter(child => child.url)
                    .map(child => ({ ...child, category: upperTitle }));
                targets.push(...validChildren);
            }
            findTargetBookmarkFolders(node.children, folderNames, targets);
        }
    }
}
