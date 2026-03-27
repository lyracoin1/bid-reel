/**
 * Admin routes — protected by ADMIN_SECRET header.
 *
 * POST /api/admin/cleanup-media
 *   Triggers an immediate media lifecycle cleanup run.
 *   Returns the CleanupResult JSON.
 *
 * GET  /api/admin/media-lifecycle-status
 *   Returns counts of auctions in each cleanup phase (useful for monitoring).
 */

import { Router } from "express";
import { runMediaCleanup } from "../lib/media-lifecycle";
import { supabaseAdmin } from "../lib/supabase";
import { logger } from "../lib/logger";

const adminRouter = Router();

// ─── Auth middleware ──────────────────────────────────────────────────────────

function requireAdminSecret(
  req: Parameters<Parameters<typeof adminRouter.use>[0]>[0],
  res: Parameters<Parameters<typeof adminRouter.use>[0]>[1],
  next: Parameters<Parameters<typeof adminRouter.use>[0]>[2],
) {
  const secret = process.env["ADMIN_SECRET"];
  if (!secret) {
    // No secret configured → deny all admin routes in production
    if (process.env["NODE_ENV"] === "production") {
      res.status(503).json({ error: "Admin routes are not configured" });
      return;
    }
    // In dev, allow without auth so it is easy to test
    next();
    return;
  }

  const provided = req.headers["x-admin-secret"] ?? req.query["secret"];
  if (provided !== secret) {
    res.status(401).json({ error: "Invalid admin secret" });
    return;
  }
  next();
}

adminRouter.use(requireAdminSecret);

// ─── POST /cleanup-media ──────────────────────────────────────────────────────

adminRouter.post("/cleanup-media", async (_req, res) => {
  logger.info("admin: manual media cleanup triggered");
  try {
    const result = await runMediaCleanup();
    res.json({
      success: true,
      ...result,
      // Make dates serializable
      ranAt: result.ranAt.toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "admin: media cleanup failed");
    res.status(500).json({ error: "Cleanup run failed", detail: String(err) });
  }
});

// ─── GET /media-lifecycle-status ─────────────────────────────────────────────

adminRouter.get("/media-lifecycle-status", async (_req, res) => {
  try {
    const now = new Date().toISOString();

    // Auctions that have ended (any state)
    const { count: ended } = await supabaseAdmin
      .from("auctions")
      .select("id", { count: "exact", head: true })
      .lte("ends_at", now)
      .is("deleted_at", null);

    // Videos still pending deletion (ended > 7 days ago, videos not yet cleaned)
    const videoThreshold = new Date();
    videoThreshold.setDate(videoThreshold.getDate() - 7);
    const { count: videoPending } = await supabaseAdmin
      .from("auctions")
      .select("id", { count: "exact", head: true })
      .lte("ends_at", videoThreshold.toISOString())
      .is("videos_deleted_at", null)
      .is("deleted_at", null);

    // Images still pending deletion (ended > 14 days ago, images not yet cleaned)
    const imageThreshold = new Date();
    imageThreshold.setDate(imageThreshold.getDate() - 14);
    const { count: imagePending } = await supabaseAdmin
      .from("auctions")
      .select("id", { count: "exact", head: true })
      .lte("ends_at", imageThreshold.toISOString())
      .is("images_deleted_at", null)
      .is("deleted_at", null);

    // Fully cleaned
    const { count: fullyCleaned } = await supabaseAdmin
      .from("auctions")
      .select("id", { count: "exact", head: true })
      .not("media_deleted_at", "is", null);

    res.json({
      totalEnded: ended ?? 0,
      videoPendingCleanup: videoPending ?? 0,
      imagePendingCleanup: imagePending ?? 0,
      fullyCleaned: fullyCleaned ?? 0,
      retentionPolicy: {
        videoDays: 7,
        imageDays: 14,
      },
    });
  } catch (err) {
    logger.error({ err }, "admin: media-lifecycle-status failed");
    res.status(500).json({ error: "Status check failed", detail: String(err) });
  }
});

export default adminRouter;
