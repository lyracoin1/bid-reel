-- Migration 034: unlock_token column for the real Gumroad checkout flow
--
-- Adds a server-generated unique token to each pending unlock so we can:
--   1. Build a Gumroad checkout URL the buyer is redirected to:
--        https://lyracoin.gumroad.com/l/frgfn?token=<unlock_token>
--   2. Later (webhook hardening) match the Gumroad receipt back to the
--      exact (auction_id, user_id) pair via this token.
--
-- The existing UNIQUE(auction_id, user_id) constraint guarantees one row
-- per (auction, user); the token is therefore also unique per pair, and
-- a UNIQUE index on it lets webhook lookups be O(1).
--
-- Backwards compatible:
--   • Column is NULLABLE — old paid rows (created before this migration
--     by the trust-on-claim "I have paid" path) keep payment_status='paid'
--     and unlock_token=NULL. They remain valid unlocks.
--   • New flow: POST /unlock/start inserts a pending row with a token;
--     POST /unlock (or the future webhook) flips payment_status='paid'
--     while leaving the token in place for receipt reconciliation.

ALTER TABLE auction_unlocks
  ADD COLUMN IF NOT EXISTS unlock_token TEXT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_auction_unlocks_unlock_token
  ON auction_unlocks (unlock_token)
  WHERE unlock_token IS NOT NULL;
