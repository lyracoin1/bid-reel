-- =============================================================================
-- Migration 037: Add auction_shared notification type
-- =============================================================================
-- Extends the notifications_type_check constraint to allow the new
-- "auction_shared" type fired when a seller shares an auction with followers.
-- Idempotent — safe to re-run.
-- =============================================================================

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
      'auction_shared',
      -- legacy aliases (kept for back-compat with existing rows + older code paths)
      'new_follower',
      'new_bid',
      'new_bid_received',
      'auction_started',
      'auction_removed'
    )
  );

SELECT 'notifications_type_check updated with auction_shared' AS status;
