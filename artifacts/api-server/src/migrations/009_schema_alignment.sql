-- =============================================================================
-- BidReel — Migration 009: Schema Alignment
-- =============================================================================
-- Run this ONCE in the Supabase SQL editor.
-- It is fully idempotent (safe to re-run).
--
-- PURPOSE:
--   Aligns the live DB (from lib/db/migrations/001_initial_schema.sql) with
--   what the current API server code expects.
--
-- CHANGES:
--   1. auctions: rename current_price → current_bid
--   2. auctions: rename minimum_increment → min_increment
--   3. auctions: add media_purge_after, winner_id, video_deleted_at,
--                thumbnail_deleted_at columns (needed by media lifecycle)
--   4. Fix the bid trigger to keep current_bid (not current_price) in sync.
--   5. Add auction_category type alias if needed (category column is already TEXT-compatible).
--   6. profiles: ensure expo_push_token column exists (for push notifications).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. auctions: rename current_price → current_bid
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auctions' AND column_name = 'current_price'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auctions' AND column_name = 'current_bid'
  ) THEN
    ALTER TABLE auctions RENAME COLUMN current_price TO current_bid;
    RAISE NOTICE 'Renamed current_price → current_bid';
  ELSE
    RAISE NOTICE 'current_price rename skipped (column already renamed or does not exist)';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. auctions: rename minimum_increment → min_increment
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auctions' AND column_name = 'minimum_increment'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auctions' AND column_name = 'min_increment'
  ) THEN
    ALTER TABLE auctions RENAME COLUMN minimum_increment TO min_increment;
    RAISE NOTICE 'Renamed minimum_increment → min_increment';
  ELSE
    RAISE NOTICE 'minimum_increment rename skipped';
  END IF;
END $$;

-- Ensure min_increment has a sensible default if it came from the old schema
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auctions' AND column_name = 'min_increment'
  ) THEN
    ALTER TABLE auctions ALTER COLUMN min_increment SET DEFAULT 10.00;
    RAISE NOTICE 'min_increment default set to 10.00';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3a. auctions: add media_purge_after column
-- ---------------------------------------------------------------------------
ALTER TABLE auctions
  ADD COLUMN IF NOT EXISTS media_purge_after TIMESTAMPTZ;

-- Back-fill: set to ends_at + 7 days for existing auctions
UPDATE auctions
SET media_purge_after = ends_at + INTERVAL '7 days'
WHERE media_purge_after IS NULL;

-- ---------------------------------------------------------------------------
-- 3b. auctions: add video_deleted_at, thumbnail_deleted_at
-- ---------------------------------------------------------------------------
ALTER TABLE auctions
  ADD COLUMN IF NOT EXISTS video_deleted_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS thumbnail_deleted_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- 3c. auctions: add winner_id
-- ---------------------------------------------------------------------------
ALTER TABLE auctions
  ADD COLUMN IF NOT EXISTS winner_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 3d. auctions: ensure starts_at column exists (added in some migrations)
-- ---------------------------------------------------------------------------
ALTER TABLE auctions
  ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- 4. Fix the bid trigger to update current_bid (not current_price)
-- ---------------------------------------------------------------------------
-- Drop the old trigger and function that referenced current_price.
DROP TRIGGER IF EXISTS trg_bids_update_auction ON bids;
DROP TRIGGER IF EXISTS trg_bids_sync_auction   ON bids;
DROP FUNCTION IF EXISTS update_auction_on_bid() CASCADE;
DROP FUNCTION IF EXISTS fn_bids_sync_auction()  CASCADE;

-- Create the correct trigger function targeting current_bid.
CREATE OR REPLACE FUNCTION fn_bid_placed()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE auctions
  SET
    current_bid = NEW.amount,
    bid_count   = bid_count + 1,
    updated_at  = now()
  WHERE id = NEW.auction_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_bid_placed
  AFTER INSERT ON bids
  FOR EACH ROW EXECUTE FUNCTION fn_bid_placed();

-- ---------------------------------------------------------------------------
-- 5. profiles: ensure expo_push_token exists (for push notifications)
-- ---------------------------------------------------------------------------
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS expo_push_token TEXT;

-- ---------------------------------------------------------------------------
-- 6. Realtime: make sure bids table is in the publication
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'bids'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE bids;
    RAISE NOTICE 'Added bids to supabase_realtime publication';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 7. Verify: show current columns on auctions
-- ---------------------------------------------------------------------------
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'auctions'
ORDER BY ordinal_position;
