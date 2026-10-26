/* =========================================================
   RIVALS 2050 — SERVICE WORKER
   Network-first for same-origin GETs.
   Falls back to cache when offline.
   Cache version bump drops stale caches on activate.
   ========================================================= */

const CACHE = 'rivals-v102';

const ASSETS = [
  './index.html',
  './style.css',
  './game.js',
  './net.js',
  './audio.js',
  './manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .catch(err => {
        // Do not fail install if one asset is missing (e.g. manifest.json
        // not yet added). Just log and continue.
        console.warn('[SW] Precache partial failure:', err);
      })
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Never intercept Supabase, CDN (Three.js, jsdelivr), fonts, etc.
  if (url.origin !== location.origin) return;

  // Only intercept GETs. POST/PUT/etc. go straight to network.
  if (e.request.method !== 'GET') return;

  // Network-first: always try fresh from GitHub Pages,
  // cache a copy on success, fall back to cache on failure.
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
