import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../_lib/supabase";
import { requireAuth } from "../_lib/requireAuth";
import { requireAdmin } from "../_lib/requireAdmin";
import { ApiError } from "../_lib/errors";
import { logger } from "../_lib/logger";
import { applyCors } from "../_lib/cors";

// ---------------------------------------------------------------------------
// GET /api/admin/users
// Admin only. Returns all user profiles.
// Response: { users: AdminUser[] }
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

    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id, display_name, phone, avatar_url, is_admin, is_banned, ban_reason, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      logger.error("GET /api/admin/users — supabase error", error);
      res.status(500).json({ error: "INTERNAL_ERROR", message: "Failed to fetch users." });
      return;
    }

    const users = (data ?? []).map((row: Record<string, unknown>) => ({
      id: row["id"],
      displayName: row["display_name"] ?? null,
      phone: row["phone"] ?? null,
      avatarUrl: row["avatar_url"] ?? null,
      role: row["is_admin"] ? "admin" : "user",
      isBanned: row["is_banned"] ?? false,
      banReason: row["ban_reason"] ?? null,
      createdAt: row["created_at"],
    }));

    res.status(200).json({ users });
  } catch (err) {
    if (err instanceof ApiError) {
      res.status(err.statusCode).json(err.toJSON());
      return;
    }
    logger.error("GET /api/admin/users failed", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Unexpected error." });
  }
}
