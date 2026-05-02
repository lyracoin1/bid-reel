-- =============================================================================
-- Migration 045: Secure Deals — payment_proofs table
-- =============================================================================
-- Run ONCE in the Supabase SQL Editor. Idempotent.
--
-- Creates the `payment_proofs` table for Buyer Payment Proof Upload (Part #4):
--   - Buyer uploads a PDF / image as proof of external payment (bank transfer etc.)
--   - One active proof row per deal via UNIQUE(deal_id) — re-upload upserts in place
--     (the DB row is updated to the new file_url; the old R2 object is orphaned)
--   - Seller receives FCM push + in-app notification when proof is uploaded
--   - Admin can list all proofs via GET /api/admin/payment-proofs
--
-- Also rebuilds the notifications type CHECK constraint to add
-- 'payment_proof_uploaded' (carries forward all prior types from 026–044).
-- =============================================================================

-- ── 1. payment_proofs table ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payment_proofs (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id     TEXT         NOT NULL REFERENCES transactions(deal_id) ON DELETE CASCADE,
  buyer_id    UUID         NOT NULL,
  file_url    TEXT         NOT NULL,
  file_name   TEXT         NOT NULL,   -- original filename for display
  file_type   TEXT         NOT NULL,   -- MIME type (application/pdf, image/jpeg, …)
  file_size   INTEGER,                 -- bytes (nullable for legacy rows)
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One proof row per deal; re-upload replaces (INSERT ON CONFLICT UPDATE)
  CONSTRAINT payment_proofs_unique_deal UNIQUE (deal_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_proofs_deal_id
  ON payment_proofs (deal_id);

CREATE INDEX IF NOT EXISTS idx_payment_proofs_buyer_id
  ON payment_proofs (buyer_id);

-- ── 2. Row Level Security ─────────────────────────────────────────────────────

ALTER TABLE payment_proofs ENABLE ROW LEVEL SECURITY;

-- The buyer who uploaded, the deal's seller, and admins can read
DROP POLICY IF EXISTS "proof_parties_read" ON payment_proofs;
CREATE POLICY "proof_parties_read" ON payment_proofs
  FOR SELECT USING (
    buyer_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM transactions t
      WHERE t.deal_id = payment_proofs.deal_id
        AND t.seller_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.is_admin = true
    )
  );

-- Only the buyer (uploader) can insert / replace their proof
DROP POLICY IF EXISTS "buyer_insert_proof" ON payment_proofs;
CREATE POLICY "buyer_insert_proof" ON payment_proofs
  FOR INSERT WITH CHECK (buyer_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "buyer_update_proof" ON payment_proofs;
CREATE POLICY "buyer_update_proof" ON payment_proofs
  FOR UPDATE USING (buyer_id = (SELECT auth.uid()));

GRANT SELECT ON TABLE public.payment_proofs TO anon, authenticated;
GRANT INSERT, UPDATE ON TABLE public.payment_proofs TO authenticated;

-- ── 3. Extend notifications type CHECK ───────────────────────────────────────
-- Rebuilds the constraint carrying forward all types from migrations
-- 026, 037, 042, 043, 044 and adding 'payment_proof_uploaded'.

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
      -- Secure Deals Parts #1–#4
      'buyer_conditions_submitted',
      'seller_conditions_submitted',
      'deal_rated',
      'payment_proof_uploaded',
      -- legacy aliases
      'new_follower',
      'new_bid',
      'new_bid_received',
      'auction_started',
      'auction_removed'
    )
  );
