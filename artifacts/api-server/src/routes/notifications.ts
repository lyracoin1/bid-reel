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

const router = Router();

router.use(requireAuth);

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
