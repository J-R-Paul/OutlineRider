// sw.js - Basic Service Worker for PWA installation

const CACHE_NAME = 'bike-editor-pro-cache-v1';
const URLS_TO_CACHE = [
  '/', // Cache the root HTML
  'index.html',
  'style.css',
  'script.js',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png'
  // Add other essential assets if needed
];

// Install event: Cache core assets
self.addEventListener('install', event => {
  console.log('SW: Install event');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('SW: Caching app shell');
        return cache.addAll(URLS_TO_CACHE);
      })
      .then(() => self.skipWaiting()) // Activate worker immediately
      .catch(error => {
        console.error('SW: Failed to cache app shell:', error);
      })
  );
});

// Activate event: Clean up old caches
self.addEventListener('activate', event => {
  console.log('SW: Activate event');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('SW: Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim()) // Take control of open clients immediately
  );
});

// Fetch event: Serve cached assets first (Cache-First strategy)
self.addEventListener('fetch', event => {
  // console.log('SW: Fetch event for', event.request.url);
  // Use a cache-first strategy for app shell assets
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          // console.log('SW: Serving from cache:', event.request.url);
          return response; // Serve from cache
        }
        // console.log('SW: Fetching from network:', event.request.url);
        return fetch(event.request); // Fetch from network if not in cache
      })
      .catch(error => {
         // Optional: Fallback page for offline?
         console.error('SW: Fetch failed:', error);
         // For now, just let the browser handle the fetch failure
      })
  );
});