-- =============================================================================
-- BidReel — Migration 016: Unique Username
-- =============================================================================
-- Safe to re-run (idempotent).
-- Run in Supabase SQL editor.
-- =============================================================================

-- 1. Add username column (nullable so existing rows are unaffected).
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS username TEXT;

-- 2. Case-insensitive unique index (partial — only enforced on non-NULL rows).
--    This prevents two users picking "Alice" and "alice" as the same handle.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_ci_unique
  ON profiles (LOWER(username))
  WHERE username IS NOT NULL;

-- 3. Tighten the display_name column: cap at 50 chars at DB level.
--    (The API already enforces this via Zod, but defence in depth.)
ALTER TABLE profiles
  ALTER COLUMN display_name TYPE VARCHAR(50);

-- 4. Index for fast username lookups (profile page, search).
CREATE INDEX IF NOT EXISTS profiles_username_idx
  ON profiles (username);

-- =============================================================================
-- Verification
-- =============================================================================
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'profiles' AND column_name IN ('username', 'display_name');
