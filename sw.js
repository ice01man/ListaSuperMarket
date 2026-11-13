// ================================================================
//  SERVICE WORKER — Mis Compras (PWA)
//  Regla clave: /api/* NUNCA se cachea (siempre va a la red), así los
//  datos de MongoDB llegan frescos. El resto (app shell) va network-first:
//  con conexión siempre trae la última versión publicada en Vercel y
//  actualiza la caché; sin conexión usa la copia guardada.
// ================================================================
const CACHE = 'miscompras-v3';   // con network-first ya no hace falta subirla en cada deploy
const APP_SHELL = [
  '/',
  '/index.html',
  '/style.css',
  '/stats.js',
  '/script.js',
  '/manifest.json',
  '/icons/icon-192.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // allSettled: si falta algún archivo, no aborta la instalación
    await Promise.allSettled(APP_SHELL.map(url => cache.add(url)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // 1) La API siempre a la red (nunca cache)
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // 2) Solo GET
  if (e.request.method !== 'GET') return;

  // 3) Network-first: siempre intenta traer la versión nueva
  e.respondWith((async () => {
    try {
      const resp = await fetch(e.request, { cache: 'no-cache' });
      if (resp && resp.ok && url.origin === self.location.origin) {
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      }
      return resp;
    } catch (err) {
      // Sin conexión: usar la copia guardada
      const cached = await caches.match(e.request);
      return cached || Response.error();
    }
  })());
});
