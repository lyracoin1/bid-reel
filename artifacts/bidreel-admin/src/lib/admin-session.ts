import { supabase } from "./supabase";

export async function getAdminToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export async function clearAdminSession(): Promise<void> {
  if (!supabase) return;
  await supabase.auth.signOut();
}
