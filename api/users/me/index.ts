import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { requireAuth } from "../../_lib/requireAuth";
import { supabaseAdmin } from "../../_lib/supabase";
import {
  getOwnProfile,
  updateProfile,
  UsernameTakenError,
} from "../../_lib/profiles";
import { ApiError } from "../../_lib/errors";
import { logger } from "../../_lib/logger";

// ---------------------------------------------------------------------------
// /api/users/me  —  GET | PATCH | DELETE
// ---------------------------------------------------------------------------

// ─── Shared username schema ──────────────────────────────────────────────────
// 3-30 chars; lowercase letters, digits, underscores; no leading/trailing _.
const usernameSchema = z
  .string()
  .min(3, "Username must be at least 3 characters")
  .max(30, "Username must be 30 characters or fewer")
  .regex(
    /^[a-z0-9][a-z0-9_]{1,28}[a-z0-9]$|^[a-z0-9]{3}$/,
    "Username may only contain lowercase letters, numbers, and underscores, and cannot start or end with an underscore",
  );

const updateProfileSchema = z.object({
  username: usernameSchema
    .transform((v) => v.toLowerCase().trim())
    .optional(),
  displayName: z
    .string()
    .min(2, "Display name must be at least 2 characters")
    .max(50, "Display name must be 50 characters or fewer")
    .trim()
    .optional(),
  avatarUrl: z.string().url("avatarUrl must be a valid URL").optional(),
  bio: z
    .string()
    .max(300, "Bio must be 300 characters or fewer")
    .trim()
    .optional(),
});

// ─── GET /api/users/me ───────────────────────────────────────────────────────
// Returns the authenticated user's full own profile.
// Response: { user: OwnProfile }
async function handleGet(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  const user = await requireAuth(req.headers["authorization"]);
  const profile = await getOwnProfile(user.id);

  if (!profile) {
    res.status(404).json({
      error: "PROFILE_NOT_FOUND",
      message: "No profile found for this user.",
    });
    return;
  }

  res.status(200).json({ user: profile });
}

// ─── PATCH /api/users/me ─────────────────────────────────────────────────────
// Update safe profile fields: username, displayName, avatarUrl, bio.
// Protected fields (is_admin, is_banned, phone) are silently stripped.
// Response: { user: OwnProfile }
async function handlePatch(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  const user = await requireAuth(req.headers["authorization"]);

  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: parsed.error.issues[0]?.message ?? "Invalid request body",
    });
    return;
  }

  if (Object.keys(parsed.data).length === 0) {
    res.status(400).json({
      error: "EMPTY_UPDATE",
      message:
        "Provide at least one field to update: username, displayName, avatarUrl, or bio.",
    });
    return;
  }

  let profile;
  try {
    profile = await updateProfile(user.id, parsed.data);
  } catch (err) {
    if (err instanceof UsernameTakenError) {
      res.status(409).json({ error: err.code, message: err.message });
      return;
    }
    throw err;
  }

  if (!profile) {
    res.status(404).json({
      error: "PROFILE_NOT_FOUND",
      message: "No profile found for this user.",
    });
    return;
  }

  res.status(200).json({ user: profile });
}

// ─── DELETE /api/users/me ─────────────────────────────────────────────────────
// Permanently deletes the authenticated user's account:
//   1. Anonymises their auctions (seller_id → null) to preserve history.
//   2. Deletes the profile row (cascades: follows, saves, device tokens via FK).
//   3. Deletes the Supabase Auth user — irreversible.
// Response: { success: true, message: string }
async function handleDelete(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  const user = await requireAuth(req.headers["authorization"]);
  const userId = user.id;

  // 1. Anonymise auctions (preserve auction integrity)
  await supabaseAdmin
    .from("auctions")
    .update({ seller_id: null } as never)
    .eq("seller_id", userId);

  // 2. Delete profile row (cascades follows, saves, device tokens via FK)
  await supabaseAdmin.from("profiles").delete().eq("id", userId);

  // 3. Delete the Supabase Auth user — irreversible
  const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (authError) {
    logger.error("DELETE /api/users/me: auth deletion failed", {
      err: authError,
      userId,
    });
    res.status(500).json({
      error: "DELETE_FAILED",
      message: "Could not delete account. Please try again or contact support.",
    });
    return;
  }

  logger.info("DELETE /api/users/me: account permanently deleted", { userId });
  res.status(200).json({ success: true, message: "Account permanently deleted." });
}

// ─── Router ──────────────────────────────────────────────────────────────────

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  try {
    if (req.method === "GET") return await handleGet(req, res);
    if (req.method === "PATCH") return await handlePatch(req, res);
    if (req.method === "DELETE") return await handleDelete(req, res);

    res.status(405).json({
      error: "METHOD_NOT_ALLOWED",
      message: "Allowed methods: GET, PATCH, DELETE",
    });
  } catch (err) {
    if (err instanceof ApiError) {
      res.status(err.statusCode).json(err.toJSON());
      return;
    }
    logger.error(`${req.method} /api/users/me failed`, err);
    res.status(500).json({
      error: "INTERNAL_ERROR",
      message: "Unexpected error.",
    });
  }
}
