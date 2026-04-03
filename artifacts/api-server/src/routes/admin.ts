/**
 * Admin routes — protected by requireAuth + requireAdmin.
 *
 * Every route checks that the authenticated user has is_admin = true
 * in the profiles table. No secret headers, no login hacks.
 *
 * GET    /api/admin/stats           — dashboard summary counts
 * GET    /api/admin/users           — all users list
 * PATCH  /api/admin/users/:id       — update role / ban status
 * GET    /api/admin/auctions        — all auctions list
 * PATCH  /api/admin/auctions/:id    — hide / feature auction
 * DELETE /api/admin/auctions/:id    — delete auction
 * GET    /api/admin/reports         — all reports list
 * PATCH  /api/admin/reports/:id     — update report status
 * GET    /api/admin/actions         — admin action log
 *
 * NOTE: The former POST /api/admin/verify-password endpoint has been
 * permanently removed. Admin panel access is granted exclusively through
 * the dedicated admin login flow (POST /api/auth/admin-login).
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

// ─── Helper: log an admin action to the audit table ──────────────────────────

type AdminActionType = "ban_user" | "unban_user" | "remove_auction" | "dismiss_report" | "resolve_report";
type AdminTargetType = "user" | "auction" | "report";

async function logAdminAction(
  adminId: string,
  actionType: AdminActionType,
  targetType: AdminTargetType,
  targetId: string,
  note?: string,
) {
  const { error } = await supabaseAdmin
    .from("admin_actions")
    .insert({ admin_id: adminId, action_type: actionType, target_type: targetType, target_id: targetId, note: note ?? null });
  if (error) {
    logger.warn({ error, adminId, actionType, targetId }, "logAdminAction: insert failed (non-fatal)");
  }
}

// ─── GET /stats ───────────────────────────────────────────────────────────────

adminRouter.get("/stats", async (_req, res) => {
  try {
    const [
      usersResult,
      auctionsResult,
      activeResult,
      removedResult,
      bidsResult,
      reportsResult,
      bannedResult,
      adminCountResult,
    ] = await Promise.all([
      supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("auctions").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("auctions").select("id", { count: "exact", head: true }).eq("status", "active"),
      supabaseAdmin.from("auctions").select("id", { count: "exact", head: true }).eq("status", "removed"),
      supabaseAdmin.from("bids").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("reports").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }).eq("is_banned", true),
      supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }).eq("is_admin", true),
    ]);

    res.json({
      totalUsers: usersResult.count ?? 0,
      totalAuctions: auctionsResult.count ?? 0,
      activeAuctions: activeResult.count ?? 0,
      removedAuctions: removedResult.count ?? 0,
      totalBids: bidsResult.count ?? 0,
      openReports: reportsResult.count ?? 0,
      bannedUsers: bannedResult.count ?? 0,
      totalAdmins: adminCountResult.count ?? 0,
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

    // Log auditable actions
    if (isBanned === true) {
      await logAdminAction(req.user!.id, "ban_user", "user", id, banReason ?? undefined);
    } else if (isBanned === false) {
      await logAdminAction(req.user!.id, "unban_user", "user", id);
    }

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
      .select("id, title, status")
      .single();

    if (error) throw error;

    logger.info({ auctionId: id, patch, adminId: req.user!.id }, "Admin updated auction");

    // Log remove action
    if (status === "removed") {
      await logAdminAction(req.user!.id, "remove_auction", "auction", id);
    }

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
    await logAdminAction(req.user!.id, "remove_auction", "auction", id, "Permanently deleted");

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

    // Log dismiss / resolve
    if (status === "dismissed") {
      await logAdminAction(req.user!.id, "dismiss_report", "report", id);
    } else if (status === "actioned") {
      await logAdminAction(req.user!.id, "resolve_report", "report", id);
    }

    res.json({ report: data });
  } catch (err) {
    logger.error({ err, reportId: id }, "PATCH /admin/reports/:id failed");
    res.status(500).json({ error: "UPDATE_FAILED", message: "Failed to update report" });
  }
});

// ─── GET /actions ─────────────────────────────────────────────────────────────

adminRouter.get("/actions", async (_req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("admin_actions")
      .select(`
        id, action_type, target_type, target_id, note, created_at,
        admin:profiles!admin_id(id, display_name, phone)
      `)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) throw error;

    const actions = (data ?? []).map((row: Record<string, unknown>) => {
      const admin = row["admin"] as { id: string; display_name: string | null; phone: string | null } | null;
      return {
        id: row["id"],
        actionType: row["action_type"],
        targetType: row["target_type"],
        targetId: row["target_id"],
        note: row["note"],
        createdAt: row["created_at"],
        admin: admin ? { id: admin.id, displayName: admin.display_name, phone: admin.phone } : null,
      };
    });

    res.json({ actions });
  } catch (err) {
    logger.error({ err }, "GET /admin/actions failed");
    res.status(500).json({ error: "ACTIONS_FAILED", message: "Failed to fetch action log" });
  }
});

// ─── Legacy media-lifecycle routes (kept for backward compat) ─────────────────

adminRouter.post("/cleanup-media", async (_req, res) => {
  logger.info("admin: manual media cleanup triggered");
  try {
    const result = await runMediaCleanup();
    res.json({ success: true, ...result, ranAt: result.ranAt.toISOString() });
  } catch (err) {
    logger.error({ err }, "admin: media cleanup failed");
    res.status(500).json({ error: "Cleanup run failed", detail: String(err) });
  }
});

adminRouter.get("/media-lifecycle-status", async (_req, res) => {
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
