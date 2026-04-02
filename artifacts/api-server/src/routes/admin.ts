/**
 * Admin routes — protected by requireAuth + requireAdmin.
 *
 * Every route checks that the authenticated user has is_admin = true
 * in the profiles table. No secret headers, no login hacks.
 *
 * POST /api/admin/verify-password   — verify the admin panel password
 * GET  /api/admin/stats             — dashboard summary counts
 * GET  /api/admin/users             — all users list
 * PATCH /api/admin/users/:id        — update role / ban status
 * GET  /api/admin/auctions          — all auctions list
 * PATCH /api/admin/auctions/:id     — hide / feature auction
 * DELETE /api/admin/auctions/:id    — delete auction
 * GET  /api/admin/reports           — all reports list
 * PATCH /api/admin/reports/:id      — update report status
 *
 * Legacy media-lifecycle routes kept at the bottom (secret-based).
 */

import { Router } from "express";
import { supabaseAdmin } from "../lib/supabase";
import { requireAuth } from "../middlewares/requireAuth";
import { requireAdmin } from "../middlewares/requireAdmin";
import { runMediaCleanup } from "../lib/media-lifecycle";
import { logger } from "../lib/logger";

const adminRouter = Router();

// ─── All admin routes require auth + admin role ───────────────────────────────
adminRouter.use(requireAuth, requireAdmin);

// ─── POST /verify-password ────────────────────────────────────────────────────

adminRouter.post("/verify-password", (req, res) => {
  const { password } = req.body as { password?: string };
  const expected = process.env["ADMIN_PANEL_PASSWORD"];

  if (!expected) {
    res.status(503).json({ error: "NOT_CONFIGURED", message: "Admin password is not configured on the server" });
    return;
  }

  if (!password || password !== expected) {
    res.status(403).json({ error: "WRONG_PASSWORD", message: "Incorrect admin password" });
    return;
  }

  res.json({ ok: true });
});

// ─── GET /stats ───────────────────────────────────────────────────────────────

adminRouter.get("/stats", async (_req, res) => {
  try {
    const [usersResult, auctionsResult, activeResult, bidsResult, reportsResult] = await Promise.all([
      supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("auctions").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("auctions").select("id", { count: "exact", head: true }).eq("status", "active"),
      supabaseAdmin.from("bids").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("reports").select("id", { count: "exact", head: true }).eq("status", "pending"),
    ]);

    res.json({
      totalUsers: usersResult.count ?? 0,
      totalAuctions: auctionsResult.count ?? 0,
      activeAuctions: activeResult.count ?? 0,
      totalBids: bidsResult.count ?? 0,
      openReports: reportsResult.count ?? 0,
    });
  } catch (err) {
    logger.error({ err }, "GET /admin/stats failed");
    res.status(500).json({ error: "STATS_FAILED", message: "Failed to fetch stats" });
  }
});

// ─── GET /users ───────────────────────────────────────────────────────────────

adminRouter.get("/users", async (_req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id, display_name, phone, avatar_url, is_admin, is_banned, ban_reason, created_at")
      .order("created_at", { ascending: false });

    if (error) throw error;

    const users = (data ?? []).map((row) => ({
      id: row.id,
      displayName: row.display_name,
      phone: row.phone,
      avatarUrl: row.avatar_url,
      role: row.is_admin ? "admin" : "user",
      isBanned: row.is_banned,
      banReason: row.ban_reason,
      createdAt: row.created_at,
    }));

    res.json({ users });
  } catch (err) {
    logger.error({ err }, "GET /admin/users failed");
    res.status(500).json({ error: "USERS_FAILED", message: "Failed to fetch users" });
  }
});

// ─── PATCH /users/:id ─────────────────────────────────────────────────────────

adminRouter.patch("/users/:id", async (req, res) => {
  const { id } = req.params;
  const { role, isBanned, banReason } = req.body as {
    role?: "admin" | "user";
    isBanned?: boolean;
    banReason?: string | null;
  };

  const patch: Record<string, unknown> = {};
  if (role !== undefined) patch["is_admin"] = role === "admin";
  if (isBanned !== undefined) {
    patch["is_banned"] = isBanned;
    patch["ban_reason"] = isBanned ? (banReason ?? "Banned by admin") : null;
  }

  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "NO_CHANGES", message: "No changes provided" });
    return;
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .update(patch)
      .eq("id", id)
      .select("id, display_name, phone, is_admin, is_banned, ban_reason, created_at")
      .single();

    if (error) throw error;

    logger.info({ targetId: id, patch, adminId: req.user!.id }, "Admin updated user");

    res.json({
      user: {
        id: data.id,
        displayName: data.display_name,
        phone: data.phone,
        role: data.is_admin ? "admin" : "user",
        isBanned: data.is_banned,
        banReason: data.ban_reason,
        createdAt: data.created_at,
      },
    });
  } catch (err) {
    logger.error({ err, targetId: id }, "PATCH /admin/users/:id failed");
    res.status(500).json({ error: "UPDATE_FAILED", message: "Failed to update user" });
  }
});

// ─── GET /auctions ────────────────────────────────────────────────────────────

