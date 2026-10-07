/**
 * @fileoverview Contrôleur principal pour la PWA mobile Check Anime & Scans.
 * Communication directe avec l'API GitHub Gist, pull-to-refresh et édition directe.
 */

const STORAGE_KEYS = {
    GIST_ID: 'check_scans_gist_id',
    GIST_TOKEN: 'check_scans_gist_token',
    CACHED_DATA: 'check_scans_cached_data',
    LAST_SYNC_TIME: 'check_scans_last_sync'
};

const GITHUB_API_URL = 'https://api.github.com/gists';
const GIST_FILENAME = 'suivi.json';
const VAPID_PUBLIC_KEY = 'BFdc6qHW_0VONqmpkv2Qy6lbV5Tp4U3xdG2gOPCNKaqPfmPbsLK8upQXLnus7cFx1pGJV7HXddnw4y_wtgvVHMg';

// État de l'application
let allItems = {};
let activeFilter = 'unread';
let searchQuery = '';
let isSyncing = false;
let currentPushSubscription = null;

// Enregistrement et mise à jour du Service Worker
function registerAppServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('./sw.js').then((reg) => {
        reg.update();
        refreshPushStatusUI(reg);
    }).catch((err) => {
        console.warn('Erreur SW:', err);
    });
}

if (document.readyState === 'complete') {
    registerAppServiceWorker();
} else {
    window.addEventListener('load', registerAppServiceWorker);
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
    const togglePushBtn = document.getElementById('toggle-push-btn');

    if (togglePushBtn) {
        togglePushBtn.addEventListener('click', () => {
            handleTogglePushSubscription();
        });
    }

    // Éléments du dialogue de modification de chapitre
    const chapterDialog = document.getElementById('chapter-dialog');
    const chapterForm = document.getElementById('chapter-form');
    const closeChapterDialogBtn = document.getElementById('close-chapter-dialog-btn');

    // Récupération des réglages existants
    const storedGistId = localStorage.getItem(STORAGE_KEYS.GIST_ID) || '';
    const storedGistToken = localStorage.getItem(STORAGE_KEYS.GIST_TOKEN) || '';

    if (storedGistId) gistIdField.value = storedGistId;
    if (storedGistToken) gistTokenField.value = storedGistToken;

    // Initialisation forcée de l'onglet 'unread' par défaut
    activeFilter = 'unread';
    filterTabs.forEach((tab) => {
        const isUnread = tab.getAttribute('data-filter') === 'unread';
        tab.classList.toggle('active', isUnread);

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
        refreshPushStatusUI();
        settingsDialog.showModal();
    });

    if (setupBtn) {
        setupBtn.addEventListener('click', () => {
            refreshPushStatusUI();
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

    // Gestion du dialogue d'édition manuelle de chapitre
    if (closeChapterDialogBtn) {
        closeChapterDialogBtn.addEventListener('click', () => {
            chapterDialog.close();
        });
    }

    if (chapterForm) {
        chapterForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const targetKey = document.getElementById('chapter-target-key').value;
            const newNum = document.getElementById('chapter-number-input').value.trim();

            if (targetKey && newNum && allItems[targetKey]) {
                const item = allItems[targetKey];
                const isAnime = (item.category || '').toUpperCase() === 'ANIMES' || (item.userProgress || '').toLowerCase().includes('épisode');
                const newProgress = isAnime ? `Épisode ${newNum}` : `Chapitre ${newNum}`;
                chapterDialog.close();
                markAsRead(targetKey, newProgress);
            }
        });
    }

    // Initialisation Push dès que le Service Worker est prêt
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then((reg) => {
            refreshPushStatusUI(reg);
        });
    }

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

    // Initialisation du geste Pull-to-Refresh
    initPullToRefresh();
});

/**
 * Configure le geste tactile Pull to Refresh sur mobile
 */
function initPullToRefresh() {
    const ptrIndicator = document.getElementById('ptr-indicator');
    if (!ptrIndicator) return;

    let touchStartY = 0;
    let touchDiffY = 0;
    let isTracking = false;

    window.addEventListener('touchstart', (e) => {
        if (window.scrollY === 0 && e.touches.length === 1) {
            touchStartY = e.touches[0].clientY;
            isTracking = true;
        } else {
            isTracking = false;
        }
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
        if (!isTracking || window.scrollY > 0 || isSyncing) return;
        const currentY = e.touches[0].clientY;
        touchDiffY = currentY - touchStartY;

        if (touchDiffY > 40) {
            ptrIndicator.classList.add('visible');
        }
    }, { passive: true });

    window.addEventListener('touchend', () => {
        if (!isTracking) return;
        if (touchDiffY > 75 && !isSyncing) {
            if (navigator.vibrate) navigator.vibrate(20);
            loadDataFromGist(true).finally(() => {
                ptrIndicator.classList.remove('visible');
            });
        } else {
            ptrIndicator.classList.remove('visible');
        }
        isTracking = false;
        touchDiffY = 0;
    }, { passive: true });
}

