import fs from 'fs';
import { parseAnimeSama } from './background/adapters/anime-sama.js';
import { parseWebtoons } from './background/adapters/webtoons.js';
import { parseMangago } from './background/adapters/mangago.js';

const animeHtml = fs.readFileSync('exemples/anime-sama.html', 'utf-8');
const webtoonHtml = fs.readFileSync('exemples/webtoons.html', 'utf-8');
const mangagoHtml = fs.readFileSync('exemples/mangago.html', 'utf-8');

console.log('--- TEST ANIME-SAMA ---');
console.log('Extracted:', parseAnimeSama(animeHtml));

console.log('\n--- TEST WEBTOONS ---');
console.log('Extracted:', parseWebtoons(webtoonHtml));

console.log('\n--- TEST MANGAGO ---');
console.log('Extracted:', parseMangago(mangagoHtml));
