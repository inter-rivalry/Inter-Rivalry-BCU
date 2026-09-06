// INTER RIVALRY Service Worker

self.addEventListener("install", (event) => {
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
    let data = {};

    try {
        data = event.data ? event.data.json() : {};
    } catch (error) {
        data = {
            title: "INTER RIVALRY",
            body: event.data
                ? event.data.text()
                : "You have a new notification."
        };
    }

    const title = data.title || "INTER RIVALRY";

    const options = {
        body: data.body || "You have a new notification.",
        icon: data.icon || "./icon-192.png",
        badge: data.badge || "./icon-192.png",
        data: data.data || {},
        tag: data.tag || "inter-rivalry-notification",
        renotify: true
    };

    event.waitUntil(
        self.registration.showNotification(title, options)
    );
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();

    const targetUrl =
        event.notification.data?.url ||
        "./index.html";

    event.waitUntil(
        self.clients.matchAll({
            type: "window",
            includeUncontrolled: true
        }).then((clientList) => {

            for (const client of clientList) {
                if ("focus" in client) {
                    client.navigate(targetUrl);
                    return client.focus();
                }
            }

            if (self.clients.openWindow) {
                return self.clients.openWindow(targetUrl);
            }
        })
    );
});
