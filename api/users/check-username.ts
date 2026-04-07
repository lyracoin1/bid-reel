import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { requireAuth } from "../_lib/requireAuth";
import { supabaseAdmin } from "../_lib/supabase";
import { ApiError } from "../_lib/errors";
import { logger } from "../_lib/logger";

// ---------------------------------------------------------------------------
// GET /api/users/check-username?username=<value>
// ---------------------------------------------------------------------------
// Real-time availability check. Requires auth so bots cannot enumerate names.
//
// Response: { available: boolean }
//   On validation failure: { available: false, error, message } with 400.
// ---------------------------------------------------------------------------

// 3-30 chars; lowercase letters, digits, underscores; no leading/trailing _.
const usernameSchema = z
  .string()
  .min(3, "Username must be at least 3 characters")
  .max(30, "Username must be 30 characters or fewer")
  .regex(
    /^[a-z0-9][a-z0-9_]{1,28}[a-z0-9]$|^[a-z0-9]{3}$/,
    "Username may only contain lowercase letters, numbers, and underscores, and cannot start or end with an underscore",
  );

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

    const raw =
      typeof req.query["username"] === "string"
        ? req.query["username"].toLowerCase().trim()
        : "";

    const parsed = usernameSchema.safeParse(raw);
    if (!parsed.success) {
      res.status(400).json({
        error: "INVALID_USERNAME",
        message: parsed.error.issues[0]?.message ?? "Invalid username format",
        available: false,
      });
      return;
    }

    const { data: existing } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .ilike("username", parsed.data)
      .neq("id", user.id)
      .maybeSingle();

    res.status(200).json({ available: !existing });
  } catch (err) {
    if (err instanceof ApiError) {
      res.status(err.statusCode).json(err.toJSON());
      return;
    }
    logger.error("GET /api/users/check-username failed", err);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Unexpected error." });
  }
}
