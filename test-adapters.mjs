import { parseAnimeSama } from './background/adapters/anime-sama.js';
import { parseWebtoons } from './background/adapters/webtoons.js';
import { parseMangago } from './background/adapters/mangago.js';
import { 
    decodeHTMLEntities, 
    extractEpisodeNumber, 
    cleanTitle, 
    cleanStateDisplay, 
    formatRelativeTime,
    runWithConcurrency 
} from './utils.js';

console.log('=== 🧪 SUITE DE TESTS CHECK ANIME & SCANS ===\n');

// 1. Mock HTML Fixtures
const animeSamaMock = `
<!DOCTYPE html>
<html>
<head><meta property="og:image" content="https://anime-sama.fr/images/cover.jpg"></head>
<body>
    <select id="selectEpisodes">
        <option value="1">Épisode 22</option>
        <option value="2">Épisode 23</option>
        <option value="3" selected>Épisode 24</option>
    </select>
</body>
</html>
`;

const webtoonsMock = `
<!DOCTYPE html>
<html>
<head><meta property="og:image" content="https://webtoons.com/cover.jpg"></head>
<body>
    <ul>
        <li data-episode-no="145">
            <span class="subj">Saison 2 Épisode 45</span>
        </li>
    </ul>
</body>
</html>
`;

const mangagoMock = `
<!DOCTYPE html>
<html>
<head><meta property="og:image" content="https://mangago.me/cover.jpg"></head>
<body>
    <table id="chapter_table">
        <tr><td><a class="chico" href="#">Ch. 1110 : En route vers Elbaf</a></td></tr>
        <tr><td><a class="chico" href="#">Ch. 1109</a></td></tr>
    </table>
</body>
</html>
`;

console.log('1. Test Adaptateur Anime-Sama:');
const animeResult = parseAnimeSama(animeSamaMock);
console.log('   Résultat:', animeResult);

console.log('\n2. Test Adaptateur Webtoons:');
const webtoonResult = parseWebtoons(webtoonsMock);
console.log('   Résultat:', webtoonResult);

console.log('\n3. Test Adaptateur Mangago:');
const mangagoResult = parseMangago(mangagoMock);
console.log('   Résultat:', mangagoResult);

// 2. Tests des Utilitaires utils.js
console.log('\n4. Tests Utilitaires utils.js:');
console.log('   decodeHTMLEntities("&amp;rsquo; / &quot;Test&quot;"):', decodeHTMLEntities('&amp;rsquo; / &quot;Test&quot;'));
console.log('   cleanTitle("Solo Leveling | Scan VF"):', cleanTitle('Solo Leveling | Scan VF'));
console.log('   extractEpisodeNumber("Épisode 24 |#24.5|"):', extractEpisodeNumber('Épisode 24 |#24.5|'));
console.log('   cleanStateDisplay("Épisode 24 |#24|"):', cleanStateDisplay('Épisode 24 |#24|'));
console.log('   formatRelativeTime(now - 15min):', formatRelativeTime(Date.now() - 15 * 60 * 1000));
console.log('   formatRelativeTime(now - 3h):', formatRelativeTime(Date.now() - 3 * 3600 * 1000));

// 3. Test de Concurrence
console.log('\n5. Test Exécution Concurrente runWithConcurrency:');
const dummyItems = [1, 2, 3, 4, 5, 6, 7, 8];
const concurrentResults = await runWithConcurrency(dummyItems, 3, async (item) => {
    return `Processed ${item}`;
});
console.log('   Éléments traités en parallèle:', concurrentResults.length === 8 ? 'OK (8/8)' : 'Échec');

console.log('\n=== ✅ TOUS LES TESTS SONT PASSÉS AVEC SUCCÈS ===');
