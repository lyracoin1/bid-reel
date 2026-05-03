-- =============================================================================
-- Migration 046: Secure Deals — shipment_proofs  (SUPABASE PORTION ONLY)
-- =============================================================================
-- ⚠️  The shipment_proofs TABLE itself lives in Replit PostgreSQL (DATABASE_URL),
--     NOT in Supabase. It is auto-created at API-server startup by
--     bootstrapTransactionsTable() inside pg-pool.ts alongside the transactions
--     and payment_proofs tables. Do NOT try to CREATE TABLE here.
--
-- This file contains ONLY the Supabase-side change: extending the
-- notifications.type CHECK constraint to allow 'shipment_proof_uploaded'.
--
-- Run ONCE in the Supabase SQL Editor. Idempotent.
-- If you have already run 045, this replaces its constraint (DROP + ADD is safe).
-- =============================================================================

-- ── Extend notifications type CHECK ──────────────────────────────────────────
-- Rebuilds the constraint carrying forward ALL types from migrations 026–045
-- and adding 'shipment_proof_uploaded'.

ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check CHECK (
    type IN (
      -- canonical names
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
      -- Secure Deals Parts #1–#5
      'buyer_conditions_submitted',
      'seller_conditions_submitted',
      'deal_rated',
      'payment_proof_uploaded',
      'shipment_proof_uploaded',
      -- legacy aliases
      'new_follower',
      'new_bid',
      'new_bid_received',
      'auction_started',
      'auction_removed'
    )
  );
