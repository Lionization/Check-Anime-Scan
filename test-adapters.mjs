import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { parseAnimeSama } from './background/adapters/anime-sama.js';
import { parseWebtoons } from './background/adapters/webtoons.js';
import { parseMangago } from './background/adapters/mangago.js';
import { normalizeUrlKey } from './background/gist-sync.js';
import { 
    decodeHTMLEntities, 
    extractEpisodeNumber, 
    cleanTitle, 
    cleanStateDisplay, 
    formatRelativeTime,
    runWithConcurrency,
    isItemUnread
} from './utils.js';

console.log('=== 🧪 SUITE DE TESTS COMPLÈTE CHECK ANIME & SCANS ===\n');

// -------------------------------------------------------------
// 1. Contrôle Syntaxique Intégral du Code Source
// -------------------------------------------------------------
console.log('1. Contrôle syntaxique du projet (node -c) :');
const jsFiles = execSync('find . -maxdepth 3 -name "*.js" -not -path "*/node_modules/*" -not -path "*/.git/*"', { encoding: 'utf-8' })
    .trim()
    .split('\n')
    .filter(Boolean);

for (const file of jsFiles) {
    try {
        execSync(`node -c "${file}"`);
    } catch (err) {
        assert.fail(`Erreur syntaxique détectée dans le fichier: ${file}`);
    }
}
console.log(`   ✓ ${jsFiles.length} fichiers JavaScript validés avec succès (zéro erreur de syntaxe)`);

// -------------------------------------------------------------
// 2. Tests de l'Adaptateur Anime-Sama
// -------------------------------------------------------------
console.log('\n2. Tests Adaptateur Anime-Sama :');
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
</html>`;
const resAnimeNominal = parseAnimeSama(animeSamaMock);
assert.strictEqual(typeof resAnimeNominal === 'object' ? resAnimeNominal.text : resAnimeNominal, 'Épisode 24', 'Doit extraire l\'épisode sélectionné');
assert.strictEqual(resAnimeNominal.image, 'https://anime-sama.fr/images/cover.jpg', 'Doit extraire la cover og:image');

// Cas dégradé : HTML sans options sélectionnées -> Doit retourner null
const resAnimeEmpty = parseAnimeSama('<html><body><p>Texte sans épisode</p></body></html>');
assert.strictEqual(resAnimeEmpty, null, 'Doit retourner null si aucun épisode détecté');
assert.strictEqual(parseAnimeSama(null), null);
console.log('   ✓ Cas nominal et résilience (zéro résidu/fallback) validés');

// -------------------------------------------------------------
// 3. Tests de l'Adaptateur Webtoons
// -------------------------------------------------------------
console.log('\n3. Tests Adaptateur Webtoons :');
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
</html>`;
const resWebtoonNominal = parseWebtoons(webtoonsMock);
assert.strictEqual(resWebtoonNominal.text, 'Saison 2 Épisode 45 |#145|', 'Doit tagger data-episode-no');
assert.strictEqual(resWebtoonNominal.image, 'https://webtoons.com/cover.jpg');

const resWebtoonEmpty = parseWebtoons('<html><body></body></html>');
assert.strictEqual(resWebtoonEmpty, null, 'Doit retourner null si aucun épisode');
console.log('   ✓ Extraction du numéro d\'épisode et tag masqué validés');

