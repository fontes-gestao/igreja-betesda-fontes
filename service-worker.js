/* ============================================================
   Service Worker - Betesda Fontes (PWA)
   - Cache de app shell (HTML, CSS, JS, ícones, imagens)
   - Funcionamento offline
   - Atualização automática de cache em nova versão
   - Cache do app shell; os dados são sincronizados via Firebase/Firestore
   ============================================================ */

// Suba este número a cada deploy para forçar atualização do cache.
const CACHE_VERSION = 'v6-dashboard-perfis';
const CACHE_NAME = `betesda-fontes-${CACHE_VERSION}`;

// Arquivos do "app shell" - essenciais para o app abrir offline.
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json',
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

// Bibliotecas externas (CDN) usadas pelo app - cacheadas em runtime (ver fetch handler),
// listadas aqui só como referência do que é esperado carregar:
// - Tailwind CDN, Google Fonts (DM Sans), Lucide Icons

/* ---------------- INSTALL ---------------- */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()) // ativa a nova versão assim que possível
  );
});

/* ---------------- ACTIVATE ---------------- */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('betesda-fontes-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key)) // limpa versões antigas de cache
      ))
      .then(() => self.clients.claim())
  );
});

/* ---------------- FETCH ----------------
   Estratégia:
   - Navegação (HTML): network-first, cai pro cache se offline (garante conteúdo mais novo quando online).
   - Estáticos do app shell (css/js/ícones/imagens locais): cache-first (mais rápido).
   - CDNs externas (tailwind/fonts/lucide): stale-while-revalidate (usa cache e atualiza em segundo plano).
   IMPORTANTE: nunca intercepta chamadas que não sejam GET; isso não bloqueia gravações no Firestore.
------------------------------------------- */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isNavigation = req.mode === 'navigate';

  if (isNavigation) {
    event.respondWith(networkFirst(req));
    return;
  }

  if (isSameOrigin) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // CDNs externas (fonts.googleapis.com, cdn.tailwindcss.com, cdn.jsdelivr.net, etc.)
  event.respondWith(staleWhileRevalidate(req));
});

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

async function networkFirst(req) {
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, fresh.clone());
    }
    return fresh;
  } catch (err) {
    const cached = await caches.match(req);
    return cached || caches.match('./index.html');
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

/* ---------------- MENSAGENS ----------------
   Permite que a página peça para o SW novo assumir imediatamente
   (usado no fluxo de "nova versão disponível" no script.js).
------------------------------------------- */
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/* ============================================================
   PRONTO PARA O FUTURO (não ativado agora, só a estrutura-base):
   - Push Notifications: adicionar listener 'push' e 'notificationclick'.
   - Background Sync: adicionar listener 'sync' com tag própria.
   - IndexedDB: pode ser usado em paralelo ao localStorage sem conflito.
   ============================================================ */
self.addEventListener('push', (event) => {
  // Reservado para notificações push futuras.
  // Exemplo de uso futuro:
  // const data = event.data ? event.data.json() : {};
  // event.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: './icons/icon-192.png' }));
});

self.addEventListener('sync', (event) => {
  // Reservado para sincronização em segundo plano futura.
  // if (event.tag === 'sync-dados') { event.waitUntil(/* lógica de sync */); }
});
