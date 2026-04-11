import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../_lib/supabase";
import { requireAuth } from "../../_lib/requireAuth";
import { ApiError } from "../../_lib/errors";
import { logger } from "../../_lib/logger";

// ---------------------------------------------------------------------------
// GET /api/users/me/following-ids
// Auth required. Returns the flat list of profile IDs the current user follows.
// Response: { followingIds: string[] }
// ---------------------------------------------------------------------------

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  try {
    if (req.method !== "GET") {
      res.status(405).json({
        error: "METHOD_NOT_ALLOWED",
        message: "Allowed methods: GET",
      });
      return;
    }

    const user = await requireAuth(req.headers["authorization"]);

    const { data, error } = await supabaseAdmin
      .from("user_follows")
      .select("following_id")
      .eq("follower_id", user.id);

    if (error) {
      logger.error("GET /api/users/me/following-ids failed", {
        error,
        userId: user.id,
      });
      res.status(500).json({
        error: "INTERNAL_ERROR",
        message: "Failed to fetch following list.",
      });
      return;
    }

    const followingIds = (data ?? []).map(
      (row: { following_id: string }) => row.following_id,
    );
    res.status(200).json({ followingIds });
  } catch (err) {
    if (err instanceof ApiError) {
      res.status(err.statusCode).json(err.toJSON());
      return;
    }
    logger.error("GET /api/users/me/following-ids unexpected error", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Unexpected error." });
  }
}