/**
 * Met à jour l'indicateur visuel d'état de synchronisation dans l'en-tête
 * @param {'syncing'|'synced'|'error'} state 
 * @param {string} text 
 */
function setSyncStatus(state, text) {
    const dot = document.querySelector('.sync-dot');
    const label = document.getElementById('sync-label');
    if (!dot || !label) return;

    dot.className = 'sync-dot';
    if (state === 'syncing') dot.classList.add('syncing');
    if (state === 'error') dot.classList.add('error');

    label.textContent = text;
}

/**
 * Formate un timestamp relatif concis pour le statut
 * @param {number} timestamp 
 * @returns {string}
 */
function formatRelativeSyncTime(timestamp) {
    if (!timestamp) return 'Synchronisé';
    const elapsedMinutes = Math.floor((Date.now() - timestamp) / 60000);
    if (elapsedMinutes < 1) return 'À l’instant';
    if (elapsedMinutes < 60) return `Il y a ${elapsedMinutes}m`;
    return 'Synchronisé';
}

/**
 * Charge les données initiales : affichage immédiat depuis le cache puis rafraîchissement réseau
 */
async function loadInitialData() {
    const cached = localStorage.getItem(STORAGE_KEYS.CACHED_DATA);
    const lastSync = parseInt(localStorage.getItem(STORAGE_KEYS.LAST_SYNC_TIME) || '0', 10);

    if (cached) {
        try {
            allItems = JSON.parse(cached);
            setViewState('ready');
            renderItems();
            setSyncStatus('synced', formatRelativeSyncTime(lastSync));
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
    setSyncStatus('syncing', 'Synchronisation...');
    isSyncing = true;

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
            localStorage.setItem(STORAGE_KEYS.LAST_SYNC_TIME, Date.now().toString());
            setSyncStatus('synced', 'À l’instant');
        } else {
            allItems = {};
            setSyncStatus('synced', 'Synchronisé');
        }

        setViewState('ready');
        renderItems();
    } catch (error) {
        console.error('Erreur Gist fetch:', error);
        setSyncStatus('error', 'Erreur réseau');
        if (Object.keys(allItems).length > 0) {
            setViewState('ready');
            renderItems();
        } else {
            setViewState('unconfigured');
        }
    } finally {
        isSyncing = false;
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
    const hiddenMatch = str.match(/\|#(\d+(?:\.\d+)?)\|/);
    if (hiddenMatch) {
        return parseFloat(hiddenMatch[1]);
    }
    const match = str.match(/(\d+(?:\.\d+)?)/);
    return match ? parseFloat(match[1]) : 0;
}

/**
 * Détermine si un manga/anime a des sorties non lues en attente
 * @param {any} item 
 * @returns {boolean}
 */
function isItemUnread(item) {
    if (!item || typeof item !== 'object') return false;
    if (item.isNew === true) return true;
    const numUser = extractEpisodeNumber(item.userProgress);
    const numLatest = extractEpisodeNumber(item.latestState);
    if (numLatest > numUser) return true;
    if (!item.userProgress && !!item.latestState) return true;
    if (item.userProgress && item.latestState && item.userProgress !== item.latestState && !numLatest && !numUser) return true;
    return false;
}

/**
 * Met à jour le badge numérique natif sur l'icône de l'application (Badging API)
 */
function updateAppBadge() {
    let unreadCount = 0;
    for (const item of Object.values(allItems)) {
        if (isItemUnread(item)) {
            unreadCount++;
        }
    }

    if ('setAppBadge' in navigator) {
        if (unreadCount > 0) {
            navigator.setAppBadge(unreadCount).catch(() => {});
        } else {
            navigator.clearAppBadge().catch(() => {});
        }
    }

    // Mise à jour visuelle du libellé de l'onglet À lire avec compteur
    const unreadTab = document.querySelector('.tab-btn[data-filter="unread"]');
    if (unreadTab) {
        unreadTab.textContent = unreadCount > 0 ? `À lire (${unreadCount})` : 'À lire';
    }
}

/**
 * Effectue le rendu de la liste des cartes
 */
function renderItems() {
    updateAppBadge();
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
        const hasUnread = isItemUnread(item);

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
                            <div class="progress-val-wrapper">
                                <span class="progress-val">${item.userProgress || 'Non commencé'}</span>
                                <button type="button" class="btn-edit-progress" data-action="edit" data-key="${encodeURIComponent(urlKey)}" title="Modifier manuellement">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M12 20h9"></path>
                                        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                                    </svg>
                                </button>
                            </div>
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

        const editBtn = card.querySelector('[data-action="edit"]');
        if (editBtn) {
            editBtn.addEventListener('click', () => {
                openChapterEditModal(urlKey, item);
            });
        }

        gridEl.appendChild(card);
    });
}

