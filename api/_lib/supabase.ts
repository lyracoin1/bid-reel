import { createClient } from "@supabase/supabase-js";
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
