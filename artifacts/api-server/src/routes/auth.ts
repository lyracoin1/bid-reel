import { Router, type IRouter } from "express";
import { upsertProfile, getOwnProfile } from "../lib/profiles";
import { requireAuth } from "../middlewares/requireAuth";
import { supabase } from "../lib/supabase";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// POST /api/auth/ensure-profile
// ---------------------------------------------------------------------------
// Called by the web app immediately after a Supabase email+password login.
// Guarantees that a profiles row exists for the authenticated user.
// If the DB trigger already created the row on signup, this is a fast no-op.
// If the row is missing (legacy account or trigger not yet applied), it creates one.
// Returns { isNewUser, user }.
// ---------------------------------------------------------------------------
router.post("/auth/ensure-profile", requireAuth, async (req, res) => {
  try {
    const result = await upsertProfile(req.user!.id, req.user!.email);
    res.json({
      isNewUser: result.isNewUser,
      user: result.profile,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error({ err: message, userId: req.user!.id }, "ensure-profile failed");
    res.status(500).json({ error: "PROFILE_ERROR", message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/auth/me
// ---------------------------------------------------------------------------
router.get("/auth/me", requireAuth, async (req, res) => {
  const profile = await getOwnProfile(req.user!.id);
  if (!profile) {
    res.status(404).json({ error: "PROFILE_NOT_FOUND", message: "Profile not found." });
    return;
  }
  res.json(profile);
});

// ---------------------------------------------------------------------------
// POST /api/auth/logout
// ---------------------------------------------------------------------------
router.post("/auth/logout", requireAuth, async (_req, res) => {
  await supabase.auth.signOut();
  res.json({ message: "Logged out" });
});

export default router;
