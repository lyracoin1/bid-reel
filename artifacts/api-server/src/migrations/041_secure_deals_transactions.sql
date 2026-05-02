-- =============================================================================
-- Migration 041: Secure Deals — transactions table
-- =============================================================================
-- Run ONCE in the Supabase SQL Editor. Fully idempotent — safe to re-run.
--
-- Creates the `transactions` table that backs the Secure Deals feature:
--   - Seller creates a deal → row inserted with payment_status = 'pending'
--   - Buyer pays → payment_status updated to 'secured', buyer_id + payment_date set
--   - Seller ships → shipment_status = 'verified'
--   - Buyer confirms receipt → shipment_status = 'delivered'
--   - Admin releases funds → funds_released = true, release_date set
-- =============================================================================

CREATE TABLE IF NOT EXISTS transactions (
  deal_id          TEXT          PRIMARY KEY,
  seller_id        UUID          NOT NULL,
  buyer_id         UUID,
  product_name     TEXT          NOT NULL,
  price            NUMERIC(14,2) NOT NULL CHECK (price > 0),
  currency         TEXT          NOT NULL DEFAULT 'USD',
  description      TEXT,
  delivery_method  TEXT          NOT NULL,
  media_urls       TEXT[]        NOT NULL DEFAULT '{}',
  terms            TEXT,
  payment_status   TEXT          NOT NULL DEFAULT 'pending'
                     CHECK (payment_status IN ('pending', 'secured', 'refunded')),
  payment_date     TIMESTAMPTZ,
  shipment_status  TEXT          NOT NULL DEFAULT 'pending'
                     CHECK (shipment_status IN ('pending', 'verified', 'delivered')),
  funds_released   BOOLEAN       NOT NULL DEFAULT FALSE,
  payment_link     TEXT,
  release_date     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Auto-update updated_at on every row change
CREATE OR REPLACE FUNCTION update_transactions_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_transactions_updated_at ON transactions;
CREATE TRIGGER trg_transactions_updated_at
  BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION update_transactions_updated_at();

-- Indexes for common access patterns
CREATE INDEX IF NOT EXISTS idx_transactions_seller_id ON transactions (seller_id);
CREATE INDEX IF NOT EXISTS idx_transactions_buyer_id  ON transactions (buyer_id) WHERE buyer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_payment_status ON transactions (payment_status);

-- RLS
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- Anyone with the payment link (deal_id) can read the deal (buyer needs to see it)
DROP POLICY IF EXISTS "public_read_by_deal_id" ON transactions;
CREATE POLICY "public_read_by_deal_id" ON transactions
  FOR SELECT USING (true);

-- Only the seller can create their own deal
DROP POLICY IF EXISTS "sellers_insert_own" ON transactions;
CREATE POLICY "sellers_insert_own" ON transactions
  FOR INSERT WITH CHECK (
    seller_id = (SELECT auth.uid())
  );

-- Seller can update their own deal (shipment, etc.)
DROP POLICY IF EXISTS "sellers_update_own" ON transactions;
CREATE POLICY "sellers_update_own" ON transactions
  FOR UPDATE USING (
    seller_id = (SELECT auth.uid())
    OR buyer_id = (SELECT auth.uid())
  );

-- Grant access to authenticated and anon roles
GRANT SELECT ON TABLE public.transactions TO anon, authenticated;
GRANT INSERT, UPDATE ON TABLE public.transactions TO authenticated;
