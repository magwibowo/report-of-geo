const CACHE_NAME = 'geo-report-v2';

// File inti yang perlu tersedia walau koneksi terputus
const CORE_ASSETS = [
  '/',
  '/style.css',
  '/app.js',
  '/manifest.json'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(CORE_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (key) { return key !== CACHE_NAME; })
            .map(function (key) { return caches.delete(key); })
      );
    })
  );
  self.clients.claim();
});

  // Untuk file statis (HTML, CSS, JS): coba jaringan dulu (supaya selalu versi terbaru),
  // dan baru pakai cache sebagai cadangan kalau sedang offline
  event.respondWith(
    fetch(event.request)
      .then(function (response) {
        var clone = response.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put(event.request, clone);
        });
        return response;
      })
      .catch(function () {
        return caches.match(event.request);
      })
  );