// -------------------------------------------------------------
// 4. Tests de l'Adaptateur Mangago
// -------------------------------------------------------------
console.log('\n4. Tests Adaptateur Mangago :');
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
</html>`;
const resMangagoNominal = parseMangago(mangagoMock);
assert.strictEqual(resMangagoNominal.text, 'Chapitre 1110', 'Doit formater Ch. en Chapitre');
assert.strictEqual(resMangagoNominal.image, 'https://mangago.me/cover.jpg');

const resMangagoEmpty = parseMangago('<html><body></body></html>');
assert.strictEqual(resMangagoEmpty, null, 'Doit retourner null si aucun chapitre');
console.log('   ✓ Normalisation de chapitre, cover et absence de résultat validées');

// -------------------------------------------------------------
// 5. Tests Utilitaires : Décodage Entités & Nettoyage de Titre
// -------------------------------------------------------------
console.log('\n5. Tests Décodage & Nettoyage de Titre :');
assert.strictEqual(decodeHTMLEntities('&amp;rsquo;'), '’', 'Doit supporter le double échappement HTML');
assert.strictEqual(decodeHTMLEntities('&eacute;&amp;&quot;'), 'é&"', 'Doit décoder accents et guillemets');
assert.strictEqual(decodeHTMLEntities(''), '');
assert.strictEqual(decodeHTMLEntities(null), '');

assert.strictEqual(cleanTitle('Solo Leveling | Scan VF'), 'Solo Leveling', 'Doit retirer le pipe et le suffixe');
assert.strictEqual(cleanTitle('One Piece &amp; Cie | Manga'), 'One Piece & Cie', 'Doit décoder et nettoyer');
assert.strictEqual(cleanTitle(null), '');
console.log('   ✓ Décodage HTML et assainissement de titre validés');

// -------------------------------------------------------------
// 6. Tests Utilitaires : Extraction de Numéros de Chapitres & Tags
// -------------------------------------------------------------
console.log('\n6. Tests Extraction Numérique & Nettoyage Statut :');
// Nombres simples
assert.strictEqual(extractEpisodeNumber('Chapitre 105'), 105);
// Décimaux (ex: chapitres .5)
assert.strictEqual(extractEpisodeNumber('Chapitre 105.5'), 105.5);
// Format tagué masqué prioritaire
assert.strictEqual(extractEpisodeNumber('Saison 2 Épisode 45 |#145|'), 145);
assert.strictEqual(extractEpisodeNumber('Épisode 24 |#24.5|'), 24.5);
// Cas limites
assert.strictEqual(extractEpisodeNumber('Sans numéro'), 0);
assert.strictEqual(extractEpisodeNumber(null), 0);
assert.strictEqual(extractEpisodeNumber(''), 0);

// Nettoyage de l'affichage
assert.strictEqual(cleanStateDisplay('Saison 2 Épisode 45 |#145|'), 'Saison 2 Épisode 45');
assert.strictEqual(cleanStateDisplay('Chapitre 12'), 'Chapitre 12');
assert.strictEqual(cleanStateDisplay(null), 'État inconnu');
console.log('   ✓ Extraction de décimaux, entiers et tags masqués validée');

// -------------------------------------------------------------
// 7. Tests Logique Métier : Détection Lu / Non Lu (isItemUnread)
// -------------------------------------------------------------
console.log('\n7. Tests Détection de Non Lu (Règle Métier Anti-Régression) :');
// La fonction isItemUnread importée de utils.js fait foi de règle canonique universelle.

// Cas 1 : L'utilisateur est à jour numériquement -> DOIT être lu
assert.strictEqual(isItemUnread({
    userProgress: 'Chapitre 105',
    latestEpisode: 'Chapitre 105',
    isNew: true
}), false, 'Si userProgress === latestEpisode numériquement, ne doit PAS être non lu');

// Cas 2 : L'utilisateur est en avance ou égal malgré un sous-titre différent
assert.strictEqual(isItemUnread({
    userProgress: 'Chapitre 105',
    latestEpisode: 'Chapitre 105 : Fin du combat',
    isNew: true
}), false, 'Même numéro avec sous-titre doit être considéré lu');

// Cas 3 : L'utilisateur est en retard -> DOIT être non lu
assert.strictEqual(isItemUnread({
    userProgress: 'Chapitre 104',
    latestEpisode: 'Chapitre 105',
    isNew: true
}), true, 'Si userProgress < latestEpisode, doit être non lu');

// Cas 4 : isNew explicite à false (lecture validée manuellement)
assert.strictEqual(isItemUnread({
    userProgress: 'Chapitre 100',
    latestEpisode: 'Chapitre 105',
    isNew: false
}), false, 'Si isNew === false, doit être lu');

// Cas 5 : Nouvel animé sorti sans historique de lecture utilisateur (Non commencé)
assert.strictEqual(isItemUnread({
    userProgress: '',
    latestState: 'Épisode 1'
}), true, 'Un nouvel animé sans historique de lecture DOIT être non lu');
console.log('   ✓ Comparaison numérique, nouveauté sans historique et cas limites lu/non-lu validés');

// -------------------------------------------------------------
// 8. Tests Normalisation des Clés d'URL
// -------------------------------------------------------------
console.log('\n8. Tests Normalisation des Clés Gist (normalizeUrlKey) :');
assert.strictEqual(
    normalizeUrlKey('https://anime-sama.fr/catalogue/solo-leveling/'),
    'https://anime-sama.fr/catalogue/solo-leveling',
    'Doit supprimer le trailing slash'
);
assert.strictEqual(
    normalizeUrlKey('https://webtoons.com/fr/action/tower-of-god/viewer?title_no=123'),
    'https://webtoons.com/fr/action/tower-of-god/viewer',
    'Doit conserver le pathname propre sans trailing slash'
);
assert.strictEqual(normalizeUrlKey(''), '');
assert.strictEqual(normalizeUrlKey(null), '');
console.log('   ✓ Normalisation des clés d\'accès validée');

// -------------------------------------------------------------
// 9. Tests Formatage du Temps Relatif
// -------------------------------------------------------------
console.log('\n9. Tests Formatage du Temps Relatif :');
const now = Date.now();
assert.strictEqual(formatRelativeTime(now - 30 * 1000), "À l'instant");
assert.strictEqual(formatRelativeTime(now - 15 * 60 * 1000), 'Il y a 15 min');
assert.strictEqual(formatRelativeTime(now - 3 * 3600 * 1000), 'Il y a 3h');
assert.strictEqual(formatRelativeTime(now - 25 * 3600 * 1000), 'Hier');
assert.strictEqual(formatRelativeTime(now - 3 * 86400 * 1000), 'Il y a 3j');
assert.strictEqual(formatRelativeTime(null), '');
console.log('   ✓ Échelons temporels relatifs en français validés');

// -------------------------------------------------------------
// 10. Tests Exécution Concurrente et Tolérance aux Pannes
// -------------------------------------------------------------
console.log('\n10. Tests Exécution Concurrente (runWithConcurrency) :');
const itemsToProcess = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
let activeConcurrency = 0;
let maxObservedConcurrency = 0;

const concurrentResults = await runWithConcurrency(itemsToProcess, 3, async (item) => {
    activeConcurrency++;
    if (activeConcurrency > maxObservedConcurrency) {
        maxObservedConcurrency = activeConcurrency;
    }
    await new Promise(r => setTimeout(r, 10));
    activeConcurrency--;
    if (item === 5) throw new Error('Erreur réseau simulée');
    return `OK-${item}`;
});

assert.strictEqual(concurrentResults.length, 10, 'Tous les éléments doivent être représentés');
assert.strictEqual(concurrentResults[4], null, 'L\'élément en erreur doit retourner null sans faire crasher la boucle');
assert.strictEqual(concurrentResults[0], 'OK-1');
assert.ok(maxObservedConcurrency <= 3, `La concurrence observée (${maxObservedConcurrency}) ne doit pas dépasser le plafond (3)`);
console.log('   ✓ Limitation stricte de concurrence et résilience aux erreurs validées');

console.log('\n=== ✅ TOUS LES TESTS STRICTS SONT PASSÉS SANS ERREUR (10/10) ===');
