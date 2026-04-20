-- Migration 029: Fixed-price selling alongside auctions
--
-- Changes:
--   1. Adds `sale_type` column ('auction' | 'fixed') with default 'auction'.
--   2. Adds `fixed_price` numeric column (nullable; required when sale_type='fixed').
--   3. Adds `buyer_id` column (nullable; set when a fixed listing is purchased).
--   4. Extends auction_status enum with 'reserved' and 'sold' values.
--   5. Adds CHECK constraint enforcing fixed_price/sale_type relationship.
--
-- Apply in Supabase SQL editor before deploying the corresponding server changes.
-- This migration is idempotent and safe to re-run.

-- 1. sale_type column (text + CHECK is simpler than a new enum and avoids
--    PostgreSQL's enum-in-same-transaction limitation)
ALTER TABLE auctions
  ADD COLUMN IF NOT EXISTS sale_type TEXT NOT NULL DEFAULT 'auction';

ALTER TABLE auctions DROP CONSTRAINT IF EXISTS chk_auctions_sale_type;
ALTER TABLE auctions
  ADD CONSTRAINT chk_auctions_sale_type
  CHECK (sale_type IN ('auction', 'fixed'));

-- 2. fixed_price column — required when sale_type='fixed', NULL otherwise
ALTER TABLE auctions
  ADD COLUMN IF NOT EXISTS fixed_price NUMERIC(12, 2);

ALTER TABLE auctions DROP CONSTRAINT IF EXISTS chk_auctions_fixed_price_consistency;
ALTER TABLE auctions
  ADD CONSTRAINT chk_auctions_fixed_price_consistency
  CHECK (
    (sale_type = 'auction' AND fixed_price IS NULL) OR
    (sale_type = 'fixed' AND fixed_price IS NOT NULL AND fixed_price > 0)
  )
  NOT VALID;

-- 3. buyer_id column — set atomically when a fixed listing is purchased
ALTER TABLE auctions
  ADD COLUMN IF NOT EXISTS buyer_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_auctions_buyer_id
  ON auctions (buyer_id)
  WHERE buyer_id IS NOT NULL;

-- 4. Extend auction_status enum with 'reserved' and 'sold' values
ALTER TYPE auction_status ADD VALUE IF NOT EXISTS 'reserved';
ALTER TYPE auction_status ADD VALUE IF NOT EXISTS 'sold';
