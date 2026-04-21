-- Migration 031: Per-auction activation gate ($1 Gumroad payment)
--
-- Business rule:
--   • Fixed-price listings (sale_type='fixed') remain completely free —
--     no activation required, seller contact stays visible.
--   • Auction listings (sale_type='auction') can be created and shown
--     publicly, but bidding is locked AND the seller's contact details
--     are hidden until the seller pays $1 to activate that specific
--     auction. Activation is per-auction, never per-user.
--
-- Schema change:
--   Adds a single nullable timestamp column `activated_at`.
--     • NULL  → auction is locked (bidding blocked, seller phone hidden).
--     • SET   → auction is activated (bidding open, contact visible).
--
-- This migration is idempotent and safe to re-run.
-- Apply in the Supabase SQL editor before deploying the corresponding
-- server changes.

ALTER TABLE auctions
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;

-- Backfill: every auction that already exists predates this gate, so
-- treat them all as already activated (otherwise live listings would
-- silently lose bidding ability the moment this ships). New rows
-- default to NULL and must be activated explicitly.
UPDATE auctions
SET activated_at = COALESCE(activated_at, created_at)
WHERE activated_at IS NULL;

-- Partial index for the "is this locked?" lookup that runs on every
-- bid attempt and on every detail fetch. Cheap because most auctions
-- are activated and the partial WHERE keeps the index tiny.
CREATE INDEX IF NOT EXISTS idx_auctions_locked
  ON auctions (id)
  WHERE activated_at IS NULL;
