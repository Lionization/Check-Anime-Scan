// -- DÉTECTION DU SITE --
const url = window.location.href;
const isWebtoons = url.includes('webtoons.com');
const isMangago = url.includes('mangago.me');
const isAnimeSama = url.includes('anime-sama'); 
const isBackgroundScrape = new URL(url).searchParams.get('background_scrape') === 'true';

if (isBackgroundScrape && isAnimeSama) {
    let epNum = null;
    let coverImage = null;

    // Extraire l'image de couverture
    const imgMeta = document.querySelector('meta[property="og:image"]');
    if (imgMeta) {
        coverImage = imgMeta.content;
    }

    const select = document.getElementById("selectEpisodes") || document.getElementById("selectChapitres");
    if (select) {
        let maxEp = -1;
        let type = "Épisode";
        for (let i = 0; i < select.options.length; i++) {
            const opt = select.options[i];
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
    
    // Renvoyer au offscreen
    chrome.runtime.sendMessage({
        action: 'offscreenScrapedData',
        originalUrl: url,
        data: { text: epNum, image: coverImage }
    });
} else {
    // ==========================================
    // MODE NORMAL : Suivi de lecture utilisateur
    // ==========================================
    let markedAsRead = false;

// 1. Gestion du Scroll (Mangago, Webtoons, & Anime-Sama)
if (isWebtoons || isMangago || isAnimeSama) {
    window.addEventListener('scroll', () => {
        if (markedAsRead) return;
        
        const scrollPosition = window.scrollY + window.innerHeight;
        const documentHeight = Math.max(
            document.body.scrollHeight, document.documentElement.scrollHeight,
            document.body.offsetHeight, document.documentElement.offsetHeight,
            document.documentElement.clientHeight
        );
        
        // Validation à 90%
        if (scrollPosition >= documentHeight * 0.9) {
            
            let chapterText = "Lu";
            let isValidPage = false;
            
            if (isMangago) {
                // Le vrai chapitre lu est affiché dans le bouton dropdown #dropdown-chapter-page
                const dropdown = document.getElementById('dropdown-chapter-page');
                if (dropdown) {
                    const match = dropdown.textContent.match(/(\d+(?:\.\d+)?)/);
                    if (match) chapterText = `Chapitre ${match[1]}`;
                    isValidPage = true;
                } else {
                    // Fallback sur l'URL
                    const match = url.match(/chapter-?(\d+(?:\.\d+)?)/i);
                    if (match) {
                        chapterText = `Chapitre ${match[1]}`;
                        isValidPage = true;
                    }
                }
            } else if (isWebtoons) {
                if (url.includes('/viewer')) {
                    isValidPage = true;
                }
                
                let num = "";
                // Extraire le numéro réel depuis l'URL
                const numMatch = url.match(/episode_no=(\d+)/i) || url.match(/episode-?(\d+)/i);
                if (numMatch) num = numMatch[1];
                
                // Extraire le titre stylisé (S2 Ep.47) depuis le DOM
                let title = "";
                // On utilise uniquement .subj_episode car .subj récupère le nom du manga (ex: "Killer Reborn")
                const subj = document.querySelector('.subj_episode, h1.subj_episode');
                if (subj && subj.textContent.trim() !== '') {
                    title = subj.textContent.trim();
                } else if (num) {
                    title = `Épisode ${num}`;
                } else {
                    title = "Lu";
                }
                
                if (num) {
                    chapterText = `${title} |#${num}|`;
                } else {
                    chapterText = title;
                }
            } else if (isAnimeSama) {
                // Pour Anime-Sama, on lit le select
                const select = document.getElementById("selectEpisodes") || document.getElementById("selectChapitres");
                // Sécurité : On s'assure qu'on est bien sur la page de lecture et non sur l'index (qui contient aussi le select)
                const isViewer = url.includes('/scan/') || url.includes('/saison-') || url.includes('/ep-') || url.includes('/chapitre-');
                
                if (select && isViewer) {
                    isValidPage = true;
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
            
            // On ne valide que si on est sur une vraie page de chapitre et qu'on a pu extraire quelque chose
            if (isValidPage && chapterText !== "Lu" && chapterText !== "") {
                markedAsRead = true; // On bloque les futurs envois sur cette page
                chrome.runtime.sendMessage({
                    action: 'markAsRead',
                    url: url, // On envoie l'URL courante
                    progressText: chapterText
                });
            }
        }
    });
}

// Écouteur pour récupérer l'épisode Anime-Sama depuis la page parente
if (typeof chrome !== 'undefined' && chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "getAnimeSamaEpisode") {
            let epNum = null;
            // On essaie de lire le selecteur d'épisodes
            const select = document.getElementById("selectEpisodes") || document.getElementById("selectChapitres");
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

// 2. Gestion de la Vidéo (Anime-Sama ou iframe tiers)
const videoInterval = setInterval(() => {
    if (markedAsRead) {
        clearInterval(videoInterval);
        return;
    }

    const video = document.querySelector('video');
    if (video) {
        
        video.addEventListener('timeupdate', () => {
            if (markedAsRead || !video.duration) return;
            
            const progress = video.currentTime / video.duration;
            if (progress >= 0.75) {
                markedAsRead = true;
                clearInterval(videoInterval);
                
                // On envoie le message. Le background va utiliser sender.tab.url pour trouver le favori.
                chrome.runtime.sendMessage({
                    action: 'markAsReadVideo'
                });
            }
        });
        clearInterval(videoInterval); // Vidéo trouvée, on arrête la boucle de recherche
    }
}, 2000);

} // Fin du bloc else (!isBackgroundScrape)
