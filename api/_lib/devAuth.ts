/**
 * devAuth.ts — Development-only authentication helper
 *
 * Creates/retrieves a Supabase Auth user keyed by a derived email address
 * (email auth works without any Supabase provider configuration).
 * The profile row stores the real phone number as usual.
 *
 * UNIQUE PHONE ENFORCEMENT:
 * If a profile for this phone exists under a DIFFERENT auth user (e.g. a
 * legacy OTP-based account), dev-login migrates the profile to the new
 * email-based auth user so one phone = one account is preserved.
 *
 * SCALABILITY FIX (vs. old Express backend):
 * The old fallback used listUsers({ perPage: 1000 }) — O(N) and brittle.
 * This version looks up by phone in the profiles table — O(1) indexed query.
 */

import { createHmac } from "crypto";
import { supabaseAdmin, authAdmin, goTrueAnonAuth } from "./supabase";
import { upsertProfile, PhoneAlreadyRegisteredError } from "./profiles";
import type { OwnProfile } from "./profiles";

export interface DevLoginResult {
  token: string;
  isNewUser: boolean;
  user: OwnProfile;
}

function deriveDevPassword(phoneNumber: string): string {
  const secret =
    process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "bidreel-dev-fallback";
  return createHmac("sha256", secret)
    .update(phoneNumber)
    .digest("hex")
    .slice(0, 32);
}

function deriveDevEmail(phoneNumber: string): string {
  const hash = createHmac("sha256", "bidreel-dev-email")
    .update(phoneNumber)
    .digest("hex")
    .slice(0, 16);
  return `dev-${hash}@bidreel.internal`;
}

/**
 * Get or create an email-based auth user for the given phone.
 *
 * Scalability fix: when creation fails (user already exists), we look up
 * the auth user ID by querying the profiles table by phone (O(1) indexed
 * lookup) instead of paginating through all users with listUsers().
 */
async function ensureEmailUser(
  derivedEmail: string,
  derivedPassword: string,
  phone: string,
): Promise<string> {
  const { data: created, error: createError } =
    await authAdmin.createUser({
      email: derivedEmail,
      email_confirm: true,
      password: derivedPassword,
    });

  if (!createError && created.user) {
    return created.user.id;
  }

  // User already exists — look up by phone in the profiles table.
  // The profiles.phone column is indexed and uniquely constrained.
  // If the profile row doesn't exist yet (extremely unlikely race), fall
  // through to the error below.
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();

  if (profile?.id) {
    // Refresh the password so sign-in works if the service role key changed.
    await authAdmin.updateUserById(profile.id, {
      email_confirm: true,
      password: derivedPassword,
    });
    return profile.id;
  }

  throw new Error(
    `Dev auth: could not create or find auth user for derived email. ` +
      `createUser error: ${createError?.message ?? "unknown"}`,
  );
}

/**
 * If a profile for this phone exists under a DIFFERENT auth userId,
 * migrate it: delete the old profile and let upsertProfile create a fresh
 * one under the current dev-login auth user.
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
    return;
  }

  await supabaseAdmin.from("profiles").delete().eq("id", existingProfile.id);

  await authAdmin.deleteUser(existingProfile.id).catch(() => null);
}

export async function devLogin(phoneNumber: string): Promise<DevLoginResult> {
  const maskedPhone =
    phoneNumber.length > 4 ? phoneNumber.slice(0, 4) + "****" : "****";
  console.log(`[devAuth] login attempt — phone=${maskedPhone}`);

  const derivedPassword = deriveDevPassword(phoneNumber);
  const derivedEmail = deriveDevEmail(phoneNumber);

  // Step 1: get or create an email-based auth user (deterministic per phone).
  const userId = await ensureEmailUser(derivedEmail, derivedPassword, phoneNumber);

  // Step 2: sign in via email+password.
  const { data: signIn, error: signInError } =
    await goTrueAnonAuth.signInWithPassword({
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
      throw new Error(
        `Dev auth: phone ${phoneNumber.slice(0, 4)}**** is already registered ` +
          `to another account. Check the profiles table for duplicates.`,
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
      `isNew=${result.isNewUser} isAdmin=${result.user.isAdmin}`,
  );

  return result;
}
