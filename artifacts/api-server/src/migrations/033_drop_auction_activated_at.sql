-- Migration 033: Drop the (now-incorrect) per-auction `activated_at` column.
--
-- See migration 031 for the original (incorrect) seller-side activation
-- model and the reason it was replaced. Migration 032 implemented the
-- correct buyer-side per-user/per-auction unlock model.
--
-- Idempotent: both DROP statements use IF EXISTS so re-running this
-- migration after the column has already been dropped is a no-op.

DROP INDEX IF EXISTS idx_auctions_locked;

ALTER TABLE auctions
  DROP COLUMN IF EXISTS activated_at;
