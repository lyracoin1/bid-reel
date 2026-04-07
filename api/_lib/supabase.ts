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
// SupabaseAuthClient (extends AuthClient), removing the typed .admin accessor.
// The underlying runtime object is still a GoTrueClient with full admin methods;
// this cast restores type-safe access to .admin without changing any behaviour.
// All callers must use authAdmin.xxx() instead of supabaseAdmin.auth.admin.xxx().
export const authAdmin = (supabaseAdmin.auth as unknown as GoTrueClient).admin;
