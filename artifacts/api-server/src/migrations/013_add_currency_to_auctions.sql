-- Migration 013: Add currency metadata to auctions
-- Run this in the Supabase Dashboard SQL editor.

ALTER TABLE auctions
  ADD COLUMN IF NOT EXISTS currency_code  TEXT NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS currency_label TEXT NOT NULL DEFAULT 'US Dollar';

COMMENT ON COLUMN auctions.currency_code  IS 'ISO 4217 currency code chosen by the creator (e.g. USD, EGP, SAR). Never converted.';
COMMENT ON COLUMN auctions.currency_label IS 'Human-readable label in the creator''s language (e.g. "Egyptian Pound", "الجنيه المصري").';
