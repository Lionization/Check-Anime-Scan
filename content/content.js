/**
 * @fileoverview Script de contenu injecté (Manifest V3) pour Check Anime & Scans.
 * Détecte la lecture (scroll 90% sur les scans / lecture 75% sur les lecteurs vidéo) et communique avec le background.
 */

(() => {
    const currentUrl = window.location.href;
    const isWebtoons = currentUrl.includes('webtoons.com');
    const isMangago = currentUrl.includes('mangago.me');
    const isAnimeSama = currentUrl.includes('anime-sama');
    const isTopFrame = window.self === window.top;

    // 0. FILTRAGE STRICT DU CONTEXTE D'EXÉCUTION (Évite de tourner sur le reste du web)
    if (isTopFrame) {
        if (!isAnimeSama && !isWebtoons && !isMangago) {
            return; // Fenêtre principale hors du périmètre : arrêt immédiat
        }
    } else {
        // En sous-frame (iframe) : restreint exclusivement aux lecteurs embarqués par Anime-Sama
        const hasAnimeSamaReferrer = typeof document.referrer === 'string' && document.referrer.includes('anime-sama');
        const hasAnimeSamaAncestor = window.location.ancestorOrigins && Array.from(window.location.ancestorOrigins).some(origin => origin.includes('anime-sama'));
        
        if (!hasAnimeSamaReferrer && !hasAnimeSamaAncestor && !isAnimeSama) {
            return; // Iframe tierce non liée à Anime-Sama : arrêt immédiat
        }
    }

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

    if (isTopFrame && (isWebtoons || isMangago || isAnimeSama)) {
        initScrollTracker();
        initAnimeSamaMessageListener();
    }

    // Le tracker vidéo ne s'exécute que dans le contexte Anime-Sama (page hôte ou iframes associées)
    if (isAnimeSama || !isTopFrame) {
        initVideoTracker();
    }

    /**
     * Traite le scraping d'Anime-Sama lorsqu'il est chargé dans une iframe offscreen
     */
    function handleBackgroundScrape() {
        const executeExtraction = () => {
            let epNum = null;
            let coverImage = null;

            // Image de couverture
            const imgMeta = document.querySelector('meta[property="og:image"]');
            const imgOeuvre = document.getElementById('imgOeuvre');
            if (imgMeta?.content) {
                coverImage = imgMeta.content;
            } else if (imgOeuvre?.src) {
                coverImage = imgOeuvre.src;
            }

            // 1. Recherche via le sélecteur d'épisodes s'il est présent et alimenté
            const select = getAnimeSamaSelectElement();
            if (select && select.options && select.options.length > 0) {
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

            // 1.2. Recherche via la grille d'épisodes du nouveau template (#ctGrille / .ct-ep)
            const ctButtons = document.querySelectorAll('button.ct-ep, .ct-ep');
            if (ctButtons && ctButtons.length > 0) {
                let maxCtEp = -1;
                for (const btn of ctButtons) {
                    const titleText = btn.getAttribute('title') || btn.textContent || '';
                    const match = titleText.match(/(\d+(?:\.\d+)?)/);
                    if (match) {
                        const num = parseFloat(match[1]);
                        if (num > maxCtEp) maxCtEp = num;
                    }
                }
                if (maxCtEp > -1) {
                    const curNum = epNum ? (parseFloat(epNum.match(/\d+(?:\.\d+)?/)?.[0] || '-1')) : -1;
                    if (maxCtEp > curNum) {
                        epNum = `Épisode ${maxCtEp}`;
                    }
                }
            }

            // 1.5. Recherche via variables eps déclarées dans les scripts de la page (tous les lecteurs : eps1, eps2, eps3...)
            const scripts = Array.from(document.querySelectorAll('script:not([src])'));
            let maxScriptCount = -1;
            for (const s of scripts) {
                const text = s.textContent || '';
                const epsRegex = /(?:var|let|const)?\s*(eps\w*)\s*=\s*\[([\s\S]*?)\];?/gi;
                let m;
                while ((m = epsRegex.exec(text)) !== null) {
                    const rawContent = m[2];
                    const count = rawContent.split(',').map(str => str.trim()).filter(str => str.length > 4 && (str.startsWith('"') || str.startsWith("'") || str.startsWith('`'))).length;
                    if (count > maxScriptCount) {
                        maxScriptCount = count;
                    }
                }
            }
            if (maxScriptCount > 0) {
                const curNum = epNum ? (parseFloat(epNum.match(/\d+(?:\.\d+)?/)?.[0] || '-1')) : -1;
                if (maxScriptCount > curNum) {
                    epNum = `Épisode ${maxScriptCount}`;
                }
            }

            // 2. Recherche via les liens d'épisodes dans le document (ex: pages catalogue)
            if (!epNum) {
                const epLinks = document.querySelectorAll('a[href*="episode"], a[href*="ep-"], a[href*="saison"]');
                let maxLinkEp = -1;
                for (const link of epLinks) {
                    const match = (link.textContent + ' ' + link.href).match(/(?:[éeE]pisode|ep)[-_ ]*(\d+(?:\.\d+)?)/i);
                    if (match) {
                        const num = parseFloat(match[1]);
                        if (num > maxLinkEp) maxLinkEp = num;
                    }
                }
                if (maxLinkEp > -1) epNum = `Épisode ${maxLinkEp}`;
            }

            // 3. Heuristique textuelle globale dans le corps de la page en excluant les reprises en cours
            if (!epNum && document.body) {
                const clone = document.body.cloneNode(true);
                clone.querySelectorAll('#ctEpisodeActuel, .as-dd-texte, #savedEpisodeId, .ct-ep-actuel').forEach(el => el.remove());
                const bodyText = clone.innerText || '';
                const regex = /(?:[éeE]pisode|chapitre)[\s-]*(\d+(?:\.\d+)?)/gi;
                let match;
                let maxTextEp = -1;
                let textType = "Épisode";
                while ((match = regex.exec(bodyText)) !== null) {
                    const num = parseFloat(match[1]);
                    if (num > maxTextEp && num < 2000) { // Plafond réaliste pour éviter les années
                        maxTextEp = num;
                        if (/chapitre/i.test(match[0])) textType = "Chapitre";
                    }
                }
                if (maxTextEp > -1) epNum = `${textType} ${maxTextEp}`;
            }

            // Renvoyer les données au document offscreen (null si rien n'est trouvé, zéro résidu de fallback)
            safeSendMessage({
                action: 'offscreenScrapedData',
                originalUrl: currentUrl,
                data: epNum ? { text: epNum, image: coverImage } : null
            });
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => setTimeout(executeExtraction, 500));
        } else {
            setTimeout(executeExtraction, 500);
        }
    }

    /**
     * Envoie un message au Service Worker de façon sécurisée (évite Extension context invalidated)
     */
    function safeSendMessage(payload, callback) {
        if (!chrome?.runtime?.id) return;
        try {
            chrome.runtime.sendMessage(payload, (response) => {
                if (chrome.runtime.lastError) {
                    // Erreur consommée silencieusement si contexte invalidé
                    return;
                }
                if (callback) callback(response);
            });
        } catch (e) {
            // Contexte invalidé lors d'un rechargement de l'extension
        }
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
        if (!chrome?.runtime?.id || markedAsRead) return;

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
                safeSendMessage({
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
            const isViewer = currentUrl.includes('/scan/') || currentUrl.includes('/saison') || currentUrl.includes('/ep-') || currentUrl.includes('/chapitre-');
            if (isViewer) {
                const epText = extractAnimeSamaEpisodeText();
                if (epText) {
                    isValid = true;
                    chapterText = epText;
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
        // 1. Indicateurs directs du template Anime-Sama (#ctEpisodeActuel, bouton .ct-ep-actuel, .as-dd-texte)
        const activeEl = document.getElementById('ctEpisodeActuel') || 
                         document.querySelector('.ct-ep-actuel') || 
                         document.querySelector('.as-dd-texte');
        if (activeEl) {
            const text = activeEl.getAttribute('title') || activeEl.textContent || '';
            const match = text.match(/(\d+(?:\.\d+)?)/);
            if (match) {
                const isChap = /chapitre/i.test(text);
                return `${isChap ? 'Chapitre' : 'Épisode'} ${match[1]}`;
            }
        }

        // 2. Sélecteur natif classique
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

        // 3. Recherche dans l'URL si aucun sélecteur actif n'est présent
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
                if (!chrome?.runtime?.id) return;

                const videoSrc = video.currentSrc || video.src || currentUrl;
                if (lastMarkedVideoSrc && lastMarkedVideoSrc === videoSrc) return;

                const duration = video.duration;
                const isFinished = video.ended || (duration > 0 && (video.currentTime / duration) >= 0.75);

                if (isFinished) {
                    lastMarkedVideoSrc = videoSrc;
                    safeSendMessage({ action: 'markAsReadVideo' });
                }
            };

            video.addEventListener('timeupdate', checkAndNotify, { passive: true });
            video.addEventListener('ended', checkAndNotify, { passive: true });
        }

        // Observer les vidéos déjà présentes
        document.querySelectorAll('video').forEach(attachToVideo);

        // Observer les vidéos insérées dynamiquement dans le DOM
        const observer = new MutationObserver((mutations) => {
            if (!chrome?.runtime?.id) {
                observer.disconnect();
                return;
            }
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
            if (!chrome?.runtime?.id) {
                clearInterval(backupInterval);
                return;
            }
            document.querySelectorAll('video').forEach(attachToVideo);
            if (++checkCount >= 10) clearInterval(backupInterval);
        }, 2000);
    }
})();
