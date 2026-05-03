/**
 * Firebase Cloud Messaging Service Worker
 *
 * Handles background push notifications when the app tab is not focused.
 * The Firebase config is passed from the main thread via postMessage to avoid
 * hardcoding credentials in a public file.
 */

importScripts("https://www.gstatic.com/firebasejs/12.0.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.0.0/firebase-messaging-compat.js");

let messagingReady = false;

// ── Deep-link resolver (mirrors use-fcm-token.ts / resolveDeepLinkRoute) ────

const DEAL_TYPES = new Set([
  "payment_proof_uploaded",
  "shipment_proof_uploaded",
  "buyer_delivery_proof_uploaded",
  "buyer_confirmed_receipt",
  "shipping_fee_dispute_created",
  "seller_penalty_applied",
  "buyer_conditions_submitted",
  "seller_conditions_submitted",
  "deal_rated",
  "receipt_uploaded",
  "escrow_released",
  "escrow_disputed",
  "escrow_released_with_fee",
  "product_media_uploaded",
  "external_payment_warning",
]);

function resolveRoute(data) {
  if (!data) return "/feed";
  const type      = data.type ?? "";
  const dealId    = data.dealId ?? data.deal_id ?? "";
  const auctionId = data.auctionId ?? "";
  const actorId   = data.actorId ?? "";

  if (DEAL_TYPES.has(type)) {
    return dealId ? `/secure-deals/pay/${dealId}` : "/deals";
  }
  if (auctionId) {
    return `/auction/${auctionId}`;
  }
  if ((type === "followed_you" || type === "new_follower") && actorId) {
    return `/users/${actorId}`;
  }
  if (actorId && !type) {
    return `/users/${actorId}`;
  }
  return "/feed";
}

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
      const body  = payload.notification?.body ?? "You have a new notification";
      const data  = payload.data ?? {};
      const route = resolveRoute(data);

      // Use type + dealId/auctionId as tag so multiple notifications of the
      // same type on the same deal collapse in the system tray.
      const tag = data.dealId
        ? `deal-${data.dealId}-${data.type ?? "notif"}`
        : data.auctionId
          ? `auction-${data.auctionId}`
          : "bidreel";

      self.registration.showNotification(title, {
        body,
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        tag,
        requireInteraction: true,
        data: { url: route },
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
      // If the app is already open on that route, just focus it
      for (const client of windowClients) {
        if (client.url.includes(url) && "focus" in client) {
          return client.focus();
        }
      }
      // Otherwise open (or re-open) the app at the target route
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    }),
  );
});
