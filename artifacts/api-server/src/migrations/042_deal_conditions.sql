-- =============================================================================
-- Migration 042: Secure Deals — deal_conditions (Buyer Terms) table
-- =============================================================================
-- Run ONCE in the Supabase SQL Editor (same DB as transactions). Idempotent.
--
-- Creates the `deal_conditions` table for the Buyer Terms feature:
--   - Buyer submits their conditions before paying
--   - Seller receives a real FCM + in-app notification to review them
--   - One active row per (deal_id, buyer_id) via UNIQUE constraint
--   - Re-submission replaces previous conditions (upsert on conflict)
--   - status: 'pending' | 'accepted' | 'rejected'  (seller response in Part #2)
--
-- Also extends the notifications type CHECK constraint to include
--   'buyer_conditions_submitted'  so createNotification() accepts the new type.
-- =============================================================================

-- ── 1. deal_conditions table ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS deal_conditions (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id      TEXT         NOT NULL REFERENCES transactions(deal_id) ON DELETE CASCADE,
  buyer_id     UUID         NOT NULL,
  conditions   TEXT         NOT NULL,
  status       TEXT         NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- One conditions record per buyer per deal (re-submission updates in place)
CREATE UNIQUE INDEX IF NOT EXISTS idx_deal_conditions_deal_buyer
  ON deal_conditions (deal_id, buyer_id);

CREATE INDEX IF NOT EXISTS idx_deal_conditions_deal_id
  ON deal_conditions (deal_id);

CREATE INDEX IF NOT EXISTS idx_deal_conditions_buyer_id
  ON deal_conditions (buyer_id);

-- Auto-update updated_at on every write
CREATE OR REPLACE FUNCTION update_deal_conditions_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_deal_conditions_updated_at ON deal_conditions;
CREATE TRIGGER trg_deal_conditions_updated_at
  BEFORE UPDATE ON deal_conditions
  FOR EACH ROW EXECUTE FUNCTION update_deal_conditions_updated_at();

-- ── 2. Row Level Security ─────────────────────────────────────────────────────

ALTER TABLE deal_conditions ENABLE ROW LEVEL SECURITY;

-- The submitting buyer and the deal's seller can both read conditions
DROP POLICY IF EXISTS "deal_parties_read" ON deal_conditions;
CREATE POLICY "deal_parties_read" ON deal_conditions
  FOR SELECT USING (
    buyer_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM transactions t
      WHERE t.deal_id = deal_conditions.deal_id
        AND t.seller_id = (SELECT auth.uid())
    )
  );

-- Only the buyer can insert their own conditions
DROP POLICY IF EXISTS "buyer_insert_own" ON deal_conditions;
CREATE POLICY "buyer_insert_own" ON deal_conditions
  FOR INSERT WITH CHECK (buyer_id = (SELECT auth.uid()));

-- Only the buyer can update (re-submit) their own conditions
DROP POLICY IF EXISTS "buyer_update_own" ON deal_conditions;
CREATE POLICY "buyer_update_own" ON deal_conditions
  FOR UPDATE USING (buyer_id = (SELECT auth.uid()));

GRANT SELECT ON TABLE public.deal_conditions TO anon, authenticated;
GRANT INSERT, UPDATE ON TABLE public.deal_conditions TO authenticated;

-- ── 3. Extend notifications type CHECK for buyer_conditions_submitted ─────────
--
-- Migration 026 added a CHECK constraint named notifications_type_check.
-- Migration 037 did NOT update the constraint but added auction_shared logic.
-- We drop and recreate it here with the full current list + new type.
--
-- NOTE: If your constraint was renamed, inspect pg_constraint and adjust.

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
      -- legacy aliases (back-compat with existing rows)
      'new_follower',
      'new_bid',
      'new_bid_received',
      'auction_started',
      'auction_removed'
    )
  );
