import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env["SUPABASE_URL"];
const supabaseAnonKey = process.env["SUPABASE_ANON_KEY"];
const supabaseServiceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];

if (!supabaseUrl) throw new Error("SUPABASE_URL is required");
if (!supabaseAnonKey) throw new Error("SUPABASE_ANON_KEY is required");
if (!supabaseServiceRoleKey)
  throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");

const clientOptions = {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
} as const;

// Anon client — used for auth operations (OTP send/verify).
// Operates under RLS with anon / authenticated permissions.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, clientOptions);

// Admin client — service_role key, bypasses RLS.
// NEVER expose this key or this client to frontend code.
// Use only in server-side routes (profile creation, admin actions, phone lookup).
export const supabaseAdmin = createClient(
  supabaseUrl,
  supabaseServiceRoleKey,
  clientOptions,
);
