-- =============================================================================
-- Migration 048: Secure Deals — buyer_delivery_proof_uploaded notification type
-- =============================================================================
-- ⚠️  Run this ONLY in the Supabase SQL Editor, NOT in Replit PostgreSQL.
--
-- The `delivery_proofs` table lives in Replit PostgreSQL (DATABASE_URL) and is
-- managed by bootstrapTransactionsTable() in pg-pool.ts — it is created
-- automatically at server startup via CREATE TABLE IF NOT EXISTS.
-- There is nothing to run here for the delivery_proofs table itself.
--
-- Why previous attempts failed:
--   Any query that tries to CREATE TABLE delivery_proofs with a FK reference
--   to transactions(deal_id) inside Supabase would fail because the
--   transactions table does NOT exist in Supabase — it lives in the separate
--   Replit-managed PostgreSQL instance (DATABASE_URL). Both tables are in the
--   same Replit Postgres database, so the FK is defined there in pg-pool.ts.
--
-- What this file does:
--   Extends the notifications.type CHECK constraint to include the new
--   'buyer_delivery_proof_uploaded' type introduced in Part #8.
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
      'buyer_delivery_proof_uploaded',   -- NEW in Part #8
      'new_follower',
      'new_bid',
      'new_bid_received',
      'auction_started',
      'auction_removed'
    )
  );
