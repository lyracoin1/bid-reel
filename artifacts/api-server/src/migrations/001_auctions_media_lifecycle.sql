-- Migration: auctions table with media lifecycle columns
-- Apply in Supabase SQL editor or via drizzle-kit push.
--
-- Media lifecycle overview:
--   expires_at        = ends_at + 7 days   (set by app at auction creation)
--   videos_deleted_at = set when Phase 1 cleanup removes video files
--   images_deleted_at = set when Phase 2 cleanup removes image files
--   media_deleted_at  = set when BOTH phases are done (convenience flag)
--
-- Cleanup phases:
--   Phase 1 — Videos deleted 7 days  after ends_at  (large files, priority)
--   Phase 2 — Images deleted 14 days after ends_at  (smaller, kept longer)

CREATE TABLE IF NOT EXISTS auctions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Ownership
  seller_id       UUID NOT NULL,

  -- Listing
  title           TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  type            TEXT NOT NULL CHECK (type IN ('video', 'album')),

  -- Supabase Storage paths (bucket: auction-media)
  -- Conventions:
  --   video  → auctions/{id}/video.{ext}
  --   images → auctions/{id}/images/{index}.{ext}
  storage_path    TEXT,
  image_paths     TEXT[],

  -- Bidding (stored in cents to avoid floating point)
  starting_bid    INTEGER NOT NULL DEFAULT 0,
  current_bid     INTEGER NOT NULL DEFAULT 0,
  bid_count       INTEGER NOT NULL DEFAULT 0,

  -- Timing
  starts_at       TIMESTAMPTZ,
  ends_at         TIMESTAMPTZ NOT NULL,

  -- Media lifecycle
  expires_at          TIMESTAMPTZ NOT NULL,   -- ends_at + retention period
  videos_deleted_at   TIMESTAMPTZ,            -- NULL = videos still live
  images_deleted_at   TIMESTAMPTZ,            -- NULL = images still live
  media_deleted_at    TIMESTAMPTZ,            -- NULL = any media still live

  -- Soft delete
  deleted_at      TIMESTAMPTZ,

  -- Timestamps
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for cleanup queries (find auctions with expired media)
CREATE INDEX IF NOT EXISTS idx_auctions_ends_at
  ON auctions (ends_at)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_auctions_videos_pending
  ON auctions (ends_at)
  WHERE videos_deleted_at IS NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_auctions_images_pending
  ON auctions (ends_at)
  WHERE images_deleted_at IS NULL AND deleted_at IS NULL;

-- Row Level Security
ALTER TABLE auctions ENABLE ROW LEVEL SECURITY;

-- Anyone can read non-deleted auctions
CREATE POLICY "Public auctions are viewable"
  ON auctions FOR SELECT
  USING (deleted_at IS NULL);

-- Only the seller can insert their own auction
CREATE POLICY "Sellers can create auctions"
  ON auctions FOR INSERT
  WITH CHECK (auth.uid() = seller_id);

-- Only the seller can update their own auction (except lifecycle columns)
CREATE POLICY "Sellers can update their auctions"
  ON auctions FOR UPDATE
  USING (auth.uid() = seller_id)
  WITH CHECK (auth.uid() = seller_id);

-- Service role (server) handles all lifecycle column updates — no RLS needed
-- (service_role bypasses RLS entirely)
