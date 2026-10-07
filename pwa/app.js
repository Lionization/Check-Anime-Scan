/**
 * @fileoverview Contrôleur principal pour la PWA mobile Check Anime & Scans.
 * Communication directe avec l'API GitHub Gist sans serveur tiers.
 */

const STORAGE_KEYS = {
    GIST_ID: 'check_scans_gist_id',
    GIST_TOKEN: 'check_scans_gist_token',
    CACHED_DATA: 'check_scans_cached_data'
};

const GITHUB_API_URL = 'https://api.github.com/gists';
const GIST_FILENAME = 'suivi.json';

// État de l'application
let allItems = {};
let activeFilter = 'all';
let searchQuery = '';

// Enregistrement du Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch((err) => {
            console.log('Erreur SW:', err);
        });
    });
}

// Initialisation au chargement du DOM
document.addEventListener('DOMContentLoaded', () => {
    const refreshBtn = document.getElementById('refresh-btn');
    const openSettingsBtn = document.getElementById('open-settings-btn');
    const setupBtn = document.getElementById('setup-btn');
    const searchInput = document.getElementById('search-input');
    const filterTabs = document.querySelectorAll('.tab-btn');
    const settingsDialog = document.getElementById('settings-dialog');
    const settingsForm = document.getElementById('settings-form');
    const closeDialogBtn = document.getElementById('close-dialog-btn');
    const gistIdField = document.getElementById('gist-id-field');
    const gistTokenField = document.getElementById('gist-token-field');

    // Récupération des réglages existants
    const storedGistId = localStorage.getItem(STORAGE_KEYS.GIST_ID) || '';
    const storedGistToken = localStorage.getItem(STORAGE_KEYS.GIST_TOKEN) || '';

    if (storedGistId) gistIdField.value = storedGistId;
    if (storedGistToken) gistTokenField.value = storedGistToken;

    // Écouteurs de navigation et filtres
    filterTabs.forEach((tab) => {
        tab.addEventListener('click', () => {
            filterTabs.forEach((t) => t.classList.remove('active'));
            tab.classList.add('active');
            activeFilter = tab.getAttribute('data-filter') || 'all';
            renderItems();
        });
    });

    // Recherche
    searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value.toLowerCase().trim();
        renderItems();
    });

    // Actualisation
    refreshBtn.addEventListener('click', () => {
        loadDataFromGist(true);
    });

    // Gestion du dialogue de réglages
    openSettingsBtn.addEventListener('click', () => {
        settingsDialog.showModal();
    });

    if (setupBtn) {
        setupBtn.addEventListener('click', () => {
            settingsDialog.showModal();
        });
    }

    closeDialogBtn.addEventListener('click', () => {
        settingsDialog.close();
    });

    settingsForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const gistId = gistIdField.value.trim();
        const gistToken = gistTokenField.value.trim();

        if (gistId && gistToken) {
            localStorage.setItem(STORAGE_KEYS.GIST_ID, gistId);
            localStorage.setItem(STORAGE_KEYS.GIST_TOKEN, gistToken);
            settingsDialog.close();
            showToast('Paramètres enregistrés !');
            loadDataFromGist(true);
        }
    });

    // Chargement initial (cache d'abord, puis réseau)
    loadInitialData();

    // Actualisation automatique au retour sur l'application (sortie de veille / changement d'onglet)
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            loadDataFromGist(false);
        }
    });

    window.addEventListener('focus', () => {
        loadDataFromGist(false);
    });

    // Vérification périodique toutes les 3 minutes si la PWA reste active à l'écran
    setInterval(() => {
        if (document.visibilityState === 'visible') {
            loadDataFromGist(false);
        }
    }, 180000);
});

/**
 * Charge les données initiales : affichage immédiat depuis le cache puis rafraîchissement réseau
 */
async function loadInitialData() {
    const cached = localStorage.getItem(STORAGE_KEYS.CACHED_DATA);
    if (cached) {
        try {
            allItems = JSON.parse(cached);
            setViewState('ready');
            renderItems();
        } catch {
            // Ignorer
        }
    }

    const gistId = localStorage.getItem(STORAGE_KEYS.GIST_ID);
    const gistToken = localStorage.getItem(STORAGE_KEYS.GIST_TOKEN);

    if (!gistId || !gistToken) {
        if (!cached) setViewState('unconfigured');
        return;
    }

    await loadDataFromGist(false);
}

/**
 * Récupère les données depuis l'API GitHub Gist
 * @param {boolean} showLoading 
 */
