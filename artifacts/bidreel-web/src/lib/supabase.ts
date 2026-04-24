import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ||
  "https://zhbfbjwagehwetyqljjr.supabase.co";

const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpoYmZiandhZ2Vod2V0eXFsampyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1NDQxNDUsImV4cCI6MjA5MDEyMDE0NX0.A6RyEYtO8Fhdt0Gi5rRLnGUZshUYK6ltF6BaMrOkO1g";

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