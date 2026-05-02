/**
 * pg-pool.ts
 *
 * Lightweight PostgreSQL connection pool used exclusively for the
 * `transactions` (Secure Deals) feature. The rest of the api-server
 * uses Supabase cloud; this pool talks to the Replit-managed PostgreSQL
 * instance (DATABASE_URL).
 *
 * The transactions table schema lives in migration:
 *   artifacts/api-server/src/migrations/041_secure_deals_transactions.sql
 *
 * This module also runs a one-time idempotent table-creation on first use
 * so the table is always present without manual migration steps.
 */

import pg from "pg";
import { logger } from "./logger";

const { Pool } = pg;

const DATABASE_URL = process.env["DATABASE_URL"];
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required for transactions");
}

export const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes("sslmode=disable")
    ? false
    : { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (err) => {
  logger.error({ err: err.message }, "pg-pool: unexpected idle client error");
});

// ── One-time table bootstrap ──────────────────────────────────────────────────

let _bootstrapped = false;

export async function bootstrapTransactionsTable(): Promise<void> {
  if (_bootstrapped) return;

  const client = await pool.connect();
  try {
    await client.query(`
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

      CREATE INDEX IF NOT EXISTS idx_transactions_seller_id
        ON transactions (seller_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_buyer_id
        ON transactions (buyer_id)
        WHERE buyer_id IS NOT NULL;

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
    `);

    // Idempotent column additions for tables that already exist.
    // ADD COLUMN IF NOT EXISTS is safe to run on every startup.
    await client.query(`
      ALTER TABLE transactions
        ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(14,2);
    `);

    _bootstrapped = true;
    logger.info("pg-pool: transactions table bootstrapped");
  } catch (err) {
    logger.error({ err }, "pg-pool: failed to bootstrap transactions table");
  } finally {
    client.release();
  }
}
