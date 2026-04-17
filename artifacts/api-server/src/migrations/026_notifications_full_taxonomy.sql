-- =============================================================================
-- Migration 026: Full notification taxonomy
-- =============================================================================
-- Adds the complete user-centric notification type set + supporting columns.
-- Idempotent — safe to re-run.
--
-- New columns:
--   title       TEXT NULL  — short headline shown in list rows / push title
--   body        TEXT NULL  — long-form body shown in detail / push body
--                           (the existing `message` column is kept for back-compat)
--   metadata    JSONB NULL — deep-link payload (e.g. {"commentId":"…","bidAmount":1234})
--
-- New types added to the CHECK constraint:
--   followed_you, liked_your_auction, saved_your_auction,
--   commented_on_your_auction, replied_to_your_comment, mentioned_you,
--   bid_received, auction_unsold, auction_ended,
--   admin_message, account_warning
--
-- Legacy aliases preserved (so existing rows / code keep working):
--   new_follower, new_bid, new_bid_received, auction_started, auction_removed
-- =============================================================================

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS title    TEXT,
  ADD COLUMN IF NOT EXISTS body     TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB;

ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check CHECK (
    type IN (
      -- canonical (spec) names
      'followed_you',
      'liked_your_auction',
      'saved_your_auction',
      'commented_on_your_auction',
      'replied_to_your_comment',
      'mentioned_you',
      'bid_received',
      'outbid',
      'auction_won',
      'auction_unsold',
      'auction_ended',
      'auction_ending_soon',
      'admin_message',
      'account_warning',
      -- legacy aliases (kept for back-compat with existing rows + older code paths)
      'new_follower',
      'new_bid',
      'new_bid_received',
      'auction_started',
      'auction_removed'
    )
  );

-- Dedup helper index — used by the lib/notifications.ts dedup window queries.
-- Filters on the small set of types that need dedup so the index stays compact.
CREATE INDEX IF NOT EXISTS idx_notifications_dedup
  ON notifications (user_id, type, actor_id, auction_id, created_at DESC)
  WHERE type IN ('liked_your_auction', 'saved_your_auction', 'followed_you', 'auction_ending_soon');

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'notifications'
ORDER BY ordinal_position;
