import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

/**
 * Supabase client for the web app.
 *
 * persistSession: true  — stores the session in localStorage so the user stays
 *                         logged in across page reloads.
 * autoRefreshToken: true — automatically refreshes the access token before it
 *                          expires (Supabase default: 1-hour access tokens,
 *                          60-day refresh tokens).
 * detectSessionInUrl: true — processes magic-link / OAuth callback tokens that
 *                            Supabase appends to the URL after email verification.
 */
export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        storageKey: "bidreel:supabase:session",
      },
      realtime: {
        params: { eventsPerSecond: 10 },
      },
    })
  : null;
