-- Migration 039: Add image_urls array column to auctions table
-- Stores all uploaded image URLs for multi-image (album) auctions.
-- NULL/empty = legacy single-image auction (uses video_url as the image).
-- Array order matches the upload order from the client.

ALTER TABLE auctions
  ADD COLUMN IF NOT EXISTS image_urls text[] DEFAULT NULL;
