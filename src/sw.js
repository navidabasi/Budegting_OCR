/// <reference lib="webworker" />
// Service worker (vite-plugin-pwa injectManifest): precache, SPA navigation fallback, Web Share Target.
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { handleShareRequest } from './services/sharedFiles';

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// Receipts shared from Mail/Gmail/Files (manifest share_target: POST /share, multipart `files`)
self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method === 'POST' && new URL(request.url).pathname === '/share') {
        event.respondWith(handleShareRequest(request));
    }
});

// SPA fallback for navigations, never for the API or the share endpoint
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api/, /^\/share/] }));

// The PDF renderer is large and rarely used: cached on first use instead of precached
registerRoute(
    ({ url }) => /\/assets\/pdf[.-].*\.(js|mjs)$/.test(url.pathname),
    new CacheFirst({ cacheName: 'pdf-renderer', plugins: [new ExpirationPlugin({ maxEntries: 4 })] })
);
