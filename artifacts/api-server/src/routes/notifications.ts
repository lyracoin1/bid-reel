/**
 * Notification routes — all require authentication.
 *
 * GET  /api/notifications          — list current user's notifications (newest first)
 * POST /api/notifications/read-all — mark all as read
 * POST /api/notifications/:id/read — mark one as read
 */

import { Router } from "express";
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
    res.status(500).json({ error: "FETCH_FAILED", message: error.message });
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
    res.status(500).json({ error: "UPDATE_FAILED", message: error.message });
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
    res.status(500).json({ error: "UPDATE_FAILED", message: error.message });
    return;
  }

  res.json({ success: true });
});

export default router;
