/**
 * @fileoverview Script de contenu injecté (Manifest V3) pour Check Anime & Scans.
 * Détecte la lecture (scroll 90% sur les scans / lecture 75% sur les lecteurs vidéo) et communique avec le background.
 */

(() => {
    const currentUrl = window.location.href;
    const isWebtoons = currentUrl.includes('webtoons.com');
    const isMangago = currentUrl.includes('mangago.me');
    const isAnimeSama = currentUrl.includes('anime-sama');
    const isBackgroundScrape = new URL(currentUrl).searchParams.get('background_scrape') === 'true';

    // =========================================================================
    // 1. MODE BACKGROUND SCRAPE (Anime-Sama via Document Offscreen)
    // =========================================================================
    if (isBackgroundScrape && isAnimeSama) {
        handleBackgroundScrape();
        return;
    }

    // 2. MODE NORMAL : Suivi de lecture utilisateur
    let markedAsRead = false;

    if (isWebtoons || isMangago || isAnimeSama) {
        initScrollTracker();
        initAnimeSamaMessageListener();
    }

    // Le tracker vidéo doit s'exécuter dans tous les contextes (notamment les iframes de lecteurs tiers)
    initVideoTracker();

    /**
     * Traite le scraping d'Anime-Sama lorsqu'il est chargé dans une iframe offscreen
     */
    function handleBackgroundScrape() {
        let epNum = null;
        let coverImage = null;

        // Image de couverture
        const imgMeta = document.querySelector('meta[property="og:image"]');
        if (imgMeta?.content) {
            coverImage = imgMeta.content;
        }

        const select = getAnimeSamaSelectElement();
        if (select) {
            let maxEp = -1;
            let type = "Épisode";

            for (const opt of select.options) {
                const match = opt.text.match(/(\d+(?:\.\d+)?)/);
                if (match) {
                    const num = parseFloat(match[1]);
                    if (num > maxEp) {
                        maxEp = num;
                        if (/chapitre/i.test(opt.text)) type = "Chapitre";
                    }
                }
            }
            if (maxEp > -1) epNum = `${type} ${maxEp}`;
        }

        // Renvoyer les données au document offscreen
        chrome.runtime.sendMessage({
            action: 'offscreenScrapedData',
            originalUrl: currentUrl,
            data: { text: epNum, image: coverImage }
        });
    }

    /**
     * Initialise le tracker de défilement (90% de la hauteur de page)
     */
    function initScrollTracker() {
        let isTicking = false;

        window.addEventListener('scroll', () => {
            if (markedAsRead || isTicking) return;

            window.requestAnimationFrame(() => {
                checkScrollProgress();
                isTicking = false;
            });
            isTicking = true;
        }, { passive: true });
    }

    /**
     * Calcule la progression du scroll et envoie la notification de lecture
     */
    function checkScrollProgress() {
        if (markedAsRead) return;

        const scrollPosition = window.scrollY + window.innerHeight;
        const documentHeight = Math.max(
            document.body ? document.body.scrollHeight : 0,
            document.documentElement ? document.documentElement.scrollHeight : 0,
            document.body ? document.body.offsetHeight : 0,
            document.documentElement ? document.documentElement.offsetHeight : 0,
            document.documentElement ? document.documentElement.clientHeight : 0
        );

        // Validation lorsque l'utilisateur a parcouru au moins 90% de la page
        if (documentHeight > 0 && scrollPosition >= documentHeight * 0.9) {
            const result = extractCurrentChapterOrEpisode();

            if (result.isValid && result.chapterText && result.chapterText !== 'Lu') {
                markedAsRead = true;
                chrome.runtime.sendMessage({
                    action: 'markAsRead',
                    url: currentUrl,
                    progressText: result.chapterText
                });
            }
        }
    }

    /**
     * Extrait le chapitre ou épisode en cours de lecture selon le site actif
     * @returns {{ isValid: boolean, chapterText: string }}
     */
    function extractCurrentChapterOrEpisode() {
        let chapterText = 'Lu';
        let isValid = false;

        if (isMangago) {
            const dropdown = document.getElementById('dropdown-chapter-page');
            if (dropdown) {
                const match = dropdown.textContent.match(/(\d+(?:\.\d+)?)/);
                if (match) chapterText = `Chapitre ${match[1]}`;
                isValid = true;
            } else {
                const match = currentUrl.match(/chapter-?(\d+(?:\.\d+)?)/i);
                if (match) {
                    chapterText = `Chapitre ${match[1]}`;
                    isValid = true;
                }
            }
        } else if (isWebtoons) {
            if (currentUrl.includes('/viewer')) {
                isValid = true;
            }

            let num = '';
            const numMatch = currentUrl.match(/episode_no=(\d+)/i) || currentUrl.match(/episode-?(\d+)/i);
            if (numMatch) num = numMatch[1];

            let title = '';
            const subj = document.querySelector('.subj_episode, h1.subj_episode');
            if (subj && subj.textContent.trim()) {
                title = subj.textContent.trim();
            } else if (num) {
                title = `Épisode ${num}`;
            } else {
                title = 'Lu';
            }

            chapterText = num ? `${title} |#${num}|` : title;
        } else if (isAnimeSama) {
            const select = getAnimeSamaSelectElement();
            const isViewer = currentUrl.includes('/scan/') || currentUrl.includes('/saison') || currentUrl.includes('/ep-') || currentUrl.includes('/chapitre-');

            if (select && isViewer) {
                isValid = true;
                const selectedOpt = select.options[select.selectedIndex];
                if (selectedOpt) {
                    const match = selectedOpt.text.match(/(\d+(?:\.\d+)?)/);
                    if (match) {
                        const isChap = /chapitre/i.test(selectedOpt.text);
                        chapterText = `${isChap ? 'Chapitre' : 'Épisode'} ${match[1]}`;
                    }
                }
            }
        }

        return { isValid, chapterText };
    }

    /**
     * Retourne le sélecteur d'épisodes/chapitres d'Anime-Sama
     * @returns {HTMLSelectElement|null}
     */
    function getAnimeSamaSelectElement() {
        return document.getElementById("selectEpisodes") || 
               document.getElementById("selectChapitres") || 
               document.querySelector('select[id*="episode" i]') || 
               document.querySelector('select[id*="chapitre" i]');
    }

    /**
     * Extrait l'identifiant de l'épisode ou chapitre courant sur Anime-Sama
     * @returns {string|null}
     */
    function extractAnimeSamaEpisodeText() {
        const select = getAnimeSamaSelectElement();
        if (select && select.selectedIndex >= 0) {
            const selectedOpt = select.options[select.selectedIndex];
            if (selectedOpt) {
                const match = selectedOpt.text.match(/(\d+(?:\.\d+)?)/);
                if (match) {
                    const isChap = /chapitre/i.test(selectedOpt.text);
                    return `${isChap ? 'Chapitre' : 'Épisode'} ${match[1]}`;
                }
            }
        }

        // Recherche dans l'URL si aucun select actif n'est présent
        const urlMatch = currentUrl.match(/(?:ep|episode|chapitre|ch)[-_]?(\d+(?:\.\d+)?)/i);
        if (urlMatch) {
            const isChap = /chapitre|ch/i.test(urlMatch[0]);
            return `${isChap ? 'Chapitre' : 'Épisode'} ${urlMatch[1]}`;
        }

        if (/film|movie/i.test(currentUrl) || /film/i.test(document.title)) {
            return "Film";
        }

        return null;
    }

    /**
     * Écouteur pour transmettre l'épisode Anime-Sama actif au Service Worker
     */
    function initAnimeSamaMessageListener() {
        if (!chrome?.runtime?.onMessage) return;

        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.action === "getAnimeSamaEpisode") {
                const epNum = extractAnimeSamaEpisodeText();
                sendResponse({ episodeText: epNum });
            }
        });
    }

    /**
     * Initialise le suivi de lecture pour les lecteurs vidéo HTML5 (dans le frame principal et les iframes)
     */
    function initVideoTracker() {
        /** @type {WeakSet<HTMLVideoElement>} */
        const trackedVideos = new WeakSet();
        let lastMarkedVideoSrc = '';

        function attachToVideo(video) {
            if (!video || trackedVideos.has(video)) return;
            trackedVideos.add(video);

            const checkAndNotify = () => {
                const videoSrc = video.currentSrc || video.src || currentUrl;
                if (lastMarkedVideoSrc && lastMarkedVideoSrc === videoSrc) return;

                const duration = video.duration;
                const isFinished = video.ended || (duration > 0 && (video.currentTime / duration) >= 0.75);

                if (isFinished) {
                    lastMarkedVideoSrc = videoSrc;
                    chrome.runtime.sendMessage({ action: 'markAsReadVideo' });
                }
            };

            video.addEventListener('timeupdate', checkAndNotify, { passive: true });
            video.addEventListener('ended', checkAndNotify, { passive: true });
        }

        // Observer les vidéos déjà présentes
        document.querySelectorAll('video').forEach(attachToVideo);

        // Observer les vidéos insérées dynamiquement dans le DOM
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== Node.ELEMENT_NODE) continue;
                    if (node.tagName === 'VIDEO') {
                        attachToVideo(node);
                    } else if (node.querySelectorAll) {
                        node.querySelectorAll('video').forEach(attachToVideo);
                    }
                }
            }
        });

        if (document.body) {
            observer.observe(document.body, { childList: true, subtree: true });
        } else {
            document.addEventListener('DOMContentLoaded', () => {
                document.querySelectorAll('video').forEach(attachToVideo);
                if (document.body) {
                    observer.observe(document.body, { childList: true, subtree: true });
                }
            });
        }

        // Vérification de secours périodique pendant les premières secondes
        let checkCount = 0;
        const backupInterval = setInterval(() => {
            document.querySelectorAll('video').forEach(attachToVideo);
            if (++checkCount >= 10) clearInterval(backupInterval);
        }, 2000);
    }
})();
