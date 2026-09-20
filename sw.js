/* Service worker — deixa a calculadora funcionar offline. */
const CACHE = 'pertcpm-v6';
const ARQUIVOS = ['./', './index.html', './app.js', './manifest.json', './fontes/fontes.css'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // O contador nunca entra no cache: precisa bater no servidor toda vez.
  if (new URL(e.request.url).pathname.startsWith('/api/')) return;
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(resp => {
      if (resp && resp.status === 200 && new URL(e.request.url).origin === location.origin) {
        const copia = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, copia));
      }
      return resp;
    }).catch(() => hit))
  );
});
