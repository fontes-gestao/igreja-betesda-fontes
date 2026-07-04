/* ============================================================
   Service Worker - Betesda Fontes (PWA)
   Versão com atualização automática e menos cache preso.
   - HTML, JS, CSS e manifest: network-first com cache reload.
   - Imagens e ícones: cache-first.
   - Ao publicar uma versão nova no GitHub, o app atualiza sem precisar limpar cache.
   ============================================================ */

const CACHE_VERSION = '20260704-admin-risk-v9';
const CACHE_NAME = `betesda-fontes-${CACHE_VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './style.css?v=20260704-admin-risk-v9',
  './script.js?v=20260704-admin-risk-v9',
  './manifest.json?v=20260704-admin-risk-v9',
  './assets/church-logo.png',
  './assets/cards/card-culto.png',
  './assets/cards/card-evento.png',
  './assets/cards/card-membros.png',
  './assets/cards/card-escalas.png',
  './assets/cards/card-manut.png',
  './assets/avatar-1.png',
  './assets/avatar-2.png',
  './assets/avatar-3.png',
  './assets/avatar-4.png',
  './assets/avatar-5.png',
  './assets/avatar-6.png',
  './assets/avatar-7.png',
  './assets/avatar-8.png',
  './assets/avatar-9.png',
  './icons/icon-72.png',
  './icons/icon-96.png',
  './icons/icon-128.png',
  './icons/icon-144.png',
  './icons/icon-152.png',
  './icons/icon-192.png',
  './icons/icon-192-maskable.png',
  './icons/icon-384.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('betesda-fontes-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
      .then(() => notifyClientsOfUpdate())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isNavigation = req.mode === 'navigate';

  if (isNavigation) {
    event.respondWith(networkFirst(req, './index.html'));
    return;
  }

  if (isSameOrigin) {
    const path = url.pathname.toLowerCase();
    const isCriticalFile = path.endsWith('/index.html') || path.endsWith('.js') || path.endsWith('.css') || path.endsWith('.json') || path.endsWith('.webmanifest');

    if (isCriticalFile) {
      event.respondWith(networkFirst(req));
      return;
    }

    event.respondWith(cacheFirst(req));
    return;
  }

  event.respondWith(staleWhileRevalidate(req));
});

async function networkFirst(req, fallbackUrl) {
  try {
    const fresh = await fetch(req, { cache: 'reload' });
    if (fresh && fresh.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, fresh.clone());
    }
    return fresh;
  } catch (err) {
    const cached = await caches.match(req);
    if (cached) return cached;
    if (fallbackUrl) return caches.match(fallbackUrl) || caches.match('./index.html');
    return Response.error();
  }
}

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, fresh.clone());
    }
    return fresh;
  } catch (err) {
    return cached || Response.error();
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);
  const networkPromise = fetch(req)
    .then((fresh) => {
      if (fresh && fresh.ok) cache.put(req, fresh.clone());
      return fresh;
    })
    .catch(() => cached);
  return cached || networkPromise;
}

async function notifyClientsOfUpdate() {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) {
    client.postMessage({ type: 'APP_UPDATED', version: CACHE_VERSION });
  }
}

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING' || event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('push', () => {});
self.addEventListener('sync', () => {});
