import { Router, type IRouter } from "express";
import { createHash } from "crypto";
import { upsertProfile, getOwnProfile } from "../lib/profiles";
import { requireAuth } from "../middlewares/requireAuth";
import { supabase, supabaseAdmin } from "../lib/supabase";
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

// ---------------------------------------------------------------------------
// POST /api/auth/forgot-password
// ---------------------------------------------------------------------------
// Sends a password-reset email via Supabase with per-email rate limiting.
//
// SECURITY MODEL
// ──────────────
// • No authentication required (the user is locked out of their account).
// • Email is normalised (trim + lowercase) before hashing. Only the SHA-256
//   hash is stored — the raw address is never persisted (PII minimisation).
// • Max 3 reset emails per email address per 24-hour window.
// • Always returns HTTP 200 with the same generic response regardless of
//   whether the email is registered or the rate limit is reached — prevents
//   email enumeration and timing attacks.
// • Any Supabase errors are logged server-side but never surfaced to the client.
//
// SUPABASE SMTP NOTE
// ──────────────────
// Supabase's free-tier built-in SMTP has a hard project-level rate limit
// (typically 3–4 emails per hour across the whole project). Once that cap is
// hit, emails stop silently. For production with higher traffic, configure a
// custom SMTP provider (Resend, SendGrid, Mailgun, or Postmark) in the
// Supabase dashboard → Project Settings → Auth → SMTP Settings.
// ---------------------------------------------------------------------------

const RESET_MAX_PER_WINDOW = 3;
const RESET_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
const RESET_REDIRECT_URL = "https://www.bid-reel.com/reset-password";

function hashEmail(email: string): string {
  return createHash("sha256").update(email).digest("hex");
}

router.post("/auth/forgot-password", async (req, res) => {
  // Always return the same generic response — never reveal whether the email
  // exists, whether it was rate-limited, or whether Supabase returned an error.
  const GENERIC_OK = {
    message: "If this email is registered, a reset link has been sent.",
  };

  const raw = req.body?.email;
  if (typeof raw !== "string" || !raw.trim()) {
    // Return generic success even for empty/missing email — don't leak anything.
    res.json(GENERIC_OK);
    return;
  }

  const email = raw.trim().toLowerCase();
  const emailHash = hashEmail(email);

  try {
    // ── Step 1: check / upsert the rate-limit row ──────────────────────────
    const windowCutoff = new Date(Date.now() - RESET_WINDOW_MS).toISOString();

    const { data: existing, error: selectErr } = await supabaseAdmin
      .from("password_reset_requests")
      .select("id, request_count, window_start")
      .eq("email_hash", emailHash)
      .maybeSingle();

    if (selectErr) {
      logger.error({ err: selectErr.message, emailHash }, "forgot-password: rate-limit SELECT failed");
      // Fail open: allow the reset attempt rather than blocking the user due to a DB error.
    }

    if (existing) {
      const windowActive = existing.window_start > windowCutoff;

      if (windowActive && existing.request_count >= RESET_MAX_PER_WINDOW) {
        // Rate limit reached — do NOT call Supabase. Log and return generic success.
        logger.warn(
          { emailHash, count: existing.request_count, windowStart: existing.window_start },
          "forgot-password: rate limit reached — suppressing Supabase call",
        );
        res.json(GENERIC_OK);
        return;
      }

      // Update the existing row: reset the window if expired, otherwise increment.
      const newCount = windowActive ? existing.request_count + 1 : 1;
      const newWindowStart = windowActive ? undefined : new Date().toISOString();

      const updatePayload: Record<string, unknown> = {
        request_count: newCount,
        last_request_at: new Date().toISOString(),
      };
      if (newWindowStart) updatePayload["window_start"] = newWindowStart;

      const { error: updateErr } = await supabaseAdmin
        .from("password_reset_requests")
        .update(updatePayload)
        .eq("id", existing.id);

      if (updateErr) {
        logger.error({ err: updateErr.message, emailHash }, "forgot-password: rate-limit UPDATE failed");
      }
    } else {
      // First-ever request for this email — insert the row.
      const { error: insertErr } = await supabaseAdmin
        .from("password_reset_requests")
        .insert({
          email_hash: emailHash,
          request_count: 1,
          window_start: new Date().toISOString(),
          last_request_at: new Date().toISOString(),
        });

      if (insertErr) {
        logger.error({ err: insertErr.message, emailHash }, "forgot-password: rate-limit INSERT failed");
      }
    }

    // ── Step 2: call Supabase to send the reset email ─────────────────────
    // Uses the service-role client so errors are visible server-side.
    // The response is always the same generic message regardless of outcome.
    const { error: sbErr } = await supabaseAdmin.auth.resetPasswordForEmail(email, {
      redirectTo: RESET_REDIRECT_URL,
    });

    if (sbErr) {
      logger.error(
        { err: sbErr.message, code: sbErr.code, status: sbErr.status, emailHash },
        "forgot-password: Supabase resetPasswordForEmail failed",
      );
      // Do NOT propagate — return generic success to avoid leaking account existence.
    } else {
      logger.info({ emailHash }, "forgot-password: reset email dispatched via Supabase");
    }

  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : err }, "forgot-password: unexpected error");
    // Still return generic success — never expose internals.
  }

  res.json(GENERIC_OK);
});

export default router;