/**
 * Ouvre le dialogue modal pour modifier manuellement le numéro de chapitre
 * @param {string} urlKey 
 * @param {any} item 
 */
function openChapterEditModal(urlKey, item) {
    const dialog = document.getElementById('chapter-dialog');
    const titleEl = document.getElementById('chapter-dialog-title');
    const targetKeyInput = document.getElementById('chapter-target-key');
    const numberInput = document.getElementById('chapter-number-input');

    if (!dialog) return;

    titleEl.textContent = `Modifier : ${item.title || 'Manga'}`;
    targetKeyInput.value = urlKey;
    const currentNum = extractEpisodeNumber(item.userProgress);
    numberInput.value = currentNum > 0 ? currentNum : '';

    dialog.showModal();
    numberInput.focus();
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

    setSyncStatus('syncing', 'Sauvegarde...');

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
            setSyncStatus('error', 'Erreur sauvegarde');
            showToast('Erreur de synchronisation réseau', true);
        } else {
            localStorage.setItem(STORAGE_KEYS.LAST_SYNC_TIME, Date.now().toString());
            setSyncStatus('synced', 'À l’instant');
            showToast('Synchronisé avec GitHub Gist');
        }
    } catch (err) {
        console.error('Erreur lors de la sauvegarde Gist:', err);
        setSyncStatus('error', 'Erreur réseau');
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

/**
 * =========================================================================
 * WEB PUSH NOTIFICATIONS
 * =========================================================================
 */

/**
 * Convertit une clé publique VAPID base64 en Uint8Array
 * @param {string} base64String 
 * @returns {Uint8Array}
 */
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

/**
 * Vérifie et actualise l'état des notifications dans la modale
 * @param {ServiceWorkerRegistration|null} [regInstance]
 */
async function refreshPushStatusUI(regInstance = null) {
    const btn = document.getElementById('toggle-push-btn');
    const label = document.getElementById('push-status-label');
    if (!btn || !label) return;

    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        btn.disabled = true;
        btn.textContent = 'Non disponible';
        label.textContent = 'Notifications non supportées par ce navigateur (sur iPhone : installez l’application sur votre écran d’accueil).';
        label.style.color = '#ef4444';
        return;
    }

    if (Notification.permission === 'denied') {
        btn.disabled = true;
        btn.textContent = 'Notifications bloquées';
        label.textContent = 'Bloqué par Chrome : appuyez sur l’icône cadenas/réglages à gauche de l’URL > Autorisations > Notifications > Autoriser.';
        label.style.color = '#f59e0b';
        return;
    }

    try {
        const reg = regInstance || await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        currentPushSubscription = sub;
        updatePushUI(!!sub);
    } catch (err) {
        console.warn('Erreur vérification abonnement push:', err);
        updatePushUI(false);
    }
}

/**
 * Met à jour le libellé et le bouton de notification
 * @param {boolean} isSubscribed 
 */
function updatePushUI(isSubscribed) {
    const btn = document.getElementById('toggle-push-btn');
    const label = document.getElementById('push-status-label');
    if (!btn || !label) return;

    if (isSubscribed) {
        btn.disabled = false;
        btn.textContent = 'Désactiver les notifications';
        btn.className = 'btn btn-outline';
        label.textContent = 'Notifications actives sur ce téléphone !';
        label.style.color = 'var(--accent-green)';
    } else {
        btn.className = 'btn btn-secondary';
        if (window.Notification && Notification.permission === 'denied') {
            btn.disabled = true;
            btn.textContent = 'Notifications bloquées';
            label.textContent = 'Bloqué par Chrome : appuyez sur le cadenas à gauche de l’adresse web > Notifications > Autoriser.';
            label.style.color = '#f59e0b';
        } else if (window.Notification && Notification.permission === 'granted') {
            btn.disabled = false;
            btn.textContent = 'Activer les notifications directes';
            label.textContent = 'Autorisation système accordée. Cliquez pour lier cet appareil au suivi cloud.';
            label.style.color = 'var(--text-secondary)';
        } else {
            btn.disabled = false;
            btn.textContent = 'Activer les notifications directes';
            label.textContent = 'Recevez une alerte sur votre téléphone dès qu’un scan sort.';
            label.style.color = 'var(--text-secondary)';
        }
    }
}

