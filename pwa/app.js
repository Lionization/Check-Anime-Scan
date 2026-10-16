/**
 * @fileoverview Contrôleur principal pour la PWA mobile Check Anime & Scans.
 * Communication directe avec l'API GitHub Gist, pull-to-refresh et édition directe.
 */

const STORAGE_KEYS = {
    GIST_ID: 'check_scans_gist_id',
    GIST_TOKEN: 'check_scans_gist_token',
    CACHED_DATA: 'check_scans_cached_data',
    LAST_SYNC_TIME: 'check_scans_last_sync',
    LAST_CLOUD_CHECK: 'check_scans_last_cloud_check',
    PENDING_SYNC: 'check_scans_pending_sync',
    ZEN_STATION: 'check_scans_zen_station',
    ZEN_VOLUME: 'check_scans_zen_volume',
    SORT_ORDER: 'check_scans_sort_order',
    TYPE_FILTER: 'check_scans_type_filter'
};

const ZEN_STATIONS = {
    koto: {
        id: 'koto',
        name: 'Koto & Shakuhachi (Temple Zen)',
        desc: 'Ishikari Lore — Cordes traditionnelles & bambou',
        url: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Ishikari%20Lore.mp3',
        loop: true
    },
    eastern: {
        id: 'eastern',
        name: 'Méditation Japonaise (Zen)',
        desc: 'Eastern Thought — Flûte Shakuhachi méditative',
        url: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Eastern%20Thought.mp3',
        loop: true
    },
    anime_ost: {
        id: 'anime_ost',
        name: 'Stereo Anime (OST & Soundtracks)',
        desc: 'Bandes originales d’animes & jeux vidéo',
        url: 'https://radio.stereoanime.com/listen/stereoanime/128',
        loop: false
    },
    zen_ambient: {
        id: 'zen_ambient',
        name: 'Ambiance Zen & Nappes douces',
        desc: 'Sons contemplatifs sans percussions',
        url: 'https://streaming.hotmixradio.com/hotmix-zen-en-mp3?provider=radiobrowser',
        loop: false
    },
    plaza: {
        id: 'plaza',
        name: 'Nightwave Plaza (Tokyo City Pop)',
        desc: 'Tokyo nostalgie & City Pop 80s',
        url: 'https://radio.plaza.one/mp3',
        loop: false
    }
};

const GITHUB_API_URL = 'https://api.github.com/gists';
const GIST_FILENAME = 'suivi.json';
const VAPID_PUBLIC_KEY = 'BFdc6qHW_0VONqmpkv2Qy6lbV5Tp4U3xdG2gOPCNKaqPfmPbsLK8upQXLnus7cFx1pGJV7HXddnw4y_wtgvVHMg';
const CURRENT_VERSION = (typeof self !== 'undefined' && self.APP_VERSION) || (typeof window !== 'undefined' && window.APP_VERSION);

// État de l'application
let allItems = {};
let activeFilter = 'all';
let activeTypeFilter = localStorage.getItem(STORAGE_KEYS.TYPE_FILTER) || 'all';
let searchQuery = '';
let currentSort = localStorage.getItem(STORAGE_KEYS.SORT_ORDER) || 'date';
let isSyncing = false;
let currentPushSubscription = null;

// Écouteur Service Worker (sans rechargement en boucle infinie)
// Le rafraîchissement est laissé au contrôle naturel de la PWA

