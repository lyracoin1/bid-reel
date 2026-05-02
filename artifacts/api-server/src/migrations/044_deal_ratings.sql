-- =============================================================================
-- Migration 044: Secure Deals — deal_ratings table
-- =============================================================================
-- Run ONCE in the Supabase SQL Editor (same DB as transactions). Idempotent.
--
-- Creates the `deal_ratings` table for post-deal ratings:
--   - Either participant (buyer or seller) can rate the other exactly once
--   - UNIQUE (deal_id, rater_id) — prevents duplicate ratings per user
--   - Rating allowed only after deal reaches 'delivered' terminal state
--   - comment is optional (max 500 chars enforced at API layer)
--   - status column reserved for future moderation (Part #5+)
--
-- Also rebuilds the notifications type CHECK constraint to add 'deal_rated'.
-- =============================================================================

-- ── 1. deal_ratings table ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS deal_ratings (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id    TEXT         NOT NULL REFERENCES transactions(deal_id) ON DELETE CASCADE,
  rater_id   UUID         NOT NULL,
  ratee_id   UUID         NOT NULL,
  stars      SMALLINT     NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment    TEXT         CHECK (comment IS NULL OR char_length(comment) <= 500),
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- Each user can rate once per deal
  CONSTRAINT deal_ratings_unique_rater UNIQUE (deal_id, rater_id),

  -- Prevent self-rating at DB level as a safety net
  CONSTRAINT deal_ratings_no_self_rate CHECK (rater_id <> ratee_id)
);

CREATE INDEX IF NOT EXISTS idx_deal_ratings_deal_id
  ON deal_ratings (deal_id);

CREATE INDEX IF NOT EXISTS idx_deal_ratings_ratee_id
  ON deal_ratings (ratee_id);

-- Auto-update updated_at on every write
CREATE OR REPLACE FUNCTION update_deal_ratings_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_deal_ratings_updated_at ON deal_ratings;
CREATE TRIGGER trg_deal_ratings_updated_at
  BEFORE UPDATE ON deal_ratings
  FOR EACH ROW EXECUTE FUNCTION update_deal_ratings_updated_at();

-- ── 2. Row Level Security ─────────────────────────────────────────────────────

ALTER TABLE deal_ratings ENABLE ROW LEVEL SECURITY;

-- Both deal participants can read all ratings for their deal
DROP POLICY IF EXISTS "deal_participants_read" ON deal_ratings;
CREATE POLICY "deal_participants_read" ON deal_ratings
  FOR SELECT USING (
    rater_id = (SELECT auth.uid())
    OR ratee_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM transactions t
      WHERE t.deal_id = deal_ratings.deal_id
        AND (t.seller_id = (SELECT auth.uid()) OR t.buyer_id = (SELECT auth.uid()))
    )
  );

-- Only the rater can insert their own rating
DROP POLICY IF EXISTS "rater_insert_own" ON deal_ratings;
CREATE POLICY "rater_insert_own" ON deal_ratings
  FOR INSERT WITH CHECK (rater_id = (SELECT auth.uid()));

-- Ratings are immutable after submission (no UPDATE policy)

GRANT SELECT ON TABLE public.deal_ratings TO anon, authenticated;
GRANT INSERT ON TABLE public.deal_ratings TO authenticated;

-- ── 3. Extend notifications type CHECK ───────────────────────────────────────
-- Rebuilds the constraint carrying forward all types from migrations
-- 026, 037, 042, 043 and adding 'deal_rated'.

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
      -- Secure Deals Parts #1, #2, #3
      'buyer_conditions_submitted',
      'seller_conditions_submitted',
      'deal_rated',
      -- legacy aliases
      'new_follower',
      'new_bid',
      'new_bid_received',
      'auction_started',
      'auction_removed'
    )
  );
