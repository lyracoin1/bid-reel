/**
 * pg-pool.ts
 *
 * Lightweight PostgreSQL connection pool used exclusively for the
 * `transactions` (Secure Deals) feature. The rest of the api-server
 * uses Supabase cloud; this pool talks to the Replit-managed PostgreSQL
 * instance.
 *
 * ── Connection priority ──────────────────────────────────────────────────────
 * Replit injects native PostgreSQL credentials as individual env vars:
 *   PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE
 * These always point to the local Replit-managed Postgres and are always
 * reachable.  DATABASE_URL may be set to a Supabase direct-connection URL
 * (db.*.supabase.co:5432) which is NOT reachable from Replit's network and
 * causes ENOTFOUND errors at bootstrap time.
 *
 * Strategy:
 *   1. If PGHOST is present and is NOT a Supabase host → use native PG* vars.
 *      The pg library auto-discovers PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE.
 *   2. Else if DATABASE_URL is set → use it as connectionString (with SSL).
 *      This is a fallback for external deployments only.
 *   3. Otherwise → unavailable proxy (all pool calls reject with a clear error).
 *
 * The transactions table schema lives in:
 *   artifacts/api-server/src/migrations/041_secure_deals_transactions.sql
 * Tables are also created idempotently at server startup via bootstrapTransactionsTable().
 */

import pg from "pg";
import { logger } from "./logger";

const { Pool } = pg;

const PGHOST       = process.env["PGHOST"]       ?? null;
const DATABASE_URL = process.env["DATABASE_URL"] ?? null;

// Replit native Postgres: PGHOST is set and does NOT contain "supabase"
const useNativePg =
  !!PGHOST && !PGHOST.toLowerCase().includes("supabase");

const hasConnection = useNativePg || !!DATABASE_URL;

const _missingDbError = hasConnection
  ? null
  : new Error(
      "No PostgreSQL connection available — Secure Deals (transactions) are unavailable. " +
        "Set PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE (Replit native Postgres) or " +
        "DATABASE_URL pointing to an accessible PostgreSQL database.",
    );

if (_missingDbError) {
  logger.warn(
    "pg-pool: no PostgreSQL connection configured — Secure Deals will be unavailable. " +
      "All other API routes (auctions, bids, users) are unaffected.",
  );
} else {
  logger.info(
    { mode: useNativePg ? "native-pg-vars" : "database-url", host: PGHOST ?? "(from DATABASE_URL)" },
    "pg-pool: connecting to PostgreSQL",
  );
}

function createPool(): pg.Pool {
  if (useNativePg) {
    // Native Replit Postgres — pg lib reads PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE
    // automatically.  No SSL needed for the local socket/loopback connection.
    return new Pool({
      ssl:                    false,
      max:                    5,
      idleTimeoutMillis:      30_000,
      connectionTimeoutMillis: 5_000,
    });
  }

  // DATABASE_URL fallback (Neon, Railway, Render, etc.)
  return new Pool({
    connectionString:        DATABASE_URL!,
    ssl: DATABASE_URL!.includes("sslmode=disable")
      ? false
      : { rejectUnauthorized: false },
    max:                     5,
    idleTimeoutMillis:       30_000,
    connectionTimeoutMillis: 5_000,
  });
}

