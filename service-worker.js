const CACHE_NAME = 'outlinerider-cache-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  '/style.css',
  '/app.js',
  '/worker.js',
  '/offline.html',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/js/utils.js',
  '/js/state.js',
  '/js/ui.js',
  '/js/latex.js',
  '/js/editor.js',
  '/js/fileSystem.js',
  '/js/keyboard.js',
  '/js/mobile.js'
];

// Install service worker and cache the static assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Cache opened');
        return cache.addAll(urlsToCache);
      })
  );
});

// Serve cached content when offline
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Cache hit - return response
        if (response) {
          return response;
        }
        
        return fetch(event.request).then(
          response => {
            // Check if we received a valid response
            if(!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }

            // Clone the response
            let responseToCache = response.clone();

            caches.open(CACHE_NAME)
              .then(cache => {
                cache.put(event.request, responseToCache);
              });

            return response;
          }
        ).catch(() => {
          // If fetch fails (offline), show offline page
          if (event.request.mode === 'navigate') {
            return caches.match('/offline.html');
          }
        });
      })
  );
});

// Clean up old caches
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Add periodic cache updates for essential resources
setInterval(() => {
  if (navigator.onLine) {
    caches.open(CACHE_NAME).then(cache => {
      urlsToCache.forEach(url => {
        fetch(url)
          .then(response => {
            if (response.ok) {
              cache.put(url, response);
            }
          })
          .catch(error => console.log(`Failed to update cache for ${url}: ${error}`));
      });
    });
  }
}, 24 * 60 * 60 * 1000); // Update cache once per day
