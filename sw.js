const CACHE_NAME = 'fitmetdicky-20260414a';
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'manifest.webmanifest?v=20260414a',
  'styles/fmd-app.css?v=20260414a',
  'styles/fmd-polish.css?v=20260413k',
  'js/app.js?v=20260414c',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
  'vendor/supabase-js.js?v=20260413a'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if(request.method !== 'GET') return;

  if(request.mode === 'navigate'){
    event.respondWith(
      fetch(request).then(response => response.ok ? response : caches.match('index.html'))
        .catch(() => caches.match('index.html'))
    );
    return;
  }

  event.respondWith(
    fetch(request).then(response => {
      if(response.ok){
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
      }
      return response;
    }).catch(() => caches.match(request))
  );
});