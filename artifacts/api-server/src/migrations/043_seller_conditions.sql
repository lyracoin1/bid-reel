-- =============================================================================
-- Migration 043: Secure Deals — seller_conditions (Seller Terms) table
-- =============================================================================
-- Run ONCE in the Supabase SQL Editor (same DB as transactions). Idempotent.
--
-- Creates the `seller_conditions` table for the Seller Terms feature:
--   - Seller submits their own conditions for a deal after creation
--   - Buyer receives a real FCM + in-app notification to review them
--   - One active row per deal_id via UNIQUE constraint (one seller per deal)
--   - Re-submission replaces previous conditions (upsert on conflict)
--   - status: 'pending' | 'accepted' | 'rejected' (buyer response in Part #3)
--
-- Also rebuilds the notifications type CHECK constraint to carry forward
-- 'buyer_conditions_submitted' (migration 042) and add the new
-- 'seller_conditions_submitted' type.  Safe to run after 042 or alone.
-- =============================================================================

-- ── 1. seller_conditions table ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS seller_conditions (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id      TEXT         NOT NULL REFERENCES transactions(deal_id) ON DELETE CASCADE,
  seller_id    UUID         NOT NULL,
  conditions   TEXT         NOT NULL,
  status       TEXT         NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- One conditions record per deal (a deal has exactly one seller)
CREATE UNIQUE INDEX IF NOT EXISTS idx_seller_conditions_deal_id
  ON seller_conditions (deal_id);

CREATE INDEX IF NOT EXISTS idx_seller_conditions_seller_id
  ON seller_conditions (seller_id);

-- Auto-update updated_at on every write
CREATE OR REPLACE FUNCTION update_seller_conditions_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seller_conditions_updated_at ON seller_conditions;
CREATE TRIGGER trg_seller_conditions_updated_at
  BEFORE UPDATE ON seller_conditions
  FOR EACH ROW EXECUTE FUNCTION update_seller_conditions_updated_at();

-- ── 2. Row Level Security ─────────────────────────────────────────────────────

ALTER TABLE seller_conditions ENABLE ROW LEVEL SECURITY;

-- The seller, the assigned buyer, and any user who submitted buyer conditions
-- (i.e., potential buyers who have the deal link) can all read.
DROP POLICY IF EXISTS "deal_parties_read" ON seller_conditions;
CREATE POLICY "deal_parties_read" ON seller_conditions
  FOR SELECT USING (
    seller_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM transactions t
      WHERE t.deal_id = seller_conditions.deal_id
        AND t.buyer_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM deal_conditions dc
      WHERE dc.deal_id = seller_conditions.deal_id
        AND dc.buyer_id = (SELECT auth.uid())
    )
  );

-- Only the verified seller (FK-checked via transactions.seller_id) can insert
DROP POLICY IF EXISTS "seller_insert_own" ON seller_conditions;
CREATE POLICY "seller_insert_own" ON seller_conditions
  FOR INSERT WITH CHECK (seller_id = (SELECT auth.uid()));

-- Only the seller can update their own conditions
DROP POLICY IF EXISTS "seller_update_own" ON seller_conditions;
CREATE POLICY "seller_update_own" ON seller_conditions
  FOR UPDATE USING (seller_id = (SELECT auth.uid()));

GRANT SELECT ON TABLE public.seller_conditions TO anon, authenticated;
GRANT INSERT, UPDATE ON TABLE public.seller_conditions TO authenticated;

-- ── 3. Extend notifications type CHECK ───────────────────────────────────────
-- Rebuilds the constraint carrying forward all types from migrations
-- 026, 037, 042 and adding 'seller_conditions_submitted'.

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
      -- Secure Deals
      'buyer_conditions_submitted',
      'seller_conditions_submitted',
      -- legacy aliases
      'new_follower',
      'new_bid',
      'new_bid_received',
      'auction_started',
      'auction_removed'
    )
  );
