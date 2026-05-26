const CACHE_NAME = 'aca-fis-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/dashboard.html',
  '/report.html',
  '/reports.html',
  '/analytics.html',
  '/style.css',
  '/firebase.js',
  '/app.js',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('firestore') || event.request.url.includes('googleapis')) return;
  event.respondWith(
    fetch(event.request).then(response => {
      const clone = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
      return response;
    }).catch(() => caches.match(event.request))
  );
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-reports') {
    event.waitUntil(self.clients.matchAll({ type: 'window' }).then(clients => clients.forEach(client => client.postMessage({ action: 'syncPendingReports' }))));
  }
});