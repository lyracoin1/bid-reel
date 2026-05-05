-- =============================================================================
-- Migration 053: Digital Vault — Supabase notifications type extension
-- =============================================================================
-- ⚠️  Run ONLY in the Supabase SQL Editor. Idempotent.
--
-- The three new tables (digital_deal_disputes, vault_access_audit, and the
-- new columns on transactions) all live in Replit PostgreSQL (DATABASE_URL)
-- and are auto-created at server startup via bootstrapTransactionsTable().
-- Do NOT try to create those tables here.
--
-- What this file does:
--   Extends the notifications.type CHECK constraint to include the new
--   notification types introduced in Phase 1 of the Digital Vault feature.
--
-- New types added:
--   'digital_vault_unlocked'    — buyer revealed the vault
--   'digital_deal_acked'        — buyer confirmed vault as received
--   'digital_dispute_created'   — buyer opened a dispute
--   'digital_dispute_resolved'  — admin resolved a dispute
-- =============================================================================

ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check CHECK (
    type IN (
      -- Auction / social
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
      -- Secure Deals — physical flow (Parts #1–#7)
      'buyer_conditions_submitted',
      'seller_conditions_submitted',
      'deal_rated',
      'payment_proof_uploaded',
      'shipment_proof_uploaded',
      'buyer_confirmed_receipt',
      'shipping_fee_dispute_created',
      -- Digital Vault (Phase 1)
      'digital_vault_unlocked',
      'digital_deal_acked',
      'digital_dispute_created',
      'digital_dispute_resolved',
      -- Legacy aliases
      'new_follower',
      'new_bid',
      'new_bid_received',
      'auction_started',
      'auction_removed'
    )
  );
