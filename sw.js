const CACHE_V = 'cacusa-store-v1';

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_V)
      .then(c => c.addAll(['/ui_kits/store/']))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_V).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Skip Firebase, Cloudflare Worker, Square
  if (url.hostname.includes('firebase') || url.hostname.includes('workers.dev') ||
      url.hostname.includes('square') || url.hostname.includes('squareup')) return;

  // Navigation: network-first, fallback a caché
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(r => {
          // Clonar ANTES de devolver r — si se clona dentro del .then() de
          // caches.open() (async), el navegador ya puede haber empezado a leer
          // el body de r para pintar la página, y clonar un body ya consumido
          // revienta con "Response body is already used".
          const copy = r.clone();
          caches.open(CACHE_V).then(c => c.put(e.request, copy));
          return r;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Imágenes de la tienda: cache-first
  if (url.pathname.startsWith('/ui_kits/store/images/')) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(r => {
          const copy = r.clone();
          caches.open(CACHE_V).then(c => c.put(e.request, copy));
          return r;
        });
      })
    );
    return;
  }

  // Google Fonts: stale-while-revalidate
  if (url.hostname.includes('googleapis.com') || url.hostname.includes('gstatic.com')) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        const network = fetch(e.request).then(r => {
          const copy = r.clone();
          caches.open(CACHE_V).then(c => c.put(e.request, copy));
          return r;
        });
        return cached || network;
      })
    );
  }
});
