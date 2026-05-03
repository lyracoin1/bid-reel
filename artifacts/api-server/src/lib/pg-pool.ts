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
 *
 * RESILIENCE: When DATABASE_URL is not set (e.g. Vercel without the env var),
 * this module does NOT throw at import time. Instead, pool.query() and
 * pool.connect() reject with a clear error message. This allows all
 * Supabase-backed routes (auctions, bids, users, etc.) to load and serve
 * normally. Only the Secure Deals routes (which actually use this pool)
 * will fail — all other mobile app functionality is unaffected.
 */

import pg from "pg";
import { logger } from "./logger";

const { Pool } = pg;

const DATABASE_URL = process.env["DATABASE_URL"] ?? null;

const _missingDbError = DATABASE_URL
  ? null
  : new Error(
      "DATABASE_URL is not configured in this deployment — " +
        "Secure Deals (transactions) are unavailable. " +
        "Set DATABASE_URL in Vercel → Settings → Environment Variables " +
        "pointing to an externally-accessible PostgreSQL database, then redeploy.",
    );

if (_missingDbError) {
  logger.warn(
    "pg-pool: DATABASE_URL is not set — Secure Deals will be unavailable. " +
      "All other API routes (auctions, bids, users) are unaffected.",
  );
}

export const pool: pg.Pool = DATABASE_URL
  ? (() => {
      const p = new Pool({
        connectionString: DATABASE_URL,
        ssl: DATABASE_URL.includes("sslmode=disable")
          ? false
          : { rejectUnauthorized: false },
        max: 5,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
      });
      p.on("error", (err) => {
        logger.error({ err: err.message }, "pg-pool: unexpected idle client error");
      });
      return p;
    })()
  : (new Proxy({} as pg.Pool, {
      get(_target, prop) {
        if (prop === "query" || prop === "connect") {
          return () => Promise.reject(_missingDbError);
        }
        if (prop === "on" || prop === "end" || prop === "removeListener") {
          return () => {};
        }
        return undefined;
      },
    }) as pg.Pool);

// ── One-time table bootstrap ──────────────────────────────────────────────────

let _bootstrapped = false;

export async function bootstrapTransactionsTable(): Promise<void> {
  if (_bootstrapped) return;
  if (_missingDbError) {
    logger.warn("pg-pool: skipping bootstrapTransactionsTable — DATABASE_URL not set");
    return;
  }

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

    // ── payment_proofs (Part #4: Buyer Payment Proof Upload) ─────────────────
    // Stored in Replit Postgres alongside transactions so pool.query() can
    // access it directly. No Supabase RLS needed — the API enforces auth.
    await client.query(`
      CREATE TABLE IF NOT EXISTS payment_proofs (
        id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        deal_id     TEXT         NOT NULL,
        buyer_id    UUID         NOT NULL,
        file_url    TEXT         NOT NULL,
        file_name   TEXT         NOT NULL,
        file_type   TEXT         NOT NULL,
        file_size   INTEGER,
        uploaded_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        CONSTRAINT payment_proofs_unique_deal UNIQUE (deal_id)
      );

      CREATE INDEX IF NOT EXISTS idx_payment_proofs_deal_id
        ON payment_proofs (deal_id);
      CREATE INDEX IF NOT EXISTS idx_payment_proofs_buyer_id
        ON payment_proofs (buyer_id);
    `);

    // ── shipment_proofs (Part #5: Seller Shipment Proof Upload) ──────────────
    // Same database, same reasoning as payment_proofs above.
    await client.query(`
      CREATE TABLE IF NOT EXISTS shipment_proofs (
        id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        deal_id       TEXT         NOT NULL,
        seller_id     UUID         NOT NULL,
        file_url      TEXT         NOT NULL,
        tracking_link TEXT         NOT NULL DEFAULT '',
        uploaded_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        CONSTRAINT shipment_proofs_unique_deal_seller UNIQUE (deal_id, seller_id)
      );

      CREATE INDEX IF NOT EXISTS idx_shipment_proofs_deal_id
        ON shipment_proofs (deal_id);
      CREATE INDEX IF NOT EXISTS idx_shipment_proofs_seller_id
        ON shipment_proofs (seller_id);
    `);

    _bootstrapped = true;
    logger.info("pg-pool: transactions, payment_proofs, shipment_proofs bootstrapped");
  } catch (err) {
    logger.error({ err }, "pg-pool: failed to bootstrap transactions table");
  } finally {
    client.release();
  }
}
