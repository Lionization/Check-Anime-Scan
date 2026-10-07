/**
 * @fileoverview Script autonome de scraping cloud exécutable via Node.js ou GitHub Actions.
 * Scrape les séries configurées dans le Gist secret et pousse les nouveautés automatiquement.
 */

import { parseAnimeSama } from '../background/adapters/anime-sama.js';
import { parseWebtoons } from '../background/adapters/webtoons.js';
import { parseMangago } from '../background/adapters/mangago.js';
import webpush from 'web-push';

const GIST_ID = process.env.GIST_ID;
const GIST_TOKEN = process.env.GIST_TOKEN;
const GIST_FILENAME = 'suivi.json';
const GITHUB_API_URL = 'https://api.github.com/gists';

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BFdc6qHW_0VONqmpkv2Qy6lbV5Tp4U3xdG2gOPCNKaqPfmPbsLK8upQXLnus7cFx1pGJV7HXddnw4y_wtgvVHMg';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:check-anime-scan@example.com';

if (VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

if (!GIST_ID || !GIST_TOKEN) {
    console.log("Variables GIST_ID ou GIST_TOKEN absentes. Arrêt du scraper cloud.");
    process.exit(0);
}

/**
 * Extrait le numéro numérique
 * @param {string|null|undefined} str 
 * @returns {number}
 */
function extractEpisodeNumber(str) {
    if (!str || typeof str !== 'string') return 0;
    const match = str.match(/(\d+(?:\.\d+)?)/);
    return match ? parseFloat(match[1]) : 0;
}

/**
 * Effectue une requête HTTP avec timeout
 * @param {string} url 
 * @returns {Promise<string|null>}
 */
async function fetchPage(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);

    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7'
            }
        });

        if (!response.ok) return null;
        return await response.text();
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Scrape une URL via les adaptateurs existants
 * @param {string} url 
 * @returns {Promise<{ text: string, image?: string|null }|null>}
 */
async function scrapeUrl(url) {
    const html = await fetchPage(url);
    if (!html) return null;

    if (url.includes('anime-sama')) {
        const res = parseAnimeSama(html);
        return typeof res === 'string' ? { text: res } : res;
    }

    if (url.includes('webtoons.com')) {
        const res = parseWebtoons(html);
        return typeof res === 'string' ? { text: res } : res;
    }

    if (url.includes('mangago.me')) {
        const res = parseMangago(html);
        return typeof res === 'string' ? { text: res } : res;
    }

    return null;
}

async function run() {
    console.log("Récupération du Gist...");
    const res = await fetch(`${GITHUB_API_URL}/${GIST_ID}`, {
        headers: {
            'Authorization': `Bearer ${GIST_TOKEN}`,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28'
        }
    });

    if (!res.ok) {
        console.error(`Erreur HTTP Gist: ${res.status}`);
        process.exit(1);
    }

    const gist = await res.json();
    const fileObj = gist?.files?.[GIST_FILENAME];
    if (!fileObj || !fileObj.content) {
        console.log("Fichier suivi.json vide ou absent.");
        process.exit(0);
    }

    const parsed = JSON.parse(fileObj.content);
    const items = parsed.items || parsed.mangas || parsed || {};
    const entries = Object.entries(items);

    if (entries.length === 0) {
        console.log("Aucun manga à scraper dans le Gist.");
        process.exit(0);
    }

    console.log(`Analyse de ${entries.length} séries en cours...`);
    let hasChanges = false;
    const newReleases = [];

    for (const [key, item] of entries) {
        const targetUrl = item.url || key;
        if (!targetUrl || !targetUrl.startsWith('http')) continue;

        const scraped = await scrapeUrl(targetUrl);
        if (!scraped || !scraped.text) continue;

        const currentLatestNum = extractEpisodeNumber(item.latestState);
        const newLatestNum = extractEpisodeNumber(scraped.text);

        if (newLatestNum > currentLatestNum) {
            console.log(`Nouveauté détectée sur ${item.title || key} : ${scraped.text} (précédent: ${item.latestState})`);
            item.latestState = scraped.text;
            if (scraped.image && !item.image) {
                item.image = scraped.image;
            }
            item.updatedAt = Date.now();
            hasChanges = true;
            newReleases.push({
                title: item.title || key,
                state: scraped.text,
                url: targetUrl
            });
        }
    }

    if (hasChanges) {
        console.log("Mise à jour du Gist avec les nouveautés...");
        const payload = {
            version: 1,
            updatedAt: Date.now(),
            _pushSubscription: parsed._pushSubscription || null,
            items: items
        };

        const patchRes = await fetch(`${GITHUB_API_URL}/${GIST_ID}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${GIST_TOKEN}`,
                'Accept': 'application/vnd.github+json',
                'Content-Type': 'application/json',
                'X-GitHub-Api-Version': '2022-11-28'
            },
            body: JSON.stringify({
                files: {
                    [GIST_FILENAME]: {
                        content: JSON.stringify(payload, null, 2)
                    }
                }
            })
        });

        if (patchRes.ok) {
            console.log("Gist mis à jour avec succès.");

            // Envoi des notifications Web Push sur le smartphone si abonné
            if (newReleases.length > 0 && parsed._pushSubscription && VAPID_PRIVATE_KEY) {
                console.log(`Envoi de ${newReleases.length} notification(s) Web Push vers votre smartphone...`);
                for (const rel of newReleases) {
                    try {
                        await webpush.sendNotification(
                            parsed._pushSubscription,
                            JSON.stringify({
                                title: `Nouveau scan / anime !`,
                                body: `${rel.title} — ${rel.state}`,
                                url: rel.url
                            })
                        );
                        console.log(`Notification envoyée avec succès pour : ${rel.title}`);
                    } catch (pushErr) {
                        console.error(`Erreur notification (${rel.title}):`, pushErr.message);
                    }
                }
            }
        } else {
            console.error("Échec de la mise à jour du Gist:", patchRes.status);
        }
    } else {
        console.log("Aucune nouvelle sortie détectée.");
    }
}

run().catch((e) => {
    console.error("Erreur fatale scraper cloud:", e);
    process.exit(1);
});
