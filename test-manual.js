const fs = require('fs');

const animeHtml = fs.readFileSync('exemples/anime-sama.html', 'utf-8');
const webtoonHtml = fs.readFileSync('exemples/webtoons.html', 'utf-8');
const mangagoHtml = fs.readFileSync('exemples/mangago.html', 'utf-8');

function parseAnimeSama(htmlText) {
    const selectRegex = /<select[^>]*id="select[^>]*>([\s\S]*?)<\/select>/i;
    const selectMatch = htmlText.match(selectRegex);
    
    if (selectMatch) {
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
    return "Fallback";
}

function parseWebtoons(htmlText) {
    const regex = /<span[^>]*class="tx"[^>]*>#(\d+)<\/span>/i;
    const match = htmlText.match(regex);
    if (match) {
        return `Épisode ${match[1]}`;
    }
    return null;
}

function parseMangago(htmlText) {
    const regex = /Ch\.\s*(\d+(?:\.\d+)?)/i;
    const match = htmlText.match(regex);
    if (match) {
        return `Chapitre ${match[1]}`;
    }
    return null;
}

console.log('--- TEST ANIME-SAMA ---');
console.log('Extracted:', parseAnimeSama(animeHtml));

console.log('\n--- TEST WEBTOONS ---');
console.log('Extracted:', parseWebtoons(webtoonHtml));

console.log('\n--- TEST MANGAGO ---');
console.log('Extracted:', parseMangago(mangagoHtml));
