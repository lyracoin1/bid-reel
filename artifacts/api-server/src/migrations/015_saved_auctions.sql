-- =============================================================================
-- BidReel — Migration 015: Saved Auctions (Bookmarks)
-- =============================================================================
-- Safe to re-run (idempotent).
-- Run in Supabase SQL editor.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Create saved_auctions table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS saved_auctions (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  auction_id UUID        NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_saved_auctions UNIQUE (user_id, auction_id)
);

-- ---------------------------------------------------------------------------
-- 2. Indexes for fast user lookups
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_saved_auctions_user    ON saved_auctions(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_auctions_auction ON saved_auctions(auction_id);

-- ---------------------------------------------------------------------------
-- 3. RLS — service_role bypasses these; they protect direct SDK access
-- ---------------------------------------------------------------------------
ALTER TABLE saved_auctions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'saved_auctions' AND policyname = 'saved_auctions_select_own'
  ) THEN
    CREATE POLICY saved_auctions_select_own
      ON saved_auctions FOR SELECT
      USING (user_id = auth.uid());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'saved_auctions' AND policyname = 'saved_auctions_insert_own'
  ) THEN
    CREATE POLICY saved_auctions_insert_own
      ON saved_auctions FOR INSERT
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'saved_auctions' AND policyname = 'saved_auctions_delete_own'
  ) THEN
    CREATE POLICY saved_auctions_delete_own
      ON saved_auctions FOR DELETE
      USING (user_id = auth.uid());
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Verify
-- ---------------------------------------------------------------------------
SELECT 'saved_auctions table ready' AS status,
       COUNT(*) AS existing_rows
FROM saved_auctions;