// Enregistrement et mise à jour du Service Worker
function registerAppServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((reg) => {
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
    // Affichage dynamique de la version
    const versionBadge = document.getElementById('app-version-badge');
    if (versionBadge) {
        versionBadge.textContent = `v${CURRENT_VERSION}`;
    }

    const refreshBtn = document.getElementById('refresh-btn');
    const openSettingsBtn = document.getElementById('open-settings-btn');
    const setupBtn = document.getElementById('setup-btn');
    const searchInput = document.getElementById('search-input');
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

    // Bascule compacte du statut (Tous / À lire)
    const statusBtn = document.getElementById('status-toggle-btn');
    if (statusBtn) {
        updateStatusUI();
        statusBtn.addEventListener('click', (e) => {
            e.preventDefault();
            activeFilter = activeFilter === 'all' ? 'unread' : 'all';
            updateStatusUI();
            renderItems();
        });
    }

    // Recherche
    searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value.toLowerCase().trim();
        renderItems();
    });

    // Bascule du mode de tri (Par date / Alphabétique)
    const sortBtn = document.getElementById('sort-toggle-btn');
    const sortLabel = document.getElementById('sort-label');
    if (sortBtn) {
        if (sortLabel) {
            sortLabel.textContent = currentSort === 'date' ? 'Date' : 'A-Z';
        }
        sortBtn.addEventListener('click', () => {
            currentSort = currentSort === 'date' ? 'alpha' : 'date';
            localStorage.setItem(STORAGE_KEYS.SORT_ORDER, currentSort);
            if (sortLabel) {
                sortLabel.textContent = currentSort === 'date' ? 'Date' : 'A-Z';
            }
            renderItems();
        });
    }

    // Gestion du Segmented Switcher de format (Tout / Scans / Animes)
    const formatBtns = document.querySelectorAll('.format-btn');
    const updateFormatUI = () => {
        formatBtns.forEach((btn) => {
            const btnType = btn.getAttribute('data-type');
            const isActive = btnType === activeTypeFilter;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-checked', String(isActive));
        });
    };
    if (formatBtns.length > 0) {
        updateFormatUI();
        formatBtns.forEach((btn) => {
            btn.addEventListener('click', () => {
                activeTypeFilter = btn.getAttribute('data-type') || 'all';
                localStorage.setItem(STORAGE_KEYS.TYPE_FILTER, activeTypeFilter);
                updateFormatUI();
                renderItems();
            });
        });
    }

    // Actualisation
    refreshBtn.addEventListener('click', () => {
        loadDataFromGist(true);
    });

    const populateSettingsFields = () => {
        gistIdField.value = localStorage.getItem(STORAGE_KEYS.GIST_ID) || '';
        gistTokenField.value = localStorage.getItem(STORAGE_KEYS.GIST_TOKEN) || '';
        refreshPushStatusUI();
    };

    // Gestion du dialogue de réglages
    openSettingsBtn.addEventListener('click', () => {
        populateSettingsFields();
        settingsDialog.showModal();
    });

    if (setupBtn) {
        setupBtn.addEventListener('click', () => {
            populateSettingsFields();
            settingsDialog.showModal();
        });
    }

    closeDialogBtn.addEventListener('click', () => {
        settingsDialog.close();
    });

    settingsForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const rawGistId = gistIdField.value.trim();
        const cleanGistId = extractGistId(rawGistId);
        const gistToken = gistTokenField.value.trim();

        if (cleanGistId) {
            localStorage.setItem(STORAGE_KEYS.GIST_ID, cleanGistId);
            gistIdField.value = cleanGistId;
            if (gistToken) {
                localStorage.setItem(STORAGE_KEYS.GIST_TOKEN, gistToken);
            }
            settingsDialog.close();
            showToast('Paramètres enregistrés !');
            loadDataFromGist(true);
        } else {
            showToast('Identifiant Gist manquant ou invalide', true);
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

    // Gestion du mode hors-ligne et retour de la connectivité réseau
    window.addEventListener('online', () => {
        processPendingSyncQueue();
    });

    window.addEventListener('offline', () => {
        setSyncStatus('error', 'Hors-ligne');
    });

    // Initialisation du geste Pull-to-Refresh
    initPullToRefresh();

    // Initialisation du lecteur d'ambiance Zen & Lofi
    initZenAudioPlayer();
});

/**
 * Initialise le lecteur d'ambiance sonore Zen & Lofi
 * Supporte le streaming continu via CDN externe, navigator.mediaSession et persistance locale
 */
