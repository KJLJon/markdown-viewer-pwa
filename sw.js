/* =============================================================
   Markdown Viewer PWA — Service Worker
   ============================================================= */

const CACHE_NAME = 'md-viewer-v2';

const PRECACHE = [
  '/markdown-viewer-pwa/',
  '/markdown-viewer-pwa/index.html',
  '/markdown-viewer-pwa/app.js',
  '/markdown-viewer-pwa/style.css',
  '/markdown-viewer-pwa/manifest.json',
  '/markdown-viewer-pwa/icons/icon-192.png',
  '/markdown-viewer-pwa/icons/icon-512.png',
  'https://cdn.jsdelivr.net/npm/marked@12/marked.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css',
];

// ── Install: pre-cache app shell ───────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: remove old caches ────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch ───────────────────────────────────────────────────────
// Same-origin assets: network-first (fresh when online, cached offline)
// CDN assets:         cache-first  (version-pinned URLs, safe to cache forever)
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (!url.protocol.startsWith('http')) return;

  const isSameOrigin = url.origin === self.location.origin;
  const isCDN = url.hostname === 'cdn.jsdelivr.net' ||
                url.hostname === 'cdnjs.cloudflare.com';

  if (isCDN) {
    // Cache-first: CDN URLs are versioned, no need to re-fetch
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  if (isSameOrigin) {
    // Network-first: always try to get a fresh copy, fall back to cache offline
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          return caches.match(event.request).then(cached => {
            if (cached) return cached;
            // Last-resort offline fallback for navigation
            if (event.request.mode === 'navigate') {
              return caches.match('/markdown-viewer-pwa/index.html');
            }
          });
        })
    );
  }
});