adminRouter.get("/auctions", async (_req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("auctions")
      .select(`
        id, title, category, status, start_price,
        current_price, bid_count,
        starts_at, ends_at, created_at,
        seller:profiles!seller_id(id, display_name)
      `)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const auctions = (data ?? []).map((row: Record<string, unknown>) => {
      const currentBid = (row["current_price"] as number | null) ?? 0;
      const seller = row["seller"] as { id: string; display_name: string | null } | null;
      return {
        id: row["id"],
        title: row["title"],
        category: row["category"],
        status: row["status"],
        startPrice: row["start_price"],
        currentBid,
        bidCount: row["bid_count"],
        startsAt: row["starts_at"],
        endsAt: row["ends_at"],
        createdAt: row["created_at"],
        seller: seller ? { id: seller.id, displayName: seller.display_name } : null,
      };
    });

    res.json({ auctions });
  } catch (err) {
    logger.error({ err }, "GET /admin/auctions failed");
    res.status(500).json({ error: "AUCTIONS_FAILED", message: "Failed to fetch auctions" });
  }
});

// ─── PATCH /auctions/:id ──────────────────────────────────────────────────────

adminRouter.patch("/auctions/:id", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body as {
    status?: "active" | "ended" | "removed";
  };

  const patch: Record<string, unknown> = {};
  if (status !== undefined) patch["status"] = status;

  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "NO_CHANGES", message: "No changes provided" });
    return;
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("auctions")
      .update(patch)
      .eq("id", id)
      .select("id, title, status, featured")
      .single();

    if (error) throw error;

    logger.info({ auctionId: id, patch, adminId: req.user!.id }, "Admin updated auction");
    res.json({ auction: data });
  } catch (err) {
    logger.error({ err, auctionId: id }, "PATCH /admin/auctions/:id failed");
    res.status(500).json({ error: "UPDATE_FAILED", message: "Failed to update auction" });
  }
});

// ─── DELETE /auctions/:id ─────────────────────────────────────────────────────

adminRouter.delete("/auctions/:id", async (req, res) => {
  const { id } = req.params;

  try {
    // Delete bids first (no cascade configured)
    await supabaseAdmin.from("bids").delete().eq("auction_id", id);
    await supabaseAdmin.from("reports").delete().eq("auction_id", id);

    const { error } = await supabaseAdmin
      .from("auctions")
      .delete()
      .eq("id", id);

    if (error) throw error;

    logger.info({ auctionId: id, adminId: req.user!.id }, "Admin deleted auction");
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, auctionId: id }, "DELETE /admin/auctions/:id failed");
    res.status(500).json({ error: "DELETE_FAILED", message: "Failed to delete auction" });
  }
});

// ─── GET /reports ─────────────────────────────────────────────────────────────

adminRouter.get("/reports", async (_req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("reports")
      .select(`
        id, reason, details, status, created_at,
        reporter:profiles!reporter_id(id, display_name),
        auction:auctions!auction_id(id, title, seller_id)
      `)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const reports = (data ?? []).map((row: Record<string, unknown>) => {
      const reporter = row["reporter"] as { id: string; display_name: string | null } | null;
      const auction = row["auction"] as { id: string; title: string; seller_id: string } | null;
      return {
        id: row["id"],
        reason: row["reason"],
        details: row["details"],
        status: row["status"],
        createdAt: row["created_at"],
        reporter: reporter ? { id: reporter.id, displayName: reporter.display_name } : null,
        auction: auction ? { id: auction.id, title: auction.title } : null,
      };
    });

    res.json({ reports });
  } catch (err) {
    logger.error({ err }, "GET /admin/reports failed");
    res.status(500).json({ error: "REPORTS_FAILED", message: "Failed to fetch reports" });
  }
});

// ─── PATCH /reports/:id ───────────────────────────────────────────────────────

adminRouter.patch("/reports/:id", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body as { status?: "pending" | "reviewed" | "dismissed" | "actioned" };

  if (!status) {
    res.status(400).json({ error: "MISSING_STATUS", message: "status is required" });
    return;
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("reports")
      .update({ status })
      .eq("id", id)
      .select("id, reason, status")
      .single();

    if (error) throw error;

    logger.info({ reportId: id, status, adminId: req.user!.id }, "Admin updated report");
    res.json({ report: data });
  } catch (err) {
    logger.error({ err, reportId: id }, "PATCH /admin/reports/:id failed");
    res.status(500).json({ error: "UPDATE_FAILED", message: "Failed to update report" });
  }
});

// ─── Legacy media-lifecycle routes (secret-based, kept for backward compat) ───

function requireAdminSecret(
  req: Parameters<Parameters<typeof adminRouter.use>[0]>[0],
  res: Parameters<Parameters<typeof adminRouter.use>[0]>[1],
  next: Parameters<Parameters<typeof adminRouter.use>[0]>[2],
) {
  // Already protected by requireAuth + requireAdmin above
  next();
}

adminRouter.post("/cleanup-media", requireAdminSecret, async (_req, res) => {
  logger.info("admin: manual media cleanup triggered");
  try {
    const result = await runMediaCleanup();
    res.json({ success: true, ...result, ranAt: result.ranAt.toISOString() });
  } catch (err) {
    logger.error({ err }, "admin: media cleanup failed");
    res.status(500).json({ error: "Cleanup run failed", detail: String(err) });
  }
});

adminRouter.get("/media-lifecycle-status", requireAdminSecret, async (_req, res) => {
  try {
    const now = new Date().toISOString();
    const { count: ended } = await supabaseAdmin
      .from("auctions")
      .select("id", { count: "exact", head: true })
      .lte("ends_at", now)
      .is("deleted_at", null);

    res.json({ totalEnded: ended ?? 0 });
  } catch (err) {
    logger.error({ err }, "admin: media-lifecycle-status failed");
    res.status(500).json({ error: "Status check failed" });
  }
});

export default adminRouter;
