/**
 * @fileoverview Service Worker pour la PWA Check Anime & Scans Mobile.
 * Gère la mise en cache de l'interface applicative et le mode hors-ligne.
 */

const CACHE_NAME = 'check-scans-pwa-v1';
const APP_SHELL = [
    './',
    './index.html',
    './app.css',
    './app.js',
    './manifest.json',
    './icons/favicon16.png',
    './icons/favicon48.png',
    './icons/favicon128.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(APP_SHELL);
        }).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Ne pas mettre en cache les requêtes API GitHub en cache statique
    if (url.hostname.includes('api.github.com')) {
        return;
    }

    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse;
            }
            return fetch(event.request).catch(() => {
                // Secours hors-ligne
                if (event.request.mode === 'navigate') {
                    return caches.match('./index.html');
                }
            });
        })
    );
});
