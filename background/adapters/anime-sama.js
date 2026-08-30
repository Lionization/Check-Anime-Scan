/**
 * Adaptateur pour anime-sama
 * @param {string} htmlText Code HTML brut de la page
 * @returns {string|null} Un identifiant unique du dernier épisode (ex: numéro, URL ou date)
 */
export function parseAnimeSama(htmlText) {
    // Anime-sama utilise souvent des balises <script> avec une variable contenant les épisodes
    // ou des listes déroulantes pour sélectionner les épisodes.
    
    // Heuristique 1 : Chercher un select d'épisodes ou chapitres spécifiquement
    const selectRegex = /<select[^>]*id="select[^>]*>([\s\S]*?)<\/select>/i;
    const selectMatch = htmlText.match(selectRegex);
    
    if (selectMatch) {
        // On a trouvé le bloc select, on cherche les options à l'intérieur
        const optionsHtml = selectMatch[1];
        const optionRegex = /<option[^>]*>.*?(?:Episode|Chapitre)\s*(\d+(?:\.\d+)?).*?<\/option>/gi;
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
            return `${type} ${maxEp}`;
        }
    }
    
    // Heuristique 2 : Chercher "Épisode X" ou "Chapitre X" dans le HTML global
    const regex = /(?:episodes?|chapitres?)[\s-]*(\d+(?:\.\d+)?)/gi;
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
        return `${globalType} ${maxEpGlobal}`;
    }
    
    // Heuristique 2 : Chercher un lien contenant "episode"
    const linkRegex = /href="[^"]*episode-(\d+)[^"]*"/i;
    const linkMatch = htmlText.match(linkRegex);
    if (linkMatch) {
        return `Épisode ${linkMatch[1]}`;
    }

    // Heuristique 3 (Fallback) : chercher la première date ou mention de 'nouveau'
    return extractFallback(htmlText);
}

function extractFallback(htmlText) {
    // On extrait simplement un hash simple ou un bout de la première liste trouvée
    // C'est basique mais ça permet de détecter un changement.
    const length = htmlText.length;
    return `Longueur/Etat HTML: ${length}`;
}
