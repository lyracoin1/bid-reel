import { createClient } from "@supabase/supabase-js";
import type { GoTrueClient } from "@supabase/supabase-js";
import { requireEnv } from "./env";

const clientOptions = {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
} as const;

// Anon client — used for auth operations (OTP send/verify, sign-in).
// Operates under RLS with anon / authenticated permissions.
export const supabase = createClient(
  requireEnv("SUPABASE_URL"),
  requireEnv("SUPABASE_ANON_KEY"),
  clientOptions,
);

// Admin client — service_role key, bypasses RLS.
// NEVER expose this client or key to any frontend code.
// Use only inside serverless API functions.
export const supabaseAdmin = createClient(
  requireEnv("SUPABASE_URL"),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  clientOptions,
);

// supabase-js@2.100.0 changed SupabaseClient.auth from GoTrueClient to
// SupabaseAuthClient (extends AuthClient), removing typed accessors that only
// exist on GoTrueClient (.admin, .getUser(jwt), etc.).
// The underlying runtime object is still a GoTrueClient; these casts restore
// type-safe access without changing any runtime behaviour.

// Typed access to admin auth methods (createUser, updateUserById, deleteUser …).
// Use instead of supabaseAdmin.auth.admin.xxx().
export const authAdmin = (supabaseAdmin.auth as unknown as GoTrueClient).admin;

// Typed access to GoTrueClient methods that are missing from SupabaseAuthClient
// in 2.100.0, specifically getUser(jwt) used to verify Bearer tokens.
// Use instead of supabaseAdmin.auth.getUser(jwt).
export const goTrueAuth = supabaseAdmin.auth as unknown as GoTrueClient;
