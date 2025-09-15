// service-worker.js
// Basic service worker for caching static assets and providing offline shell
const CACHE_NAME = 'myrocket-cache-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.json'
];

self.addEventListener('install', (e)=>{
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e)=>{
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e)=>{
  // Network first for API calls (firebase), cache-first for assets
  const url = new URL(e.request.url);
  if (url.origin === location.origin && ASSETS.includes(url.pathname)) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
  } else {
    // fallback to network, but provide offline fallback for navigation
    if (e.request.mode === 'navigate') {
      e.respondWith(fetch(e.request).catch(()=> caches.match('/index.html')));
    } else {
      e.respondWith(fetch(e.request).catch(()=> caches.match(e.request)));
    }
  }
});
