-- =============================================================================
-- Migration 047: Secure Deals — buyer_confirmed_receipt notification type
-- =============================================================================
-- ⚠️  Run this ONLY in the Supabase SQL Editor, NOT in Replit PostgreSQL.
--
-- The `transactions` table lives in Replit PostgreSQL (DATABASE_URL) and is
-- managed by bootstrapTransactionsTable() in pg-pool.ts. The `confirmed_at`
-- column is added automatically at server startup via ADD COLUMN IF NOT EXISTS.
-- There is nothing to run here for the transactions table.
--
-- What this file does:
--   Extends the notifications.type CHECK constraint to include the new
--   'buyer_confirmed_receipt' type introduced in Part #7.
-- =============================================================================

ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check CHECK (
    type IN (
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
      'buyer_conditions_submitted',
      'seller_conditions_submitted',
      'deal_rated',
      'payment_proof_uploaded',
      'shipment_proof_uploaded',
      'buyer_confirmed_receipt',
      'new_follower',
      'new_bid',
      'new_bid_received',
      'auction_started',
      'auction_removed'
    )
  );
