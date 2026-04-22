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
-- IMPORTANT — apply order in Supabase SQL Editor:
--   1. Repair any rows that violate chk_auction_duration (legacy 3-day
--      auctions left over from before migration 030). See the operator
--      runbook; the repair clamps ends_at to created_at + 47 hours for
--      sale_type='auction' rows that fall outside the 1–48h window.
--   2. Run the schema block below (column + partial index).
--   3. Run the legacy-row backfill (also below) to mark pre-existing
--      live auctions as already activated.
--
-- Step 2 is intentionally schema-only: there is NO bulk UPDATE here so
-- it cannot re-validate unrelated CHECK constraints (chk_auction_duration
-- in particular) and abort partway through. Idempotent and safe to re-run.

ALTER TABLE auctions
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_auctions_locked
  ON auctions (id)
  WHERE activated_at IS NULL;

-- Step 3 — legacy backfill. Run AFTER step 1 has cleared every
-- chk_auction_duration violation, otherwise this UPDATE will abort on
-- the first invalid row it touches.
--
--   UPDATE auctions
--   SET activated_at = created_at
--   WHERE activated_at IS NULL
--     AND status <> 'removed';
