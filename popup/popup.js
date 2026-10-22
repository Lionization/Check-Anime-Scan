/**
 * @fileoverview Contrôleur de l'interface utilisateur de la Popup pour Check Anime & Scans.
 */

import { decodeHTMLEntities, cleanStateDisplay, updateBadgeCount, formatRelativeTime, isItemUnread, extractEpisodeNumber } from '../utils.js';

document.addEventListener('DOMContentLoaded', () => {
    // Affichage dynamique de la version synchronisée
    const versionBadge = document.getElementById('app-version-badge');
    if (versionBadge) {
        versionBadge.textContent = `v${chrome.runtime.getManifest().version}`;
    }

    // Éléments du DOM
    const columnsContainer = document.getElementById('columns-container');
    const animesList = document.getElementById('animes-list');
    const scansList = document.getElementById('scans-list');
    const animesCountEl = document.getElementById('animes-count');
    const scansCountEl = document.getElementById('scans-count');
    const animesEmpty = document.getElementById('animes-empty');
    const scansEmpty = document.getElementById('scans-empty');
    
    const emptyEl = document.getElementById('empty-state');
    const loadingEl = document.getElementById('loading');
    const refreshBtn = document.getElementById('refresh-btn');
    const optionsBtn = document.getElementById('options-btn');
    const markAllReadBtn = document.getElementById('mark-all-read-btn');
    const searchInput = document.getElementById('search-input');
    const sortToggleBtn = document.getElementById('sort-toggle-btn');
    const sortLabel = document.getElementById('sort-label');

    // Dialogue Modal de Modification d'avancement
    const chapterDialog = document.getElementById('chapter-dialog');
    const chapterForm = document.getElementById('chapter-form');
    const closeChapterDialogBtn = document.getElementById('close-chapter-dialog-btn');
    const cancelChapterDialogBtn = document.getElementById('cancel-chapter-dialog-btn');
    const chapterTargetKey = document.getElementById('chapter-target-key');
    const chapterNumberInput = document.getElementById('chapter-number-input');
    const chapterDialogTitle = document.getElementById('chapter-dialog-title');

    /** @type {Record<string, any>} */
    let currentUpdates = {};

    // Mode de tri actif : 'date' par défaut (mémorisée en localStorage)
    let currentSort = localStorage.getItem('check_scans_popup_sort') || 'date';
    updateSortUI();

    /**
     * Ouvre la boîte de dialogue pour éditer manuellement la progression
     * @param {string} key 
     * @param {any} item 
     */
    function openChapterEditModal(key, item) {
        if (!chapterDialog) return;
        if (chapterDialogTitle) {
            chapterDialogTitle.textContent = `Modifier : ${item.title || 'Média'}`;
        }
        if (chapterTargetKey) {
            chapterTargetKey.value = key;
        }
        const currentNum = extractEpisodeNumber(item.userProgress || item.latestState);
        if (chapterNumberInput) {
            chapterNumberInput.value = currentNum > 0 ? currentNum : '';
        }
        if (typeof chapterDialog.showModal === 'function') {
            chapterDialog.showModal();
            chapterNumberInput?.focus();
        }
    }

    /**
     * Ferme la boîte de dialogue de modification
     */
    function closeChapterEditModal() {
        if (chapterDialog && chapterDialog.open) {
            chapterDialog.close();
        }
    }

    if (closeChapterDialogBtn) {
        closeChapterDialogBtn.addEventListener('click', closeChapterEditModal);
    }
    if (cancelChapterDialogBtn) {
        cancelChapterDialogBtn.addEventListener('click', closeChapterEditModal);
    }
    if (chapterDialog) {
        chapterDialog.addEventListener('click', (e) => {
            if (e.target === chapterDialog) {
                closeChapterEditModal();
            }
        });
    }

    if (chapterForm) {
        chapterForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const targetKey = chapterTargetKey?.value;
            const newNum = chapterNumberInput?.value.trim();

            if (targetKey && newNum !== '' && currentUpdates[targetKey]) {
                const item = currentUpdates[targetKey];
                const isAnime = (item.category || '').toUpperCase() === 'ANIMES' || (item.userProgress || item.latestState || '').toLowerCase().includes('épisode');
                const newProgress = isAnime ? `Épisode ${newNum}` : `Chapitre ${newNum}`;

                closeChapterEditModal();

                const newData = { ...currentUpdates };
                newData[targetKey].userProgress = newProgress;
                newData[targetKey].updatedAt = Date.now();
                newData[targetKey].isNew = isItemUnread(newData[targetKey]);

                await chrome.storage.local.set(newData);
                await updateBadgeCount(newData);
                currentUpdates = newData;
                renderList(newData, searchInput.value.toLowerCase().trim());
                chrome.runtime.sendMessage({ action: 'syncGist' }).catch(() => {});
            }
        });
    }

    // Gestion du basculement de tri Date <-> A-Z
    if (sortToggleBtn) {
        sortToggleBtn.addEventListener('click', () => {
            currentSort = currentSort === 'date' ? 'alpha' : 'date';
            localStorage.setItem('check_scans_popup_sort', currentSort);
            updateSortUI();
            renderList(currentUpdates, searchInput.value.toLowerCase().trim());
        });
    }

    /**
     * Met à jour le libellé, l'infobulle et l'accessibilité ARIA du bouton de tri
     */
    function updateSortUI() {
        const isDate = currentSort === 'date';
        if (sortLabel) {
            sortLabel.textContent = isDate ? 'Date' : 'A-Z';
        }
        if (sortToggleBtn) {
            sortToggleBtn.setAttribute('aria-pressed', isDate ? 'false' : 'true');
            sortToggleBtn.setAttribute(
                'aria-label',
                isDate 
                    ? 'Trier par date récente (actif). Cliquer pour trier par ordre alphabétique' 
                    : 'Trier par ordre alphabétique (actif). Cliquer pour trier par date récente'
            );
            sortToggleBtn.title = isDate 
                ? 'Tri : Par Date récente (cliquer pour tri alphabétique A-Z)' 
                : 'Tri : Par ordre alphabétique A-Z (cliquer pour tri par Date)';
        }
    }

    // Initialisation
    loadData();
    try {
        chrome.runtime.sendMessage({ action: 'syncGist' }, (res) => {
            if (res?.success) {
                chrome.storage.local.get(null).then(data => {
                    currentUpdates = data || {};
                    renderList(currentUpdates, searchInput.value.toLowerCase().trim());
                });
            }
        });
    } catch {
        // Ignorer si le service worker est occupé
    }

    // Ouverture des options
    if (optionsBtn) {
        optionsBtn.addEventListener('click', () => {
            if (chrome.runtime.openOptionsPage) {
                chrome.runtime.openOptionsPage();
            } else {
                window.open(chrome.runtime.getURL('options/options.html'));
            }
        });
    }

    // Recherche dynamique filtrée
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        renderList(currentUpdates, query);
    });

    // Rafraîchissement manuel
    refreshBtn.addEventListener('click', async () => {
        setLoading(true);
        refreshBtn.disabled = true;
        
        chrome.runtime.sendMessage({ action: 'forceCheck' }, () => {
            setTimeout(async () => {
                await loadData();
                refreshBtn.disabled = false;
            }, 500);
        });
    });

    // Tout marquer comme lu
    markAllReadBtn.addEventListener('click', async () => {
        const newData = { ...currentUpdates };
        for (const key in newData) {
            if (isItemUnread(newData[key])) {
                newData[key].isNew = false;
                newData[key].previousProgress = newData[key].userProgress;
                newData[key].userProgress = newData[key].latestState || newData[key].userProgress;
                newData[key].updatedAt = Date.now();
            }
        }
        await chrome.storage.local.set(newData);
        await updateBadgeCount(newData);
        currentUpdates = newData;
        renderList(newData, searchInput.value.toLowerCase().trim());
        chrome.runtime.sendMessage({ action: 'syncGist' }).catch(() => {});
    });

    /**
     * Charge les données depuis chrome.storage.local
     */
    async function loadData() {
        setLoading(true);
        try {
            const data = await chrome.storage.local.get(null);
            currentUpdates = data || {};
            renderList(currentUpdates, searchInput.value.toLowerCase().trim());
        } catch (error) {
            console.error("Erreur lors du chargement des données:", error);
        } finally {
            setLoading(false);
        }
    }

    /**
     * Effectue le rendu des cartes animes et scans
     * @param {Record<string, any>} data 
     * @param {string} searchQuery 
     */
    function renderList(data, searchQuery = '') {
        animesList.innerHTML = '';
        scansList.innerHTML = '';
        
        // Optimisation O(N) : conservation de la clé directe dès l'extraction
        let items = Object.entries(data)
            .filter(([_, item]) => item?.title)
            .map(([key, item]) => ({ ...item, _key: key }));
        
        if (searchQuery) {
            items = items.filter(item => item.title.toLowerCase().includes(searchQuery));
        }
        
        // Tri : non lus en tête, puis selon le mode actif (date récente par défaut ou A-Z)
        items.sort((a, b) => {
            const aUnread = isItemUnread(a);
            const bUnread = isItemUnread(b);
            if (aUnread && !bUnread) return -1;
            if (!aUnread && bUnread) return 1;

            if (currentSort === 'date') {
                const timeA = a.timestamp || a.updatedAt || 0;
                const timeB = b.timestamp || b.updatedAt || 0;
                if (timeB !== timeA) return timeB - timeA;
                return a.title.localeCompare(b.title);
            }

            return a.title.localeCompare(b.title);
        });

        const hasNew = items.some(i => isItemUnread(i));
        markAllReadBtn.disabled = !hasNew;

        if (items.length === 0) {
            columnsContainer.classList.add('hidden');
            emptyEl.classList.remove('hidden');
            return;
        }

        columnsContainer.classList.remove('hidden');
        emptyEl.classList.add('hidden');

        let animeCount = 0;
        let scanCount = 0;

        // Optimisation DOM : DocumentFragment pour insérer les cartes en un seul batch atomique
        const animeFragment = document.createDocumentFragment();
        const scanFragment = document.createDocumentFragment();

        for (const item of items) {
            const cardElement = createUpdateItemElement(item, item._key);

            if (item.category === 'ANIMES') {
                animeFragment.appendChild(cardElement);
                animeCount++;
            } else {
                scanFragment.appendChild(cardElement);
                scanCount++;
            }
        }

        animesList.appendChild(animeFragment);
        scansList.appendChild(scanFragment);

        if (animesCountEl) {
            animesCountEl.textContent = `(${animeCount})`;
        }
        if (scansCountEl) {
            scansCountEl.textContent = `(${scanCount})`;
        }

        animesEmpty.classList.toggle('hidden', animeCount > 0);
        scansEmpty.classList.toggle('hidden', scanCount > 0);
    }

    /**
     * Crée l'élément DOM d'une carte d'anime ou scan
     * @param {any} item 
     * @param {string} key 
     * @returns {HTMLLIElement}
     */
    function createUpdateItemElement(item, key) {
        const li = document.createElement('li');
        
        const a = document.createElement('a');
        a.href = item.url;
        a.className = 'update-item';
        a.rel = 'noopener noreferrer';
        
        // Ouvrir dans un onglet d'arrière-plan sans fermer la popup
        a.addEventListener('click', (e) => {
            e.preventDefault();
            chrome.tabs.create({ url: item.url, active: false });
        });

        // Jaquette
        if (item.image) {
            const img = document.createElement('img');
            img.src = item.image;
            img.className = 'item-cover';
            img.loading = 'lazy';
            img.alt = '';
            img.onerror = () => { img.classList.add('hidden'); };
            a.appendChild(img);
        }

        const infoDiv = document.createElement('div');
        infoDiv.className = 'update-info';

        const titleSpan = document.createElement('span');
        titleSpan.className = 'update-title';
        titleSpan.textContent = decodeHTMLEntities(item.title);
        infoDiv.appendChild(titleSpan);

        const metaDiv = document.createElement('div');
        metaDiv.className = 'update-meta';

        const stateSpan = document.createElement('span');
        if (item.userProgress && item.userProgress !== item.latestState) {
            const cleanProg = cleanStateDisplay(item.userProgress);
            const cleanLat = cleanStateDisplay(item.latestState);

            const progSpan = document.createElement('span');
            progSpan.className = 'prog-prev';
            progSpan.textContent = `${cleanProg} ➔ `;

            const latestB = document.createElement('b');
            latestB.textContent = cleanLat;

            stateSpan.appendChild(progSpan);
            stateSpan.appendChild(latestB);
        } else if (!item.userProgress && item.latestState) {
            const cleanLat = cleanStateDisplay(item.latestState);

            const progSpan = document.createElement('span');
            progSpan.className = 'prog-prev';
            progSpan.textContent = `Non commencé ➔ `;

            const latestB = document.createElement('b');
            latestB.textContent = cleanLat;

            stateSpan.appendChild(progSpan);
            stateSpan.appendChild(latestB);
        } else {
            stateSpan.textContent = cleanStateDisplay(item.latestState || item.lastState);
        }
        metaDiv.appendChild(stateSpan);

        // Affichage du temps relatif
        const relativeTime = formatRelativeTime(item.timestamp);
        if (relativeTime) {
            const timeSpan = document.createElement('span');
            timeSpan.className = 'update-time';
            timeSpan.textContent = `• ${relativeTime}`;
            metaDiv.appendChild(timeSpan);
        }

        const unread = isItemUnread(item);
        if (unread) {
            a.classList.add('is-new');
        }

        infoDiv.appendChild(metaDiv);
        a.appendChild(infoDiv);

        // Actions (Édition manuelle / Marquer comme lu / Annuler)
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'update-actions';

        // Bouton d'édition d'avancement manuel (crayon)
        const editBtn = document.createElement('button');
        editBtn.className = 'btn-edit-progress';
        editBtn.title = 'Modifier l’avancement';
        editBtn.setAttribute('aria-label', `Modifier l’avancement de ${item.title}`);
        editBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>`;

        editBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            openChapterEditModal(key, item);
        });

        actionsDiv.appendChild(editBtn);

        if (unread) {
            const markBtn = document.createElement('button');
            markBtn.className = 'btn-mark-read';
            markBtn.title = 'Marquer comme lu';
            markBtn.setAttribute('aria-label', 'Marquer comme lu');
            markBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

            markBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();

                const newData = { ...currentUpdates };
                newData[key].isNew = false;
                newData[key].previousProgress = newData[key].userProgress;
                newData[key].userProgress = newData[key].latestState;
                newData[key].updatedAt = Date.now();

                await chrome.storage.local.set(newData);
                await updateBadgeCount(newData);
                currentUpdates = newData;
                renderList(newData, searchInput.value.toLowerCase().trim());
                chrome.runtime.sendMessage({ action: 'syncGist' }).catch(() => {});
            });

            actionsDiv.appendChild(markBtn);
        } else if (item.previousProgress && item.userProgress !== item.previousProgress) {
            const undoBtn = document.createElement('button');
            undoBtn.className = 'btn-undo-read';
            undoBtn.title = 'Annuler et restaurer';
            undoBtn.setAttribute('aria-label', 'Annuler');
            undoBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"></path><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"></path></svg>`;

            undoBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();

                const newData = { ...currentUpdates };
                newData[key].userProgress = newData[key].previousProgress;
                newData[key].isNew = isItemUnread(newData[key]);
                newData[key].updatedAt = Date.now();

                await chrome.storage.local.set(newData);
                await updateBadgeCount(newData);
                currentUpdates = newData;
                renderList(newData, searchInput.value.toLowerCase().trim());
                chrome.runtime.sendMessage({ action: 'syncGist' }).catch(() => {});
            });

            actionsDiv.appendChild(undoBtn);
        }

        a.appendChild(actionsDiv);

        li.appendChild(a);
        return li;
    }

    /**
     * Gère l'affichage du spinner de chargement
     * @param {boolean} isLoading 
     */
    function setLoading(isLoading) {
        if (isLoading) {
            loadingEl.classList.remove('hidden');
            columnsContainer.classList.add('hidden');
            emptyEl.classList.add('hidden');
        } else {
            loadingEl.classList.add('hidden');
        }
    }
});
