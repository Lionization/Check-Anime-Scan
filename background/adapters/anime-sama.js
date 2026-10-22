/**
 * @fileoverview Adaptateur de scraping pour anime-sama.fr.
 */

/**
 * Parse le code HTML d'une page Anime-Sama pour extraire le dernier épisode/chapitre et l'image de couverture.
 * 
 * @param {string} htmlText Code HTML brut de la page
 * @returns {{ text: string, image: string|null }|string|null}
 */
export function parseAnimeSama(htmlText) {
    if (!htmlText || typeof htmlText !== 'string') return null;

    let coverImage = null;
    const imgRegex = /<meta\s+property="og:image"\s+content="([^"]+)"/i;
    const imgOeuvreRegex = /<img[^>]+(?:id=["']imgOeuvre["'][^>]*src=["']([^"']+)["']|src=["']([^"']+)["'][^>]*id=["']imgOeuvre["'])/i;
    const imgMatch = htmlText.match(imgRegex);
    const imgOeuvreMatch = htmlText.match(imgOeuvreRegex);
    if (imgMatch) {
        coverImage = imgMatch[1];
    } else if (imgOeuvreMatch) {
        coverImage = imgOeuvreMatch[1] || imgOeuvreMatch[2];
    }

    let detectedText = null;

    // Heuristique 1 : Chercher un sélecteur d'épisodes ou de chapitres
    const selectRegex = /<select[^>]*id="select[^>]*>([\s\S]*?)<\/select>/i;
    const selectMatch = htmlText.match(selectRegex);
    
    if (selectMatch) {
        const optionsHtml = selectMatch[1];
        const optionRegex = /<option[^>]*>.*?(?:[ÉEe]pisode|Chapitre)\s*(\d+(?:\.\d+)?).*?<\/option>/gi;
        let optMatch;
        let maxEp = -1;
        let type = "Épisode";
        
        while ((optMatch = optionRegex.exec(optionsHtml)) !== null) {
            const epNum = parseFloat(optMatch[1]);
            if (epNum > maxEp) {
                maxEp = epNum;
                if (/chapitre/i.test(optMatch[0])) type = "Chapitre";
            }
        }
        
        if (maxEp > -1) {
            detectedText = `${type} ${maxEp}`;
        }
    }

    // Heuristique 1.2 : Nouveau template Anime-Sama avec grille d'épisodes (#ctGrille / boutons .ct-ep)
    const isScanContext = /scan/i.test(htmlText) || /chapitre/i.test(htmlText);
    const ctEpRegex = /<button[^>]*class=["'][^"']*\bct-ep\b[^"']*["'][^>]*title=["'](?:([ÉEe]pisode|Chapitre))?\s*(\d+(?:\.\d+)?)["'][^>]*>/gi;
    let ctMatch;
    let maxCtEp = -1;
    let ctType = isScanContext ? "Chapitre" : "Épisode";
    while ((ctMatch = ctEpRegex.exec(htmlText)) !== null) {
        const matchedType = ctMatch[1];
        const epNum = parseFloat(ctMatch[2]);
        if (epNum > maxCtEp) {
            maxCtEp = epNum;
            if (matchedType) {
                ctType = /chapitre/i.test(matchedType) ? "Chapitre" : "Épisode";
            }
        }
    }
    if (maxCtEp === -1) {
        const ctEpTextRegex = /<button[^>]*class=["'][^"']*\bct-ep\b[^"']*["'][^>]*>\s*(\d+(?:\.\d+)?)\s*<\/button>/gi;
        while ((ctMatch = ctEpTextRegex.exec(htmlText)) !== null) {
            const epNum = parseFloat(ctMatch[1]);
            if (epNum > maxCtEp) {
                maxCtEp = epNum;
            }
        }
    }
    if (maxCtEp > -1) {
        const curEpNum = detectedText ? parseFloat(detectedText.match(/\d+(?:\.\d+)?/)?.[0] || '-1') : -1;
        if (maxCtEp > curEpNum) {
            detectedText = `${ctType} ${maxCtEp}`;
        }
    }
    
    // Heuristique 1.5 : Recherche de tableaux eps déclarés inline pour tous les lecteurs (eps1, eps2, eps3, eps4...)
    const inlineEpsCount = extractEpsMaxEpisode(htmlText);
    if (inlineEpsCount > -1) {
        const curEpNum = detectedText ? parseFloat(detectedText.match(/\d+(?:\.\d+)?/)?.[0] || '-1') : -1;
        if (inlineEpsCount > curEpNum) {
            const inlineType = isScanContext ? "Chapitre" : "Épisode";
            detectedText = `${inlineType} ${inlineEpsCount}`;
        }
    }
    
    // Heuristique 2 : Recherche globale "Épisode X" ou "Chapitre X" en excluant les reprises/épisodes en cours
    if (!detectedText) {
        const cleanForSearch = htmlText
            .replace(/<span[^>]*id=["']ctEpisodeActuel["'][^>]*>[\s\S]*?<\/span>/gi, '')
            .replace(/<span[^>]*class=["'][^"']*as-dd-texte[^"']*["'][^>]*>[\s\S]*?<\/span>/gi, '')
            .replace(/<i[^>]*id=["']savedEpisodeId["'][^>]*>[\s\S]*?<\/i>/gi, '')
            .replace(/<button[^>]*class=["'][^"']*ct-ep-actuel[^"']*["'][^>]*>[\s\S]*?<\/button>/gi, '');

        const regex = /(?:[éeE]pisodes?|chapitres?)[\s-]*(\d+(?:\.\d+)?)/gi;
        let match;
        let maxEpGlobal = -1;
        let globalType = "Épisode";
        
        while ((match = regex.exec(cleanForSearch)) !== null) {
            const epNum = parseFloat(match[1]);
            if (epNum > maxEpGlobal) {
                maxEpGlobal = epNum;
                if (/chapitre/i.test(match[0])) globalType = "Chapitre";
            }
        }
        
        if (maxEpGlobal > -1) {
            detectedText = `${globalType} ${maxEpGlobal}`;
        }
    }
    
    // Heuristique 3 : Lien d'épisode dans le document
    if (!detectedText) {
        const linkRegex = /href="[^"]*(?:[éeE]pisode|episode)-(\d+)[^"]*"/i;
        const linkMatch = htmlText.match(linkRegex);
        if (linkMatch) {
            detectedText = `Épisode ${linkMatch[1]}`;
        }
    }

    if (detectedText) {
        return coverImage ? { text: detectedText, image: coverImage } : detectedText;
    }

    return null;
}

/**
 * Extrait le nombre maximal d'épisodes parmi les tableaux de lecteurs (eps1, eps2, eps3...) déclarés dans un code JS ou HTML.
 * @param {string} code Contenu HTML ou JS brut
 * @returns {number} Nombre maximal d'épisodes détecté (-1 si aucun)
 */
export function extractEpsMaxEpisode(code) {
    if (!code || typeof code !== 'string') return -1;
    const epsRegex = /(?:var|let|const)?\s*(eps\w*)\s*=\s*\[([\s\S]*?)\];?/gi;
    let match;
    let maxCount = -1;
    while ((match = epsRegex.exec(code)) !== null) {
        const rawContent = match[2];
        const count = rawContent
            .split(',')
            .map(s => s.trim())
            .filter(s => s.length > 4 && (s.startsWith('"') || s.startsWith("'") || s.startsWith('`'))).length;
        if (count > maxCount) {
            maxCount = count;
        }
    }
    return maxCount;
}

/**
 * Extrait et ordonne les URLs des saisons disponibles sur une page catalogue Anime-Sama (saison la plus avancée en tête).
 * @param {string} htmlText Contenu HTML de la page catalogue
 * @param {string} baseUrl URL de référence pour résolution absolue
 * @param {boolean} [preferScan=false] Si vrai, priorise les URLs de scans sur les animes
 * @returns {string[]} Liste ordonnée des URLs absolues des saisons
 */
export function extractAnimeSamaSeasonUrls(htmlText, baseUrl, preferScan = false) {
    if (!htmlText || typeof htmlText !== 'string' || !baseUrl) return [];
    const seasonPatterns = [
        /href=["'](\/catalogue\/[^"']+\/(?:saison\d+|scan)\/[^"']*)["']/gi,
        /href=["']((?:saison\d+|scan)\/[^"']*)["']/gi,
        /panneauAnime\s*\(\s*['"]([^'"]*(?:saison\d+|scan)[^'"]*)['"]/gi,
        /['"]((?:saison\d+|scan)\/[^"']*)['"]/gi
    ];
    const found = [];
    for (const pattern of seasonPatterns) {
        let match;
        while ((match = pattern.exec(htmlText)) !== null) {
            const rawPath = match[1];
            try {
                const fullUrl = new URL(rawPath, baseUrl).href;
                if (!found.includes(fullUrl)) {
                    found.push(fullUrl);
                }
            } catch {
                // Ignore URL invalide
            }
        }
    }
    return found.sort((a, b) => {
        const isScanA = a.includes('/scan');
        const isScanB = b.includes('/scan');
        if (preferScan) {
            if (isScanA && !isScanB) return -1;
            if (!isScanA && isScanB) return 1;
        } else {
            if (isScanA && !isScanB) return 1;
            if (!isScanA && isScanB) return -1;
        }
        const numA = parseFloat(a.match(/saison(\d+)/i)?.[1] || '0');
        const numB = parseFloat(b.match(/saison(\d+)/i)?.[1] || '0');
        return numB - numA;
    });
}
