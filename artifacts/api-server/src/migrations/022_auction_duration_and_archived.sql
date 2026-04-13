-- Migration 022: Variable auction duration (1–48 h) and archived lifecycle state
--
-- Changes:
--   1. Adds 'archived' value to the auction_status enum.
--   2. Drops the old hard-coded 3-day ends_at CHECK constraint.
--   3. Adds a flexible 1–48 hour duration CHECK constraint (NOT VALID so
--      existing rows under the old 3-day rule are unaffected).
--
-- Apply in Supabase SQL editor before deploying the corresponding server changes.
-- This migration is fully idempotent and safe to re-run.

-- 1. Add 'archived' to auction_status enum (safe additive change)
ALTER TYPE auction_status ADD VALUE IF NOT EXISTS 'archived';

-- 2. Drop the old hard-coded 3-day constraint
ALTER TABLE auctions DROP CONSTRAINT IF EXISTS chk_auctions_ends_at_3days;

-- 3. Add new flexible 1–48 hour constraint.
--    NOT VALID: does not retroactively check existing rows, so auctions
--    created under the old 3-day rule are unaffected. Only new INSERTs
--    and UPDATEs are subject to the constraint.
--    5-minute upper tolerance accounts for server processing delay.
ALTER TABLE auctions
  ADD CONSTRAINT chk_auctions_ends_at_duration
  CHECK (
    ends_at BETWEEN (created_at + INTERVAL '1 hour')
                AND (created_at + INTERVAL '48 hours 5 minutes')
  )
  NOT VALID;
