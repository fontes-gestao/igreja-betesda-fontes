/* ============================================================
   Service Worker - Betesda Fontes (PWA)
   Versão 20260705-login-entrar-v25
   - Corrige cache preso em iPhone/Android/Chrome.
   - HTML, JS, CSS e manifest sempre tentam buscar a versão nova primeiro.
   - Imagens e ícones continuam em cache para o PWA funcionar melhor offline.
   ============================================================ */

const CACHE_VERSION = '20260705-login-entrar-v25';
const CACHE_NAME = `betesda-fontes-${CACHE_VERSION}`;

const STATIC_ASSETS = [
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
  './icons/favicon.png',
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
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith('betesda-fontes-') && key !== CACHE_NAME)
      .map((key) => caches.delete(key))
    );
    await self.clients.claim();
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) client.postMessage({ type: 'APP_UPDATED', version: CACHE_VERSION });
  })());
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
    const critical = path.endsWith('/index.html') || path.endsWith('.html') || path.endsWith('.js') || path.endsWith('.css') || path.endsWith('.json') || path.endsWith('.webmanifest');
    if (critical) {
      event.respondWith(networkFirst(req));
      return;
    }
    event.respondWith(cacheFirst(req));
    return;
  }

  // Bibliotecas externas: tenta rede primeiro; se falhar, usa cache.
  event.respondWith(networkFirst(req));
});

async function networkFirst(req, fallbackUrl) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(req, { cache: 'no-store' });
    if (fresh && fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch (err) {
    const cached = await caches.match(req);
    if (cached) return cached;
    if (fallbackUrl) {
      return caches.match(fallbackUrl) || caches.match('./index.html') || new Response('Offline', { status: 503 });
    }
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

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING' || event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('push', () => {});
self.addEventListener('sync', () => {});