export const pool: pg.Pool = hasConnection
  ? (() => {
      const p = createPool();
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
    logger.warn("pg-pool: skipping bootstrapTransactionsTable — no PostgreSQL connection configured");
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

    // Idempotent column additions and constraint fixes for tables that already exist.
    // ADD COLUMN IF NOT EXISTS is safe to run on every startup.
    // DROP NOT NULL is idempotent — no-ops if the column is already nullable.
    await client.query(`
      ALTER TABLE transactions
        ALTER COLUMN payment_link DROP NOT NULL;
    `).catch(() => { /* already nullable — ignore */ });

    await client.query(`
      ALTER TABLE transactions
        ADD COLUMN IF NOT EXISTS paid_amount   NUMERIC(14,2);
      ALTER TABLE transactions
        ADD COLUMN IF NOT EXISTS confirmed_at  TIMESTAMPTZ;
      -- Part #13: External Payment Warning
      ALTER TABLE transactions
        ADD COLUMN IF NOT EXISTS external_payment_warning         BOOLEAN     NOT NULL DEFAULT FALSE;
      ALTER TABLE transactions
        ADD COLUMN IF NOT EXISTS external_payment_confirmed_at    TIMESTAMPTZ;
      ALTER TABLE transactions
        ADD COLUMN IF NOT EXISTS external_payment_warning_reason  TEXT;
      -- Hide Buyer Info Until Payment Confirmed
      ALTER TABLE transactions
        ADD COLUMN IF NOT EXISTS buyer_info_visible  BOOLEAN NOT NULL DEFAULT FALSE;
      -- Part #17: Receipt / Order ID storage
      ALTER TABLE transactions
        ADD COLUMN IF NOT EXISTS order_id              TEXT;
      ALTER TABLE transactions
        ADD COLUMN IF NOT EXISTS receipt_file_url      TEXT;
      ALTER TABLE transactions
        ADD COLUMN IF NOT EXISTS receipt_uploaded_at   TIMESTAMPTZ;
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

    // ── seller_penalties (Part #10: Seller Penalty System) ───────────────────
    // Admin-imposed penalties on a deal's seller (warning, fee, suspension, etc.)
    await client.query(`
      CREATE TABLE IF NOT EXISTS seller_penalties (
        id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        deal_id      TEXT         NOT NULL,
        seller_id    UUID         NOT NULL,
        reason       TEXT         NOT NULL,
        penalty_type TEXT         NOT NULL
                       CHECK (penalty_type IN ('warning', 'fee', 'suspension', 'other')),
        amount       NUMERIC(12,2),
        resolved     BOOLEAN      NOT NULL DEFAULT FALSE,
        created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_seller_penalties_deal_id
        ON seller_penalties (deal_id);
      CREATE INDEX IF NOT EXISTS idx_seller_penalties_seller_id
        ON seller_penalties (seller_id);
    `);

    // ── shipping_fee_disputes (Part #9: Shipping Fee Dispute) ─────────────────
    // Either party can open a dispute about who should pay the shipping fee.
    // UNIQUE (deal_id, submitted_by) prevents duplicate disputes per user.
    await client.query(`
      CREATE TABLE IF NOT EXISTS shipping_fee_disputes (
        id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        deal_id      TEXT         NOT NULL,
        submitted_by UUID         NOT NULL,
        party        TEXT         NOT NULL
                       CHECK (party IN ('buyer', 'seller')),
        proof_url    TEXT,
        comment      TEXT,
        created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        CONSTRAINT shipping_fee_disputes_unique_deal_submitter
          UNIQUE (deal_id, submitted_by)
      );

      CREATE INDEX IF NOT EXISTS idx_shipping_fee_disputes_deal_id
        ON shipping_fee_disputes (deal_id);
      CREATE INDEX IF NOT EXISTS idx_shipping_fee_disputes_submitted_by
        ON shipping_fee_disputes (submitted_by);
    `);

    // ── delivery_proofs (Part #8: Buyer Delivery Proof Upload) ───────────────
    // Buyer uploads a receipt/photo proving they received the item.
    // Same Replit Postgres DB as payment_proofs and shipment_proofs.
    await client.query(`
      CREATE TABLE IF NOT EXISTS delivery_proofs (
        id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        deal_id     TEXT         NOT NULL,
        buyer_id    UUID         NOT NULL,
        file_url    TEXT         NOT NULL,
        uploaded_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        CONSTRAINT delivery_proofs_unique_deal_buyer UNIQUE (deal_id, buyer_id)
      );

      CREATE INDEX IF NOT EXISTS idx_delivery_proofs_deal_id
        ON delivery_proofs (deal_id);
      CREATE INDEX IF NOT EXISTS idx_delivery_proofs_buyer_id
        ON delivery_proofs (buyer_id);
    `);

    // ── escrow (Part #12: Escrow Logic) ──────────────────────────────────────
    // One escrow row per Secure Deal (UNIQUE on deal_id).
    // Created lazily when payment_status transitions to 'secured'.
    // status: 'pending' → 'released' (admin) | 'disputed' (buyer/seller)
    await client.query(`
      CREATE TABLE IF NOT EXISTS escrow (
        id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
        deal_id              TEXT          NOT NULL UNIQUE,
        buyer_id             UUID          NOT NULL,
        seller_id            UUID          NOT NULL,
        amount               NUMERIC(14,2) NOT NULL,
        status               TEXT          NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'released', 'disputed')),
        released_at          TIMESTAMPTZ,
        dispute_id           UUID,
        platform_fee         NUMERIC(12,2) NOT NULL DEFAULT 0,
        seller_receive_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      );

      ALTER TABLE escrow
        ADD COLUMN IF NOT EXISTS platform_fee          NUMERIC(12,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS seller_receive_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

      CREATE INDEX IF NOT EXISTS idx_escrow_deal_id   ON escrow (deal_id);
      CREATE INDEX IF NOT EXISTS idx_escrow_buyer_id  ON escrow (buyer_id);
      CREATE INDEX IF NOT EXISTS idx_escrow_seller_id ON escrow (seller_id);
      CREATE INDEX IF NOT EXISTS idx_escrow_status    ON escrow (status);
    `);

    // ── product_media (Part #15: Product Media Upload) ───────────────────────
    // Multiple media items per deal (images + videos uploaded by the seller).
    // UNIQUE (deal_id, file_name) enables upsert — same filename re-uploads replace.
    await client.query(`
      CREATE TABLE IF NOT EXISTS product_media (
        id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
        deal_id     TEXT          NOT NULL,
        seller_id   UUID          NOT NULL,
        media_type  TEXT          NOT NULL DEFAULT 'image'
                      CHECK (media_type IN ('image', 'video')),
        file_url    TEXT          NOT NULL,
        file_name   TEXT          NOT NULL DEFAULT '',
        file_size   INTEGER,
        uploaded_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        CONSTRAINT product_media_unique_deal_file UNIQUE (deal_id, file_name)
      );

      CREATE INDEX IF NOT EXISTS idx_product_media_deal_id   ON product_media (deal_id);
      CREATE INDEX IF NOT EXISTS idx_product_media_seller_id ON product_media (seller_id);
    `);

    // ── Digital Vault columns on transactions (Phase 1) ───────────────────────
    // All added safely with ADD COLUMN IF NOT EXISTS — no risk to existing rows.
    // deal_type defaults to 'physical' so all current rows remain unaffected.
    // vault_ciphertext and vault_iv store AES-256-GCM encrypted vault data.
    // vault_ciphertext and vault_iv are intentionally excluded from all normal
    // GET responses — only the /reveal and /vault-review endpoints return plaintext.
    await client.query(`
      ALTER TABLE transactions
        ADD COLUMN IF NOT EXISTS deal_type          TEXT        NOT NULL DEFAULT 'physical'
                                                      CHECK (deal_type IN ('physical', 'digital'));
      ALTER TABLE transactions
        ADD COLUMN IF NOT EXISTS vault_ciphertext   TEXT        NULL;
      ALTER TABLE transactions
        ADD COLUMN IF NOT EXISTS vault_iv           TEXT        NULL;
      ALTER TABLE transactions
        ADD COLUMN IF NOT EXISTS vault_revealed_at  TIMESTAMPTZ NULL;
      ALTER TABLE transactions
        ADD COLUMN IF NOT EXISTS vault_ack_status   TEXT        NULL
                                                      CHECK (vault_ack_status IN ('accepted', 'disputed'));
      ALTER TABLE transactions
        ADD COLUMN IF NOT EXISTS vault_ack_at       TIMESTAMPTZ NULL;
    `);

    // ── digital_deal_disputes (Digital Vault Phase 1) ─────────────────────────
    // Buyer-raised disputes about digital vault contents after revealing.
    // Separate from shipping_fee_disputes — different reasons and resolution flow.
    await client.query(`
      CREATE TABLE IF NOT EXISTS digital_deal_disputes (
        id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        deal_id     TEXT         NOT NULL,
        buyer_id    UUID         NOT NULL,
        reason      TEXT         NOT NULL CHECK (char_length(reason) <= 2000),
        status      TEXT         NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open', 'resolved_buyer', 'resolved_seller')),
        admin_note  TEXT,
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        resolved_at TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS idx_digital_disputes_deal_id
        ON digital_deal_disputes (deal_id);
      CREATE INDEX IF NOT EXISTS idx_digital_disputes_buyer_id
        ON digital_deal_disputes (buyer_id);
      CREATE INDEX IF NOT EXISTS idx_digital_disputes_status
        ON digital_deal_disputes (status);
    `);

    // ── vault_access_audit (Digital Vault Phase 1) ────────────────────────────
    // Immutable audit trail of every vault reveal — buyer reveals and admin reviews.
    // Plaintext vault contents are NEVER stored in this table.
    // access_type examples: 'buyer_reveal', 'admin_dispute_review', 'admin_compliance_review'
    await client.query(`
      CREATE TABLE IF NOT EXISTS vault_access_audit (
        id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        deal_id     TEXT         NOT NULL,
        admin_id    UUID         NULL,
        buyer_id    UUID         NULL,
        access_type TEXT         NOT NULL,
        reason      TEXT         NULL,
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_vault_audit_deal_id
        ON vault_access_audit (deal_id);
      CREATE INDEX IF NOT EXISTS idx_vault_audit_admin_id
        ON vault_access_audit (admin_id)
        WHERE admin_id IS NOT NULL;
    `);

    // ── Point 2: auction_id on transactions ───────────────────────────────────
    // Optional link from a Secure Deal back to its source auction in Supabase.
    // Enables the full flow: auction/listing → deal → payment → vault reveal.
    // NULL for deals created without an auction origin (direct P2P deals).
    await client.query(`
      ALTER TABLE transactions
        ADD COLUMN IF NOT EXISTS auction_id TEXT NULL;

      CREATE INDEX IF NOT EXISTS idx_transactions_auction_id
        ON transactions (auction_id)
        WHERE auction_id IS NOT NULL;
    `);

    // ── Point 4: vault_dispute_resolution on transactions ─────────────────────
    // Records the admin's resolution outcome for a digital vault dispute so that
    // vault_ack_status does not remain ambiguously 'disputed' after resolution.
    // Values: 'resolved_buyer' (dispute upheld) | 'resolved_seller' (overridden).
    // NULL until an admin resolves a dispute via POST /admin/digital-disputes/:id/resolve.
    await client.query(`
      ALTER TABLE transactions
        ADD COLUMN IF NOT EXISTS vault_dispute_resolution TEXT NULL;
    `);

    // ── Point 4: admin_note + resolved_by_admin on escrow ────────────────────
    // admin_note:        human-readable explanation recorded when admin intervenes.
    // resolved_by_admin: UUID of the admin who resolved a disputed escrow.
    await client.query(`
      ALTER TABLE escrow
        ADD COLUMN IF NOT EXISTS admin_note        TEXT NULL;
      ALTER TABLE escrow
        ADD COLUMN IF NOT EXISTS resolved_by_admin UUID NULL;
    `);

    // ── Point 4: extend escrow status to include 'refunded' ──────────────────
    // 'refunded' is set when admin resolves an escrow dispute in the buyer's favour.
    // The actual payout to the buyer is handled externally/manually.
    // We DROP the old auto-named constraint and ADD the new one with 'refunded'.
    // DROP IF EXISTS is a no-op on first run; safe to re-run on every startup.
    await client.query(`
      ALTER TABLE escrow DROP CONSTRAINT IF EXISTS escrow_status_check;
      ALTER TABLE escrow ADD CONSTRAINT escrow_status_check
        CHECK (status IN ('pending', 'released', 'disputed', 'refunded'));
    `).catch(() => {
      // Constraint rename may fail if another constraint covers the same column —
      // log and continue. The column still has a NOT NULL DEFAULT 'pending' guard.
      logger.warn("pg-pool: could not update escrow status CHECK constraint (non-fatal — constraint may already be up to date)");
    });

    // ── seller_payout_methods ─────────────────────────────────────────────────
    // Sellers store their preferred payout bank/wallet/crypto details here.
    // account_details are encrypted at rest with the same AES-256-GCM system
    // used for the digital vault. Plaintext is NEVER stored.
    await client.query(`
      CREATE TABLE IF NOT EXISTS seller_payout_methods (
        id                        UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id                   UUID         NOT NULL,
        method_type               TEXT         NOT NULL,
        account_details_encrypted TEXT         NOT NULL,
        account_details_iv        TEXT         NOT NULL,
        is_default                BOOLEAN      NOT NULL DEFAULT TRUE,
        last_admin_view_at        TIMESTAMPTZ  NULL,
        last_admin_view_by        UUID         NULL,
        created_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_payout_methods_user_id
        ON seller_payout_methods (user_id);
    `);

    // ── payouts ───────────────────────────────────────────────────────────────
    // One payout record per deal (UNIQUE on deal_id). Created automatically
    // when the deal is confirmed (vault ACK, admin resolve, or escrow release).
    // Admins process payouts manually through a dedicated admin UI.
    // Status lifecycle: ready → processing → paid
    //                                     ↘ cancelled (any status before 'paid')
    await client.query(`
      CREATE TABLE IF NOT EXISTS payouts (
        id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
        deal_id            TEXT          NOT NULL,
        seller_id          UUID          NOT NULL,
        gross_amount       NUMERIC(14,2) NOT NULL,
        platform_fee       NUMERIC(12,2) NOT NULL DEFAULT 0,
        net_amount         NUMERIC(14,2) NOT NULL,
        payout_method_id   UUID          NULL,
        status             TEXT          NOT NULL DEFAULT 'ready'
                             CHECK (status IN ('pending','ready','processing','paid','cancelled')),
        admin_id           UUID          NULL,
        admin_note         TEXT          NULL,
        external_reference TEXT          NULL,
        created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        paid_at            TIMESTAMPTZ   NULL,
        CONSTRAINT payouts_deal_id_unique UNIQUE (deal_id)
      );

      CREATE INDEX IF NOT EXISTS idx_payouts_seller_id ON payouts (seller_id);
      CREATE INDEX IF NOT EXISTS idx_payouts_status    ON payouts (status);
    `);

    _bootstrapped = true;
    logger.info(
      "pg-pool: transactions, payment_proofs, shipment_proofs, delivery_proofs, " +
      "shipping_fee_disputes, seller_penalties, escrow, product_media, " +
      "digital_deal_disputes, vault_access_audit bootstrapped",
    );
  } catch (err) {
    logger.error({ err }, "pg-pool: failed to bootstrap transactions table");
  } finally {
    client.release();
  }
}
