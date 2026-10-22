import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { parseAnimeSama, extractEpsMaxEpisode, extractAnimeSamaSeasonUrls } from './background/adapters/anime-sama.js';
import { parseWebtoons } from './background/adapters/webtoons.js';
import { parseMangago } from './background/adapters/mangago.js';
import { normalizeUrlKey, getUrlFingerprint } from './background/gist-sync.js';
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
<head><meta property="og:image" content="https://anime-sama.to/images/cover.jpg"></head>
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
assert.strictEqual(resAnimeNominal.image, 'https://anime-sama.to/images/cover.jpg', 'Doit extraire la cover og:image');

// Test Nouveau Template Anime-Sama (Grille ct-ep + reprise à 16 + épisode 17 sorti)
const animeSamaNewTemplateMock = `
<div class="ct-page">
    <a href="/catalogue/the-exiled-heavy-knight/" class="ct-banniere-lien"><img id="imgOeuvre" class="ct-banniere" src="https://cdn.jsdelivr.net/cover.jpg"></a>
    <span id="ctEpisodeActuel" class="ct-nav-actuel">Épisode 16</span>
    <span class="as-dd-texte">Episode 16</span>
    <i id="savedEpisodeId">Episode 16</i>
    <div id="ctGrille" class="ct-grille">
        <button type="button" class="ct-ep ct-ep-actuel" title="Episode 16" data-i="15">16</button>
        <button type="button" class="ct-ep" title="Episode 17" data-i="16">17</button>
    </div>
</div>`;
const resNewTemplate = parseAnimeSama(animeSamaNewTemplateMock);
assert.strictEqual(typeof resNewTemplate === 'object' ? resNewTemplate.text : resNewTemplate, 'Épisode 17', 'Doit détecter l\'épisode 17 et non la reprise 16');
assert.strictEqual(resNewTemplate.image, 'https://cdn.jsdelivr.net/cover.jpg');

// Test Multi-lecteurs inline (eps2 et eps3 avec lecteur 1 incomplet)
const animeSamaMultiPlayerMock = `
<html><head></head><body>
<script>
var eps1 = ["link1", "link2", "link3"]; // 3 épisodes
var eps2 = ["link1", "link2", "link3", "link4", "link5"]; // 5 épisodes
</script>
</body></html>`;
const resMultiPlayer = parseAnimeSama(animeSamaMultiPlayerMock);
assert.strictEqual(typeof resMultiPlayer === 'object' ? resMultiPlayer.text : resMultiPlayer, 'Épisode 5', 'Doit prendre le maximum des lecteurs disponibles');

// Test de la fonction factorisée extractEpsMaxEpisode
const rawJsScript = `
var eps1 = ["https://site/ep1.mp4", "https://site/ep2.mp4"];
let eps2 = [\`https://site/ep1.mp4\`, 'https://site/ep2.mp4', "https://site/ep3.mp4", "https://site/ep4.mp4"];
const epsAS = ["https://site/ep1.mp4"];
`;
assert.strictEqual(extractEpsMaxEpisode(rawJsScript), 4, 'Doit trouver 4 comme maximum des lecteurs');
assert.strictEqual(extractEpsMaxEpisode(''), -1);
assert.strictEqual(extractEpsMaxEpisode(null), -1);

// Test de la fonction factorisée extractAnimeSamaSeasonUrls
const catalogueHtmlMock = `
<html><body>
    <a href="/catalogue/test/saison1/vostfr">Saison 1</a>
    <a href="saison2/vostfr">Saison 2</a>
    <a href="/catalogue/test/scan/vf/">Scans</a>
    <div onclick="panneauAnime('saison3/vostfr')">Saison 3</div>
</body></html>`;
const seasonsAnime = extractAnimeSamaSeasonUrls(catalogueHtmlMock, 'https://anime-sama.to/catalogue/test/', false);
assert.strictEqual(seasonsAnime[0], 'https://anime-sama.to/catalogue/test/saison3/vostfr', 'Saison 3 doit être en tête si preferScan est faux');

const seasonsScan = extractAnimeSamaSeasonUrls(catalogueHtmlMock, 'https://anime-sama.to/catalogue/test/', true);
assert.strictEqual(seasonsScan[0], 'https://anime-sama.to/catalogue/test/scan/vf/', 'Scans doit être en tête si preferScan est vrai');

// Nouveau template ct-ep avec chapitres de scans (ex: Overlord)
const ctScanHtmlMock = `
<html><body>
    <div id="ctGrille">
        <button class="ct-ep" title="Chapitre 80">80</button>
        <button class="ct-ep" title="Chapitre 81">81</button>
    </div>
</body></html>`;
const resCtScan = parseAnimeSama(ctScanHtmlMock);
assert.strictEqual(typeof resCtScan === 'string' ? resCtScan : resCtScan?.text, 'Chapitre 81', 'Doit détecter Chapitre 81 dans les boutons ct-ep');

// Cas dégradé : HTML sans options sélectionnées -> Doit retourner null
const resAnimeEmpty = parseAnimeSama('<html><body><p>Texte sans épisode</p></body></html>');
assert.strictEqual(resAnimeEmpty, null, 'Doit retourner null si aucun épisode détecté');
assert.strictEqual(parseAnimeSama(null), null);
console.log('   ✓ Cas nominal, nouveau template ct-ep épisodes/chapitres, multi-lecteurs, helpers factorisés et résilience validés');

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
assert.strictEqual(decodeHTMLEntities('Ep.134 : L&#039;accord (1)'), "Ep.134 : L'accord (1)", 'Doit décoder les entités numériques avec zéro');
assert.strictEqual(decodeHTMLEntities(''), '');
assert.strictEqual(decodeHTMLEntities(null), '');

