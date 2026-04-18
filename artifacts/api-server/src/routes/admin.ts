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
import { env } from "../config/env";
import { notifyAdminMessage, notifyAccountWarning } from "../lib/notifications";

const adminRouter = Router();

// ─── All admin routes require auth + admin role ───────────────────────────────
adminRouter.use(requireAuth, requireAdmin);

// ─── Helper: log an admin action to the audit table ──────────────────────────

type AdminActionType = "ban_user" | "unban_user" | "remove_auction" | "dismiss_report" | "resolve_report" | "promote_admin" | "demote_admin";
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
      endedResult,
      removedResult,
      bidsResult,
      totalReportsResult,
      openReportsResult,
      resolvedReportsResult,
      dismissedReportsResult,
      bannedResult,
      adminCountResult,
    ] = await Promise.all([
      supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("auctions").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("auctions").select("id", { count: "exact", head: true }).eq("status", "active"),
      supabaseAdmin.from("auctions").select("id", { count: "exact", head: true }).eq("status", "ended"),
      supabaseAdmin.from("auctions").select("id", { count: "exact", head: true }).eq("status", "removed"),
      supabaseAdmin.from("bids").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("reports").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("reports").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabaseAdmin.from("reports").select("id", { count: "exact", head: true }).eq("status", "actioned"),
      supabaseAdmin.from("reports").select("id", { count: "exact", head: true }).eq("status", "dismissed"),
      supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }).eq("is_banned", true),
      supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }).eq("is_admin", true),
    ]);

    res.json({
      totalUsers: usersResult.count ?? 0,
      totalAuctions: auctionsResult.count ?? 0,
      activeAuctions: activeResult.count ?? 0,
      endedAuctions: endedResult.count ?? 0,
      removedAuctions: removedResult.count ?? 0,
      totalBids: bidsResult.count ?? 0,
      totalReports: totalReportsResult.count ?? 0,
      openReports: openReportsResult.count ?? 0,
      resolvedReports: resolvedReportsResult.count ?? 0,
      dismissedReports: dismissedReportsResult.count ?? 0,
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
      .select("id, username, display_name, phone, avatar_url, location, is_admin, is_banned, ban_reason, created_at")
      .order("created_at", { ascending: false });

    if (error) throw error;

    const users = (data ?? []).map((row) => {
      // Completeness rule: must match isProfileComplete() in lib/profiles.ts exactly.
      // Required: username, display_name, phone, avatar_url, location.
      const missing: string[] = [];
      if (!row.username)     missing.push("username");
      if (!row.display_name) missing.push("display_name");
      if (!row.phone)        missing.push("phone");
      if (!row.avatar_url)   missing.push("avatar");
      if (!row.location)     missing.push("location");

      return {
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        phone: row.phone,
        avatarUrl: row.avatar_url,
        role: row.is_admin ? "admin" : "user",
        isBanned: row.is_banned,
        banReason: row.ban_reason,
        createdAt: row.created_at,
        isCompleted: missing.length === 0,
        missingFields: missing,
      };
    });

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
      .select("id, username, display_name, phone, avatar_url, location, is_admin, is_banned, ban_reason, created_at")
      .single();

    if (error) throw error;

    logger.info({ targetId: id, patch, adminId: req.user!.id }, "Admin updated user");

    // Log auditable actions
    if (isBanned === true) {
      await logAdminAction(req.user!.id, "ban_user", "user", id, banReason ?? undefined);
    } else if (isBanned === false) {
      await logAdminAction(req.user!.id, "unban_user", "user", id);
    }
    if (role === "admin") {
      await logAdminAction(req.user!.id, "promote_admin", "user", id);
    } else if (role === "user") {
      await logAdminAction(req.user!.id, "demote_admin", "user", id);
    }

    // Re-derive completeness from the freshly updated row.
    const patchMissing: string[] = [];
    if (!data.username)     patchMissing.push("username");
    if (!data.display_name) patchMissing.push("display_name");
    if (!data.phone)        patchMissing.push("phone");
    if (!data.avatar_url)   patchMissing.push("avatar");
    if (!data.location)     patchMissing.push("location");

    res.json({
      user: {
        id: data.id,
        username: data.username,
        displayName: data.display_name,
        phone: data.phone,
        avatarUrl: data.avatar_url,
        role: data.is_admin ? "admin" : "user",
        isBanned: data.is_banned,
        banReason: data.ban_reason,
        createdAt: data.created_at,
        isCompleted: patchMissing.length === 0,
        missingFields: patchMissing,
      },
    });
  } catch (err) {
    logger.error({ err, targetId: id }, "PATCH /admin/users/:id failed");
    res.status(500).json({ error: "UPDATE_FAILED", message: "Failed to update user" });
  }
});

