-- =============================================================================
-- Migration 051: Add Secure Deal notification types to notifications CHECK
-- =============================================================================
-- Extends the notifications_type_check constraint to include all Secure Deal
-- event types introduced in Parts #5–#10 of the Secure Deals feature.
--
-- New types added:
--   auction_shared
--   buyer_conditions_submitted, seller_conditions_submitted, deal_rated
--   payment_proof_uploaded, shipment_proof_uploaded
--   buyer_confirmed_receipt, buyer_delivery_proof_uploaded
--   shipping_fee_dispute_created, seller_penalty_applied
--
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
      -- Secure Deals
      'buyer_conditions_submitted',
      'seller_conditions_submitted',
      'deal_rated',
      'payment_proof_uploaded',
      'shipment_proof_uploaded',
      'buyer_confirmed_receipt',
      'buyer_delivery_proof_uploaded',
      'shipping_fee_dispute_created',
      'seller_penalty_applied',
      -- legacy aliases (kept for back-compat with existing rows + older code paths)
      'new_follower',
      'new_bid',
      'new_bid_received',
      'auction_started',
      'auction_removed'
    )
  );
