// sw.js

const CACHE_NAME = 'bike-editor-pro-cache-v1';
const urlsToCache = [
  '.', // Alias for index.html
  'index.html',
  'style.css',
  'script.js',
  'worker.js',
  'manifest.json',
   // Add paths to your icons here if you have them
   'icon-192.png',
   'icon-512.png',
   // Optional: Add a basic offline fallback page
   // 'offline.html'
];

// Install event: Cache core assets
self.addEventListener('install', event => {
  console.log('[SW] Install event');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Opened cache:', CACHE_NAME);
        return cache.addAll(urlsToCache).catch(error => {
            console.error('[SW] Failed to cache URLs:', error, urlsToCache);
        });
      })
  );
});

// Activate event: Clean up old caches
self.addEventListener('activate', event => {
  console.log('[SW] Activate event');
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Fetch event: Serve from cache, fallback to network
self.addEventListener('fetch', event => {
  // console.log('[SW] Fetch event for:', event.request.url);
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Cache hit - return response
        if (response) {
          // console.log('[SW] Serving from cache:', event.request.url);
          return response;
        }

        // Not in cache - fetch from network
        // console.log('[SW] Fetching from network:', event.request.url);
        return fetch(event.request).then(
          (networkResponse) => {
            // Optional: Cache the new resource dynamically (be careful with this)
            /* if(!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
              return networkResponse;
            }
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME)
              .then(cache => {
                cache.put(event.request, responseToCache);
              });
            */
            return networkResponse;
          }
        ).catch(error => {
           console.warn('[SW] Fetch failed; returning offline page if available.', error);
           // Optional: Return offline fallback page
           // return caches.match('offline.html');
        });
      })
    );
});