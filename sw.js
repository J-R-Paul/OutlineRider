// sw.js

// Increment version number when assets change
const CACHE_NAME = 'outlinerider-cache-v2';
const urlsToCache = [
  '.', // Alias for index.html
  'index.html',
  'style.css',
  // Add refactored JS files
  'app.js',
  'js/utils.js',
  'js/state.js',
  'js/ui.js',
  'js/latex.js',
  'js/editor.js',
  'js/fileSystem.js',
  'js/keyboard.js',
  'js/mobile.js',
  // Keep worker and manifest
  'worker.js',
  'manifest.json',
   // Add paths to your icons (assuming they are in the root)
   'icon-192.png',
   'icon-512.png',
   // Optional: KaTeX files for full offline LaTeX
   // 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css',
   // 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js',
   // Add fonts if KaTeX needs them offline (can be many files)
   // 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/KaTeX_Main-Regular.woff2',
   // ... etc ...

   // Optional: Add a basic offline fallback page
   // 'offline.html'
];

// Install event: Cache core assets
self.addEventListener('install', event => {
  console.log('[SW] Install event v2');
  // Ensure the SW takes control immediately if possible (good for updates)
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Opened cache:', CACHE_NAME);
        // Use addAll - if one fails, the whole operation fails
        return cache.addAll(urlsToCache).catch(error => {
            console.error('[SW] Failed to cache one or more URLs during install:', error);
            // Rethrow to make the installation fail if core assets can't be cached
            // throw error;
        });
      })
      .catch(error => {
          console.error('[SW] Cache open/addAll failed during install:', error);
      })
  );
});

// Activate event: Clean up old caches
self.addEventListener('activate', event => {
  console.log('[SW] Activate event v2');
  const cacheWhitelist = [CACHE_NAME]; // Only keep the current version
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
    }).then(() => {
        // Ensure the activated SW takes control of the page immediately
        console.log('[SW] Claiming clients');
        return self.clients.claim();
    })
  );
});

// Fetch event: Serve from cache, fallback to network (Cache First strategy)
self.addEventListener('fetch', event => {
  // Skip caching for non-GET requests or Chrome extensions
   if (event.request.method !== 'GET' || event.request.url.startsWith('chrome-extension://')) {
    // console.log('[SW] Skipping fetch event for non-GET or extension request:', event.request.url);
    return;
  }

  // Special handling for KaTeX CDN files if caching them
  const isKaTeXRequest = event.request.url.startsWith('https://cdn.jsdelivr.net/npm/katex');

  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        // Cache hit - return response
        if (cachedResponse) {
          // console.log('[SW] Serving from cache:', event.request.url);
          return cachedResponse;
        }

        // Not in cache - fetch from network
        // console.log('[SW] Fetching from network:', event.request.url);
        return fetch(event.request).then(
          (networkResponse) => {
            // Check if we received a valid response
            if(!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
               // Don't cache opaque responses (e.g., from cross-origin requests without CORS)
               // Don't cache errors
                if (!isKaTeXRequest && networkResponse.type !== 'opaque') { // Allow opaque for CDN potentially
                    console.warn('[SW] Not caching invalid network response:', event.request.url, networkResponse.status, networkResponse.type);
                }
               return networkResponse;
            }

            // Optional: Cache the new resource dynamically ONLY if it was in the original list or is KaTeX
            // Avoid caching everything fetched dynamically to prevent cache bloat.
            const shouldCacheDynamically = urlsToCache.includes(event.request.url) || isKaTeXRequest;

            if (shouldCacheDynamically) {
                 const responseToCache = networkResponse.clone();
                 caches.open(CACHE_NAME)
                   .then(cache => {
                     // console.log('[SW] Caching new resource dynamically:', event.request.url);
                     cache.put(event.request, responseToCache);
                   });
            }

            return networkResponse;
          }
        ).catch(error => {
           console.warn('[SW] Network fetch failed; returning offline page or error.', error, event.request.url);
           // Optional: Return offline fallback page
           // return caches.match('offline.html');
           // Or return a generic error response
           return new Response('Network error occurred', {
               status: 408, // Request Timeout
               headers: { 'Content-Type': 'text/plain' }
           });
        });
      })
    );
});