function initZenAudioPlayer() {
    const toggleBtn = document.getElementById('zen-audio-toggle-btn');
    const panel = document.getElementById('zen-player-panel');
    const playBtn = document.getElementById('zen-play-btn');
    const stationSelect = document.getElementById('zen-station-select');
    const volumeRange = document.getElementById('zen-volume-range');
    const closeBtn = document.getElementById('zen-close-panel-btn');
    const audioElement = document.getElementById('zen-audio-element');
    const audioBadge = document.getElementById('zen-audio-badge');
    const visualizer = document.getElementById('zen-visualizer');
    const stationNameEl = document.getElementById('zen-station-name');
    const statusLabel = document.getElementById('zen-playback-status');

    if (!toggleBtn || !panel || !playBtn || !audioElement) return;

    const playIcon = playBtn.querySelector('.play-icon');
    const pauseIcon = playBtn.querySelector('.pause-icon');

    // Récupération des préférences persistées
    const savedStationId = localStorage.getItem(STORAGE_KEYS.ZEN_STATION) || 'koto';
    const savedVolume = parseFloat(localStorage.getItem(STORAGE_KEYS.ZEN_VOLUME) || '0.7');

    let currentStation = ZEN_STATIONS[savedStationId] || ZEN_STATIONS.koto;
    if (stationSelect) {
        stationSelect.value = currentStation.id;
    }
    if (volumeRange) {
        volumeRange.value = savedVolume;
    }
    audioElement.volume = isNaN(savedVolume) ? 0.7 : Math.max(0, Math.min(1, savedVolume));

    const switchStation = (direction) => {
        const stationKeys = Object.keys(ZEN_STATIONS);
        const currentIndex = stationKeys.indexOf(currentStation.id);
        const newIndex = (currentIndex + direction + stationKeys.length) % stationKeys.length;
        const nextStationId = stationKeys[newIndex];

        currentStation = ZEN_STATIONS[nextStationId];
        localStorage.setItem(STORAGE_KEYS.ZEN_STATION, nextStationId);

        if (stationSelect) {
            stationSelect.value = nextStationId;
        }
        if (stationNameEl) {
            stationNameEl.textContent = currentStation.name;
        }

        startAudio();
    };

    const updateMediaSession = () => {
        if (!('mediaSession' in navigator)) return;
        try {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: currentStation.name,
                artist: 'Check Anime & Scans — Ambiance Zen',
                album: currentStation.desc,
                artwork: [
                    { src: 'icons/favicon128.png', sizes: '128x128', type: 'image/png' },
                    { src: 'icons/favicon500.png', sizes: '500x500', type: 'image/png' }
                ]
            });
            navigator.mediaSession.setActionHandler('play', () => startAudio());
            navigator.mediaSession.setActionHandler('pause', () => pauseAudio());
            navigator.mediaSession.setActionHandler('stop', () => pauseAudio());
            navigator.mediaSession.setActionHandler('previoustrack', () => switchStation(-1));
            navigator.mediaSession.setActionHandler('nexttrack', () => switchStation(1));
        } catch (e) {
            console.warn('MediaSession non supporté:', e);
        }
    };

    const setUIPlaying = (isPlaying) => {
        if (playIcon) playIcon.classList.toggle('hidden', isPlaying);
        if (pauseIcon) pauseIcon.classList.toggle('hidden', !isPlaying);
        if (visualizer) visualizer.classList.toggle('playing', isPlaying);
        if (audioBadge) audioBadge.classList.toggle('playing', isPlaying);
        playBtn.setAttribute('title', isPlaying ? 'Mettre en pause' : 'Lecture');
        playBtn.setAttribute('aria-label', isPlaying ? 'Mettre en pause la musique' : 'Démarrer la musique');
        if (statusLabel) {
            statusLabel.textContent = isPlaying ? (currentStation.loop ? 'Lecture (Boucle)' : 'En direct') : 'En pause';
        }
    };

    const startAudio = () => {
        if (stationNameEl) stationNameEl.textContent = currentStation.name;
        if (statusLabel) statusLabel.textContent = 'Connexion...';

        audioElement.loop = Boolean(currentStation.loop);

        if (audioElement.src !== currentStation.url) {
            audioElement.src = currentStation.url;
            audioElement.load();
        }

        const playPromise = audioElement.play();
        if (playPromise !== undefined) {
            playPromise.then(() => {
                setUIPlaying(true);
                updateMediaSession();
            }).catch((err) => {
                console.warn('Lecture audio bloquée ou interrompue:', err);
                setUIPlaying(false);
                if (statusLabel) statusLabel.textContent = 'Flux indisponible';
            });
        }
    };

    const pauseAudio = () => {
        audioElement.pause();
        // Libération du tampon réseau pour les flux radio continus
        audioElement.removeAttribute('src');
        audioElement.load();
        setUIPlaying(false);
    };

    // Gestion du bouton Lecture / Pause
    playBtn.addEventListener('click', () => {
        if (audioElement.paused || !audioElement.src) {
            startAudio();
        } else {
            pauseAudio();
        }
    });

    // Changement de station radio
    if (stationSelect) {
        stationSelect.addEventListener('change', (e) => {
            const nextStationId = e.target.value;
            if (ZEN_STATIONS[nextStationId]) {
                const wasPlaying = !audioElement.paused && Boolean(audioElement.src);
                currentStation = ZEN_STATIONS[nextStationId];
                localStorage.setItem(STORAGE_KEYS.ZEN_STATION, nextStationId);
                if (stationNameEl) stationNameEl.textContent = currentStation.name;

                if (wasPlaying) {
                    startAudio();
                } else {
                    if (statusLabel) statusLabel.textContent = 'Prêt';
                }
            }
        });
    }

    // Réglage du volume
    if (volumeRange) {
        volumeRange.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            audioElement.volume = val;
            localStorage.setItem(STORAGE_KEYS.ZEN_VOLUME, String(val));
        });
    }

    // Bascule et fermeture du panneau rétractable
    const togglePanel = (forceOpen) => {
        const isHidden = panel.classList.contains('hidden');
        const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : isHidden;
        panel.classList.toggle('hidden', !shouldOpen);
        toggleBtn.setAttribute('aria-expanded', String(shouldOpen));
        toggleBtn.classList.toggle('active', shouldOpen);
    };

    toggleBtn.addEventListener('click', () => {
        togglePanel();
    });

    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            togglePanel(false);
        });
    }

    // Événements du lecteur audio HTML5
    audioElement.addEventListener('playing', () => {
        setUIPlaying(true);
    });

    audioElement.addEventListener('waiting', () => {
        if (statusLabel) statusLabel.textContent = 'Chargement...';
    });

    // Prise en charge Document Picture-in-Picture (Tablettes & Ordinateurs Chromium)
    const pipBtn = document.getElementById('zen-pip-btn');
    if (pipBtn) {
        pipBtn.addEventListener('click', async () => {
            if (!('documentPictureInPicture' in window)) {
                showToast('Picture-in-Picture non disponible sur ce navigateur (supporté sur Chrome Desktop & tablettes compatibles)', true);
                return;
            }

            try {
                if (window.documentPictureInPicture.window) {
                    window.documentPictureInPicture.window.close();
                    return;
                }

                const pipWin = await window.documentPictureInPicture.requestWindow({
                    width: 340,
                    height: 140
                });

                // Copie des styles CSS de l'application
                [...document.styleSheets].forEach((sheet) => {
                    try {
                        if (sheet.href) {
                            const link = document.createElement('link');
                            link.rel = 'stylesheet';
                            link.href = sheet.href;
                            pipWin.document.head.appendChild(link);
                        } else if (sheet.cssRules) {
                            const style = document.createElement('style');
                            [...sheet.cssRules].forEach(rule => style.appendChild(document.createTextNode(rule.cssText)));
                            pipWin.document.head.appendChild(style);
                        }
                    } catch (e) {
                        console.warn('PiP CSS copy:', e);
                    }
                });

                const playerContent = panel.querySelector('.zen-player-content');
                if (playerContent) {
                    pipWin.document.body.style.margin = '0';
                    pipWin.document.body.style.background = '#0b1120';
                    pipWin.document.body.style.display = 'flex';
                    pipWin.document.body.style.alignItems = 'center';
                    pipWin.document.body.style.justifyContent = 'center';
                    pipWin.document.body.appendChild(playerContent);

                    pipWin.addEventListener('pagehide', () => {
                        panel.insertBefore(playerContent, audioElement);
                    });
                }
            } catch (err) {
                console.warn('Erreur Document PiP:', err);
                showToast('Impossible d\'ouvrir la fenêtre PiP', true);
            }
        });
    }

    if (stationNameEl) stationNameEl.textContent = currentStation.name;
}

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
 * Met à jour les libellés indiquant l'heure du dernier passage cloud
 * @param {number|null} timestamp 
 */
