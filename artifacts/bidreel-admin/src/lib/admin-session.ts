import { supabase } from "./supabase";

export async function getAdminToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export async function clearAdminSession(): Promise<void> {
  await supabase.auth.signOut();
}