// ─── DELETE /users/:id ────────────────────────────────────────────────────────
//
// Permanently removes a user from BidReel:
//   1. Fetches all auction IDs belonging to the user (seller_id).
//   2. Deletes bids on those auctions (bids.auction_id CASCADE would handle
//      this when the auction is deleted, but we need to be explicit to avoid
//      FK RESTRICT on bidder_id when deleting the profile).
//   3. Deletes reports referencing those auctions.
//   4. Deletes the user's auctions (unblocked now that bids are gone).
//   5. Deletes any remaining bids placed BY the user on other auctions
//      (bids.bidder_id → profiles RESTRICT — must clear before auth delete).
//   6. Calls supabaseAdmin.auth.admin.deleteUser() which cascades to:
//        profiles  (ON DELETE CASCADE)
//        likes, content_signals, user_follows, saved_auctions  (CASCADE via profiles)
//        reports.reporter_id / resolved_by  (SET NULL)
//        auctions.winner_id  (SET NULL)
//
// Self-delete is blocked: admins may not delete their own account.

adminRouter.delete("/users/:id", async (req, res) => {
  const { id: targetId } = req.params;

  // Block self-delete at the server level.
  if (targetId === req.user!.id) {
    res.status(403).json({ error: "SELF_DELETE", message: "You cannot delete your own account." });
    return;
  }

  // Helper: every Supabase delete returns { error }. Previously these were
  // silently ignored, which meant a failed cleanup step would let the code
  // proceed to auth.admin.deleteUser and resurface as the misleading generic
  // "Database error deleting user" instead of the real FK / permission cause.
  const must = async <T,>(label: string, p: PromiseLike<{ data: T; error: { message?: string } | null }>) => {
    const { data, error } = await p;
    if (error) {
      const msg = error.message ?? "unknown error";
      throw new Error(`Step "${label}" failed: ${msg}`);
    }
    return data;
  };

  try {
    // 1. Fetch auction IDs owned by this user.
    const auctionRows = await must(
      "fetch user auctions",
      supabaseAdmin.from("auctions").select("id").eq("seller_id", targetId),
    );
    const auctionIds = ((auctionRows ?? []) as Array<{ id: string }>).map(r => r.id);

    // 2. Delete bids/reports on those auctions (clears RESTRICT on bids.auction_id→auctions).
    if (auctionIds.length > 0) {
      await must("delete bids on user auctions",    supabaseAdmin.from("bids").delete().in("auction_id", auctionIds));
      await must("delete reports on user auctions", supabaseAdmin.from("reports").delete().in("auction_id", auctionIds));
    }

    // 3. Delete the user's auctions (seller_id RESTRICT is now clear).
    await must("delete user auctions", supabaseAdmin.from("auctions").delete().eq("seller_id", targetId));

    // 4. Delete bids placed BY this user on OTHER auctions (bidder_id RESTRICT).
    await must("delete user bids", supabaseAdmin.from("bids").delete().eq("bidder_id", targetId));

    // 5. Delete admin_actions performed BY this user.
    //
    // admin_actions.admin_id is `ON DELETE RESTRICT`, so deleting an admin who
    // has ever performed an audited action (ban_user, delete_auction, etc.)
    // would otherwise fail at the auth.users cascade step with a misleading
    // "Database error deleting user" from Supabase.
    //
    // We intentionally bypass the table's "write-once" intent here because:
    //   - This is a deliberate, irreversible admin operation.
    //   - The deleted user's identity is preserved in the new admin_action row
    //     written below (`logAdminAction(... "delete_user", "user", targetId)`),
    //     which captures the deletion event itself.
    await must("delete user admin_actions", supabaseAdmin.from("admin_actions").delete().eq("admin_id", targetId));

    // 6. Delete the auth user — cascades to profiles and all CASCADE-linked tables
    //    (notifications, content_signals, user_follows, saved_auctions,
    //     user_devices, blocks, contact_requests, reviews).
    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(targetId);
    if (authError) throw authError;

    logger.info({ targetId, adminId: req.user!.id }, "Admin permanently deleted user");
    await logAdminAction(req.user!.id, "delete_user", "user", targetId, "Permanently deleted");

    res.json({ ok: true });
  } catch (err) {
    // Surface the *real* underlying error so the admin UI can show something
    // more useful than a generic "Database error deleting user" toast.
    const message = err instanceof Error ? err.message : "Failed to delete user";
    const detail = (err as { details?: string; hint?: string; code?: string } | null) ?? null;
    logger.error({ err, targetId, detail }, "DELETE /admin/users/:id failed");
    res.status(500).json({
      error: "DELETE_FAILED",
      message,
      ...(detail?.code ? { code: detail.code } : {}),
      ...(detail?.details ? { details: detail.details } : {}),
      ...(detail?.hint ? { hint: detail.hint } : {}),
    });
  }
});

