-- Migration 035: Defense-in-depth uniqueness on payment_reference
--
-- Each Gumroad sale_id should ever map to exactly one auction_unlocks row
-- (the pending row that owns the matching unlock_token).
-- A UNIQUE index on payment_reference guarantees that even if the webhook
-- handler had a bug, two different rows could not both claim the same
-- Gumroad receipt id — protecting against accidental double-credit.
--
-- Partial index (WHERE NOT NULL) so legacy rows with payment_reference=NULL
-- (none today, but historically possible) coexist freely.

CREATE UNIQUE INDEX IF NOT EXISTS idx_auction_unlocks_payment_reference
  ON auction_unlocks (payment_reference)
  WHERE payment_reference IS NOT NULL;
