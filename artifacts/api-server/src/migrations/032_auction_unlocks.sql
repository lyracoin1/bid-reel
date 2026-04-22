-- Migration 032: Per-user, per-auction buyer unlocks ($1 Gumroad gate)
--
-- Business rule (corrected):
--   • Fixed-price listings (sale_type='fixed') remain completely free.
--     Seller contact is always visible; no payment gate.
--   • Auction listings (sale_type='auction') are publicly visible to
--     everyone. But to PLACE A BID or VIEW SELLER CONTACT on a given
--     auction, the viewer must pay $1 for THAT specific auction.
--   • Payment is per (auction, user). Paying for auction A does not
--     unlock auction B. User X paying does not unlock for User Y.
--   • The seller of an auction never needs to pay to access their own
--     listing (handled in the API layer, not in this table).
--
-- Trust model (MVP): the "I have paid" button on the auction detail page
-- inserts a row here with payment_status='paid' without verifying any
-- Gumroad receipt. A future webhook hardening will set payment_status
-- to 'paid' only after a verified receipt and write payment_reference.

CREATE TABLE IF NOT EXISTS auction_unlocks (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id         UUID         NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  user_id            UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  payment_status     TEXT         NOT NULL DEFAULT 'paid'
                                  CHECK (payment_status IN ('pending','paid','refunded','disputed')),
  can_bid            BOOLEAN      NOT NULL DEFAULT TRUE,
  can_view_contact   BOOLEAN      NOT NULL DEFAULT TRUE,
  payment_provider   TEXT         NULL,
  payment_reference  TEXT         NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- One unlock row per (auction, user). Guarantees idempotent "I have paid"
  -- clicks (the API uses ON CONFLICT DO NOTHING) and prevents duplicates.
  CONSTRAINT auction_unlocks_unique_per_user UNIQUE (auction_id, user_id)
);

-- Lookup is always (user_id, auction_id) on every read endpoint and on every
-- bid attempt — a covering index is the right default. The UNIQUE constraint
-- above already creates an index on (auction_id, user_id), so this second
-- index is the inverted-order one for "all unlocks owned by user X" queries.
CREATE INDEX IF NOT EXISTS idx_auction_unlocks_user_auction
  ON auction_unlocks (user_id, auction_id);

-- Touch updated_at automatically on row updates (future-proofing for the
-- webhook hardening, when payment_status flips pending → paid).
CREATE OR REPLACE FUNCTION auction_unlocks_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auction_unlocks_touch_updated_at ON auction_unlocks;
CREATE TRIGGER trg_auction_unlocks_touch_updated_at
  BEFORE UPDATE ON auction_unlocks
  FOR EACH ROW EXECUTE FUNCTION auction_unlocks_touch_updated_at();

-- RLS is intentionally disabled. The API server uses the service role key
-- for all reads/writes, the same as the `bids` table. There is no client
-- direct-to-Postgres access path.