// ─── GET /auctions ────────────────────────────────────────────────────────────

adminRouter.get("/auctions", async (_req, res) => {
  try {
    const [{ data, error }, { data: signalRows }, { data: saveRows }, { data: viewRows, error: viewErr }] = await Promise.all([
      supabaseAdmin
        .from("auctions")
        .select("*, seller:profiles!seller_id(id, display_name)")
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("content_signals")
        .select("auction_id, signal"),
      // Count saves per auction from the saved_auctions table
      supabaseAdmin
        .from("saved_auctions")
        .select("auction_id"),
      // Pre-aggregated view counters (impressions / qualified / engaged / unique).
      // Missing rows just yield zero for that auction.
      supabaseAdmin
        .from("auction_view_stats")
        .select("auction_id, impressions_count, qualified_views_count, engaged_views_count, unique_viewers_count, last_viewed_at"),
    ]);

    if (viewErr) {
      logger.warn({ err: viewErr.message }, "GET /admin/auctions: view_stats lookup failed (returning zeros)");
    }

    if (error) throw error;

    // Aggregate signal counts per auction
    const signalMap: Record<string, { interested: number; not_interested: number }> = {};
    for (const s of signalRows ?? []) {
      const aId = s["auction_id"] as string;
      const sig = s["signal"] as string;
      if (!signalMap[aId]) signalMap[aId] = { interested: 0, not_interested: 0 };
      if (sig === "interested") signalMap[aId].interested++;
      else if (sig === "not_interested") signalMap[aId].not_interested++;
    }

    // Aggregate save counts per auction
    const saveMap: Record<string, number> = {};
    for (const s of saveRows ?? []) {
      const aId = s["auction_id"] as string;
      saveMap[aId] = (saveMap[aId] ?? 0) + 1;
    }

    // Map view counters per auction
    const viewMap: Record<string, {
      impressions: number; qualified: number; engaged: number; unique: number; lastViewedAt: string | null;
    }> = {};
    for (const v of viewRows ?? []) {
      const aId = v["auction_id"] as string;
      viewMap[aId] = {
        impressions:  (v["impressions_count"]     as number | null) ?? 0,
        qualified:    (v["qualified_views_count"] as number | null) ?? 0,
        engaged:      (v["engaged_views_count"]   as number | null) ?? 0,
        unique:       (v["unique_viewers_count"]  as number | null) ?? 0,
        lastViewedAt: (v["last_viewed_at"]        as string | null) ?? null,
      };
    }

    const auctions = (data ?? []).map((row: Record<string, unknown>) => {
      const aId = row["id"] as string;
      const currentBid = (row["current_bid"] as number | null) ?? 0;
      const seller = row["seller"] as { id: string; display_name: string | null } | null;
      return {
        id: aId,
        title: row["title"],
        category: row["category"],
        status: row["status"],
        startPrice: row["start_price"],
        currentBid,
        bidCount: row["bid_count"] ?? 0,
        startsAt: row["starts_at"],
        endsAt: row["ends_at"],
        createdAt: row["created_at"],
        currencyCode: (row["currency_code"] as string | null) ?? "USD",
        currencyLabel: (row["currency_label"] as string | null) ?? "US Dollar",
        lat: row["lat"] ?? null,
        lng: row["lng"] ?? null,
        seller: seller ? { id: seller.id, displayName: seller.display_name } : null,
        interestedCount: signalMap[aId]?.interested ?? 0,
        notInterestedCount: signalMap[aId]?.not_interested ?? 0,
        saveCount: saveMap[aId] ?? 0,
        impressionsCount:    viewMap[aId]?.impressions  ?? 0,
        qualifiedViewsCount: viewMap[aId]?.qualified    ?? 0,
        engagedViewsCount:   viewMap[aId]?.engaged      ?? 0,
        uniqueViewersCount:  viewMap[aId]?.unique       ?? 0,
        lastViewedAt:        viewMap[aId]?.lastViewedAt ?? null,
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
        id, reason, details, status, admin_note, resolved_at, created_at,
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
        adminNote: (row["admin_note"] as string | null) ?? null,
        resolvedAt: (row["resolved_at"] as string | null) ?? null,
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
  // DB enum report_status: pending | dismissed | actioned  (no "reviewed")
  const { status } = req.body as { status?: "pending" | "dismissed" | "actioned" };

  if (!status) {
    res.status(400).json({ error: "MISSING_STATUS", message: "status is required" });
    return;
  }

  const ALLOWED = ["pending", "dismissed", "actioned"] as const;
  if (!(ALLOWED as readonly string[]).includes(status)) {
    res.status(400).json({ error: "INVALID_STATUS", message: `status must be one of: ${ALLOWED.join(", ")}` });
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

// ─── GET /notifications ───────────────────────────────────────────────────────

adminRouter.get("/notifications", async (_req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("admin_notifications")
      .select("id, type, title, message, is_read, metadata, created_at")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw error;

    res.json({ notifications: data ?? [] });
  } catch (err) {
    logger.error({ err }, "GET /admin/notifications failed");
    res.status(500).json({ error: "NOTIFICATIONS_FAILED", message: "Failed to fetch notifications" });
  }
});

// ─── PATCH /notifications/:id/read ───────────────────────────────────────────

adminRouter.patch("/notifications/:id/read", async (req, res) => {
  const { id } = req.params;
  try {
    const { error } = await supabaseAdmin
      .from("admin_notifications")
      .update({ is_read: true })
      .eq("id", id);

    if (error) throw error;

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, id }, "PATCH /admin/notifications/:id/read failed");
    res.status(500).json({ error: "UPDATE_FAILED", message: "Failed to mark notification as read" });
  }
});

// ─── POST /notifications/read-all ────────────────────────────────────────────

adminRouter.post("/notifications/read-all", async (_req, res) => {
  try {
    const { error } = await supabaseAdmin
      .from("admin_notifications")
      .update({ is_read: true })
      .eq("is_read", false);

    if (error) throw error;

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "POST /admin/notifications/read-all failed");
    res.status(500).json({ error: "UPDATE_FAILED", message: "Failed to mark all notifications as read" });
  }
});

// ─── POST /deploy ─────────────────────────────────────────────────────────────
//
// Triggers a Vercel deployment via the VERCEL_DEPLOY_HOOK_URL secret.
// Rate-limited: one trigger per 60 seconds (checked against DB).
// Logs the attempt as an admin_notification with type "deploy_triggered".

adminRouter.post("/deploy", async (req, res) => {
  if (!env.vercelDeployHookUrl) {
    res.status(501).json({
      error: "NOT_CONFIGURED",
      message: "VERCEL_DEPLOY_HOOK_URL is not configured on the server.",
    });
    return;
  }

  try {
    // ── Rate limit: max 1 deploy per 60 seconds ──────────────────────────────
    const { data: lastDeploy } = await supabaseAdmin
      .from("admin_notifications")
      .select("created_at")
      .eq("type", "deploy_triggered")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastDeploy) {
      const elapsedMs = Date.now() - new Date(lastDeploy.created_at).getTime();
      if (elapsedMs < 60_000) {
        const retryAfter = Math.ceil((60_000 - elapsedMs) / 1000);
        res.status(429).json({
          error: "RATE_LIMITED",
          message: `يرجى الانتظار ${retryAfter} ثانية قبل إعادة النشر`,
          retryAfterSeconds: retryAfter,
        });
        return;
      }
    }

    // ── Trigger the Vercel deploy hook ───────────────────────────────────────
    const hookRes = await fetch(env.vercelDeployHookUrl, { method: "POST" });

    const triggeredAt = new Date().toISOString();
    const hookOk = hookRes.ok;
    const hookStatus = hookRes.status;

    // ── Log the attempt regardless of outcome ────────────────────────────────
    await supabaseAdmin.from("admin_notifications").insert({
      type: "deploy_triggered",
      title: hookOk ? "نشر تم تشغيله بنجاح" : "فشل تشغيل النشر",
      message: hookOk
        ? `تم إرسال طلب النشر بنجاح في ${new Date(triggeredAt).toLocaleTimeString("ar-SA")}`
        : `فشل طلب النشر — كود الاستجابة: ${hookStatus}`,
      metadata: {
        triggered_by: req.user!.id,
        hook_status: hookStatus,
        triggered_at: triggeredAt,
      },
    });

    logger.info(
      { adminId: req.user!.id, hookStatus, triggeredAt },
      "Admin triggered Vercel deployment",
    );

    if (!hookOk) {
      res.status(502).json({
        error: "HOOK_FAILED",
        message: `Deploy hook returned ${hookStatus}`,
      });
      return;
    }

    res.json({ ok: true, triggeredAt });
  } catch (err) {
    logger.error({ err }, "POST /admin/deploy failed");
    res.status(500).json({ error: "DEPLOY_FAILED", message: "Failed to trigger deployment" });
  }
});

// ─── POST /admin/notify ──────────────────────────────────────────────────────
// Send an admin_message to one user, a list of users, or all users.
// Body: { userId?: string, userIds?: string[], all?: true, title: string, body: string }
// ─────────────────────────────────────────────────────────────────────────────

adminRouter.post("/notify", async (req, res) => {
  const adminId = req.user!.id;
  const { userId, userIds, all, title, body, metadata } = req.body as {
    userId?: string;
    userIds?: string[];
    all?: boolean;
    title?: string;
    body?: string;
    metadata?: Record<string, unknown>;
  };

  if (typeof title !== "string" || title.trim().length === 0 ||
      typeof body !== "string" || body.trim().length === 0) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "title and body are required" });
    return;
  }

  // Resolve recipient list
  let recipients: string[] = [];
  if (all === true) {
    const { data, error } = await supabaseAdmin.from("profiles").select("id").eq("is_banned", false);
    if (error) {
      logger.error({ err: error.message, adminId }, "POST /admin/notify: failed to enumerate users");
      res.status(500).json({ error: "FETCH_FAILED", message: "Could not enumerate recipients." });
      return;
    }
    recipients = (data ?? []).map((r: { id: string }) => r.id);
  } else if (Array.isArray(userIds) && userIds.length > 0) {
    recipients = userIds;
  } else if (typeof userId === "string" && userId.length > 0) {
    recipients = [userId];
  } else {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "Provide userId, userIds, or all=true" });
    return;
  }

  logger.info({ adminId, recipientCount: recipients.length }, "POST /admin/notify: dispatching admin_message");

  await Promise.all(
    recipients.map(uid =>
      notifyAdminMessage(uid, title.trim(), body.trim(), metadata).catch(err =>
        logger.warn({ err: String(err), uid }, "POST /admin/notify: helper failed for one recipient"),
      ),
    ),
  );

  res.json({ success: true, sent: recipients.length });
});

// ─── POST /admin/users/:id/warn ──────────────────────────────────────────────
// Send an account_warning to a single user. Body: { reason: string }
// ─────────────────────────────────────────────────────────────────────────────

adminRouter.post("/users/:id/warn", async (req, res) => {
  const adminId = req.user!.id;
  const targetId = req.params["id"] as string;
  const { reason } = req.body as { reason?: string };

  if (typeof reason !== "string" || reason.trim().length === 0) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "reason is required" });
    return;
  }

  await notifyAccountWarning(targetId, reason.trim(), { issuedBy: adminId });
  await logAdminAction(adminId, "dismiss_report", "user", targetId, `warning: ${reason.trim().slice(0, 200)}`);
  res.json({ success: true });
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
      .is("video_deleted_at", null);

    res.json({ totalEnded: ended ?? 0 });
  } catch (err) {
    logger.error({ err }, "admin: media-lifecycle-status failed");
    res.status(500).json({ error: "Status check failed" });
  }
});

export default adminRouter;
