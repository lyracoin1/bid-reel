/**
 * FCM service — Firebase Cloud Messaging via Admin SDK.
 *
 * Initialised lazily: if FIREBASE_SERVICE_ACCOUNT_JSON is not set the module
 * logs a one-time warning and all send* functions become no-ops.  This keeps
 * the server running in environments where Firebase is not yet configured.
 */

import { logger } from "./logger";

type App = import("firebase-admin/app").App;
type Messaging = import("firebase-admin/messaging").Messaging;

let adminApp: App | null = null;
let messaging: Messaging | null = null;
let initialised = false;
let initError: string | null = null;
let initProjectId: string | null = null;
let initClientEmail: string | null = null;

/**
 * Public init-status accessor for the diagnostics endpoint. Never throws.
 * Triggers a lazy init so the first caller (usually `/notifications/_diag`)
 * also flushes the warning to the logs if env is missing or malformed.
 */
export async function getFcmStatus(): Promise<{
  initialised: boolean;
  hasEnv: boolean;
  projectId: string | null;
  clientEmail: string | null;
  error: string | null;
}> {
  await getMessaging();
  return {
    initialised: messaging !== null,
    hasEnv: Boolean(process.env["FIREBASE_SERVICE_ACCOUNT_JSON"]),
    projectId: initProjectId,
    clientEmail: initClientEmail,
    error: initError,
  };
}

async function getMessaging(): Promise<Messaging | null> {
  if (initialised) return messaging;
  initialised = true;

  const raw = process.env["FIREBASE_SERVICE_ACCOUNT_JSON"];
  if (!raw) {
    initError = "FIREBASE_SERVICE_ACCOUNT_JSON env var is not set";
    logger.warn("FCM: FIREBASE_SERVICE_ACCOUNT_JSON not set — push notifications disabled");
    return null;
  }

  try {
    const { initializeApp, cert } = await import("firebase-admin/app");
    const { getMessaging: gm } = await import("firebase-admin/messaging");

    const serviceAccount = JSON.parse(raw);
    initProjectId = serviceAccount.project_id ?? null;
    initClientEmail = serviceAccount.client_email ?? null;
    adminApp = initializeApp({ credential: cert(serviceAccount) }, "bidreel-fcm");
    messaging = gm(adminApp);
    logger.info({ projectId: initProjectId }, "FCM: Firebase Admin SDK initialised");
  } catch (err) {
    initError = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "FCM: failed to initialise Firebase Admin SDK");
  }

  return messaging;
}

export interface FcmPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

/**
 * Send a push notification to a single device token.
 * Non-throwing — errors are logged and swallowed.
 */
export async function sendFcmPush(token: string, payload: FcmPayload): Promise<void> {
  const m = await getMessaging();
  if (!m) return;

  const tokenPrefix = token.slice(0, 24) + "…";
  logger.info({ tokenPrefix, title: payload.title, dataKeys: Object.keys(payload.data ?? {}) }, "push-chain[8]: sendFcmPush START");
  try {
    const messageId = await m.send({
      token,
      // Top-level notification shown on all platforms (Android, iOS, web)
      notification: { title: payload.title, body: payload.body },
      // Arbitrary key/value pairs forwarded to the app for deep-link navigation.
      // All values must be strings (FCM requirement).
      data: payload.data,
      // Android-specific overrides.
      //
      // IMPORTANT — fields removed because they were silently dropping pushes:
      //   • icon: "ic_launcher"  — `ic_launcher` is a MIPMAP, not a drawable.
      //     FCM looks up the icon as `R.drawable.<name>`. When that fails,
      //     some Samsung / Xiaomi / OnePlus ROMs DROP the notification
      //     instead of falling back. We now omit `icon` and rely on the
      //     manifest meta-data `default_notification_icon` (added in
      //     android/app/src/main/AndroidManifest.xml).
      //   • channelId left explicit so Android 8+ uses our defined channel
      //     instead of the auto-created `fcm_fallback_notification_channel`
      //     (which shows up to users as "Miscellaneous").
      android: {
        priority: "high",
        notification: {
          color: "#6d28d9",                        // BidReel violet status-bar tint
          channelId: "bidreel_default",            // matches manifest meta-data
          defaultSound: true,
          defaultVibrateTimings: true,
        },
      },
      // Web push (browser service worker) config — no-op on native Android
      webpush: {
        notification: {
          title: payload.title,
          body: payload.body,
          icon: "/icon-192.png",
          badge: "/icon-192.png",
          requireInteraction: true,
        },
        fcmOptions: {
          link: payload.data?.["auctionId"]
            ? `/auction/${payload.data["auctionId"]}`
            : "/feed",
        },
      },
    });
    logger.info({ tokenPrefix, messageId }, "push-chain[9.OK]: sendFcmPush SUCCESS");
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    const code = e.code ?? "";
    const message = e.message ?? String(err);
    logger.error(
      { tokenPrefix, code, message },
      "push-chain[9.ERR]: sendFcmPush FAILED",
    );
    if (code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token") {
      logger.warn({ tokenPrefix, code }, "FCM: stale token — should be pruned");
    }
  }
}

/**
 * Fan out a push notification to multiple device tokens (best-effort).
 * Invalid tokens are silently skipped.
 */
export async function sendFcmPushMulti(tokens: string[], payload: FcmPayload): Promise<void> {
  if (!tokens.length) return;
  await Promise.all(tokens.map(t => sendFcmPush(t, payload)));
}
