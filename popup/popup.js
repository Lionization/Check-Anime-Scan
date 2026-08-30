document.addEventListener('DOMContentLoaded', () => {
    const columnsContainer = document.getElementById('columns-container');
    const animesList = document.getElementById('animes-list');
    const scansList = document.getElementById('scans-list');
    const animesEmpty = document.getElementById('animes-empty');
    const scansEmpty = document.getElementById('scans-empty');
    
    const emptyEl = document.getElementById('empty-state');
    const loadingEl = document.getElementById('loading');
    const refreshBtn = document.getElementById('refresh-btn');
    const markAllReadBtn = document.getElementById('mark-all-read-btn');
    const searchInput = document.getElementById('search-input');

    let currentUpdates = {};

    // Charger les données
    loadData();

    // Recherche
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        renderList(currentUpdates, query);
    });

    // Bouton de rafraîchissement manuel
    refreshBtn.addEventListener('click', async () => {
        setLoading(true);
        refreshBtn.disabled = true;
        
        // On demande au background de forcer le check
        chrome.runtime.sendMessage({ action: 'forceCheck' }, (response) => {
            // Une fois terminé, on recharge l'UI
            setTimeout(() => {
                loadData();
                refreshBtn.disabled = false;
            }, 500); // Petit délai pour laisser le storage se mettre à jour si nécessaire
        });
    });

    // Bouton tout marquer comme lu
    markAllReadBtn.addEventListener('click', async () => {
        const newData = { ...currentUpdates };
        for (const key in newData) {
            if (newData[key] && newData[key].isNew) {
                newData[key].isNew = false;
                // On ne met plus à jour userProgress ici pour conserver la progression réelle
            }
        }
        await chrome.storage.sync.set(newData);
        chrome.action.setBadgeText({ text: '' });
        renderList(newData);
    });

    async function loadData() {
        setLoading(true);
        try {
            const data = await chrome.storage.sync.get(null); // Récupère tout le storage sync
            currentUpdates = data;
            renderList(data);
        } catch (e) {
            console.error("Erreur lors du chargement des données", e);
        } finally {
            setLoading(false);
        }
    }

    function renderList(data, searchQuery = '') {
        animesList.innerHTML = '';
        scansList.innerHTML = '';
        
        let items = Object.values(data).filter(item => item && item.title);
        
        if (searchQuery) {
            items = items.filter(item => item.title.toLowerCase().includes(searchQuery));
        }
        
        // Trier par statut nouveau en premier, puis par titre
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
            // Trouver la clé de l'item dans les données brutes
            const key = Object.keys(data).find(k => data[k] === item);
            
            const li = document.createElement('li');
            
            const a = document.createElement('a');
            a.href = item.url;
            a.className = 'update-item';
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            
            const infoDiv = document.createElement('div');
            infoDiv.className = 'update-info';
            
            // Image de couverture
            if (item.image) {
                const img = document.createElement('img');
                img.src = item.image;
                img.className = 'item-cover';
                img.loading = 'lazy';
                // En cas d'erreur de chargement (image introuvable ou erreur 403), on cache l'image
                img.onerror = () => { img.style.display = 'none'; };
                a.appendChild(img);
            }
            
            
            // Fonction pour décoder proprement les entités HTML, même si c'est double-encodé
            function decodeTitle(text) {
                if (!text) return "";
                const doc = new DOMParser().parseFromString(text, "text/html");
                let decoded = doc.documentElement.textContent;
                // Double décodage au cas où on a &amp;rsquo; au lieu de &rsquo;
                if (decoded.includes('&')) {
                    const doc2 = new DOMParser().parseFromString(decoded, "text/html");
                    decoded = doc2.documentElement.textContent;
                }
                return decoded;
            }
            
            const titleSpan = document.createElement('span');
            titleSpan.className = 'update-title';
            titleSpan.textContent = decodeTitle(item.title);
            
            const metaDiv = document.createElement('div');
            metaDiv.className = 'update-meta';
            
            const stateSpan = document.createElement('span');
            // Afficher l'évolution si userProgress est différent de latestState, même si ce n'est plus "nouveau"
            if (item.userProgress && item.userProgress !== item.latestState) {
                const progStr = item.userProgress || '';
                const latStr = item.latestState || '';
                
                // On nettoie les éventuels tags cachés |#122| pour l'affichage
                const cleanProg = progStr.replace(/\s*\|#\d+(?:\.\d+)?\|\s*/g, '');
                const cleanLat = latStr.replace(/\s*\|#\d+(?:\.\d+)?\|\s*/g, '');
                
                stateSpan.innerHTML = `<span style="color: #888;">${cleanProg} ➔</span> <b>${cleanLat}</b>`;
            } else {
                const latStr = item.latestState || item.lastState || "État inconnu";
                const cleanLat = latStr.replace(/\s*\|#\d+(?:\.\d+)?\|\s*/g, '');
                stateSpan.textContent = cleanLat;
            }
            
            metaDiv.appendChild(stateSpan);
            
            if (item.isNew) {
                const newBadge = document.createElement('span');
                newBadge.className = 'badge-new';
                newBadge.textContent = 'Nouveau';
                metaDiv.appendChild(newBadge);
            }
            
            infoDiv.appendChild(titleSpan);
            infoDiv.appendChild(metaDiv);
            a.appendChild(infoDiv);
            
            // Actions (Boutons)
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'update-actions';
            let hasActions = false;
            
            if (item.isNew) {
                hasActions = true;
                const markBtn = document.createElement('button');
                markBtn.className = 'btn-mark-read';
                markBtn.title = 'Ignorer la notification';
                markBtn.setAttribute('aria-label', 'Ignorer la notification');
                markBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
                
                markBtn.addEventListener('click', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    const newData = { ...currentUpdates };
                    newData[key].isNew = false;
                    // On met à jour la progression manuellement pour casser la boucle
                    newData[key].previousProgress = newData[key].userProgress; 
                    newData[key].userProgress = newData[key].latestState;
                    
                    await chrome.storage.sync.set(newData);
                    
                    const remainingNew = Object.values(newData).filter(i => i && i.isNew).length;
                    chrome.action.setBadgeText({ text: remainingNew > 0 ? remainingNew.toString() : '' });
                    
                    renderList(newData, searchInput.value.toLowerCase());
                });
                
                actionsDiv.appendChild(markBtn);
            } else if (item.previousProgress && item.userProgress !== item.previousProgress) {
                hasActions = true;
                const undoBtn = document.createElement('button');
                undoBtn.className = 'btn-undo-read';
                undoBtn.title = 'Annuler et restaurer la progression';
                undoBtn.setAttribute('aria-label', 'Annuler');
                undoBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"></path><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"></path></svg>`;
                
                undoBtn.addEventListener('click', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    const newData = { ...currentUpdates };
                    newData[key].userProgress = newData[key].previousProgress; // Restaure
                    newData[key].isNew = true; // Remet en nouveau
                    
                    await chrome.storage.sync.set(newData);
                    
                    const remainingNew = Object.values(newData).filter(i => i && i.isNew).length;
                    chrome.action.setBadgeText({ text: remainingNew > 0 ? remainingNew.toString() : '' });
                    
                    renderList(newData, searchInput.value.toLowerCase());
                });
                
                actionsDiv.appendChild(undoBtn);
            }
            
            if (hasActions) {
                a.appendChild(actionsDiv);
            }
            
            li.appendChild(a);
            
            // Le clic ne marque plus comme lu automatiquement, on s'en remet au script de contenu (scroll/video)
            a.addEventListener('click', () => {
                // On peut optionnellement fermer la popup
            });

            if (item.category === 'ANIMES') {
                animesList.appendChild(li);
                animeCount++;
            } else if (item.category === 'SCANS') {
                scansList.appendChild(li);
                scanCount++;
            } else {
                // Par défaut on met dans l'un des deux si inconnu (ici Animes par ex)
                animesList.appendChild(li);
                animeCount++;
            }
        });
        
        // Afficher/Cacher les textes "vide" de colonnes
        animesEmpty.classList.toggle('hidden', animeCount > 0);
        scansEmpty.classList.toggle('hidden', scanCount > 0);
    }

    function setLoading(isLoading) {
        if (isLoading) {
            loadingEl.classList.remove('hidden');
            columnsContainer.classList.add('hidden');
            emptyEl.classList.add('hidden');
        } else {
            loadingEl.classList.add('hidden');
        }
    }

    async function updateBadgeCount(data) {
        const newCount = Object.values(data).filter(i => i && i.isNew).length;
        if (newCount > 0) {
            chrome.action.setBadgeText({ text: newCount.toString() });
        } else {
            chrome.action.setBadgeText({ text: '' });
        }
    }
});
