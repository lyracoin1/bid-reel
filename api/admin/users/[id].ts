import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { supabaseAdmin } from "../../_lib/supabase";
import { requireAuth } from "../../_lib/requireAuth";
import { requireAdmin } from "../../_lib/requireAdmin";
import { ApiError } from "../../_lib/errors";
import { logger } from "../../_lib/logger";

// ---------------------------------------------------------------------------
// PATCH /api/admin/users/:id
// Admin only. Update role (is_admin) and/or ban status.
// Body: { role?: "admin"|"user"; isBanned?: boolean; banReason?: string|null }
// Response: { user: AdminUser }
// ---------------------------------------------------------------------------

const patchSchema = z.object({
  role: z.enum(["admin", "user"]).optional(),
  isBanned: z.boolean().optional(),
  banReason: z.string().max(500).nullable().optional(),
});

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  try {
    if (req.method !== "PATCH") {
      res.status(405).json({ error: "METHOD_NOT_ALLOWED", message: "Allowed: PATCH" });
      return;
    }

    const adminUser = await requireAuth(req.headers["authorization"]);
    await requireAdmin(adminUser);

    const targetId = req.query["id"] as string;

    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Invalid body",
      });
      return;
    }

    const patch: Record<string, unknown> = {};
    if (parsed.data.role !== undefined) patch["is_admin"] = parsed.data.role === "admin";
    if (parsed.data.isBanned !== undefined) patch["is_banned"] = parsed.data.isBanned;
    if (parsed.data.banReason !== undefined) patch["ban_reason"] = parsed.data.banReason;

    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: "EMPTY_UPDATE", message: "Provide at least one field." });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from("profiles")
      .update(patch)
      .eq("id", targetId)
      .select("id, display_name, phone, avatar_url, is_admin, is_banned, ban_reason, created_at")
      .single();

    if (error || !data) {
      logger.error("PATCH /api/admin/users/:id failed", { error, targetId });
      res.status(404).json({ error: "NOT_FOUND", message: "User not found." });
      return;
    }

    const row = data as Record<string, unknown>;
    res.status(200).json({
      user: {
        id: row["id"],
        displayName: row["display_name"] ?? null,
        phone: row["phone"] ?? null,
        avatarUrl: row["avatar_url"] ?? null,
        role: row["is_admin"] ? "admin" : "user",
        isBanned: row["is_banned"] ?? false,
        banReason: row["ban_reason"] ?? null,
        createdAt: row["created_at"],
      },
    });
  } catch (err) {
    if (err instanceof ApiError) {
      res.status(err.statusCode).json(err.toJSON());
      return;
    }
    logger.error(`PATCH /api/admin/users/${req.query["id"]} failed`, err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Unexpected error." });
  }
}
