-- =============================================================================
-- BidReel — Migration 014: User Follows
-- =============================================================================
-- Safe to re-run (idempotent).
-- Run in Supabase SQL editor.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Create user_follows table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_follows (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id  UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  following_id UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_follows   UNIQUE (follower_id, following_id),
  CONSTRAINT chk_no_self_follow CHECK  (follower_id <> following_id)
);

-- ---------------------------------------------------------------------------
-- 2. Indexes for fast lookups in both directions
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_follows_follower  ON user_follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_follows_following ON user_follows(following_id);

-- ---------------------------------------------------------------------------
-- 3. RLS — service_role bypasses these; they protect direct SDK access
-- ---------------------------------------------------------------------------
ALTER TABLE user_follows ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_follows' AND policyname = 'follows_select_auth'
  ) THEN
    CREATE POLICY follows_select_auth
      ON user_follows FOR SELECT
      USING (auth.uid() IS NOT NULL);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_follows' AND policyname = 'follows_insert_own'
  ) THEN
    CREATE POLICY follows_insert_own
      ON user_follows FOR INSERT
      WITH CHECK (follower_id = auth.uid());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_follows' AND policyname = 'follows_delete_own'
  ) THEN
    CREATE POLICY follows_delete_own
      ON user_follows FOR DELETE
      USING (follower_id = auth.uid());
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Expand the notifications CHECK constraint to include new_follower
--    The original constraint only allowed a small set of types.
-- ---------------------------------------------------------------------------
ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'outbid',
    'auction_started',
    'auction_won',
    'new_bid',
    'new_bid_received',
    'auction_ending_soon',
    'auction_removed',
    'new_follower'
  ));

-- ---------------------------------------------------------------------------
-- 5. Verify
-- ---------------------------------------------------------------------------
SELECT 'user_follows table ready' AS status,
       COUNT(*) AS existing_rows
FROM user_follows;
