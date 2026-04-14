import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../_lib/supabase";
import { requireAuth } from "../_lib/requireAuth";
import { requireAdmin } from "../_lib/requireAdmin";
import { ApiError } from "../_lib/errors";
import { logger } from "../_lib/logger";
import { applyCors } from "../_lib/cors";

// ---------------------------------------------------------------------------
// GET /api/admin/stats
// Admin only. Returns platform-wide aggregate stats.
// Response: { totalUsers, totalAuctions, activeAuctions, endedAuctions,
//             removedAuctions, totalBids, totalReports, openReports,
//             resolvedReports, dismissedReports, bannedUsers, totalAdmins }
// ---------------------------------------------------------------------------

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (applyCors(req, res)) return;
  try {
    if (req.method !== "GET") {
      res.status(405).json({ error: "METHOD_NOT_ALLOWED", message: "Allowed: GET" });
      return;
    }

    const user = await requireAuth(req.headers["authorization"]);
    await requireAdmin(user);

    const [
      usersResult,
      bannedResult,
      adminsResult,
      totalAuctionsResult,
      activeResult,
      endedResult,
      removedResult,
      bidsResult,
      totalReportsResult,
      openReportsResult,
      resolvedReportsResult,
      dismissedReportsResult,
    ] = await Promise.all([
      supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }).eq("is_banned", true),
      supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }).eq("is_admin", true),
      supabaseAdmin.from("auctions").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("auctions").select("id", { count: "exact", head: true }).eq("status", "active"),
      supabaseAdmin.from("auctions").select("id", { count: "exact", head: true }).eq("status", "ended"),
      supabaseAdmin.from("auctions").select("id", { count: "exact", head: true }).eq("status", "removed"),
      supabaseAdmin.from("bids").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("reports").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("reports").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabaseAdmin.from("reports").select("id", { count: "exact", head: true }).eq("status", "actioned"),
      supabaseAdmin.from("reports").select("id", { count: "exact", head: true }).eq("status", "dismissed"),
    ]);

    res.status(200).json({
      totalUsers: usersResult.count ?? 0,
      bannedUsers: bannedResult.count ?? 0,
      totalAdmins: adminsResult.count ?? 0,
      totalAuctions: totalAuctionsResult.count ?? 0,
      activeAuctions: activeResult.count ?? 0,
      endedAuctions: endedResult.count ?? 0,
      removedAuctions: removedResult.count ?? 0,
      totalBids: bidsResult.count ?? 0,
      totalReports: totalReportsResult.count ?? 0,
      openReports: openReportsResult.count ?? 0,
      resolvedReports: resolvedReportsResult.count ?? 0,
      dismissedReports: dismissedReportsResult.count ?? 0,
    });
  } catch (err) {
    if (err instanceof ApiError) {
      res.status(err.statusCode).json(err.toJSON());
      return;
    }
    logger.error("GET /api/admin/stats failed", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Unexpected error." });
  }
}