function updateCloudCheckUI(timestamp) {
    const label = document.getElementById('cloud-check-label');
    const modalLabel = document.getElementById('cloud-check-modal-label');
    if (!timestamp) return;

    const elapsedMs = Date.now() - timestamp;
    const elapsedMinutes = Math.floor(elapsedMs / 60000);
    const elapsedHours = Math.floor(elapsedMinutes / 60);

    let text = '';
    if (elapsedMinutes < 1) {
        text = 'Cloud : à l’instant';
    } else if (elapsedMinutes < 60) {
        text = `Cloud : il y a ${elapsedMinutes}m`;
    } else if (elapsedHours < 24) {
        const remMin = elapsedMinutes % 60;
        text = `Cloud : il y a ${elapsedHours}h${remMin > 0 ? remMin + 'm' : ''}`;
    } else {
        text = `Cloud : ${new Date(timestamp).toLocaleDateString()}`;
    }

    if (label) label.textContent = `• ${text}`;
    if (modalLabel) modalLabel.textContent = `Robot Cloud : dernier passage ${text.replace('Cloud : ', '')} (analyse auto toutes les 3h)`;
}

/**
 * Extrait un identifiant Gist propre (32 caractères hexadécimaux ou slug) même si une URL complète a été fournie
 * @param {string|null|undefined} raw 
 * @returns {string}
 */
function extractGistId(raw) {
    if (!raw) return '';
    const cleaned = String(raw).trim();
    const match = cleaned.match(/([a-f0-9]{20,40})/i);
    return match ? match[1] : cleaned;
}

/**
 * Charge les données initiales : affichage immédiat depuis le cache puis rafraîchissement réseau
 */
async function loadInitialData() {
    const cached = localStorage.getItem(STORAGE_KEYS.CACHED_DATA);
    const lastSync = parseInt(localStorage.getItem(STORAGE_KEYS.LAST_SYNC_TIME) || '0', 10);
    const cachedCloudCheck = parseInt(localStorage.getItem(STORAGE_KEYS.LAST_CLOUD_CHECK) || '0', 10);

    if (cachedCloudCheck > 0) {
        updateCloudCheckUI(cachedCloudCheck);
    }

    if (cached) {
        try {
            allItems = JSON.parse(cached);
            setViewState('ready');
            renderItems();
            setSyncStatus('synced', formatRelativeSyncTime(lastSync));
        } catch {
            // Ignorer
        }
    } else {
        setViewState('ready');
    }

    const rawGistId = localStorage.getItem(STORAGE_KEYS.GIST_ID);
    const gistId = extractGistId(rawGistId);

    if (!gistId) {
        if (!cached) setViewState('unconfigured');
        return;
    }

    await loadDataFromGist(false);

    // Vérification d'une synchronisation hors-ligne en attente
    if (localStorage.getItem(STORAGE_KEYS.PENDING_SYNC) === '1' && navigator.onLine) {
        processPendingSyncQueue();
    }
}

/**
 * Exécute une requête fetch avec un délai d'attente maximum strict
 * @param {string} url 
 * @param {RequestInit} [options] 
 * @param {number} [timeoutMs] 
 * @returns {Promise<Response>}
 */
function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { ...options, signal: controller.signal })
        .finally(() => clearTimeout(timer));
}

/**
 * Récupère les données depuis l'API GitHub Gist avec repli automatique sans authentification
 * @param {boolean} showLoading 
 */
