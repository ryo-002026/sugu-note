
const CACHE = 'sugu-shell-v2';

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key =>
            key.startsWith('sugu-shell-') && key !== CACHE
          )
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 画面の読み込みはオンライン時に最新版を優先する。
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache =>
            cache.put('./index.html',copy)
          );
        }
        return response;
      }).catch(async () => {
        return (await caches.match('./index.html')) ||
               Response.error();
      })
    );
    return;
  }

  // アイコンなどはキャッシュを優先する。
  event.respondWith(
    caches.match(request).then(cached =>
      cached || fetch(request)
    )
  );
});
