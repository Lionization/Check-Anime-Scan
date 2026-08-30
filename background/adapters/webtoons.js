/**
 * Adaptateur pour webtoons.com
 * @param {string} htmlText Code HTML brut de la page
 * @returns {string|null} Identifiant du dernier chapitre
 */
export function parseWebtoons(htmlText) {
    let result = { text: null, image: null };

    // Extraire l'image de couverture (og:image)
    const imgRegex = /<meta property="og:image" content="([^"]+)"/i;
    const imgMatch = htmlText.match(imgRegex);
    if (imgMatch) {
        result.image = imgMatch[1];
    }

    // Webtoons affiche les épisodes dans des <li> avec l'attribut data-episode-no
    // On extrait d'abord le bloc complet du premier <li>
    const liRegex = /<li[^>]*data-episode-no="(\d+)"[^>]*>([\s\S]*?)<\/li>/i;
    const liMatch = htmlText.match(liRegex);
    
    if (liMatch) {
        const num = liMatch[1];
        let title = `Épisode ${num}`;
        
        // On cherche le span.subj à l'intérieur de ce bloc li
        const subjMatch = liMatch[2].match(/<span class="subj">([\s\S]*?)<\/span>/i);
        if (subjMatch) {
            // On supprime les éventuelles sous-balises <span> pour ne garder que le texte pur
            const rawTitle = subjMatch[1].replace(/<[^>]+>/g, '').trim();
            if (rawTitle) {
                title = rawTitle;
            }
        }
        
        result.text = `${title} |#${num}|`;
        return result;
    }

    // Fallback: chercher la première date de mise à jour (souvent de la forme "Oct 12, 2023")
    const dateRegex = /<span class="date">([^<]+)<\/span>/i;
    const dateMatch = htmlText.match(dateRegex);
    if (dateMatch) {
        result.text = `Date: ${dateMatch[1].trim()}`;
        return result;
    }
    
    return result.text ? result : null;
}
