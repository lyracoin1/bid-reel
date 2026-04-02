-- Migration 012: Add location columns to auctions
-- Run this via the Supabase Dashboard SQL editor:
--   https://supabase.com/dashboard/project/tbsmmnbrlzbsuazrieyl/sql/new
--
-- Purpose: Store the seller's GPS coordinates at the time of auction creation.
--   lat  — WGS-84 latitude  (-90 … 90)
--   lng  — WGS-84 longitude (-180 … 180)
--
-- The backend validates that both values are present in POST /api/auctions.
-- The insertAuction helper already uses a multi-attempt fallback, so auctions
-- CAN be created without these columns — but location will not be persisted
-- until this migration is applied.

ALTER TABLE auctions
  ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;
