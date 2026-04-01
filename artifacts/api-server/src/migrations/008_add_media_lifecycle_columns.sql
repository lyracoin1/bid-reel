-- =============================================================================
-- Migration 008: Add media lifecycle tracking columns to auctions
-- =============================================================================
--
-- The media-lifecycle.ts cleanup scheduler queries these three columns.
-- They were defined in migration 005 (complete schema) but may not exist on
-- databases that only have migrations 001–004 applied.
--
-- Safe to run multiple times: all three use ADD COLUMN IF NOT EXISTS.
--
-- COLUMN MEANINGS:
--   media_purge_after     — set to ends_at + 7 days at auction creation.
--                           Phase 1 (video) runs when now() >= media_purge_after.
--   video_deleted_at      — NULL = video still in Supabase Storage.
--                           Set by cleanup job after successful deletion.
--   thumbnail_deleted_at  — NULL = thumbnail still in Supabase Storage.
--                           Set by cleanup job after successful deletion.
--                           Phase 2 (thumbnail) runs when
--                           now() >= media_purge_after + 7 days.
-- =============================================================================

ALTER TABLE auctions
  ADD COLUMN IF NOT EXISTS media_purge_after    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS video_deleted_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS thumbnail_deleted_at TIMESTAMPTZ;

-- Index: cleanup job finds auctions due for video deletion efficiently
CREATE INDEX IF NOT EXISTS idx_auctions_media_purge_video
  ON auctions (media_purge_after)
  WHERE video_deleted_at IS NULL AND video_url IS NOT NULL;

-- Index: cleanup job finds auctions due for thumbnail deletion efficiently
CREATE INDEX IF NOT EXISTS idx_auctions_media_purge_thumb
  ON auctions (media_purge_after)
  WHERE thumbnail_deleted_at IS NULL AND thumbnail_url IS NOT NULL;

-- Back-fill existing auctions that are missing media_purge_after:
-- set it to ends_at + 7 days so the scheduler can pick them up.
UPDATE auctions
  SET media_purge_after = ends_at + INTERVAL '7 days'
  WHERE media_purge_after IS NULL;
