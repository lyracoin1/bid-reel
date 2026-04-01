/**
 * Firebase Cloud Messaging Service Worker
 *
 * Handles background push notifications when the app tab is not focused.
 * The Firebase config is passed from the main thread via postMessage to avoid
 * hardcoding credentials in a public file.
 */

importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js");

let messagingReady = false;

// Receive Firebase config from the main thread and initialise
self.addEventListener("message", (event) => {
  if (event.data?.type !== "FIREBASE_SW_CONFIG") return;
  if (messagingReady) return;

  const { config } = event.data;
  if (!config?.apiKey) return;

  try {
    if (!firebase.apps.length) {
      firebase.initializeApp(config);
    }

    const messaging = firebase.messaging();
    messagingReady = true;

    messaging.onBackgroundMessage((payload) => {
      const title = payload.notification?.title ?? "BidReel";
      const body = payload.notification?.body ?? "You have a new notification";
      const auctionId = payload.data?.auctionId;

      self.registration.showNotification(title, {
        body,
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        tag: auctionId ? `auction-${auctionId}` : "bidreel",
        requireInteraction: true,
        data: { url: auctionId ? `/auction/${auctionId}` : "/feed" },
      });
    });
  } catch (err) {
    console.error("[firebase-messaging-sw] init failed:", err);
  }
});

// Handle notification click — open / focus the relevant page
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/feed";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(url) && "focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    }),
  );
});
