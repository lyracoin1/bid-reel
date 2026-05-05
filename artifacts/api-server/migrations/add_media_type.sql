-- Migration: add media_type column to auctions table
-- Run manually via your Supabase SQL editor or psql.
-- Safe to re-run: uses IF NOT EXISTS and WHERE IS NULL guards.

ALTER TABLE auctions
  ADD COLUMN IF NOT EXISTS media_type text
  CHECK (media_type IN ('video', 'album', 'image', 'processing', 'failed'));

-- Backfill existing rows based on current URL / image_urls data.
-- Rows that already have media_type set are left untouched.
UPDATE auctions
SET media_type = CASE
  -- Still holds a raw audio file → processing was never completed or failed.
  WHEN video_url ~ '\.(mp3|m4a|aac|ogg|opus)([?]|$)' THEN 'processing'
  -- MP4 / video URL → completed video (includes generated audio reels).
  WHEN video_url ~ '\.(mp4|mov|webm|avi)([?]|$)' THEN 'video'
  -- No video; multiple images → swipeable album.
  WHEN image_urls IS NOT NULL AND array_length(image_urls, 1) > 1 THEN 'album'
  -- No video; single image in image_urls → image listing.
  WHEN image_urls IS NOT NULL AND array_length(image_urls, 1) = 1 THEN 'image'
  -- Fallback: thumbnail only → treat as image.
  ELSE 'image'
END
WHERE media_type IS NULL;
