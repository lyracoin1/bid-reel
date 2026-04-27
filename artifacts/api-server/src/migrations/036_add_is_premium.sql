-- =============================================================================
-- BidReel — Migration 036: Add is_premium flag to profiles
-- =============================================================================
-- Placeholder column for Google Play Billing subscription support.
-- Billing verification logic is not implemented yet; this field defaults to
-- false for all existing and new users until a verified purchase token is
-- received from the Play Store. The API already returns isPremium in both
-- the own-profile (GET /api/users/me) and public-profile responses.
-- Fully idempotent — safe to re-run.
-- =============================================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_premium BOOLEAN NOT NULL DEFAULT FALSE;

-- Partial index — only indexes the minority of premium rows; keeps the
-- main profiles index lean for the common free-user case.
CREATE INDEX IF NOT EXISTS idx_profiles_is_premium
  ON profiles (is_premium)
  WHERE is_premium = TRUE;
