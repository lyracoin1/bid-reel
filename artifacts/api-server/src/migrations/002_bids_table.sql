-- Migration 002: bids table + min_increment on auctions
-- Run in Supabase SQL editor after 001_auctions_media_lifecycle.sql

-- ── 1. Add min_increment to auctions ─────────────────────────────────────────
--
-- Stored in the same units as current_bid (cents for USD auctions).
-- Default of 1000 = $10.00 minimum increment.

ALTER TABLE auctions
  ADD COLUMN IF NOT EXISTS min_increment INTEGER NOT NULL DEFAULT 1000;

-- ── 2. Create bids table ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bids (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id  UUID NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL,
  amount      INTEGER NOT NULL CHECK (amount > 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

-- Fast lookup of all bids for an auction, sorted by amount (for leaderboard)
CREATE INDEX IF NOT EXISTS idx_bids_auction_amount
  ON bids (auction_id, amount DESC);

-- Fast lookup of all bids by a specific user
CREATE INDEX IF NOT EXISTS idx_bids_user
  ON bids (user_id);

-- ── Row Level Security ────────────────────────────────────────────────────────

ALTER TABLE bids ENABLE ROW LEVEL SECURITY;

-- Anyone can read bids (amounts are public in an auction)
CREATE POLICY "Bids are publicly readable"
  ON bids FOR SELECT
  USING (true);

-- Only the authenticated user can insert their own bids
-- (API-level checks also enforce seller != bidder and bid amount rules)
CREATE POLICY "Users can insert their own bids"
  ON bids FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Bids are immutable — no updates or deletes by end users
-- Service role (server) handles any administrative cleanup

-- ── Realtime publication ──────────────────────────────────────────────────────
-- Enables Supabase Realtime for the bids table so the frontend can subscribe
-- to new bid events via `supabase.channel().on('postgres_changes', ...)`.

ALTER PUBLICATION supabase_realtime ADD TABLE bids;
