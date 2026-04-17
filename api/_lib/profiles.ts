import { supabaseAdmin } from "./supabase";

// ─── Shapes ──────────────────────────────────────────────────────────────────

/**
 * Own profile — returned to the authenticated user only.
 * Includes phone (WhatsApp contact) and location for profile completion.
 */
export interface OwnProfile {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  phone: string | null;
  location: string | null;
  auctionCount: number;
  totalLikesReceived: number;
  bidsPlacedCount: number;
  followersCount: number;
  followingCount: number;
  isAdmin: boolean;
  isCompleted: boolean;
  createdAt: string;
}

/**
 * Public profile — safe to return for any user lookup.
 * Never includes phone, expo_push_token, or ban_reason.
 */
export interface PublicProfile {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  auctionCount: number;
  totalLikesReceived: number;
  followersCount: number;
  followingCount: number;
  isBanned: boolean;
  isCompleted: boolean;
  createdAt: string;
}

interface ProfileRow {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  phone: string | null;
  location: string | null;
  is_admin: boolean;
  is_banned: boolean;
  created_at: string;
}

// ─── Column selects ──────────────────────────────────────────────────────────

const PROFILE_COLS =
  "id, username, display_name, avatar_url, bio, phone, location, is_admin, is_banned, created_at";

// ─── Profile completion ───────────────────────────────────────────────────────
// Mirrors artifacts/api-server/src/lib/profiles.ts isProfileComplete().
// All five user-editable fields must be set for a profile to be considered complete.
function isProfileComplete(row: ProfileRow): boolean {
  return (
    row.username !== null &&
    row.display_name !== null &&
    row.phone !== null &&
    row.avatar_url !== null &&
    row.location !== null
  );
}

// ─── Typed errors ─────────────────────────────────────────────────────────────

export class PhoneAlreadyRegisteredError extends Error {
  readonly code = "PHONE_ALREADY_REGISTERED";
  constructor(phone: string) {
    super(
      `A profile with phone ${phone.slice(0, 4)}**** already exists under a different account.`,
    );
    this.name = "PhoneAlreadyRegisteredError";
  }
}

export class UsernameTakenError extends Error {
  readonly code = "USERNAME_TAKEN";
  constructor(username: string) {
    super(
      `The username "${username}" is already taken. Please choose another one.`,
    );
    this.name = "UsernameTakenError";
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
  followersCount: number;
  followingCount: number;
}> {
  const [
    auctionsResult,
    bidsResult,
    likesResult,
    followersResult,
    followingResult,
  ] = await Promise.all([
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

    supabaseAdmin
      .from("user_follows")
      .select("id", { count: "exact", head: true })
      .eq("following_id", userId),

    supabaseAdmin
      .from("user_follows")
      .select("id", { count: "exact", head: true })
      .eq("follower_id", userId),
  ]);

  const totalLikesReceived = (likesResult.data ?? []).reduce(
    (sum: number, row: { like_count: number }) => sum + (row.like_count ?? 0),
    0,
  );

  return {
    auctionCount: auctionsResult.count ?? 0,
    bidsPlacedCount: bidsResult.count ?? 0,
    totalLikesReceived,
    followersCount: followersResult.count ?? 0,
    followingCount: followingResult.count ?? 0,
  };
}

// ─── Mappers ─────────────────────────────────────────────────────────────────

function toOwnProfile(
  row: ProfileRow,
  stats: Awaited<ReturnType<typeof fetchProfileStats>>,
): OwnProfile {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    bio: row.bio,
    phone: row.phone ?? null,
    location: row.location ?? null,
    isAdmin: row.is_admin ?? false,
    isCompleted: isProfileComplete(row),
    createdAt: row.created_at,
    ...stats,
  };
}

function toPublicProfile(
  row: ProfileRow,
  stats: Awaited<ReturnType<typeof fetchProfileStats>>,
): PublicProfile {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    bio: row.bio,
    isBanned: row.is_banned ?? false,
    isCompleted: row.username !== null,
    createdAt: row.created_at,
    ...stats,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Upserts a profile row on login.
 */
export async function upsertProfile(
  userId: string,
  phone: string,
): Promise<{ isNewUser: boolean; profile: OwnProfile }> {
  const { data: existing } = await supabaseAdmin
    .from("profiles")
    .select(PROFILE_COLS)
    .eq("id", userId)
    .maybeSingle();

  if (existing) {
    const stats = await fetchProfileStats(userId);
    return { isNewUser: false, profile: toOwnProfile(existing, stats) };
  }

  const { data: phoneOwner } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();

  if (phoneOwner && phoneOwner.id !== userId) {
    throw new PhoneAlreadyRegisteredError(phone);
  }

  const { data: created, error } = await supabaseAdmin
    .from("profiles")
    .insert({ id: userId, phone })
    .select(PROFILE_COLS)
    .single();

  if (error) {
    if (error.code === "23505" && error.message.includes("phone")) {
      throw new PhoneAlreadyRegisteredError(phone);
    }
    throw new Error(
      `Failed to create profile for user ${userId}: ${error.message}`,
    );
  }

  if (!created) {
    throw new Error(
      `Failed to create profile for user ${userId}: no row returned`,
    );
  }

  const stats = await fetchProfileStats(userId);
  return { isNewUser: true, profile: toOwnProfile(created, stats) };
}

/**
 * Fetch the authenticated user's own profile.
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
 */
export async function getPublicProfile(
  userId: string,
): Promise<PublicProfile | null> {
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
 */
export interface UpdateProfileInput {
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  bio?: string;
  phone?: string;
  location?: string;
}

export async function updateProfile(
  userId: string,
  input: UpdateProfileInput,
): Promise<OwnProfile | null> {
  const patch: Record<string, string | null> = {};

  if (input.username !== undefined) {
    const normalizedUsername = input.username.toLowerCase().trim();

    if (normalizedUsername.length > 0) {
      const { data: taken } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .ilike("username", normalizedUsername)
        .neq("id", userId)
        .maybeSingle();

      if (taken) {
        throw new UsernameTakenError(normalizedUsername);
      }
    }

    patch["username"] = normalizedUsername || null;
  }

  if (input.displayName !== undefined) patch["display_name"] = input.displayName;
  if (input.avatarUrl !== undefined) patch["avatar_url"] = input.avatarUrl;
  if (input.bio !== undefined) patch["bio"] = input.bio;
  if (input.phone !== undefined) patch["phone"] = input.phone;
  if (input.location !== undefined) patch["location"] = input.location;

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
    throw new Error(
      `Failed to update profile for user ${userId}: ${error?.message ?? "unknown error"}`,
    );
  }

  const stats = await fetchProfileStats(userId);
  return toOwnProfile(data, stats);
}

/**
 * Check whether a user account is banned.
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
 */
export async function getProfileById(userId: string): Promise<OwnProfile | null> {
  return getOwnProfile(userId);
}
