/**
 * Notification routes — all require authentication.
 *
 * GET  /api/notifications                      — list current user's notifications
 * POST /api/notifications/read-all             — mark all as read
 * POST /api/notifications/:id/read             — mark one as read
 * POST /api/notifications/register-device      — register FCM device token
 * DELETE /api/notifications/unregister-device  — remove FCM device token
 */

import { Router } from "express";
import { z } from "zod";
import { supabaseAdmin } from "../lib/supabase";
import { requireAuth } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { getFcmStatus, sendFcmPush } from "../lib/fcm";

const router = Router();

router.use(requireAuth);

// ─── GET /api/notifications/_diag ────────────────────────────────────────────
// End-to-end push pipeline diagnostic. Returns the exact state of every
// stage so the client can see WHICH stage is failing without device logs.
//
//   • fcm.hasEnv          → is FIREBASE_SERVICE_ACCOUNT_JSON set on the host?
//   • fcm.initialised     → did the Admin SDK actually init (JSON parsed, cert valid)?
//   • fcm.projectId       → MUST equal the project_id in google-services.json
//                           (currently "bidreel-android"). Mismatch = no delivery.
//   • fcm.error           → init error message if init failed
//   • devices.count       → how many tokens this user has registered
//   • devices.tokens[]    → first 24 chars of each token + platform + age
//
// Auth-gated. Safe to expose — no secrets, only token prefixes.

router.get("/notifications/_diag", async (req, res) => {
  const userId = req.user!.id;
  const fcm = await getFcmStatus();

  const { data, error } = await supabaseAdmin
    .from("user_devices")
    .select("token, platform, last_seen_at")
    .eq("user_id", userId)
    .order("last_seen_at", { ascending: false });

  res.json({
    userId,
    fcm,
    devices: {
      count: data?.length ?? 0,
      tokens: (data ?? []).map(d => ({
        tokenPrefix: d.token.slice(0, 24) + "…",
        platform: d.platform,
        lastSeenAt: d.last_seen_at,
      })),
      error: error?.message ?? null,
    },
    expectedProjectId: "bidreel-android",
    projectIdMatches: fcm.projectId === "bidreel-android",
  });
});

// ─── POST /api/notifications/_test-push ──────────────────────────────────────
// Send a real test push to every device registered for the calling user.
// Returns per-token result so we can see exactly which devices receive
// (or which FCM error each token fails with).
//
// Use after _diag confirms FCM is initialised and at least one device is
// registered. If the device gets the push, the entire pipeline works and
// the bug is in event wiring (Stage 4). If FCM returns an error per token,
// the error code tells us why (mismatched project, stale token, etc).

router.post("/notifications/_test-push", async (req, res) => {
  const userId = req.user!.id;
  const fcm = await getFcmStatus();

  if (!fcm.initialised) {
    res.status(503).json({
      error: "FCM_NOT_INITIALISED",
      fcm,
      hint: fcm.hasEnv
        ? "Service account JSON is present but failed to parse — check FIREBASE_SERVICE_ACCOUNT_JSON value."
        : "Set FIREBASE_SERVICE_ACCOUNT_JSON in your Vercel env (Production + Preview), then redeploy.",
    });
    return;
  }

  const { data: devices } = await supabaseAdmin
    .from("user_devices")
    .select("token, platform")
    .eq("user_id", userId);

  if (!devices || devices.length === 0) {
    res.status(404).json({
      error: "NO_DEVICES",
      hint: "Open the app on a device, sign in, grant notification permission. Then call _diag — devices.count should be ≥ 1.",
    });
    return;
  }

  // We instrument sendFcmPush by calling firebase-admin directly so we get
  // the real per-token result (sendFcmPush swallows errors by design).
  const { initializeApp: _, getApp } = await import("firebase-admin/app");
  const { getMessaging: gm } = await import("firebase-admin/messaging");
  const messaging = gm(getApp("bidreel-fcm"));

  const results = await Promise.all(
    devices.map(async d => {
      try {
        const messageId = await messaging.send({
          token: d.token,
          notification: { title: "BidReel test 🚀", body: "If you see this in your shade, the pipeline works." },
          data: { type: "test_push", source: "diag" },
          android: {
            priority: "high",
            notification: {
              color: "#6d28d9",
              channelId: "bidreel_default",
              defaultSound: true,
              defaultVibrateTimings: true,
            },
          },
        });
        return { tokenPrefix: d.token.slice(0, 24) + "…", platform: d.platform, ok: true, messageId };
      } catch (err) {
        const e = err as { code?: string; message?: string };
        return {
          tokenPrefix: d.token.slice(0, 24) + "…",
          platform: d.platform,
          ok: false,
          code: e.code ?? null,
          message: e.message ?? String(err),
        };
      }
    }),
  );

  // Use sendFcmPush to also exercise the production code path (logs only).
  void sendFcmPush(devices[0]!.token, {
    title: "BidReel test (prod path)",
    body: "Sent via sendFcmPush — check API server logs for the result.",
    data: { type: "test_push", source: "diag-prod-path" },
  });

  logger.info({ userId, deviceCount: devices.length, ok: results.filter(r => r.ok).length }, "FCM: test push completed");

  res.json({ userId, attemptedDevices: devices.length, results });
});

