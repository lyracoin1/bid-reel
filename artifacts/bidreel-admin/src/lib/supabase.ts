import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    "[BidReel Admin] Supabase credentials are missing from the build.\n" +
    "Expected env vars at build time: SUPABASE_URL and SUPABASE_ANON_KEY\n" +
    "Current values — URL: " + (supabaseUrl || "(empty)") + ", KEY: " + (supabaseAnonKey ? "(set)" : "(empty)"),
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});
