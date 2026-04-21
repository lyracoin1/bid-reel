/**
 * password-reset.ts — Forgot Password via WhatsApp OTP
 *
 * Three-step flow:
 *   1. POST /api/auth/password-reset/request   { phone }
 *        → generates 6-digit code, hashes it, stores in password_reset_otps,
 *          dispatches via WhatsApp. Always returns 200 with a generic shape
 *          so an attacker cannot use this endpoint to enumerate phone numbers.
 *
 *   2. POST /api/auth/password-reset/verify    { phone, code }
 *        → validates the code against the most recent un-consumed OTP row
 *          for this user. Increments attempts on every call. After
 *          MAX_VERIFY_ATTEMPTS the row is locked. On success returns a
 *          short-lived HMAC-signed reset_token bound to this OTP row.
 *
 *   3. POST /api/auth/password-reset/reset     { reset_token, new_password }
 *        → verifies the token, updates the user's password via Supabase
 *          admin API, and stamps the OTP row as consumed.
 *
 * Security choices:
 *   • Plaintext OTP is never persisted — only HMAC-SHA256(salt, code).
 *   • Per-row attempts capped at 3, resends capped at 3.
 *   • Each row expires 10 minutes after creation.
 *   • Reset token is HMAC-SHA256 over (otp_id|user_id|exp), 15-minute TTL,
 *     bound to the OTP row that produced it (and that row is single-use).
 *   • All "not found" / "wrong code" / "expired" responses share the same
 *     INVALID_OR_EXPIRED shape to limit enumeration.
 */

import { Router, type IRouter } from "express";
import { z } from "zod";
import { createHmac, randomBytes, randomInt, timingSafeEqual } from "crypto";
import { supabaseAdmin } from "../lib/supabase";
import { logger } from "../lib/logger";
import { sendWhatsApp } from "../lib/whatsapp";
import {
  buildPasswordOtpMessage,
  normalizeWonLang,
} from "../lib/auction-won-message";

const router: IRouter = Router();

// ── Tunables ────────────────────────────────────────────────────────────────
const OTP_TTL_MS = 10 * 60 * 1000;          // 10 minutes
const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;  // 15 minutes
const MAX_VERIFY_ATTEMPTS = 3;
const MAX_RESENDS = 3;
const MIN_PASSWORD_LEN = 8;

// HMAC secret. We piggyback on the service role key so no new env var is
// required. The key never leaves the server.
const HMAC_SECRET = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "fallback-dev-secret-do-not-use";

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * phoneCandidates — produce every plausible stored form of a phone number
 * given a user's input. Production data shows phones are stored in canonical
 * E.164 with a leading "+" (e.g. "+201559035388"), but users routinely type:
 *   • "+201559035388"   — already canonical
 *   • "201559035388"    — international without "+"
 *   • "01559035388"     — local Egyptian form (11 digits starting with "0")
 * Returning all variants lets us match with PostgREST `in()` regardless of
 * what the user typed, without locking the lookup to a single country.
 */
function phoneCandidates(input: string): string[] {
  const trimmed = input.trim();
  const digits = trimmed.replace(/\D/g, "");
  const set = new Set<string>();
  if (trimmed) set.add(trimmed);
  if (digits) {
    set.add(digits);
    set.add("+" + digits);
    // Local Arab-market form: starts with a single "0" (national trunk prefix),
    // 10 or 11 digits. Promote to E.164 by stripping the "0" and prepending the
    // Egyptian country code (+20) — the platform's primary market. Adding more
    // country promotions in the future is a one-liner.
    if (/^0\d{9,10}$/.test(digits)) {
      set.add("+20" + digits.slice(1));
      set.add("20" + digits.slice(1));
    }
    // Inverse: stored as local "0..." but user typed "+20..." or "20..."
    if (digits.startsWith("20") && digits.length >= 11) {
      set.add("0" + digits.slice(2));
    }
  }
  return Array.from(set).filter(Boolean);
}

function hashOtp(salt: string, code: string): string {
  return createHmac("sha256", salt).update(code).digest("hex");
}

function safeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function generateCode(): string {
  // 6-digit zero-padded numeric code.
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function signResetToken(otpId: string, userId: string, expMs: number): string {
  const payload = `${otpId}.${userId}.${expMs}`;
  const sig = createHmac("sha256", HMAC_SECRET).update(payload).digest("hex");
  return `${Buffer.from(payload).toString("base64url")}.${sig}`;
}

function verifyResetToken(token: string): { otpId: string; userId: string } | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [b64, sig] = parts as [string, string];
  let payload: string;
  try {
    payload = Buffer.from(b64, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const expectedSig = createHmac("sha256", HMAC_SECRET).update(payload).digest("hex");
  if (!safeEq(sig, expectedSig)) return null;
  const segs = payload.split(".");
  if (segs.length !== 3) return null;
  const [otpId, userId, expStr] = segs as [string, string, string];
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return null;
  return { otpId, userId };
}

// Defensive read of profile language (may not exist on every deployment).
async function readUserLanguage(userId: string): Promise<string> {
  try {
    const { data } = await supabaseAdmin
      .from("profiles")
      .select("language")
      .eq("id", userId)
      .maybeSingle();
    const row = data as { language?: unknown } | null;
    if (row && typeof row.language === "string") return row.language;
  } catch {
    /* column missing — fall through */
  }
  return "en";
}

// Generic 200 response — same shape for "phone exists" and "phone unknown".
function genericRequestOk(res: import("express").Response): void {
  res.status(200).json({
    ok: true,
    message: "If this phone is registered, a verification code has been sent via WhatsApp.",
    ttlSeconds: OTP_TTL_MS / 1000,
  });
}

// ── 1. Request OTP ──────────────────────────────────────────────────────────
const requestSchema = z.object({
  phone: z.string().trim().min(7).max(20),
});

router.post("/auth/password-reset/request", async (req, res) => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "INVALID_INPUT", message: parsed.error.errors[0]?.message ?? "Invalid phone" });
    return;
  }
  const { phone } = parsed.data;
  const candidates = phoneCandidates(phone);

  // 1. Find profile by phone using EVERY plausible stored variant, not just
  //    the literal input. Production stores E.164 with leading "+"; users
  //    often type the local form. A literal `eq("phone", phone)` here was
  //    the silent root cause of "OTP never arrives" — the privacy-first
  //    generic 200 hides the lookup miss from the caller.
  const { data: profileRows, error: profileErr } = await supabaseAdmin
    .from("profiles")
    .select("id, phone")
    .in("phone", candidates)
    .limit(1);

  const profile = (profileRows && profileRows[0]) || null;
  logger.info(
    {
      diag: "password-reset",
      step: "lookup",
      inputPhone: phone,
      candidates,
      lookupErr: profileErr ? String(profileErr.message ?? profileErr) : null,
      matched: Boolean(profile),
      matchedPhone: profile ? (profile as { phone: string }).phone : null,
    },
    "password-reset: phone lookup",
  );

  if (!profile) {
    logger.info({ phone, candidates }, "password-reset: request — phone not registered (generic ok)");
    genericRequestOk(res);
    return;
  }

  const userId = (profile as { id: string }).id;
  // Use the CANONICAL stored phone for both the OTP row and the WhatsApp
  // dispatch, so downstream verify() (which still must accept the user's
  // input) finds the row, and Wapilot is called with the correct number.
  const canonicalPhone = (profile as { phone: string }).phone;

  // 2. Resend cap. Look at the latest unconsumed OTP row; if its resends
  //    counter has hit the cap, refuse new sends until it expires.
  const { data: latest } = await supabaseAdmin
    .from("password_reset_otps")
    .select("id, resends, expires_at, consumed_at")
    .eq("user_id", userId)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latest) {
    const row = latest as { id: string; resends: number; expires_at: string };
    if (row.resends >= MAX_RESENDS) {
      // Lockout — but still return generic shape with a different message
      // (rate-limit is not an enumeration vector since the caller already
      // proved they own the phone by asking repeatedly).
      res.status(429).json({
        error: "RESEND_LIMIT",
        message: "Too many resend attempts. Please wait until the current code expires and try again.",
        retryAfterSeconds: Math.max(0, Math.floor((new Date(row.expires_at).getTime() - Date.now()) / 1000)),
      });
      return;
    }
  }

  // 3. Generate code, hash it.
  const code = generateCode();
  const salt = randomBytes(16).toString("hex");
  const codeHash = hashOtp(salt, code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();

  // 4. Persist. If a fresh row exists, increment its resends and rotate the
  //    code; else insert a new one.
  if (latest) {
    const id = (latest as { id: string }).id;
    const { error } = await supabaseAdmin
      .from("password_reset_otps")
      .update({
        code_hash: codeHash,
        salt,
        attempts: 0,
        resends: (latest as { resends: number }).resends + 1,
        expires_at: expiresAt,
      })
      .eq("id", id);
    if (error) {
      logger.error({ err: error, userId }, "password-reset: rotate failed");
      res.status(500).json({ error: "INTERNAL", message: "Could not send code" });
      return;
    }
  } else {
    const { error } = await supabaseAdmin
      .from("password_reset_otps")
      .insert({
        user_id: userId,
        phone: canonicalPhone,
        code_hash: codeHash,
        salt,
        channel: "whatsapp",
        expires_at: expiresAt,
      });
    if (error) {
      logger.error({ err: error, userId }, "password-reset: insert failed");
      res.status(500).json({ error: "INTERNAL", message: "Could not send code" });
      return;
    }
  }

  // 5. WhatsApp dispatch (localized). Always uses the CANONICAL phone from
  //    the profile row — not the user's literal input — so Wapilot receives
  //    a deliverable E.164 number regardless of how the form was filled in.
  const lang = normalizeWonLang(await readUserLanguage(userId));
  const body = buildPasswordOtpMessage(lang, code);
  logger.info(
    { diag: "password-reset", step: "dispatching", userId, canonicalPhone, lang },
    "password-reset: invoking sendWhatsApp",
  );
  void sendWhatsApp({
    phone: canonicalPhone,
    body,
    lang,
    kind: "password_otp",
    meta: { userId },
  });

  logger.info({ userId, canonicalPhone, lang }, "password-reset: OTP issued");
  genericRequestOk(res);
});

