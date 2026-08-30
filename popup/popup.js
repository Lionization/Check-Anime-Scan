/**
 * @fileoverview Contrôleur de l'interface utilisateur de la Popup pour Check Anime & Scans.
 */

import { decodeHTMLEntities, cleanStateDisplay, updateBadgeCount, formatRelativeTime } from '../utils.js';

document.addEventListener('DOMContentLoaded', () => {
    // Éléments du DOM
    const columnsContainer = document.getElementById('columns-container');
    const animesList = document.getElementById('animes-list');
    const scansList = document.getElementById('scans-list');
    const animesEmpty = document.getElementById('animes-empty');
    const scansEmpty = document.getElementById('scans-empty');
    
    const emptyEl = document.getElementById('empty-state');
    const loadingEl = document.getElementById('loading');
    const refreshBtn = document.getElementById('refresh-btn');
    const optionsBtn = document.getElementById('options-btn');
    const markAllReadBtn = document.getElementById('mark-all-read-btn');
    const searchInput = document.getElementById('search-input');

    /** @type {Record<string, any>} */
    let currentUpdates = {};

    // Initialisation
    loadData();

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
            if (newData[key]?.isNew) {
                newData[key].isNew = false;
            }
        }
        await chrome.storage.sync.set(newData);
        await updateBadgeCount(newData);
        renderList(newData, searchInput.value.toLowerCase().trim());
    });

    /**
     * Charge les données depuis chrome.storage.sync
     */
    async function loadData() {
        setLoading(true);
        try {
            const data = await chrome.storage.sync.get(null);
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
        
        let items = Object.values(data).filter(item => item?.title);
        
        if (searchQuery) {
            items = items.filter(item => item.title.toLowerCase().includes(searchQuery));
        }
        
        // Tri : nouveaux en tête, puis alphabétique
        items.sort((a, b) => {
            if (a.isNew && !b.isNew) return -1;
            if (!a.isNew && b.isNew) return 1;
            return a.title.localeCompare(b.title);
        });

        const hasNew = items.some(i => i.isNew);
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

        items.forEach(item => {
            const key = Object.keys(data).find(k => data[k] === item);
            const cardElement = createUpdateItemElement(item, key);

            if (item.category === 'ANIMES') {
                animesList.appendChild(cardElement);
                animeCount++;
            } else {
                scansList.appendChild(cardElement);
                scanCount++;
            }
        });

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
            img.onerror = () => { img.style.display = 'none'; };
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
            stateSpan.innerHTML = `<span style="color: var(--text-muted);">${cleanProg} ➔</span> <b>${cleanLat}</b>`;
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

        if (item.isNew) {
            a.classList.add('is-new');
        }

        infoDiv.appendChild(metaDiv);
        a.appendChild(infoDiv);

        // Actions (Marquer comme lu / Annuler)
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'update-actions';
        let hasActions = false;

        if (item.isNew) {
            hasActions = true;
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

                await chrome.storage.sync.set(newData);
                await updateBadgeCount(newData);
                renderList(newData, searchInput.value.toLowerCase().trim());
            });

            actionsDiv.appendChild(markBtn);
        } else if (item.previousProgress && item.userProgress !== item.previousProgress) {
            hasActions = true;
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
                newData[key].isNew = true;

                await chrome.storage.sync.set(newData);
                await updateBadgeCount(newData);
                renderList(newData, searchInput.value.toLowerCase().trim());
            });

            actionsDiv.appendChild(undoBtn);
        }

        if (hasActions) {
            a.appendChild(actionsDiv);
        }

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
