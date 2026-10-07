/**
 * @fileoverview Service Worker pour la PWA Check Anime & Scans Mobile.
 * Stratégie Network-First avec repli cache hors-ligne et versioning horodaté.
 */

// Horodatage automatique de la version du cache (AnnéeMoisJour_HeureMinute)
const CACHE_NAME = 'check-scans-20261007_2120';

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

    // Ne jamais intercepter les requêtes directes à l'API GitHub
    if (url.hostname.includes('api.github.com')) {
        return;
    }

    // Stratégie Network-First : réseau en priorité, mise en cache automatique, repli hors-ligne
    event.respondWith(
        fetch(event.request)
            .then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseToCache);
                    });
                }
                return networkResponse;
            })
            .catch(() => {
                return caches.match(event.request).then((cachedResponse) => {
                    if (cachedResponse) {
                        return cachedResponse;
                    }
                    if (event.request.mode === 'navigate') {
                        return caches.match('./index.html');
                    }
                });
            })
    );
});
