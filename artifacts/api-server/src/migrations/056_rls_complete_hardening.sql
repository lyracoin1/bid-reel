-- =============================================================================
-- Migration 056: RLS Complete Hardening
-- =============================================================================
-- Closes every remaining Supabase security-advisor "rls_disabled_in_public"
-- warning across the entire BidReel schema.
--
-- ROOT CAUSE ANALYSIS (why the warning survived migration 054)
-- ────────────────────────────────────────────────────────────
-- Supabase's security advisor fires whenever pg_class.relrowsecurity = false
-- for any table in the public schema.  A REVOKE statement (applied to
-- auction_unlocks in 054) changes the grant bitmap but does NOT flip
-- relrowsecurity.  Only ALTER TABLE … ENABLE ROW LEVEL SECURITY does that.
--
-- TABLES FIXED BY THIS MIGRATION
-- ───────────────────────────────
--   auction_unlocks        — RLS intentionally disabled in 032; 054 added
--                            REVOKE but left relrowsecurity = false.
--                            Fixed here: ENABLE RLS + service_role policy.
--
--   password_reset_requests — Created in migration 055 with full RLS, but
--                             055 was never applied to the live Supabase DB.
--                             Included here (idempotent) so both issues are
--                             resolved in a single migration run.
--
-- SAFETY GUARANTEE
-- ─────────────────
-- • The Express API uses the service_role key for all reads/writes to
--   auction_unlocks. service_role bypasses RLS entirely (Supabase guarantee).
--   Enabling RLS on auction_unlocks therefore does NOT change any existing
--   API behaviour — zero risk of breakage.
-- • All ALTER TABLE … ENABLE ROW LEVEL SECURITY statements are idempotent:
--   running them on a table that already has RLS is a no-op.
-- • All CREATE TABLE IF NOT EXISTS / DROP POLICY IF EXISTS / CREATE POLICY
--   statements are idempotent — safe whether or not 055 was previously run.
--
-- IDEMPOTENT — safe to re-run.
-- =============================================================================


-- =============================================================================
-- FIX 1: auction_unlocks — enable RLS and lock down to service_role only
-- =============================================================================
--
-- Migration 032 comment:
--   "RLS is intentionally disabled. The API server uses the service role key
--    for all reads/writes … There is no client direct-to-Postgres access path."
--
-- That design choice is correct and is preserved here.  We enable RLS purely
-- to clear the security-advisor flag.  The single service_role policy grants
-- full access to the service_role (which the API uses) while blocking anon
-- and authenticated roles completely.  The REVOKE from 054 is repeated here
-- (idempotent) for belt-and-suspenders protection at the grant level too.
--
-- =============================================================================

ALTER TABLE auction_unlocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auction_unlocks_service_role_only" ON auction_unlocks;
CREATE POLICY "auction_unlocks_service_role_only"
  ON auction_unlocks
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Belt-and-suspenders: revoke PostgREST grants from client-facing roles
-- (these were also applied in 054; repeating here is a no-op if already done).
REVOKE ALL ON TABLE public.auction_unlocks FROM anon;
REVOKE ALL ON TABLE public.auction_unlocks FROM authenticated;


-- =============================================================================
-- FIX 2: password_reset_requests — create table + RLS (idempotent with 055)
-- =============================================================================
--
-- Migration 055 wrote this SQL but was never executed against the live
-- Supabase database (all DB connection paths from the sandbox were blocked at
-- the time of authorship).  This block is a verbatim copy of 055 with full
-- idempotency guards, so it is safe whether or not 055 was ever applied.
--
-- Access model: service_role only.  The table is an email-reset rate-limiter
-- touched exclusively by the Express API.  No client-direct access is needed.
--
-- =============================================================================

CREATE TABLE IF NOT EXISTS password_reset_requests (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  email_hash       TEXT         NOT NULL,
  request_count    INTEGER      NOT NULL DEFAULT 1,
  window_start     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  last_request_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT uq_reset_requests_email_hash UNIQUE (email_hash)
);

CREATE INDEX IF NOT EXISTS idx_reset_requests_email_hash
  ON password_reset_requests (email_hash);

CREATE INDEX IF NOT EXISTS idx_reset_requests_window_start
  ON password_reset_requests (window_start);

