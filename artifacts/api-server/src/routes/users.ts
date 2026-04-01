/**
 * User profile routes
 *
 * GET    /api/users/me          — own full profile (authenticated)
 * PATCH  /api/users/me          — update own profile fields
 * GET    /api/users/:userId     — another user's public profile
 */

import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/requireAuth";
import {
  getOwnProfile,
  getPublicProfile,
  updateProfile,
} from "../lib/profiles";

const router: IRouter = Router();

// ─── GET /api/users/me ────────────────────────────────────────────────────────
// Returns the full own profile for the authenticated caller.
// Never returns phone number.
// ─────────────────────────────────────────────────────────────────────────────

router.get("/users/me", requireAuth, async (req, res) => {
  const profile = await getOwnProfile(req.user!.id);

  if (!profile) {
    res.status(404).json({
      error: "PROFILE_NOT_FOUND",
      message: "No profile found for this user.",
    });
    return;
  }

  res.json({ user: profile });
});

// ─── PATCH /api/users/me ──────────────────────────────────────────────────────
// Update safe profile fields: displayName, avatarUrl, bio.
// Protected fields (is_admin, is_banned, phone) are silently stripped.
// ─────────────────────────────────────────────────────────────────────────────

const updateProfileSchema = z.object({
  displayName: z
    .string()
    .min(2, "Display name must be at least 2 characters")
    .max(50, "Display name must be 50 characters or fewer")
    .optional(),
  avatarUrl: z
    .string()
    .url("avatarUrl must be a valid URL")
    .optional(),
  bio: z
    .string()
    .max(300, "Bio must be 300 characters or fewer")
    .optional(),
});

router.patch("/users/me", requireAuth, async (req, res) => {
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
      message: "Provide at least one field to update: displayName, avatarUrl, or bio.",
    });
    return;
  }

  let profile;
  try {
    profile = await updateProfile(req.user!.id, parsed.data);
  } catch (err) {
    req.log.error({ err }, "Profile update failed");
    res.status(500).json({
      error: "UPDATE_FAILED",
      message: "Could not update profile. Please try again.",
    });
    return;
  }

  if (!profile) {
    res.status(404).json({
      error: "PROFILE_NOT_FOUND",
      message: "No profile found for this user.",
    });
    return;
  }

  res.json({ user: profile });
});

// ─── GET /api/users/:userId ───────────────────────────────────────────────────
// Returns another user's public profile.
// Excludes phone, expo_push_token, ban_reason.
// ─────────────────────────────────────────────────────────────────────────────

const uuidSchema = z.string().uuid("userId must be a valid UUID");

router.get("/users/:userId", requireAuth, async (req, res) => {
  const parsed = uuidSchema.safeParse(req.params["userId"]);

  if (!parsed.success) {
    res.status(400).json({
      error: "INVALID_USER_ID",
      message: "userId must be a valid UUID.",
    });
    return;
  }

  const profile = await getPublicProfile(parsed.data);

  if (!profile) {
    res.status(404).json({
      error: "USER_NOT_FOUND",
      message: "No user found with that ID.",
    });
    return;
  }

  res.json({ user: profile });
});

export default router;