/**
 * Active ou désactive l'abonnement Web Push avec feedback visuel direct
 */
async function handleTogglePushSubscription() {
    const btn = document.getElementById('toggle-push-btn');
    const label = document.getElementById('push-status-label');
    if (!btn) return;

    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        if (label) {
            label.textContent = 'Notifications non supportées par ce navigateur.';
            label.style.color = '#ef4444';
        }
        return;
    }

    if (Notification.permission === 'denied') {
        btn.disabled = true;
        btn.textContent = 'Notifications bloquées';
        if (label) {
            label.textContent = 'Notifications bloquées dans Chrome : cliquez sur le cadenas à gauche de l’adresse > Notifications > Autoriser.';
            label.style.color = '#f59e0b';
        }
        return;
    }

    btn.disabled = true;

    try {
        if (currentPushSubscription) {
            // Désabonnement
            btn.textContent = 'Désactivation...';
            if (label) label.textContent = 'Suppression de l’abonnement en cours...';
            await currentPushSubscription.unsubscribe();
            currentPushSubscription = null;
            await saveSubscriptionToGist(null);
            updatePushUI(false);
            showToast('Notifications désactivées.');
        } else {
            // Demande d'autorisation directe (geste utilisateur synchrone)
            btn.textContent = 'Demande en cours...';
            if (label) {
                label.textContent = 'Veuillez accepter la demande de notification...';
                label.style.color = 'var(--text-secondary)';
            }

            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                btn.disabled = true;
                btn.textContent = 'Notifications refusées';
                if (label) {
                    label.textContent = 'Autorisation non accordée. Si aucune invite n’est apparue, vérifiez les paramètres du site dans Chrome.';
                    label.style.color = '#f59e0b';
                }
                showToast('Autorisation refusée par le navigateur.', true);
                return;
            }

            // Inscription PushManager auprès de Google FCM
            btn.textContent = 'Connexion Push...';
            if (label) label.textContent = 'Génération de l’identifiant d’envoi Push auprès de Google...';

            const reg = await navigator.serviceWorker.ready;
            const sub = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
            });

            // Sauvegarde dans le Gist secret
            btn.textContent = 'Sauvegarde cloud...';
            if (label) label.textContent = 'Enregistrement de l’appareil sur votre Gist secret...';

            await saveSubscriptionToGist(sub.toJSON());

            currentPushSubscription = sub;
            updatePushUI(true);
            showToast('Notifications activées sur ce téléphone !');

            // Déclenchement d'une notification locale immédiate pour confirmation matérielle
            try {
                await reg.showNotification('Check Anime & Scans', {
                    body: 'Notifications directes activées avec succès sur ce smartphone !',
                    icon: './icons/favicon128.png',
                    badge: './icons/favicon48.png'
                });
            } catch { }
        }
    } catch (err) {
        console.error('Erreur bascule notification:', err);
        if (label) {
            label.textContent = `Erreur : ${err.message || 'Échec de connexion'}`;
            label.style.color = '#ef4444';
        }
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Réessayer l’activation';
        }
        showToast('Erreur : ' + (err.message || 'Échec activation'), true);
    } finally {
        if (currentPushSubscription) {
            btn.disabled = false;
        }
    }
}

/**
 * Sauvegarde la souscription Web Push dans le Gist secret
 * @param {PushSubscriptionJSON|null} subJson 
 */
async function saveSubscriptionToGist(subJson) {
    const gistId = localStorage.getItem(STORAGE_KEYS.GIST_ID) || document.getElementById('gist-id-field')?.value.trim();
    const gistToken = localStorage.getItem(STORAGE_KEYS.GIST_TOKEN) || document.getElementById('gist-token-field')?.value.trim();

    if (!gistId || !gistToken) {
        throw new Error('Identifiants Gist absents. Veuillez enregistrer votre ID Gist et Token dans les réglages.');
    }

    let itemsToSave = allItems;
    if (!itemsToSave || Object.keys(itemsToSave).length === 0) {
        try {
            const rawCache = localStorage.getItem(STORAGE_KEYS.CACHE_ITEMS);
            if (rawCache) itemsToSave = JSON.parse(rawCache);
        } catch { }
    }

    const payload = {
        version: 1,
        updatedAt: Date.now(),
        _pushSubscription: subJson,
        items: itemsToSave || {}
    };

    const res = await fetch(`${GITHUB_API_URL}/${gistId}`, {
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

    if (!res.ok) {
        throw new Error(`Échec GitHub API (${res.status}) : vérifiez la validité de votre Token.`);
    }
}