async function loadDataFromGist(showLoading = false) {
    const rawGistId = localStorage.getItem(STORAGE_KEYS.GIST_ID);
    const gistId = extractGistId(rawGistId);
    const gistToken = (localStorage.getItem(STORAGE_KEYS.GIST_TOKEN) || '').trim();

    if (!gistId) {
        setViewState('unconfigured');
        return;
    }

    if (showLoading) setViewState('loading');
    setSyncStatus('syncing', 'Synchronisation...');
    isSyncing = true;

    let fetchError = null;
    let data = null;
    let usedAuth = false;

    try {
        // 1. Première tentative avec le token si renseigné
        if (gistToken) {
            try {
                const response = await fetchWithTimeout(`${GITHUB_API_URL}/${gistId}`, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${gistToken}`,
                        'Accept': 'application/vnd.github+json',
                        'X-GitHub-Api-Version': '2022-11-28'
                    }
                }, 8000);

                if (response.ok) {
                    data = await response.json();
                    usedAuth = true;
                } else {
                    fetchError = new Error(`HTTP ${response.status}`);
                }
            } catch (err) {
                fetchError = err;
            }
        }

        // 2. Repli gracieux : lecture publique sans Authorization (supporté nativement par les Gists secrets)
        if (!data) {
            try {
                const anonResponse = await fetchWithTimeout(`${GITHUB_API_URL}/${gistId}`, {
                    method: 'GET',
                    headers: {
                        'Accept': 'application/vnd.github+json',
                        'X-GitHub-Api-Version': '2022-11-28'
                    }
                }, 8000);

                if (anonResponse.ok) {
                    data = await anonResponse.json();
                } else if (!fetchError) {
                    fetchError = new Error(`HTTP ${anonResponse.status}`);
                }
            } catch (anonErr) {
                if (!fetchError) fetchError = anonErr;
            }
        }

        // Traitement des données si l'une des requêtes a abouti
        if (data) {
            let fileObj = data?.files?.[GIST_FILENAME];
            if (!fileObj && data?.files) {
                const jsonKey = Object.keys(data.files).find(k => k.endsWith('.json') || k.toLowerCase().includes('suivi'));
                if (jsonKey) fileObj = data.files[jsonKey];
            }

            if (fileObj) {
                let jsonString = '';

                // Priorité absolue au téléchargement brut direct (raw_url) pour garantir 100% des données sans troncage REST API
                if (fileObj.raw_url) {
                    try {
                        const rawUrlWithBust = `${fileObj.raw_url}${fileObj.raw_url.includes('?') ? '&' : '?'}_t=${Date.now()}`;
                        const rawResp = await fetchWithTimeout(rawUrlWithBust, { cache: 'no-store' }, 10000);
                        if (rawResp.ok) {
                            jsonString = await rawResp.text();
                        }
                    } catch (rawErr) {
                        console.warn('Échec téléchargement direct raw_url:', rawErr);
                    }
                }

                // Repli sur le champ content direct si raw_url indisponible ou non tronqué
                if (!jsonString && fileObj.content && !fileObj.truncated) {
                    jsonString = fileObj.content;
                }

                let parsed = null;
                if (jsonString) {
                    try {
                        parsed = JSON.parse(jsonString);
                    } catch {
                        console.warn('Échec parsing JSON principal...');
                    }
                }

                if (parsed) {
                    allItems = parsed.items || parsed.mangas || parsed || {};
                    localStorage.setItem(STORAGE_KEYS.CACHED_DATA, JSON.stringify(allItems));
                    localStorage.setItem(STORAGE_KEYS.LAST_SYNC_TIME, Date.now().toString());

                    if (parsed.lastCloudCheckAt) {
                        localStorage.setItem(STORAGE_KEYS.LAST_CLOUD_CHECK, parsed.lastCloudCheckAt.toString());
                        updateCloudCheckUI(parsed.lastCloudCheckAt);
                    }

                    if (gistToken && !usedAuth && fetchError && fetchError.message.includes('401')) {
                        setSyncStatus('synced', 'Lecture seule (Token expiré)');
                        showToast('Données chargées en direct. Attention : Token GitHub expiré.', true);
                    } else if (!gistToken) {
                        setSyncStatus('synced', 'Lecture seule');
                    } else {
                        setSyncStatus('synced', 'À l’instant');
                    }
                } else {
                    console.error('Impossible de charger le JSON complet distant');
                    setSyncStatus('error', 'Erreur lecture Gist');
                    showToast('Impossible de lire le JSON distant du Gist', true);
                }
            } else {
                console.warn('Fichier suivi.json absent du Gist');
                setSyncStatus('error', 'Fichier suivi.json absent');
                showToast('Le Gist ne contient pas de fichier suivi.json.', true);
            }
            return;
        }

        // Échec total des deux requêtes (réseau coupé ou Gist introuvable)
        console.error('Erreur Gist fetch finale:', fetchError);
        let errorLabel = 'Erreur réseau';
        const msg = (fetchError && fetchError.message) ? fetchError.message : '';

        if (msg.includes('abort') || msg.includes('timeout')) {
            errorLabel = 'Délai dépassé (Timeout)';
            showToast('Délai d\'attente GitHub dépassé. Vérifiez votre connexion.', true);
        } else if (msg.includes('401')) {
            errorLabel = 'Token expiré (401)';
            showToast('Votre Token GitHub PAT a expiré ou est invalide. Vérifiez vos réglages.', true);
        } else if (msg.includes('403')) {
            errorLabel = 'Quota atteint (403)';
            showToast('Limite de requêtes GitHub atteinte temporairement.', true);
        } else if (msg.includes('404')) {
            errorLabel = 'Gist introuvable (404)';
            showToast('L’identifiant du Gist secret est introuvable.', true);
        } else if (!navigator.onLine) {
            errorLabel = 'Hors-ligne';
            showToast('Aucune connexion Internet détectée.', false);
        } else {
            errorLabel = `Erreur (${msg || 'réseau'})`;
            showToast(`Erreur réseau (${msg || 'connexion interrompue'})`, true);
        }

        setSyncStatus('error', errorLabel);
    } finally {
        isSyncing = false;
        setViewState(Object.keys(allItems).length > 0 || gistId ? 'ready' : 'unconfigured');
        renderItems();
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
 * Échappe les caractères HTML dangereux pour neutraliser tout risque XSS
 * @param {string|null|undefined} str 
 * @returns {string}
 */
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Valide et sécurise une URL pour les attributs href et src
 * @param {string|null|undefined} url 
 * @returns {string}
 */
function sanitizeUrl(url) {
    if (!url) return '#';
    const trimmed = String(url).trim();
    if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
        return escapeHtml(trimmed);
    }
    return '#';
}

/**
 * Nettoie une chaîne de statut pour l'affichage (supprime les tags techniques |#122|)
 * @param {string|null|undefined} stateStr 
 * @returns {string}
 */
function cleanStateDisplay(stateStr) {
    if (!stateStr || typeof stateStr !== 'string') return '';
    return stateStr.replace(/\s*\|#\d+(?:\.\d+)?\|\s*/g, '').trim();
}

/**
 * Formate un horodatage (timestamp) en date ou temps relatif en français
 * @param {number|undefined|null} timestamp Millisecondes Unix
 * @returns {string}
 */
function formatRelativeTime(timestamp) {
    if (!timestamp || typeof timestamp !== 'number') return '';
    const now = Date.now();
    const diffSeconds = Math.max(0, Math.floor((now - timestamp) / 1000));
    if (diffSeconds < 60) return "À l'instant";
    const diffMinutes = Math.floor(diffSeconds / 60);
    if (diffMinutes < 60) return `Il y a ${diffMinutes} min`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `Il y a ${diffHours}h`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return 'Hier';
    if (diffDays < 7) return `Il y a ${diffDays}j`;
    const date = new Date(timestamp);
    return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

/**
 * Détermine de façon robuste la catégorie d'un élément (SCANS ou ANIMES)
 * @param {any} item 
 * @returns {'SCANS'|'ANIMES'}
 */
function getItemCategory(item) {
    if (!item) return 'SCANS';
    const cat = (item.category || '').toUpperCase().trim();
    if (cat.includes('ANIME')) return 'ANIMES';
    if (cat.includes('SCAN') || cat.includes('MANGA')) return 'SCANS';

    // Heuristiques d'analyse de l'URL ou du texte d'état
    const url = (item.url || '').toLowerCase();
    if (url.includes('/scan') || url.includes('/chapitre') || url.includes('mangago') || url.includes('webtoon')) return 'SCANS';

    const state = `${item.userProgress || ''} ${item.latestState || ''}`.toLowerCase();
    if (state.includes('épisode') || state.includes('episode')) return 'ANIMES';
    if (state.includes('chapitre') || state.includes('ch.') || state.includes('tome')) return 'SCANS';

    return 'SCANS';
}

/**
 * Détermine si un manga/anime a des sorties non lues en attente
 * @param {any} item 
 * @returns {boolean}
 */
function isItemUnread(item) {
    if (!item || typeof item !== 'object') return false;
    if (!item.userProgress && Boolean(item.latestState)) return true;
    if (!item.latestState) return false;

    const cleanUser = cleanStateDisplay(item.userProgress || '');
    const cleanLatest = cleanStateDisplay(item.latestState || '');

    // Si les deux états nettoyés sont strictement identiques -> lu
    if (cleanUser && cleanLatest && cleanUser === cleanLatest) {
        return false;
    }

    const numUser = extractEpisodeNumber(item.userProgress);
    const numLatest = extractEpisodeNumber(item.latestState);

    // Comparaison numérique si des numéros ont été extraits
    const hasNumUser = typeof item.userProgress === 'string' && /\d/.test(item.userProgress);
    const hasNumLatest = typeof item.latestState === 'string' && /\d/.test(item.latestState);

    if (hasNumUser && hasNumLatest) {
        if (numLatest > numUser) return true;
        if (numUser >= numLatest) return false;
    }

    // Si le flag isNew est explicitement positionné
    if (item.isNew === true) return true;

    // Si un numéro récent existe mais que l'utilisateur n'en a aucun
    if (hasNumLatest && !hasNumUser) return true;

    // Repli textuel pour les formats sans numéro (ex: One-shot, Dates, etc.)
    if (cleanUser && cleanLatest && cleanUser !== cleanLatest) {
        return true;
    }

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

    updateStatusUI();
}

/**
 * Met à jour le libellé et l'icône du bouton switcher de statut (Tous / À lire)
 */
function updateStatusUI() {
    const statusBtn = document.getElementById('status-toggle-btn');
    const statusLabel = document.getElementById('status-label');
    const statusIconAll = document.getElementById('status-icon-all');
    const statusIconUnread = document.getElementById('status-icon-unread');

    if (!statusLabel) return;
    const isUnread = activeFilter === 'unread';
    let unreadCount = 0;
    for (const it of Object.values(allItems)) {
        if (isItemUnread(it)) unreadCount++;
    }

    if (isUnread) {
        statusLabel.textContent = unreadCount > 0 ? `À lire (${unreadCount})` : 'À lire';
        if (statusIconAll) statusIconAll.classList.add('hidden');
        if (statusIconUnread) statusIconUnread.classList.remove('hidden');
        statusBtn?.classList.add('active');
    } else {
        statusLabel.textContent = 'Tous';
        if (statusIconAll) statusIconAll.classList.remove('hidden');
        if (statusIconUnread) statusIconUnread.classList.add('hidden');
        statusBtn?.classList.remove('active');
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

        const category = getItemCategory(item);
        const hasUnread = isItemUnread(item);

        if (activeFilter === 'unread' && !hasUnread) return false;

        if (activeTypeFilter === 'scans' && category !== 'SCANS') return false;
        if (activeTypeFilter === 'animes' && category !== 'ANIMES') return false;

        return true;
    });

    if (filtered.length === 0) {
        emptyEl.classList.remove('hidden');
        const totalItemsCount = Object.keys(allItems).length;
        if (activeFilter === 'unread' && totalItemsCount > 0) {
            emptyEl.innerHTML = `
                <div class="empty-icon">✓</div>
                <h3>Toutes vos séries sont à jour</h3>
                <p>Aucun nouveau chapitre ou épisode à lire pour le moment.</p>
                <button type="button" class="btn btn-primary btn-empty-action" id="btn-show-all-empty">Voir tout le catalogue (${totalItemsCount})</button>
            `;
            const showAllBtn = document.getElementById('btn-show-all-empty');
            if (showAllBtn) {
                showAllBtn.addEventListener('click', () => {
                    activeFilter = 'all';
                    updateStatusUI();
                    renderItems();
                });
            }
        } else {
            emptyEl.innerHTML = `
                <p>Aucun manga ne correspond à ce filtre.</p>
            `;
        }
        return;
    }

    emptyEl.classList.add('hidden');

    // Tri selon le mode actif :
    if (currentSort === 'date') {
        // Mode Date : nouveautés prioritaires (si lecture en attente), puis horodatage le plus récent (timestamp ou updatedAt), puis alphabétique
        filtered.sort((a, b) => {
            const hasUnreadA = isItemUnread(a[1]);
            const hasUnreadB = isItemUnread(b[1]);

            if (hasUnreadB !== hasUnreadA) {
                return hasUnreadB ? 1 : -1;
            }

            const timeA = a[1].timestamp || a[1].updatedAt || 0;
            const timeB = b[1].timestamp || b[1].updatedAt || 0;
            if (timeB !== timeA) return timeB - timeA;

            return (a[1].title || '').localeCompare(b[1].title || '');
        });
    } else {
        // Mode Alphabétique par titre
        filtered.sort((a, b) => (a[1].title || '').localeCompare(b[1].title || ''));
    }

    filtered.forEach(([urlKey, item]) => {
        const hasUpdate = isItemUnread(item);

        const cleanUser = cleanStateDisplay(item.userProgress);
        const cleanLatest = cleanStateDisplay(item.latestState);

        const safeTitle = escapeHtml(item.title || 'Sans titre');
        const safeUserProgress = escapeHtml(cleanUser || 'Non commencé');
        const safeLatestState = escapeHtml(cleanLatest || 'Inconnu');
        const safeUrl = sanitizeUrl(item.url || urlKey);

        const itemTime = item.timestamp || item.updatedAt;
        const relativeTimeStr = itemTime ? formatRelativeTime(itemTime) : '';

        const wrapper = document.createElement('div');
        wrapper.className = 'manga-card-wrapper';

        if (hasUpdate) {
            const actionBg = document.createElement('div');
            actionBg.className = 'swipe-action-bg';
            actionBg.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                <span>Glisser pour valider lu (${safeLatestState})</span>
            `;
            wrapper.appendChild(actionBg);
        }

        const card = document.createElement('article');
        card.className = `manga-card ${hasUpdate ? 'has-update' : ''}`;

        // Jaquette sécurisée
        const coverEl = item.image 
            ? `<img src="${sanitizeUrl(item.image)}" alt="${safeTitle}" class="manga-cover" loading="lazy">`
            : `<div class="manga-cover-placeholder">📖</div>`;

        const itemCat = getItemCategory(item);
        const isAnime = itemCat === 'ANIMES';
        const categoryTag = isAnime ? 'ANIMES' : 'SCANS';
        const categoryClass = isAnime ? 'tag-animes' : 'tag-scans';
        const categoryIcon = isAnime
            ? `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect width="20" height="15" x="2" y="7" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/><polygon points="10 11 15 14.5 10 18 10 11" fill="currentColor"/></svg>`
            : `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/></svg>`;

        // Calcul du lien d'ouverture : ciblage direct de l'activité principale Chrome (Main) avec nouvelle tâche
        const isAndroid = /Android/i.test(navigator.userAgent);
        let openHref = safeUrl;
        if (isAndroid && safeUrl.startsWith('http')) {
            const scheme = safeUrl.startsWith('https://') ? 'https' : 'http';
            const strippedUrl = safeUrl.replace(/^https?:\/\//i, '');
            openHref = `intent://${strippedUrl}#Intent;scheme=${scheme};action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;component=com.android.chrome/com.google.android.apps.chrome.Main;launchFlags=0x10000000;end`;
        }

        card.innerHTML = `
            ${coverEl}
            <div class="manga-details">
                <div>
                    <div class="manga-header">
                        <h2 class="manga-title">${safeTitle}</h2>
                        <span class="tag-badge ${categoryClass}">${categoryIcon}<span>${categoryTag}</span></span>
                    </div>

                    <div class="progress-info">
                        <div class="progress-row">
                            <span class="progress-label">Dernier lu :</span>
                            <div class="progress-val-wrapper">
                                <span class="progress-val">${safeUserProgress}</span>
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
                            <div class="progress-val-wrapper">
                                <span class="progress-val highlight">${safeLatestState}</span>
                                ${relativeTimeStr ? `<span class="progress-date" title="Horodatage de la sortie">(${relativeTimeStr})</span>` : ''}
                            </div>
                        </div>
                    </div>
                </div>

                <div class="manga-actions">
                    ${hasUpdate ? `
                        <button type="button" class="action-btn btn-read-next" data-action="catchup" data-key="${encodeURIComponent(urlKey)}">
                            Valider lu (${safeLatestState})
                        </button>
                    ` : ''}
                    <button type="button" class="action-btn btn-plus-one" data-action="plusone" data-key="${encodeURIComponent(urlKey)}" title="Incrémenter d'un chapitre">
                        +1
                    </button>
                    <a href="${openHref}" target="_blank" rel="noopener noreferrer" class="action-btn btn-open-link" title="Ouvrir dans Chrome">
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

        // Geste tactile Swipe vers la droite pour valider lu
        if (hasUpdate) {
            let startX = 0;
            let startY = 0;
            let currentX = 0;
            let isSwiping = false;
            let isHorizontal = false;
            const actionBg = wrapper.querySelector('.swipe-action-bg');

            card.addEventListener('touchstart', (e) => {
                if (e.touches.length !== 1) return;
                startX = e.touches[0].clientX;
                startY = e.touches[0].clientY;
                currentX = 0;
                isSwiping = true;
                isHorizontal = false;
                card.classList.add('swiping');
            }, { passive: true });

            card.addEventListener('touchmove', (e) => {
                if (!isSwiping || e.touches.length !== 1) return;
                const diffX = e.touches[0].clientX - startX;
                const diffY = e.touches[0].clientY - startY;

                if (!isHorizontal) {
                    if (Math.abs(diffX) > 10 || Math.abs(diffY) > 10) {
                        if (Math.abs(diffX) > Math.abs(diffY) && diffX > 0) {
                            isHorizontal = true;
                        } else {
                            isSwiping = false;
                            card.classList.remove('swiping');
                            card.style.transform = '';
                            if (actionBg) actionBg.classList.remove('visible');
                            return;
                        }
                    } else {
                        return;
                    }
                }

                if (diffX > 0) {
                    currentX = diffX;
                    const visualX = Math.min(diffX, 120) + (diffX > 120 ? Math.pow(diffX - 120, 0.7) : 0);
                    card.style.transform = `translateX(${visualX}px)`;
                    if (actionBg) actionBg.classList.toggle('visible', diffX > 35);
                }
            }, { passive: true });

            const endSwipe = () => {
                if (!isSwiping && !isHorizontal) return;
                isSwiping = false;
                card.classList.remove('swiping');

                if (isHorizontal && currentX > 85) {
                    card.classList.add('swiped-out');
                    setTimeout(() => {
                        markAsRead(urlKey, item.latestState);
                    }, 200);
                } else {
                    card.style.transform = '';
                    if (actionBg) actionBg.classList.remove('visible');
                }
                isHorizontal = false;
                currentX = 0;
            };

            card.addEventListener('touchend', endSwipe);
            card.addEventListener('touchcancel', endSwipe);
        }

        wrapper.appendChild(card);
        gridEl.appendChild(wrapper);
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
    allItems[urlKey].isNew = false;
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
 * Pousse l'ensemble des données vers le Gist GitHub avec file d'attente hors-ligne
 */
async function saveItemsToGist() {
    const rawGistId = localStorage.getItem(STORAGE_KEYS.GIST_ID);
    const gistId = extractGistId(rawGistId);
    const gistToken = (localStorage.getItem(STORAGE_KEYS.GIST_TOKEN) || '').trim();

    if (!gistId || !gistToken) {
        if (!gistToken) {
            showToast('Token GitHub requis pour sauvegarder vos modifications', true);
        }
        return;
    }

    // Si le terminal est actuellement hors-ligne, mise en file d'attente locale
    if (!navigator.onLine) {
        localStorage.setItem(STORAGE_KEYS.PENDING_SYNC, '1');
        setSyncStatus('syncing', 'En attente réseau');
        showToast('Enregistré hors-ligne. Synchro automatique dès reconnexion.');
        return;
    }

    setSyncStatus('syncing', 'Sauvegarde...');

    try {
        const payload = {
            version: 1,
            updatedAt: Date.now(),
            _pushSubscription: currentPushSubscription ? (typeof currentPushSubscription.toJSON === 'function' ? currentPushSubscription.toJSON() : currentPushSubscription) : undefined,
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
            localStorage.setItem(STORAGE_KEYS.PENDING_SYNC, '1');
            setSyncStatus('error', 'Erreur sauvegarde');
            showToast('Erreur de synchronisation réseau (mise en attente)', true);
        } else {
            localStorage.removeItem(STORAGE_KEYS.PENDING_SYNC);
            localStorage.setItem(STORAGE_KEYS.LAST_SYNC_TIME, Date.now().toString());
            setSyncStatus('synced', 'À l’instant');
            showToast('Synchronisé avec GitHub Gist');
        }
    } catch (err) {
        console.error('Erreur lors de la sauvegarde Gist:', err);
        localStorage.setItem(STORAGE_KEYS.PENDING_SYNC, '1');
        setSyncStatus('error', 'En attente réseau');
        showToast('Enregistré hors-ligne. Synchro dès reconnexion.');
    }
}

/**
 * Traite et pousse automatiquement les modifications locales enregistrées hors-ligne
 */
async function processPendingSyncQueue() {
    if (!navigator.onLine) return;
    const isPending = localStorage.getItem(STORAGE_KEYS.PENDING_SYNC) === '1';
    if (!isPending) {
        loadDataFromGist(false);
        return;
    }

    console.log('Traitement de la file d’attente hors-ligne...');
    showToast('Reconnexion : synchronisation de vos lectures...');
    await saveItemsToGist();
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
    const rawGistId = localStorage.getItem(STORAGE_KEYS.GIST_ID) || document.getElementById('gist-id-field')?.value.trim();
    const gistId = extractGistId(rawGistId);
    const rawToken = localStorage.getItem(STORAGE_KEYS.GIST_TOKEN) || document.getElementById('gist-token-field')?.value.trim();
    const gistToken = (rawToken || '').trim();

    if (!gistId || !gistToken) {
        throw new Error('Identifiants Gist absents. Veuillez enregistrer votre ID Gist et Token dans les réglages.');
    }

    let itemsToSave = allItems;
    if (!itemsToSave || Object.keys(itemsToSave).length === 0) {
        try {
            const rawCache = localStorage.getItem(STORAGE_KEYS.CACHED_DATA);
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
