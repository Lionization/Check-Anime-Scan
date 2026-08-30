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
    const imgMatch = htmlText.match(imgRegex);
    if (imgMatch) {
        coverImage = imgMatch[1];
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
    
    // Heuristique 2 : Recherche globale "Épisode X" ou "Chapitre X"
    if (!detectedText) {
        const regex = /(?:[éeE]pisodes?|chapitres?)[\s-]*(\d+(?:\.\d+)?)/gi;
        let match;
        let maxEpGlobal = -1;
        let globalType = "Épisode";
        
        while ((match = regex.exec(htmlText)) !== null) {
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

    // Fallback : empreinte de changement
    const fallbackText = `Longueur/Etat HTML: ${htmlText.length}`;
    return coverImage ? { text: fallbackText, image: coverImage } : fallbackText;
}
