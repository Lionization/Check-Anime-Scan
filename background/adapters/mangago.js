/**
 * Adaptateur pour mangago.me
 * @param {string} htmlText Code HTML brut de la page
 * @returns {string|null} Identifiant du dernier chapitre
 */
export function parseMangago(htmlText) {
    let result = { text: null, image: null };

    // Extraire l'image de couverture (og:image)
    const imgRegex = /<meta property="og:image" content="([^"]+)"/i;
    const imgMatch = htmlText.match(imgRegex);
    if (imgMatch) {
        result.image = imgMatch[1];
    }

    // Mangago affiche les chapitres dans une table, les liens ont la classe "chico"
    const regex = /<a[^>]*class="[^"]*chico[^"]*"[^>]*>.*?Ch\.\s*(\d+(?:\.\d+)?)/ig;
    let maxChap = -1;
    let match;
    
    while ((match = regex.exec(htmlText)) !== null) {
        const num = parseFloat(match[1]);
        if (num > maxChap) {
            maxChap = num;
        }
    }
    
    if (maxChap > -1) {
        result.text = `Chapitre ${maxChap}`;
        return result;
    }

    // Fallback: chercher une date si on n'a pas de chapitre précis
    const dateRegex = /<td class="no"[^>]*>([^<]+)<\/td>/i;
    const dateMatch = htmlText.match(dateRegex);
    if (dateMatch) {
        result.text = `Date: ${dateMatch[1].trim()}`;
        return result;
    }

    return result.text ? result : null;
}
