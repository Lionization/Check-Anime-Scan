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

    // =========================================================================
    // 2. MODE NORMAL : Suivi de lecture utilisateur
    // =========================================================================
    let markedAsRead = false;

    if (isWebtoons || isMangago || isAnimeSama) {
        initScrollTracker();
        initAnimeSamaMessageListener();
        initVideoTracker();
    }

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
            document.body.scrollHeight, document.documentElement.scrollHeight,
            document.body.offsetHeight, document.documentElement.offsetHeight,
            document.documentElement.clientHeight
        );

        // Validation lorsque l'utilisateur a parcouru au moins 90% de la page
        if (scrollPosition >= documentHeight * 0.9) {
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
            const isViewer = currentUrl.includes('/scan/') || currentUrl.includes('/saison-') || currentUrl.includes('/ep-') || currentUrl.includes('/chapitre-');

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
        return document.getElementById("selectEpisodes") || document.getElementById("selectChapitres");
    }

    /**
     * Écouteur pour transmettre l'épisode Anime-Sama actif au Service Worker
     */
    function initAnimeSamaMessageListener() {
        if (!chrome?.runtime?.onMessage) return;

        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.action === "getAnimeSamaEpisode") {
                let epNum = null;
                const select = getAnimeSamaSelectElement();
                if (select) {
                    const selectedOpt = select.options[select.selectedIndex];
                    if (selectedOpt) {
                        const match = selectedOpt.text.match(/(\d+(?:\.\d+)?)/);
                        if (match) {
                            const isChap = /chapitre/i.test(selectedOpt.text);
                            epNum = `${isChap ? 'Chapitre' : 'Épisode'} ${match[1]}`;
                        }
                    }
                }
                sendResponse({ episodeText: epNum });
            }
        });
    }

    /**
     * Initialise le suivi de lecture pour les lecteurs vidéo HTML5
     */
    function initVideoTracker() {
        let attempts = 0;
        const maxAttempts = 15; // 30 secondes max

        const videoInterval = setInterval(() => {
            if (markedAsRead || ++attempts > maxAttempts) {
                clearInterval(videoInterval);
                return;
            }

            const video = document.querySelector('video');
            if (video) {
                clearInterval(videoInterval);

                video.addEventListener('timeupdate', () => {
                    if (markedAsRead || !video.duration) return;

                    // Marquage à 75% du visionnage
                    if ((video.currentTime / video.duration) >= 0.75) {
                        markedAsRead = true;
                        chrome.runtime.sendMessage({ action: 'markAsReadVideo' });
                    }
                }, { passive: true });
            }
        }, 2000);
    }
})();
