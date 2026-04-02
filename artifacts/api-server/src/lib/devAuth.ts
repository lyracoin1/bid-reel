/**
 * devAuth.ts — Development-only authentication helper
 *
 * Creates/retrieves a Supabase Auth user keyed by a derived email
 * (email auth works without any Supabase provider configuration).
 * The profile row stores the real phone number as usual.
 *
 * UNIQUE PHONE ENFORCEMENT:
 * If a profile with the given phone already exists under a DIFFERENT auth user
 * (e.g. a legacy OTP-based user), dev-login migrates the profile to the new
 * email-based auth user so one phone = one account is preserved.
 */

import { createHmac } from "crypto";
import { supabase, supabaseAdmin } from "./supabase";
import { upsertProfile, PhoneAlreadyRegisteredError } from "./profiles";
import type { OwnProfile } from "./profiles";

export interface DevLoginResult {
  token: string;
  isNewUser: boolean;
  user: OwnProfile;
}

function deriveDevPassword(phoneNumber: string): string {
  const secret = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "bidreel-dev-fallback";
  return createHmac("sha256", secret).update(phoneNumber).digest("hex").slice(0, 32);
}

function deriveDevEmail(phoneNumber: string): string {
  const hash = createHmac("sha256", "bidreel-dev-email")
    .update(phoneNumber)
    .digest("hex")
    .slice(0, 16);
  return `dev-${hash}@bidreel.internal`;
}

async function ensureEmailUser(
  derivedEmail: string,
  derivedPassword: string,
): Promise<string> {
  // Try to create a new email user (no phone on auth.user — avoids phone conflicts).
  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email: derivedEmail,
    email_confirm: true,
    password: derivedPassword,
  });

  if (!createError && created.user) {
    return created.user.id;
  }

  // Already exists — look up by email.
  const { data: list, error: listError } = await supabaseAdmin.auth.admin.listUsers({
    perPage: 1000,
  });

  if (listError) {
    throw new Error(`Dev auth: listUsers failed — ${listError.message}`);
  }

  const existing = list.users.find((u) => u.email === derivedEmail);

  if (!existing) {
    throw new Error(
      `Dev auth: could not create or find user for derived email. createUser error: ${createError?.message}`,
    );
  }

  // Refresh the password in case the service role key changed.
  await supabaseAdmin.auth.admin.updateUserById(existing.id, {
    email_confirm: true,
    password: derivedPassword,
  });

  return existing.id;
}

/**
 * If a profile for this phone exists under a DIFFERENT auth userId,
 * migrate it: delete the old profile and let upsertProfile create a fresh one
 * under the current dev-login auth user.
 *
 * This handles the case where a legacy OTP-based account existed for the
 * same phone number — the dev-login email-based user takes ownership.
 */
async function reconcilePhoneOwnership(
  userId: string,
  phone: string,
): Promise<void> {
  const { data: existingProfile } = await supabaseAdmin
    .from("profiles")
    .select("id, is_admin, display_name, avatar_url, bio")
    .eq("phone", phone)
    .maybeSingle();

  if (!existingProfile || existingProfile.id === userId) {
    return; // No conflict
  }

  // Delete the orphaned legacy profile so the dev-login user can take over
  await supabaseAdmin
    .from("profiles")
    .delete()
    .eq("id", existingProfile.id);

  // Also try to delete the orphaned auth user (best-effort — may fail if already gone)
  await supabaseAdmin.auth.admin.deleteUser(existingProfile.id).catch(() => null);
}

export async function devLogin(phoneNumber: string): Promise<DevLoginResult> {
  const maskedPhone = phoneNumber.length > 4 ? phoneNumber.slice(0, 4) + "****" : "****";
  console.log(`[devAuth] login attempt — phone=${maskedPhone}`);

  const derivedPassword = deriveDevPassword(phoneNumber);
  const derivedEmail = deriveDevEmail(phoneNumber);

  // Step 1: get or create an email-based auth user (deterministic per phone).
  const userId = await ensureEmailUser(derivedEmail, derivedPassword);

  // Step 2: sign in via email+password (works without Phone auth enabled).
  const { data: signIn, error: signInError } = await supabase.auth.signInWithPassword({
    email: derivedEmail,
    password: derivedPassword,
  });

  if (signInError || !signIn.user || !signIn.session) {
    throw new Error(
      `Dev auth: email sign-in failed — ${signInError?.message ?? "no session returned"}`,
    );
  }

  // Step 3: resolve any phone ownership conflict from legacy OTP users.
  await reconcilePhoneOwnership(userId, phoneNumber);

  // Step 4: upsert the profile row with the real phone number.
  let profileResult;
  try {
    profileResult = await upsertProfile(userId, phoneNumber);
  } catch (err) {
    if (err instanceof PhoneAlreadyRegisteredError) {
      // Should not reach here after reconcilePhoneOwnership, but guard anyway.
      throw new Error(
        `Dev auth: phone ${phoneNumber.slice(0, 4)}**** is already registered to another account. ` +
        `This should not happen — check the profiles table for duplicates.`,
      );
    }
    throw err;
  }

  const result = {
    token: signIn.session.access_token,
    isNewUser: profileResult.isNewUser,
    user: profileResult.profile,
  };

  console.log(
    `[devAuth] ✅ resolved — phone=${maskedPhone} userId=${userId} ` +
    `isNew=${result.isNewUser} isAdmin=${result.user.isAdmin}`
  );

  return result;
}