CREATE OR REPLACE FUNCTION set_password_reset_requests_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reset_requests_updated_at ON password_reset_requests;
CREATE TRIGGER trg_reset_requests_updated_at
  BEFORE UPDATE ON password_reset_requests
  FOR EACH ROW EXECUTE FUNCTION set_password_reset_requests_updated_at();

ALTER TABLE password_reset_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reset_requests_service_role" ON password_reset_requests;
CREATE POLICY "reset_requests_service_role"
  ON password_reset_requests
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.password_reset_requests FROM anon;
REVOKE ALL ON TABLE public.password_reset_requests FROM authenticated;

COMMENT ON TABLE password_reset_requests IS
  'Per-email reset-email rate-limiter. Stores SHA-256(lowercase_email) only. Max 3 emails per 24-hour window enforced by API.';


-- =============================================================================
-- BELT-AND-SUSPENDERS: confirm RLS on every other Supabase table
-- =============================================================================
-- These statements are all no-ops if RLS is already enabled (which it is,
-- per source-verified audit of migrations 001–053).  They are included here
-- so that running this single migration is provably sufficient to clear the
-- Supabase security advisor warning — even if any earlier migration was
-- somehow skipped or partially applied on the live database.
-- =============================================================================

-- Core entities (migrations 001–006)
ALTER TABLE auctions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE bids               ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications      ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE likes              ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports            ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocks             ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_requests   ENABLE ROW LEVEL SECURITY;
ALTER TABLE moderation_queue   ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_actions      ENABLE ROW LEVEL SECURITY;

-- Device tokens (migration 007)
ALTER TABLE user_devices       ENABLE ROW LEVEL SECURITY;

-- Social graph (migration 014)
ALTER TABLE user_follows       ENABLE ROW LEVEL SECURITY;

-- Saved auctions / bookmarks (migration 015)
ALTER TABLE saved_auctions     ENABLE ROW LEVEL SECURITY;

-- Admin inbox (migration 018)
ALTER TABLE admin_notifications ENABLE ROW LEVEL SECURITY;

-- Feed personalisation signals (migration 024)
ALTER TABLE content_signals    ENABLE ROW LEVEL SECURITY;

-- View tracking (migration 027)
ALTER TABLE auction_view_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction_view_stats  ENABLE ROW LEVEL SECURITY;

-- Deal + rating system (migration 028)
ALTER TABLE auction_deals      ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_ratings       ENABLE ROW LEVEL SECURITY;

-- OTP reset codes (migration 031)
ALTER TABLE password_reset_otps ENABLE ROW LEVEL SECURITY;

-- Seller text/tag ratings (migration 038 + 054)
ALTER TABLE seller_ratings     ENABLE ROW LEVEL SECURITY;


-- =============================================================================
-- Reload PostgREST schema cache
-- =============================================================================
-- Required for policy and grant changes to take effect immediately without
-- a full Supabase project restart.
-- =============================================================================

NOTIFY pgrst, 'reload schema';


-- =============================================================================
-- POST-RUN VERIFICATION QUERY
-- =============================================================================
-- Run this SELECT after applying the migration to confirm every public table
-- has relrowsecurity = true.  Expected result: zero rows returned.
--
-- SELECT tablename
-- FROM   pg_tables
-- WHERE  schemaname = 'public'
--   AND  tablename NOT IN (
--          SELECT tablename FROM pg_tables
--          WHERE  schemaname = 'public'
--            AND  EXISTS (
--              SELECT 1 FROM pg_class c
--              JOIN   pg_namespace n ON n.oid = c.relnamespace
--              WHERE  c.relname     = pg_tables.tablename
--                AND  n.nspname     = 'public'
--                AND  c.relrowsecurity = true
--            )
--        )
-- ORDER  BY tablename;
--
-- Alternatively (simpler):
--
-- SELECT c.relname AS table_name,
--        c.relrowsecurity AS rls_enabled
-- FROM   pg_class c
-- JOIN   pg_namespace n ON n.oid = c.relnamespace
-- WHERE  n.nspname = 'public'
--   AND  c.relkind = 'r'
-- ORDER  BY c.relname;
-- =============================================================================
