import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { supabaseAdmin } from "../../_lib/supabase";
import { requireAuth } from "../../_lib/requireAuth";
import { requireAdmin } from "../../_lib/requireAdmin";
import { ApiError } from "../../_lib/errors";
import { logger } from "../../_lib/logger";
import { applyCors } from "../../_lib/cors";

// ---------------------------------------------------------------------------
// PATCH /api/admin/reports/:id
// Admin only. Update report status.
// Body: { status: "pending"|"dismissed"|"actioned" }
// ---------------------------------------------------------------------------

const patchSchema = z.object({
  status: z.enum(["pending", "dismissed", "actioned"]),
  adminNote: z.string().max(500).optional(),
});

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (applyCors(req, res)) return;
  try {
    if (req.method !== "PATCH") {
      res.status(405).json({ error: "METHOD_NOT_ALLOWED", message: "Allowed: PATCH" });
      return;
    }

    const user = await requireAuth(req.headers["authorization"]);
    await requireAdmin(user);

    const id = req.query["id"] as string;

    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message ?? "Invalid body",
      });
      return;
    }

    const patch: Record<string, unknown> = { status: parsed.data.status };
    if (parsed.data.adminNote !== undefined) patch["admin_note"] = parsed.data.adminNote;
    if (parsed.data.status === "actioned") patch["resolved_at"] = new Date().toISOString();

    const { error } = await supabaseAdmin
      .from("reports")
      .update(patch)
      .eq("id", id);

    if (error) {
      logger.error("PATCH /api/admin/reports/:id failed", { error, id });
      res.status(500).json({ error: "UPDATE_FAILED", message: "Failed to update report." });
      return;
    }

    res.status(200).json({ success: true });
  } catch (err) {
    if (err instanceof ApiError) {
      res.status(err.statusCode).json(err.toJSON());
      return;
    }
    logger.error(`PATCH /api/admin/reports/${req.query["id"]} failed`, err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Unexpected error." });
  }
}
