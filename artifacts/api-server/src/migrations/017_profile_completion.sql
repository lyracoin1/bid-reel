-- =============================================================================
-- BidReel — Migration 017: Profile Completion Flag
-- =============================================================================
-- Safe to re-run (idempotent).
-- Run in Supabase SQL editor.
-- =============================================================================

-- 1. Add is_completed flag.
--    Defaults to false (new users are incomplete until they set a username).
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_completed BOOLEAN NOT NULL DEFAULT false;

-- 2. Backfill: existing users who already have a username are completed.
UPDATE profiles
  SET is_completed = true
  WHERE username IS NOT NULL
    AND is_completed = false;

-- 3. Add partial index to speed up the cleanup query.
--    Only indexes rows that are actually incomplete — minimal footprint.
CREATE INDEX IF NOT EXISTS profiles_incomplete_idx
  ON profiles (created_at)
  WHERE is_completed = false;

-- 4. Add a trigger to auto-set is_completed = true whenever username is set.
CREATE OR REPLACE FUNCTION set_profile_completed()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.username IS NOT NULL AND OLD.username IS NULL THEN
    NEW.is_completed := true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_profile_completed ON profiles;
CREATE TRIGGER trg_set_profile_completed
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_profile_completed();

-- =============================================================================
-- Verification
-- =============================================================================
-- SELECT
--   COUNT(*) FILTER (WHERE is_completed = true)  AS completed,
--   COUNT(*) FILTER (WHERE is_completed = false) AS incomplete,
--   COUNT(*) FILTER (WHERE is_completed = false AND created_at < NOW() - INTERVAL '24 hours') AS expired
-- FROM profiles;
