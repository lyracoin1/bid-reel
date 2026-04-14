import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { supabaseAdmin } from "../../_lib/supabase";
import { requireAuth } from "../../_lib/requireAuth";
import { requireAdmin } from "../../_lib/requireAdmin";
import { ApiError } from "../../_lib/errors";
import { logger } from "../../_lib/logger";
import { applyCors } from "../../_lib/cors";

// ---------------------------------------------------------------------------
// PATCH /api/admin/auctions/:id  — update status
// DELETE /api/admin/auctions/:id — hard delete
// Admin only.
// ---------------------------------------------------------------------------

const patchSchema = z.object({
  status: z.enum(["active", "ended", "removed"]).optional(),
});

async function handlePatch(req: VercelRequest, res: VercelResponse): Promise<void> {
  const id = req.query["id"] as string;

  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: parsed.error.issues[0]?.message ?? "Invalid body",
    });
    return;
  }

  if (!parsed.data.status) {
    res.status(400).json({ error: "EMPTY_UPDATE", message: "Provide status to update." });
    return;
  }

  const { error } = await supabaseAdmin
    .from("auctions")
    .update({ status: parsed.data.status })
    .eq("id", id);

  if (error) {
    logger.error("PATCH /api/admin/auctions/:id failed", { error, id });
    res.status(500).json({ error: "UPDATE_FAILED", message: "Failed to update auction." });
    return;
  }

  res.status(200).json({ success: true });
}

async function handleDelete(req: VercelRequest, res: VercelResponse): Promise<void> {
  const id = req.query["id"] as string;

  // Delete bids first (foreign key constraint), then the auction
  await supabaseAdmin.from("bids").delete().eq("auction_id", id);

  const { error } = await supabaseAdmin.from("auctions").delete().eq("id", id);

  if (error) {
    logger.error("DELETE /api/admin/auctions/:id failed", { error, id });
    res.status(500).json({ error: "DELETE_FAILED", message: "Failed to delete auction." });
    return;
  }

  res.status(200).json({ success: true });
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (applyCors(req, res)) return;
  try {
    const user = await requireAuth(req.headers["authorization"]);
    await requireAdmin(user);

    if (req.method === "PATCH") return await handlePatch(req, res);
    if (req.method === "DELETE") return await handleDelete(req, res);

    res.status(405).json({ error: "METHOD_NOT_ALLOWED", message: "Allowed: PATCH, DELETE" });
  } catch (err) {
    if (err instanceof ApiError) {
      res.status(err.statusCode).json(err.toJSON());
      return;
    }
    logger.error(`${req.method} /api/admin/auctions/${req.query["id"]} failed`, err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Unexpected error." });
  }
}
