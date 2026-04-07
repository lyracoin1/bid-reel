import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAuth } from "../_lib/requireAuth";
import { goTrueAnonAuth } from "../_lib/supabase";
import { ApiError } from "../_lib/errors";
import { logger } from "../_lib/logger";

// ---------------------------------------------------------------------------
// POST /api/auth/logout
// ---------------------------------------------------------------------------
// Validates the token (rejects anonymous callers) then signs out.
// In a serverless context signOut() clears the in-memory client session.
// The access token itself expires per Supabase JWT TTL — clients must discard
// it locally. This endpoint exists to keep API symmetry with the old backend.
//
// Response: { message: "Logged out" }
// ---------------------------------------------------------------------------

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "METHOD_NOT_ALLOWED", message: "POST required" });
    return;
  }

  try {
    await requireAuth(req.headers["authorization"]);
    await goTrueAnonAuth.signOut();
    res.status(200).json({ message: "Logged out" });
  } catch (err) {
    if (err instanceof ApiError) {
      res.status(err.statusCode).json(err.toJSON());
      return;
    }
    logger.error("POST /api/auth/logout failed", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Unexpected error." });
  }
}