// ─── GET /api/notifications ───────────────────────────────────────────────────

router.get("/notifications", async (req, res) => {
  const userId = req.user!.id;

  const { data, error } = await supabaseAdmin
    .from("notifications")
    .select("id, type, message, auction_id, read, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    logger.error({ err: error }, "GET /notifications failed");
    res.status(500).json({ error: "FETCH_FAILED", message: "Could not load notifications. Please try again." });
    return;
  }

  const unreadCount = (data ?? []).filter(n => !n.read).length;

  res.json({
    notifications: data ?? [],
    unreadCount,
  });
});

// ─── POST /api/notifications/read-all ────────────────────────────────────────

router.post("/notifications/read-all", async (req, res) => {
  const userId = req.user!.id;

  const { error } = await supabaseAdmin
    .from("notifications")
    .update({ read: true })
    .eq("user_id", userId)
    .eq("read", false);

  if (error) {
    logger.error({ err: error }, "POST /notifications/read-all failed");
    res.status(500).json({ error: "UPDATE_FAILED", message: "Could not mark notifications as read." });
    return;
  }

  res.json({ success: true });
});

// ─── POST /api/notifications/:id/read ────────────────────────────────────────

router.post("/notifications/:id/read", async (req, res) => {
  const userId = req.user!.id;
  const { id } = req.params;

  const { error } = await supabaseAdmin
    .from("notifications")
    .update({ read: true })
    .eq("id", id)
    .eq("user_id", userId);

  if (error) {
    logger.error({ err: error }, "POST /notifications/:id/read failed");
    res.status(500).json({ error: "UPDATE_FAILED", message: "Could not mark notification as read." });
    return;
  }

  res.json({ success: true });
});

// ─── POST /api/notifications/register-device ─────────────────────────────────
// Upsert an FCM device token for the authenticated user.
// Safe to call on every app launch — subsequent calls with the same token
// are no-ops (ON CONFLICT DO NOTHING via upsert).

const registerDeviceSchema = z.object({
  token: z.string().min(10, "token is required"),
  platform: z.enum(["web", "ios", "android"]).default("web"),
});

router.post("/notifications/register-device", async (req, res) => {
  const userId = req.user!.id;

  const parsed = registerDeviceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: parsed.error.issues[0]?.message ?? "Invalid body",
    });
    return;
  }

  const { token, platform } = parsed.data;

  const { error } = await supabaseAdmin.from("user_devices").upsert(
    { user_id: userId, token, platform, last_seen_at: new Date().toISOString() },
    { onConflict: "user_id,token", ignoreDuplicates: false }
  );

  if (error) {
    if ((error as { code?: string }).code === "42P01") {
      logger.warn(
        { userId },
        "POST /notifications/register-device: user_devices table not created yet — run migration 007"
      );
      res.status(503).json({
        error: "TABLE_NOT_READY",
        message: "Device registration table not yet created. Apply migration 007.",
      });
      return;
    }
    logger.error({ err: error }, "POST /notifications/register-device failed");
    res.status(500).json({ error: "UPSERT_FAILED", message: "Could not register device." });
    return;
  }

  logger.debug({ userId, platform }, "FCM device token registered");
  res.json({ success: true });
});

// ─── DELETE /api/notifications/unregister-device ─────────────────────────────
// Remove a specific device token (e.g. on logout or permission revocation).

const unregisterDeviceSchema = z.object({
  token: z.string().min(10, "token is required"),
});

router.delete("/notifications/unregister-device", async (req, res) => {
  const userId = req.user!.id;

  const parsed = unregisterDeviceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: parsed.error.issues[0]?.message ?? "Invalid body",
    });
    return;
  }

  const { token } = parsed.data;

  const { error } = await supabaseAdmin
    .from("user_devices")
    .delete()
    .eq("user_id", userId)
    .eq("token", token);

  if (error) {
    logger.error({ err: error }, "DELETE /notifications/unregister-device failed");
    res.status(500).json({ error: "DELETE_FAILED", message: "Could not unregister device." });
    return;
  }

  logger.debug({ userId }, "FCM device token unregistered");
  res.json({ success: true });
});

export default router;
