import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// TEMPORARY debug log
console.log("SUPABASE URL:", supabaseUrl);

/**
 * Supabase client for the web app.
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
