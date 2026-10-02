/**
 * macOS Web Dashboard - Service Worker (v4)
 * Provides offline caching and fast performance
 */

const CACHE_NAME = 'macos-dashboard-v21';
const STATIC_ASSETS = [
  './',
  './index.html',
  './assets/css/dashboard.css',
  './assets/js/db-config.js',
  './assets/js/db-storage.js',
  './assets/js/dashboard.js',
  './manifest.json',
  './apps/chia-bill/index.html',
  './apps/tien-com/index.html',
  './apps/lai-suat/index.html',
  './apps/ghi-chu/index.html',
  './apps/control-panel/index.html',
  './apps/danh-ba/index.html'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('Some assets could not be cached immediately:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  // Supabase REST API requests should always go straight to network
  if (event.request.url.includes('supabase.co')) {
    return;
  }

  // Network-first for HTML and scripts to always get freshest version
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
        }
        return networkResponse;
      })
      .catch(() => {
        // Fallback to cache if offline
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
      })
  );
});
