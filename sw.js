const CACHE_NAME = 'Control-de-Compras-v1';
 
// Archivos que se cachean para funcionar offline
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  '/manifest.json'
];
 
// Instalación: cachear archivos estáticos
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});
 
// Activación: borrar caches viejos
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});
 
// Fetch: primero red, fallback a cache (para que Supabase siempre vaya a la red)
self.addEventListener('fetch', e => {
  // Supabase y fuentes externas: siempre red, sin cache
  if (e.request.url.includes('supabase.co') ||
      e.request.url.includes('fonts.googleapis') ||
      e.request.url.includes('fonts.gstatic') ||
      e.request.url.includes('cdn.jsdelivr')) {
    e.respondWith(fetch(e.request).catch(() => new Response('', { status: 503 })));
    return;
  }
 
  // Archivos propios: cache first, red como fallback
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        // Guardar en cache si es una respuesta válida
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return response;
      });
    })
  );
});