const CACHE = "inter-rivalry-v7-3-logo-v1";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(k => Promise.all(
        k.filter(x => x !== CACHE).map(x => caches.delete(x))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);

  if (u.origin !== self.location.origin) return;

  e.respondWith(
    caches.match(e.request).then(c => {
      return c || fetch(e.request).then(r => {
        if (r.ok && e.request.method === "GET") {
          const q = r.clone();
          caches.open(CACHE).then(x => x.put(e.request, q));
        }
        return r;
      });
    })
  );
});

self.addEventListener("push", e => {
  let d = {};

  try {
    d = e.data ? e.data.json() : {};
  } catch (_) {}

  e.waitUntil(
    self.registration.showNotification(d.title || "INTER RIVALRY", {
      body: d.body || "New notification",
      icon: "./icons/icon-192.png",
      badge: "./icons/icon-192.png",
      data: d.url || "./"
    })
  );
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data || "./"));
});