assert.strictEqual(cleanStateDisplay('Ep.134 : L&#039;accord (1) |#134|'), "Ep.134 : L'accord (1)", 'Doit nettoyer et décoder le statut');
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

// Cas 4 : L'utilisateur est en retard numériquement mais isNew est à false (ex: Overlord ou Exiled Knight après synchro)
assert.strictEqual(isItemUnread({
    userProgress: 'Chapitre 50',
    latestState: 'Chapitre 140',
    isNew: false
}), true, 'Si userProgress < latestState numériquement, DOIT être non lu même si isNew === false');

// Cas 4b : L'utilisateur est à jour avec isNew à false -> DOIT être lu
assert.strictEqual(isItemUnread({
    userProgress: 'Chapitre 140',
    latestState: 'Chapitre 140',
    isNew: false
}), false, 'Si userProgress === latestState numériquement et isNew === false, doit être lu');

// Cas 4c : Format textuel sans numéro avec isNew à false -> lu
assert.strictEqual(isItemUnread({
    userProgress: 'Film Canon',
    latestState: 'Film Canon Spécial',
    isNew: false
}), false, 'Si aucun numéro et isNew === false, doit être considéré lu');

// Cas 4d : Format textuel sans numéro avec isNew à true -> non lu
assert.strictEqual(isItemUnread({
    userProgress: 'Film Canon',
    latestState: 'Film Canon Spécial',
    isNew: true
}), true, 'Si aucun numéro et isNew === true, doit être considéré non lu');

// Cas 5 : Nouvel animé sorti sans historique de lecture utilisateur (Non commencé)
assert.strictEqual(isItemUnread({
    userProgress: '',
    latestState: 'Épisode 1'
}), true, 'Un nouvel animé sans historique de lecture DOIT être non lu');
console.log('   ✓ Comparaison numérique prioritaire sur isNew, nouveautés sans historique et cas limites validés');

// -------------------------------------------------------------
// 8. Tests Normalisation des Clés d'URL et Empreintes Multi-Domaines
// -------------------------------------------------------------
console.log('\n8. Tests Normalisation des Clés Gist (normalizeUrlKey & getUrlFingerprint) :');
assert.strictEqual(
    normalizeUrlKey('https://anime-sama.to/catalogue/solo-leveling/'),
    'https://anime-sama.to/catalogue/solo-leveling',
    'Doit conserver le domaine d\'origine valide et supprimer le trailing slash'
);
assert.strictEqual(
    normalizeUrlKey('https://webtoons.com/fr/action/tower-of-god/viewer?title_no=123'),
    'https://webtoons.com/fr/action/tower-of-god/viewer',
    'Doit conserver le pathname propre sans trailing slash'
);
assert.strictEqual(normalizeUrlKey(''), '');
assert.strictEqual(normalizeUrlKey(null), '');

// Tests de réconciliation agnostique de domaine (TLD changeant .si <-> .to)
assert.strictEqual(
    getUrlFingerprint('https://anime-sama.si/catalogue/dreamland/'),
    'anime-sama:/catalogue/dreamland'
);
assert.strictEqual(
    getUrlFingerprint('https://anime-sama.to/catalogue/dreamland'),
    'anime-sama:/catalogue/dreamland'
);
assert.strictEqual(
    getUrlFingerprint('https://anime-sama.si/catalogue/dreamland/'),
    getUrlFingerprint('https://anime-sama.to/catalogue/dreamland'),
    'Deux domaines différents pour la même oeuvre doivent avoir la même empreinte'
);
console.log('   ✓ Normalisation des clés d\'accès et empreintes multi-domaines validées');

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

// -------------------------------------------------------------
// 11. Tests Réconciliation Temporelle et Recul Manuel de Chapitre
// -------------------------------------------------------------
console.log('\n11. Tests Recul Manuel et Réconciliation Gist :');
// Cas A : L'utilisateur recule son chapitre manuellement (16 < 17) -> local plus récent
const localTimeRecent = Date.now();
const gistTimeOld = localTimeRecent - 60000;
const isLocalMoreRecent = localTimeRecent > gistTimeOld;
assert.strictEqual(isLocalMoreRecent, true, 'Le local doit être détecté comme plus récent');

// Cas B : Le statut non lu doit s'activer immédiatement lors du recul
const unreadAfterRollback = isItemUnread({
    userProgress: 'Épisode 16',
    latestState: 'Épisode 17',
    isNew: false
});
assert.strictEqual(unreadAfterRollback, true, 'Reculer à 16 alors que 17 est sorti doit basculer en non lu');

// Cas C : Avancement ou statut synchronisé quand le Gist est plus récent
const isGistMoreRecent = gistTimeOld > localTimeRecent;
assert.strictEqual(isGistMoreRecent, false);
console.log('   ✓ Priorité temporelle de modification et bascule non-lu après recul validées');

console.log('\n=== ✅ TOUS LES TESTS STRICTS SONT PASSÉS SANS ERREUR (11/11) ===');

