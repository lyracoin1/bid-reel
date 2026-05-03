-- =============================================================================
-- Migration 052: Escrow — escrow table (Part #12)
-- =============================================================================
-- Stored in Replit PostgreSQL alongside transactions / payment_proofs.
-- Applied automatically at server startup via bootstrapTransactionsTable().
-- This file is documentation — the actual DDL lives in pg-pool.ts bootstrap.
--
-- One escrow row per Secure Deal (UNIQUE on deal_id).
-- Created lazily when payment_status transitions to 'secured'.
-- =============================================================================

CREATE TABLE IF NOT EXISTS escrow (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id     TEXT          NOT NULL UNIQUE,
  buyer_id    UUID          NOT NULL,
  seller_id   UUID          NOT NULL,
  amount      NUMERIC(14,2) NOT NULL,
  status      TEXT          NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'released', 'disputed')),
  released_at TIMESTAMPTZ,
  dispute_id  UUID,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_escrow_deal_id   ON escrow (deal_id);
CREATE INDEX IF NOT EXISTS idx_escrow_buyer_id  ON escrow (buyer_id);
CREATE INDEX IF NOT EXISTS idx_escrow_seller_id ON escrow (seller_id);
CREATE INDEX IF NOT EXISTS idx_escrow_status    ON escrow (status);
