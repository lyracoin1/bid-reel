import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../_lib/supabase";
import { requireAuth } from "../_lib/requireAuth";
import { requireAdmin } from "../_lib/requireAdmin";
import { ApiError } from "../_lib/errors";
import { logger } from "../_lib/logger";
import { applyCors } from "../_lib/cors";

// ---------------------------------------------------------------------------
// GET /api/admin/actions
// Admin only. Returns the admin action audit log.
// Response: { actions: AdminAction[] }
// ---------------------------------------------------------------------------

const SELECT = `
  id, action_type, target_type, target_id, note, created_at,
  admin:profiles!admin_id (id, display_name, phone)
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
      .from("admin_actions")
      .select(SELECT)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      // admin_actions table may not exist yet — return empty gracefully
      if (error.code === "42P01") {
        res.status(200).json({ actions: [] });
        return;
      }
      logger.error("GET /api/admin/actions — supabase error", error);
      res.status(500).json({ error: "INTERNAL_ERROR", message: "Failed to fetch actions." });
      return;
    }

    const actions = (data ?? []).map((row: Record<string, unknown>) => {
      const admin = row["admin"] as Record<string, unknown> | null;
      return {
        id: row["id"],
        actionType: row["action_type"],
        targetType: row["target_type"],
        targetId: row["target_id"],
        note: row["note"] ?? null,
        createdAt: row["created_at"],
        admin: admin
          ? {
              id: admin["id"],
              displayName: admin["display_name"] ?? null,
              phone: admin["phone"] ?? null,
            }
          : null,
      };
    });

    res.status(200).json({ actions });
  } catch (err) {
    if (err instanceof ApiError) {
      res.status(err.statusCode).json(err.toJSON());
      return;
    }
    logger.error("GET /api/admin/actions failed", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Unexpected error." });
  }
}
