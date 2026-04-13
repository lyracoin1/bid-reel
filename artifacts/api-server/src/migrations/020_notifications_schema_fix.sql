-- =============================================================================
-- Migration 020: Fix notifications schema
-- =============================================================================
-- Run ONCE in the Supabase SQL editor. Fully idempotent — safe to re-run.
--
-- PROBLEMS FIXED:
--   1. Missing actor_id column — the API server always inserts actor_id
--      (as NULL for non-follower events) but the column did not exist.
--      PostgREST returns PGRST204 for unknown columns, silently failing
--      every notification insert.
--
--   2. Narrow type CHECK constraint — migration 003 only allowed
--      ('outbid', 'auction_started', 'auction_won', 'new_bid').
--      The server emits 'new_follower' and other types that were all
--      being rejected with error 23514 (check_violation).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Add actor_id column (the user who triggered this notification, e.g. the
--    follower in a new_follower event, or the top bidder in an outbid event).
--    NULL for system-generated notifications (auction_started, auction_won).
-- ---------------------------------------------------------------------------
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS actor_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_actor_id
  ON notifications (actor_id)
  WHERE actor_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Drop the old narrow CHECK constraint and replace it with one that covers
--    all notification types the server currently emits.
--
--    Postgres auto-names inline CHECK constraints as <table>_<col>_check.
--    The original constraint in migration 003 was on the type column, so its
--    name is notifications_type_check.
-- ---------------------------------------------------------------------------
ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check CHECK (
    type IN (
      'outbid',
      'auction_started',
      'auction_won',
      'new_bid',
      'new_bid_received',
      'new_follower',
      'auction_ending_soon',
      'auction_removed'
    )
  );

-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'notifications'
ORDER BY ordinal_position;
