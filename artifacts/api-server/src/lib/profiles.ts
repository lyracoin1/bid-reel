import { supabaseAdmin } from "./supabase";

// ─── Shapes ──────────────────────────────────────────────────────────────────

/**
 * Own profile — returned to the authenticated user only.
 * Phone is intentionally excluded at every level.
 */
export interface OwnProfile {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  auctionCount: number;
  totalLikesReceived: number;
  bidsPlacedCount: number;
  isAdmin: boolean;
  createdAt: string;
}

/**
 * Public profile — safe to return for any user lookup.
 * Never includes phone, expo_push_token, or ban_reason.
 */
export interface PublicProfile {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  auctionCount: number;
  totalLikesReceived: number;
  isBanned: boolean;
  createdAt: string;
}

interface ProfileRow {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  is_admin: boolean;
  is_banned: boolean;
  created_at: string;
}

// ─── Column selects ──────────────────────────────────────────────────────────

const PROFILE_COLS = "id, display_name, avatar_url, bio, is_admin, is_banned, created_at";

// ─── Typed errors ─────────────────────────────────────────────────────────────

export class PhoneAlreadyRegisteredError extends Error {
  readonly code = "PHONE_ALREADY_REGISTERED";
  constructor(phone: string) {
    super(`A profile with phone ${phone.slice(0, 4)}**** already exists under a different account.`);
    this.name = "PhoneAlreadyRegisteredError";
  }
}

// ─── Stats helpers ────────────────────────────────────────────────────────────

/**
 * Fetch aggregate stats for a user in parallel.
 * Returns counts derived from live table data (not cached).
 */
async function fetchProfileStats(userId: string): Promise<{
  auctionCount: number;
  totalLikesReceived: number;
  bidsPlacedCount: number;
}> {
  const [auctionsResult, bidsResult, likesResult] = await Promise.all([
    supabaseAdmin
      .from("auctions")
      .select("id", { count: "exact", head: true })
      .eq("seller_id", userId)
      .neq("status", "removed"),

    supabaseAdmin
      .from("bids")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId),

    supabaseAdmin
      .from("auctions")
      .select("like_count")
      .eq("seller_id", userId)
      .neq("status", "removed"),
  ]);

  const totalLikesReceived =
    (likesResult.data ?? []).reduce(
      (sum: number, row: { like_count: number }) => sum + (row.like_count ?? 0),
      0,
    );

  return {
    auctionCount: auctionsResult.count ?? 0,
    bidsPlacedCount: bidsResult.count ?? 0,
    totalLikesReceived,
  };
}

// ─── Mappers ─────────────────────────────────────────────────────────────────

function toOwnProfile(row: ProfileRow, stats: Awaited<ReturnType<typeof fetchProfileStats>>): OwnProfile {
  return {
    id: row.id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    bio: row.bio,
    isAdmin: row.is_admin ?? false,
    createdAt: row.created_at,
    ...stats,
  };
}

function toPublicProfile(row: ProfileRow, stats: Awaited<ReturnType<typeof fetchProfileStats>>): PublicProfile {
  return {
    id: row.id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    bio: row.bio,
    isBanned: row.is_banned ?? false,
    createdAt: row.created_at,
    ...stats,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Upserts a profile row on login.
 *
 * First login  → inserts a new row with the user's phone (server use only).
 * Return login → reads and returns the existing row without mutation.
 *
 * Enforces one account per phone number:
 * - If a profile already exists for the given userId, returns it.
 * - If a profile exists for a DIFFERENT userId with the same phone,
 *   throws PhoneAlreadyRegisteredError (prevents duplicate accounts).
 *
 * Phone is stored for WhatsApp link generation only.
 * It is NEVER returned in OwnProfile or PublicProfile.
 */
export async function upsertProfile(
  userId: string,
  phone: string,
): Promise<{ isNewUser: boolean; profile: OwnProfile }> {
  // 1. Fast path — profile already exists for this exact auth user
  const { data: existing } = await supabaseAdmin
    .from("profiles")
    .select(PROFILE_COLS)
    .eq("id", userId)
    .maybeSingle();

  if (existing) {
    const stats = await fetchProfileStats(userId);
    return { isNewUser: false, profile: toOwnProfile(existing, stats) };
  }

  // 2. Phone uniqueness check — reject if another account already owns this number
  const { data: phoneOwner } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();

  if (phoneOwner && phoneOwner.id !== userId) {
    throw new PhoneAlreadyRegisteredError(phone);
  }

  // 3. Create the new profile
  const { data: created, error } = await supabaseAdmin
    .from("profiles")
    .insert({ id: userId, phone })
    .select(PROFILE_COLS)
    .single();

  if (error) {
    // Postgres unique violation (code 23505) — DB-level enforcement
    if (error.code === "23505" && error.message.includes("phone")) {
      throw new PhoneAlreadyRegisteredError(phone);
    }
    throw new Error(
      `Failed to create profile for user ${userId}: ${error.message}`,
    );
  }

  if (!created) {
    throw new Error(`Failed to create profile for user ${userId}: no row returned`);
  }

  const stats = await fetchProfileStats(userId);
  return { isNewUser: true, profile: toOwnProfile(created, stats) };
}

/**
 * Fetch the authenticated user's own profile.
 * Returns OwnProfile (includes isAdmin) — never returns phone.
 */
export async function getOwnProfile(userId: string): Promise<OwnProfile | null> {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select(PROFILE_COLS)
    .eq("id", userId)
    .maybeSingle();

  if (!data) return null;

  const stats = await fetchProfileStats(userId);
  return toOwnProfile(data, stats);
}

/**
 * Fetch another user's public profile.
 * Returns PublicProfile (includes isBanned) — never returns phone.
 */
export async function getPublicProfile(userId: string): Promise<PublicProfile | null> {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select(PROFILE_COLS)
    .eq("id", userId)
    .maybeSingle();

  if (!data) return null;

  const stats = await fetchProfileStats(userId);
  return toPublicProfile(data, stats);
}

/**
 * Update the authenticated user's own profile.
 * Only allows safe fields: display_name, avatar_url, bio.
 * Ignores any attempt to set is_admin, is_banned, phone, etc.
 */
export interface UpdateProfileInput {
  displayName?: string;
  avatarUrl?: string;
  bio?: string;
}

export async function updateProfile(
  userId: string,
  input: UpdateProfileInput,
): Promise<OwnProfile | null> {
  const patch: Record<string, string | null> = {};

  if (input.displayName !== undefined) patch["display_name"] = input.displayName;
  if (input.avatarUrl !== undefined) patch["avatar_url"] = input.avatarUrl;
  if (input.bio !== undefined) patch["bio"] = input.bio;

  if (Object.keys(patch).length === 0) {
    return getOwnProfile(userId);
  }

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .update(patch)
    .eq("id", userId)
    .select(PROFILE_COLS)
    .single();

  if (error || !data) {
    throw new Error(`Failed to update profile for user ${userId}: ${error?.message ?? "unknown error"}`);
  }

  const stats = await fetchProfileStats(userId);
  return toOwnProfile(data, stats);
}

/**
 * Check whether a user account is banned.
 * Used by requireAuth middleware to block banned users early.
 */
export async function isUserBanned(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("is_banned")
    .eq("id", userId)
    .maybeSingle();

  return data?.is_banned === true;
}

/**
 * @deprecated Use getOwnProfile() instead.
 * Kept for backward compatibility with routes that still call getProfileById().
 */
export async function getProfileById(userId: string): Promise<OwnProfile | null> {
  return getOwnProfile(userId);
}
