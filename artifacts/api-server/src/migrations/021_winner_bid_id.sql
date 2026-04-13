-- Migration 021: Add winner_bid_id to auctions
--
-- Adds a direct FK reference to the winning bid so downstream
-- code can look up the exact bid amount and timestamp without a
-- separate JOIN.
--
-- winner_id already exists (migration 005/009).
-- winner_bid_id is new.
--
-- Apply in Supabase SQL editor before deploying the corresponding
-- server changes (auction-lifecycle.ts).

ALTER TABLE auctions
  ADD COLUMN IF NOT EXISTS winner_bid_id UUID REFERENCES bids(id) ON DELETE SET NULL;

COMMENT ON COLUMN auctions.winner_bid_id IS
  'ID of the winning bid row. Set when the auction expires. NULL if no bids were placed.';
