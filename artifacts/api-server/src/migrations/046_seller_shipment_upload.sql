-- =============================================================================
-- Migration 046: Secure Deals — shipment_proofs table
-- =============================================================================
-- Run ONCE in the Supabase SQL Editor. Idempotent.
--
-- Creates the `shipment_proofs` table for Seller Shipment Proof Upload (Part #5):
--   - Seller uploads a PDF / image as proof of shipment plus an optional tracking URL.
--   - One active proof row per seller per deal via UNIQUE(deal_id, seller_id).
--     Re-upload upserts in place — old R2 file is orphaned (acceptable for docs).
--   - Buyer receives FCM push + in-app notification when proof is uploaded.
--   - Admin can list all proofs via GET /api/admin/shipment-proofs.
--
-- Also rebuilds the notifications type CHECK constraint to add
-- 'shipment_proof_uploaded' (carries forward all prior types from 026–045).
-- =============================================================================

-- ── 1. shipment_proofs table ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS shipment_proofs (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  -- No FK to transactions — that table lives in Replit Postgres (pg pool), not Supabase.
  -- Referential integrity is enforced in the API route (404 if deal not found).
  deal_id       TEXT         NOT NULL,
  seller_id     UUID         NOT NULL,
  file_url      TEXT         NOT NULL,
  tracking_link TEXT         NOT NULL DEFAULT '',  -- empty string when no tracking number
  uploaded_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- One proof row per seller per deal; re-upload upserts (INSERT ON CONFLICT UPDATE)
  CONSTRAINT shipment_proofs_unique_deal_seller UNIQUE (deal_id, seller_id)
);

CREATE INDEX IF NOT EXISTS idx_shipment_proofs_deal_id
  ON shipment_proofs (deal_id);

CREATE INDEX IF NOT EXISTS idx_shipment_proofs_seller_id
  ON shipment_proofs (seller_id);

-- ── 2. Row Level Security ─────────────────────────────────────────────────────

ALTER TABLE shipment_proofs ENABLE ROW LEVEL SECURITY;

-- Seller of that proof, the deal's buyer (if assigned), and admins can read
DROP POLICY IF EXISTS "shipment_proof_parties_read" ON shipment_proofs;
CREATE POLICY "shipment_proof_parties_read" ON shipment_proofs
  FOR SELECT USING (
    seller_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM transactions t
      WHERE t.deal_id = shipment_proofs.deal_id
        AND t.buyer_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.is_admin = true
    )
  );

-- Only the seller (uploader) can insert
DROP POLICY IF EXISTS "seller_insert_shipment" ON shipment_proofs;
CREATE POLICY "seller_insert_shipment" ON shipment_proofs
  FOR INSERT WITH CHECK (seller_id = (SELECT auth.uid()));

-- Only the seller can update their own proof
DROP POLICY IF EXISTS "seller_update_shipment" ON shipment_proofs;
CREATE POLICY "seller_update_shipment" ON shipment_proofs
  FOR UPDATE USING (seller_id = (SELECT auth.uid()));

GRANT SELECT ON TABLE public.shipment_proofs TO anon, authenticated;
GRANT INSERT, UPDATE ON TABLE public.shipment_proofs TO authenticated;

-- ── 3. Extend notifications type CHECK ───────────────────────────────────────
-- Rebuilds the constraint carrying forward all types from migrations
-- 026, 037, 042, 043, 044, 045 and adding 'shipment_proof_uploaded'.

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
