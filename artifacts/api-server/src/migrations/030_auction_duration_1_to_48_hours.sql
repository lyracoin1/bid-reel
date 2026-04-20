-- Migration 030: Allow auction duration from 1 to 48 hours
--
-- The frontend duration selector now accepts any whole number of hours from
-- 1 to 48 (was previously limited to 24 or 48). Older constraints on this
-- table only allowed 3 days, or 24/48 hours exactly. Drop any legacy
-- variant and install a single canonical constraint named
-- chk_auction_duration that allows ends_at - created_at to fall anywhere
-- between 1 hour and 48 hours, with a 5 minute upper tolerance for clock
-- skew between Node and Postgres.
--
-- Idempotent and safe to re-run. NOT VALID so existing rows under older
-- rules are not retroactively checked.

-- Drop every known prior variant.
ALTER TABLE auctions DROP CONSTRAINT IF EXISTS chk_auctions_ends_at_3days;
ALTER TABLE auctions DROP CONSTRAINT IF EXISTS chk_auctions_ends_at_duration;
ALTER TABLE auctions DROP CONSTRAINT IF EXISTS chk_auction_duration;

-- Install the canonical 1–48 hour constraint.
ALTER TABLE auctions
  ADD CONSTRAINT chk_auction_duration
  CHECK (
    ends_at BETWEEN (created_at + INTERVAL '1 hour' - INTERVAL '5 minutes')
                AND (created_at + INTERVAL '48 hours' + INTERVAL '5 minutes')
  )
  NOT VALID;