async function loadDataFromGist(showLoading = false) {
    const gistId = localStorage.getItem(STORAGE_KEYS.GIST_ID);
    const gistToken = localStorage.getItem(STORAGE_KEYS.GIST_TOKEN);

    if (!gistId || !gistToken) {
        setViewState('unconfigured');
        return;
    }

    if (showLoading) setViewState('loading');

    try {
        const response = await fetch(`${GITHUB_API_URL}/${gistId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${gistToken}`,
                'Accept': 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const fileObj = data?.files?.[GIST_FILENAME];

        if (fileObj && fileObj.content) {
            const parsed = JSON.parse(fileObj.content);
            allItems = parsed.items || parsed.mangas || parsed || {};
            localStorage.setItem(STORAGE_KEYS.CACHED_DATA, JSON.stringify(allItems));
            showToast('Lectures synchronisées !');
        } else {
            allItems = {};
        }

        setViewState('ready');
        renderItems();
    } catch (error) {
        console.error('Erreur Gist fetch:', error);
        showToast('Erreur de connexion au Gist', true);
        if (Object.keys(allItems).length > 0) {
            setViewState('ready');
            renderItems();
        } else {
            setViewState('unconfigured');
        }
    }
}

/**
 * Met à jour la vue selon l'état actuel
 * @param {'loading'|'unconfigured'|'ready'} state 
 */
function setViewState(state) {
    const loadingEl = document.getElementById('loading-state');
    const unconfEl = document.getElementById('unconfigured-state');
    const emptyEl = document.getElementById('empty-state');
    const gridEl = document.getElementById('items-grid');

    loadingEl.classList.toggle('hidden', state !== 'loading');
    unconfEl.classList.toggle('hidden', state !== 'unconfigured');
    emptyEl.classList.add('hidden');
    gridEl.classList.toggle('hidden', state !== 'ready');
}

/**
 * Extrait le numéro de chapitre ou épisode d'une chaîne
 * @param {string|null|undefined} str 
 * @returns {number}
 */
function extractEpisodeNumber(str) {
    if (!str || typeof str !== 'string') return 0;
    const match = str.match(/(\d+(?:\.\d+)?)/);
    return match ? parseFloat(match[1]) : 0;
}

/**
 * Effectue le rendu de la liste des cartes
 */
function renderItems() {
    const gridEl = document.getElementById('items-grid');
    const emptyEl = document.getElementById('empty-state');
    gridEl.innerHTML = '';

    const entries = Object.entries(allItems);

    // Filtrage
    const filtered = entries.filter(([, item]) => {
        if (!item || typeof item !== 'object') return false;

        const title = (item.title || '').toLowerCase();
        if (searchQuery && !title.includes(searchQuery)) {
            return false;
        }

        const category = (item.category || '').toUpperCase();
        const numUser = extractEpisodeNumber(item.userProgress);
        const numLatest = extractEpisodeNumber(item.latestState);
        const hasUnread = numLatest > numUser || (!item.userProgress && item.latestState);

        if (activeFilter === 'unread') return hasUnread;
        if (activeFilter === 'scans') return category === 'SCANS';
        if (activeFilter === 'animes') return category === 'ANIMES';

        return true;
    });

    if (filtered.length === 0) {
        emptyEl.classList.remove('hidden');
        return;
    }

    emptyEl.classList.add('hidden');

    // Tri alphabétique par titre
    filtered.sort((a, b) => (a[1].title || '').localeCompare(b[1].title || ''));

    filtered.forEach(([urlKey, item]) => {
        const numUser = extractEpisodeNumber(item.userProgress);
        const numLatest = extractEpisodeNumber(item.latestState);
        const hasUpdate = numLatest > numUser;

        const card = document.createElement('article');
        card.className = `manga-card ${hasUpdate ? 'has-update' : ''}`;

        // Jaquette
        const coverEl = item.image 
            ? `<img src="${item.image}" alt="${item.title || 'Manga'}" class="manga-cover" loading="lazy">`
            : `<div class="manga-cover-placeholder">📖</div>`;

        const categoryTag = (item.category || 'SCANS').toUpperCase();
        const categoryClass = categoryTag === 'ANIMES' ? 'tag-animes' : 'tag-scans';

        card.innerHTML = `
            ${coverEl}
            <div class="manga-details">
                <div>
                    <div class="manga-header">
                        <h2 class="manga-title">${item.title || 'Sans titre'}</h2>
                        <span class="tag-badge ${categoryClass}">${categoryTag}</span>
                    </div>

                    ${hasUpdate ? `<span class="badge-unread">Nouveau disponible</span>` : ''}

                    <div class="progress-info">
                        <div class="progress-row">
                            <span class="progress-label">Dernier lu :</span>
                            <span class="progress-val">${item.userProgress || 'Non commencé'}</span>
                        </div>
                        <div class="progress-row">
                            <span class="progress-label">Dernier sorti :</span>
                            <span class="progress-val highlight">${item.latestState || 'Inconnu'}</span>
                        </div>
                    </div>
                </div>

                <div class="manga-actions">
                    ${hasUpdate ? `
                        <button type="button" class="action-btn btn-read-next" data-action="catchup" data-key="${encodeURIComponent(urlKey)}">
                            Valider lu (${item.latestState})
                        </button>
                    ` : ''}
                    <button type="button" class="action-btn btn-plus-one" data-action="plusone" data-key="${encodeURIComponent(urlKey)}" title="Incrémenter d'un chapitre">
                        +1
                    </button>
                    <a href="${item.url || '#'}" target="_blank" rel="noopener" class="action-btn btn-open-link" title="Ouvrir le lien">
                        Ouvrir
                    </a>
                </div>
            </div>
        `;

        // Événements boutons
        const catchupBtn = card.querySelector('[data-action="catchup"]');
        if (catchupBtn) {
            catchupBtn.addEventListener('click', () => {
                markAsRead(urlKey, item.latestState);
            });
        }

        const plusOneBtn = card.querySelector('[data-action="plusone"]');
        if (plusOneBtn) {
            plusOneBtn.addEventListener('click', () => {
                incrementChapter(urlKey);
            });
        }

        gridEl.appendChild(card);
    });
}

/**
 * Valide un chapitre précis pour un manga et envoie le PATCH vers GitHub Gist
 * @param {string} urlKey 
 * @param {string} newProgressText 
 */
async function markAsRead(urlKey, newProgressText) {
    if (!allItems[urlKey]) return;

    // Mise à jour optimiste locale
    allItems[urlKey].userProgress = newProgressText;
    allItems[urlKey].updatedAt = Date.now();
    localStorage.setItem(STORAGE_KEYS.CACHED_DATA, JSON.stringify(allItems));
    renderItems();
    showToast(`Validé : ${newProgressText}`);

    // Sauvegarde distante vers le Gist
    await saveItemsToGist();
}

/**
 * Incrémente le numéro de chapitre actuel d'une unité
 * @param {string} urlKey 
 */
async function incrementChapter(urlKey) {
    const item = allItems[urlKey];
    if (!item) return;

    const currentStr = item.userProgress || item.latestState || '';
    const currentNum = extractEpisodeNumber(currentStr);
    const nextNum = currentNum + 1;

    let nextProgressText = `Chapitre ${nextNum}`;
    if (currentStr.toLowerCase().includes('épisode') || (item.category || '').toUpperCase() === 'ANIMES') {
        nextProgressText = `Épisode ${nextNum}`;
    }

    await markAsRead(urlKey, nextProgressText);
}

/**
 * Pousse l'ensemble des données vers le Gist GitHub
 */
async function saveItemsToGist() {
    const gistId = localStorage.getItem(STORAGE_KEYS.GIST_ID);
    const gistToken = localStorage.getItem(STORAGE_KEYS.GIST_TOKEN);

    if (!gistId || !gistToken) return;

    try {
        const payload = {
            version: 1,
            updatedAt: Date.now(),
            items: allItems
        };

        const response = await fetch(`${GITHUB_API_URL}/${gistId}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${gistToken}`,
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
            console.error('Erreur PATCH Gist:', response.status);
            showToast('Erreur de synchronisation réseau', true);
        } else {
            showToast('Synchronisé avec GitHub Gist');
        }
    } catch (err) {
        console.error('Erreur lors de la sauvegarde Gist:', err);
        showToast('Erreur réseau lors de la sauvegarde', true);
    }
}

/**
 * Affiche un toast d'information à l'utilisateur
 * @param {string} message 
 * @param {boolean} isError 
 */
function showToast(message, isError = false) {
    const toast = document.getElementById('toast');
    if (!toast) return;

    toast.textContent = message;
    toast.style.borderColor = isError ? 'var(--accent-red)' : 'var(--accent-green)';
    toast.classList.remove('hidden');

    if (window._toastTimeout) clearTimeout(window._toastTimeout);
    window._toastTimeout = setTimeout(() => {
        toast.classList.add('hidden');
    }, 2800);
}
