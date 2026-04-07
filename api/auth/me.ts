import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAuth } from "../_lib/requireAuth";
import { getOwnProfile } from "../_lib/profiles";
import { ApiError } from "../_lib/errors";
import { logger } from "../_lib/logger";

// ---------------------------------------------------------------------------
// GET /api/auth/me
// ---------------------------------------------------------------------------
// Returns the authenticated user's own profile.
//
// Response shape: OwnProfile (flat object — NOT wrapped in { user }).
// This matches the Express auth/me response and differs intentionally from
// GET /api/users/me which wraps in { user }.
// ---------------------------------------------------------------------------

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== "GET") {
    res.status(405).json({ error: "METHOD_NOT_ALLOWED", message: "GET required" });
    return;
  }

  try {
    const user = await requireAuth(req.headers["authorization"]);
    const profile = await getOwnProfile(user.id);

    if (!profile) {
      res.status(404).json({
        error: "PROFILE_NOT_FOUND",
        message: "Profile not found.",
      });
      return;
    }

    res.status(200).json(profile);
  } catch (err) {
    if (err instanceof ApiError) {
      res.status(err.statusCode).json(err.toJSON());
      return;
    }
    logger.error("GET /api/auth/me failed", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Unexpected error." });
  }
}
