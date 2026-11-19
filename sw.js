/* Only cache this app's static shell. Captures remain exclusively in IndexedDB. */
const CACHE = 'miui-simple-shell-direct-delete-27';
const SHELL = ['./', './index.html', './style.css?v=layout-18', './storage.js?v=audio-24', './looks.js?v=cinema-looks-12', './ranges.js?v=focus-26', './cinema.js?v=audio-24', './cinema.css?v=layout-18', './script.js?v=direct-delete-27', './fullscreen.js?v=fullscreen-21', './collection.js?v=layout-18', './collection.css?v=layout-18', './layout.js?v=focus-26', './layout.css?v=focus-26', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-192.png?v=app-icon-19', './icons/icon-512.png?v=app-icon-19', './icons/favicon-32.png?v=app-icon-19', './icons/app-icon.svg?v=app-icon-19', './icons/apple-touch-icon.png?v=app-icon-19', './vendor/fontawesome/css/fontawesome.min.css', './vendor/fontawesome/css/solid.min.css', './vendor/fontawesome/css/regular.min.css', './vendor/fontawesome/webfonts/fa-solid-900.woff2', './vendor/fontawesome/webfonts/fa-regular-400.woff2'];
const urls = new Set(SHELL.map((path) => new URL(path, self.registration.scope).href));
self.addEventListener('install', (event) => { event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL))); });
self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('miui-simple-shell-') && key !== CACHE).map((key) => caches.delete(key)))), self.clients.claim()]));
});
self.addEventListener('message', (event) => { if (event.data === 'ACTIVATE_UPDATE') self.skipWaiting(); });
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || !urls.has(request.url)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(request);
      if (!response.ok) throw new Error('Static resource unavailable');
      await cache.put(request, response.clone());
      return response;
    } catch {
      const cached = await cache.match(request);
      return cached || new Response('Abra o aplicativo uma vez com conexão para disponibilizá-lo offline.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});
