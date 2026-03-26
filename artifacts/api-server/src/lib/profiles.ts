import { supabaseAdmin } from "./supabase";

// Shape returned to API consumers — phone is intentionally excluded.
export interface PublicProfile {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  auctionCount: number;
  totalLikesReceived: number;
  bidsPlacedCount: number;
  isAdmin: boolean;
  createdAt: string;
}

interface ProfileRow {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  is_admin: boolean;
  created_at: string;
}

function mapToPublicProfile(row: ProfileRow): PublicProfile {
  return {
    id: row.id,
    displayName: row.display_name ?? null,
    avatarUrl: row.avatar_url ?? null,
    // Counts start at 0 on first login; richer stats are returned by
    // dedicated profile endpoints that aggregate from other tables.
    auctionCount: 0,
    totalLikesReceived: 0,
    bidsPlacedCount: 0,
    isAdmin: row.is_admin ?? false,
    createdAt: row.created_at,
  };
}

const SELECT_COLS = "id, display_name, avatar_url, is_admin, created_at";

/**
 * Upserts a profile row on login.
 * - First login: inserts a new row with the user's phone (internal use only).
 * - Subsequent logins: returns the existing row, no mutation.
 *
 * Phone is stored server-side for WhatsApp link generation only.
 * It is NEVER included in the returned PublicProfile object.
 */
export async function upsertProfile(
  userId: string,
  phone: string,
): Promise<{ isNewUser: boolean; profile: PublicProfile }> {
  // Check for existing profile first to distinguish new vs returning user.
  const { data: existing } = await supabaseAdmin
    .from("profiles")
    .select(SELECT_COLS)
    .eq("id", userId)
    .maybeSingle();

  if (existing) {
    return { isNewUser: false, profile: mapToPublicProfile(existing) };
  }

  // First login — insert the profile row.
  // phone is stored here for internal use only (wa.me URL generation).
  const { data: created, error } = await supabaseAdmin
    .from("profiles")
    .insert({ id: userId, phone })
    .select(SELECT_COLS)
    .single();

  if (error || !created) {
    throw new Error(
      `Failed to create profile for user ${userId}: ${error?.message ?? "unknown error"}`,
    );
  }

  return { isNewUser: true, profile: mapToPublicProfile(created) };
}

/**
 * Fetch a profile by ID for use in authenticated responses.
 * Never returns phone.
 */
export async function getProfileById(
  userId: string,
): Promise<PublicProfile | null> {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select(SELECT_COLS)
    .eq("id", userId)
    .maybeSingle();

  return data ? mapToPublicProfile(data) : null;
}
