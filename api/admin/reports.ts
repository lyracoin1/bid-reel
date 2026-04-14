import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../_lib/supabase";
import { requireAuth } from "../_lib/requireAuth";
import { requireAdmin } from "../_lib/requireAdmin";
import { ApiError } from "../_lib/errors";
import { logger } from "../_lib/logger";
import { applyCors } from "../_lib/cors";

// ---------------------------------------------------------------------------
// GET /api/admin/reports
// Admin only. Returns all reports with reporter and auction info.
// Response: { reports: AdminReport[] }
// ---------------------------------------------------------------------------

const SELECT = `
  id, reason, details, status, admin_note, resolved_at, created_at,
  reporter:profiles!reporter_id (id, display_name),
  auction:auctions!auction_id (id, title)
`.trim();

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

    const { data, error } = await supabaseAdmin
      .from("reports")
      .select(SELECT)
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) {
      logger.error("GET /api/admin/reports — supabase error", error);
      res.status(500).json({ error: "INTERNAL_ERROR", message: "Failed to fetch reports." });
      return;
    }

    const reports = (data ?? []).map((row: Record<string, unknown>) => {
      const reporter = row["reporter"] as Record<string, unknown> | null;
      const auction = row["auction"] as Record<string, unknown> | null;
      return {
        id: row["id"],
        reason: row["reason"],
        details: row["details"] ?? null,
        status: row["status"],
        adminNote: row["admin_note"] ?? null,
        resolvedAt: row["resolved_at"] ?? null,
        createdAt: row["created_at"],
        reporter: reporter
          ? { id: reporter["id"], displayName: reporter["display_name"] ?? null }
          : null,
        auction: auction
          ? { id: auction["id"], title: auction["title"] }
          : null,
      };
    });

    res.status(200).json({ reports });
  } catch (err) {
    if (err instanceof ApiError) {
      res.status(err.statusCode).json(err.toJSON());
      return;
    }
    logger.error("GET /api/admin/reports failed", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Unexpected error." });
  }
}
