-- Migration 011: Add created_at to bids table
-- Run this in the Supabase SQL editor if bids.created_at is missing.
-- Fully idempotent (safe to re-run).

-- Add created_at column if it does not already exist
ALTER TABLE bids
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Index for efficient per-bidder chronological queries
CREATE INDEX IF NOT EXISTS idx_bids_bidder_created
  ON bids (bidder_id, created_at DESC);

-- Verify
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'bids'
ORDER BY ordinal_position;
