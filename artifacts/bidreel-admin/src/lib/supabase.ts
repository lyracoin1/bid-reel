import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    "[BidReel Admin] Supabase credentials are missing from the build.\n" +
    "Set SUPABASE_URL and SUPABASE_ANON_KEY in the Vercel project → Settings → Environment Variables.\n" +
    "Current values — URL: " + (supabaseUrl || "(empty)") + ", KEY: " + (supabaseAnonKey ? "(set)" : "(empty)"),
  );
}

/**
 * Supabase client for the admin panel.
 *
 * Returns null when credentials are missing from the build so that callers
 * can show a clear "not configured" error rather than making broken requests
 * to a relative URL that returns index.html (causing a cryptic "Network error").
 */
export const supabase = (supabaseUrl && supabaseAnonKey)
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        // Distinct key so the admin session never collides with the main web app's
        // Supabase session when both are opened on the same browser domain (e.g.
        // in the Replit dev environment where both services share a host).
        storageKey: "bidreel:admin:supabase:session",
      },
    })
  : null;
