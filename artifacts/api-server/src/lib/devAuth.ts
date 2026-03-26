/**
 * devAuth.ts — Development-only authentication helper
 *
 * PURPOSE:
 *   Allows local development and API testing without a real SMS provider.
 *   Given a phone number, creates or retrieves a Supabase user and returns
 *   a real, valid session token — identical in shape to production auth.
 *
 * HOW IT WORKS:
 *   1. Derives a stable per-phone password using HMAC-SHA256 over the phone
 *      number, keyed by the SUPABASE_SERVICE_ROLE_KEY. This password is
 *      deterministic (same phone → same password) but unguessable from outside
 *      without the service role key.
 *
 *   2. Creates the Supabase Auth user (phone confirmed, with derived password)
 *      if they don't exist yet.
 *
 *   3. Signs in with phone + derived password to obtain a real Supabase JWT.
 *      This token is 100% compatible with requireAuth middleware.
 *
 * REQUIREMENTS:
 *   - USE_DEV_AUTH=true environment variable
 *   - NODE_ENV must NOT be "production"
 *   - Supabase project must have Phone auth enabled
 *   - The Supabase project must allow phone + password sign-in
 *     (Supabase Auth → Settings → Enable Phone provider — this is all that
 *     is needed; phone+password sign-in is implicit when a phone user has
 *     a password set via the admin API)
 *
 * SECURITY:
 *   - This module is never imported in production builds because the endpoint
 *     that calls it is guarded by two independent checks:
 *       (a) process.env.USE_DEV_AUTH !== 'true'
 *       (b) process.env.NODE_ENV === 'production'
 *   - The derived password is NOT stored anywhere in our codebase.
 *   - Dev users are real Supabase Auth users; clean up via Supabase dashboard
 *     when no longer needed.
 */

import { createHmac } from "crypto";
import { supabase, supabaseAdmin } from "./supabase";
import { upsertProfile } from "./profiles";
import type { PublicProfile } from "./profiles";

export interface DevLoginResult {
  token: string;
  isNewUser: boolean;
  user: PublicProfile;
}

/**
 * Derives a stable, server-side-only password for a dev phone user.
 * Unguessable without the SUPABASE_SERVICE_ROLE_KEY.
 */
function deriveDevPassword(phoneNumber: string): string {
  const secret = process.env["SUPABASE_SERVICE_ROLE_KEY"]!;
  return createHmac("sha256", secret).update(phoneNumber).digest("hex").slice(0, 32);
}

/**
 * Creates a Supabase Auth user for the phone number if one doesn't exist.
 * Returns the user's UUID.
 *
 * Strategy:
 *   - Attempt to create the user with `phone_confirm: true` and the derived password.
 *   - If creation fails with "already registered", find the existing user via
 *     listUsers() and refresh their password so subsequent sign-ins succeed.
 */
async function ensureUser(
  phoneNumber: string,
  derivedPassword: string,
): Promise<{ userId: string; isNewUser: boolean }> {
  // Attempt to create the user.
  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    phone: phoneNumber,
    phone_confirm: true,
    password: derivedPassword,
  });

  if (!createError && created.user) {
    return { userId: created.user.id, isNewUser: true };
  }

  // If user already exists, find them and update their password.
  // listUsers() is acceptable here — this is a dev-only code path.
  const { data: list, error: listError } = await supabaseAdmin.auth.admin.listUsers({
    perPage: 1000,
  });

  if (listError) {
    throw new Error(`Dev auth: failed to list users — ${listError.message}`);
  }

  const existing = list.users.find((u) => u.phone === phoneNumber);

  if (!existing) {
    // Re-throw the original creation error if we truly can't find the user.
    throw new Error(
      `Dev auth: could not create or locate user for ${phoneNumber.slice(0, 4)}**** — ${createError?.message}`,
    );
  }

  // Refresh the derived password in case the service role key changed.
  await supabaseAdmin.auth.admin.updateUserById(existing.id, {
    password: derivedPassword,
    phone_confirm: true,
  });

  return { userId: existing.id, isNewUser: false };
}

/**
 * Main dev-login flow.
 * Returns a real Supabase JWT + public profile (no phone exposed).
 */
export async function devLogin(phoneNumber: string): Promise<DevLoginResult> {
  const derivedPassword = deriveDevPassword(phoneNumber);

  // Step 1: ensure user exists in Supabase Auth.
  const { isNewUser } = await ensureUser(phoneNumber, derivedPassword);

  // Step 2: sign in with phone + derived password to get a real session.
  const { data: signIn, error: signInError } = await supabase.auth.signInWithPassword({
    phone: phoneNumber,
    password: derivedPassword,
  });

  if (signInError || !signIn.user || !signIn.session) {
    throw new Error(
      `Dev auth: sign-in failed for ${phoneNumber.slice(0, 4)}**** — ${signInError?.message ?? "no session returned"}. ` +
      "Ensure Phone auth is enabled in your Supabase project settings.",
    );
  }

  // Step 3: upsert profile — same logic as production OTP flow.
  const profileResult = await upsertProfile(
    signIn.user.id,
    signIn.user.phone ?? phoneNumber,
  );

  return {
    token: signIn.session.access_token,
    // isNewUser reflects profile creation, not just Auth user creation,
    // to stay consistent with the production verify-otp response shape.
    isNewUser: profileResult.isNewUser,
    user: profileResult.profile,
  };
}
