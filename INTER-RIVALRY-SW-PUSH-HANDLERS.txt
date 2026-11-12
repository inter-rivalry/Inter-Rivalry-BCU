INTER RIVALRY — SERVICE WORKER PUSH HANDLERS

IMPORTANT: Do NOT replace your existing sw.js with this snippet. Your current sw.js also manages PWA caching/offline behaviour. Merge these event handlers into the existing sw.js at its top level, outside any other event listener.

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (_) { data = { body: event.data ? event.data.text() : 'You have a new update.' }; }

  const title = data.title || 'INTER RIVALRY';
  const options = {
    body: data.body || 'You have a new update.',
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: data.tag || 'inter-rivalry-notification',
    renotify: true,
    data: { url: data.url || './' },
    silent: !!data.silent,
    vibrate: Array.isArray(data.vibrate) ? data.vibrate : []
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const win of windows) {
      if ('focus' in win) {
        await win.focus();
        if ('navigate' in win) await win.navigate(target);
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});

// End of push handlers. Keep your existing install, activate, fetch and cache handlers.