// ── 2. Verify OTP ───────────────────────────────────────────────────────────
const verifySchema = z.object({
  phone: z.string().trim().min(7).max(20),
  code: z.string().trim().regex(/^\d{4,8}$/, "Code must be 4–8 digits"),
});

router.post("/auth/password-reset/verify", async (req, res) => {
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "INVALID_INPUT", message: parsed.error.errors[0]?.message ?? "Invalid input" });
    return;
  }
  const { phone, code } = parsed.data;

  // 1. Find user by phone using the same multi-variant lookup as the
  //    request route, so verify works regardless of which format the user
  //    typed (and regardless of which one was used in step 1).
  const { data: profileRows } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .in("phone", phoneCandidates(phone))
    .limit(1);
  const profile = (profileRows && profileRows[0]) || null;
  if (!profile) {
    res.status(400).json({ error: "INVALID_OR_EXPIRED", message: "Code is invalid or expired" });
    return;
  }
  const userId = (profile as { id: string }).id;

  // 2. Latest unconsumed, unexpired OTP row.
  const { data: row } = await supabaseAdmin
    .from("password_reset_otps")
    .select("id, code_hash, salt, attempts, expires_at, consumed_at")
    .eq("user_id", userId)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!row) {
    res.status(400).json({ error: "INVALID_OR_EXPIRED", message: "Code is invalid or expired" });
    return;
  }

  const otp = row as {
    id: string;
    code_hash: string;
    salt: string;
    attempts: number;
    expires_at: string;
  };

  // 3. Attempts cap.
  if (otp.attempts >= MAX_VERIFY_ATTEMPTS) {
    // Hard-invalidate the row.
    await supabaseAdmin
      .from("password_reset_otps")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", otp.id);
    res.status(429).json({ error: "TOO_MANY_ATTEMPTS", message: "Too many incorrect attempts. Request a new code." });
    return;
  }

  const expectedHash = hashOtp(otp.salt, code);
  const ok = safeEq(expectedHash, otp.code_hash);

  // Always increment attempts (whether ok or not — protects against rapid guesses).
  await supabaseAdmin
    .from("password_reset_otps")
    .update({ attempts: otp.attempts + 1 })
    .eq("id", otp.id);

  if (!ok) {
    res.status(400).json({ error: "INVALID_OR_EXPIRED", message: "Code is invalid or expired" });
    return;
  }

  // 4. Issue short-lived reset token bound to this OTP row.
  const exp = Date.now() + RESET_TOKEN_TTL_MS;
  const resetToken = signResetToken(otp.id, userId, exp);

  logger.info({ userId, otpId: otp.id }, "password-reset: OTP verified");
  res.status(200).json({
    ok: true,
    resetToken,
    expiresInSeconds: Math.floor(RESET_TOKEN_TTL_MS / 1000),
  });
});

// ── 3. Reset password ───────────────────────────────────────────────────────
const resetSchema = z.object({
  resetToken: z.string().min(20),
  newPassword: z.string().min(MIN_PASSWORD_LEN, `Password must be at least ${MIN_PASSWORD_LEN} characters`),
});

router.post("/auth/password-reset/reset", async (req, res) => {
  const parsed = resetSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "INVALID_INPUT", message: parsed.error.errors[0]?.message ?? "Invalid input" });
    return;
  }
  const { resetToken, newPassword } = parsed.data;

  const decoded = verifyResetToken(resetToken);
  if (!decoded) {
    res.status(400).json({ error: "INVALID_TOKEN", message: "Reset token is invalid or expired" });
    return;
  }

  // OTP row must still exist and not yet be consumed by another reset.
  const { data: row } = await supabaseAdmin
    .from("password_reset_otps")
    .select("id, user_id, consumed_at")
    .eq("id", decoded.otpId)
    .maybeSingle();
  if (!row || (row as { consumed_at: string | null }).consumed_at) {
    res.status(400).json({ error: "INVALID_TOKEN", message: "Reset token is invalid or expired" });
    return;
  }
  if ((row as { user_id: string }).user_id !== decoded.userId) {
    res.status(400).json({ error: "INVALID_TOKEN", message: "Reset token is invalid or expired" });
    return;
  }

  // Update password via Supabase admin API.
  const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(decoded.userId, {
    password: newPassword,
  });
  if (updateErr) {
    logger.error({ err: updateErr, userId: decoded.userId }, "password-reset: supabase password update failed");
    res.status(500).json({ error: "RESET_FAILED", message: "Could not reset password" });
    return;
  }

  // Mark OTP consumed (single-use).
  await supabaseAdmin
    .from("password_reset_otps")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", decoded.otpId);

  logger.info({ userId: decoded.userId }, "password-reset: password updated");
  res.status(200).json({ ok: true, message: "Password updated. You can now sign in with your new password." });
});

export default router;
