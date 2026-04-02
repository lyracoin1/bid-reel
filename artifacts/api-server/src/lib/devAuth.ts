/**
 * devAuth.ts — Development-only authentication helper
 *
 * Creates/retrieves a Supabase Auth user keyed by a derived email
 * (email auth works without any Supabase provider configuration).
 * The profile row stores the real phone number as usual.
 */

import { createHmac } from "crypto";
import { supabase, supabaseAdmin } from "./supabase";
import { upsertProfile } from "./profiles";
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

export async function devLogin(phoneNumber: string): Promise<DevLoginResult> {
  const derivedPassword = deriveDevPassword(phoneNumber);
  const derivedEmail = deriveDevEmail(phoneNumber);

  // Step 1: get or create an email-based auth user.
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

  // Step 3: upsert the profile row with the real phone number.
  const profileResult = await upsertProfile(userId, phoneNumber);

  return {
    token: signIn.session.access_token,
    isNewUser: profileResult.isNewUser,
    user: profileResult.profile,
  };
}
