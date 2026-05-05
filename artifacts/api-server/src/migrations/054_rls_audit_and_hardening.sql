-- =============================================================================
-- Migration 054: RLS Audit & Hardening (Supabase-only)
-- =============================================================================
-- Produced from a full audit of migrations 001–053 and pg-pool.ts.
--
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  DATABASE OWNERSHIP — DEFINITIVE MAP                                    ║
-- ╠══════════════════════════════════════════════════════════════════════════╣
-- ║  SUPABASE (zhbfbjwagehwetyqljjr.supabase.co)                           ║
-- ║  ─────────────────────────────────────────────────────────────────────  ║
-- ║  profiles              auctions          bids                           ║
-- ║  likes                 reports           blocks                         ║
-- ║  contact_requests      notifications     moderation_queue               ║
-- ║  admin_actions         user_devices      user_follows                   ║
-- ║  saved_auctions        admin_notifications  content_signals             ║
-- ║  auction_deals         deal_ratings (028 — boolean f1-f5 system)        ║
-- ║  password_reset_otps   auction_unlocks   seller_ratings                 ║
-- ║  auction_view_events   auction_view_stats                               ║
-- ╠══════════════════════════════════════════════════════════════════════════╣
-- ║  REPLIT POSTGRESQL (DATABASE_URL / PGHOST — bootstrapped by pg-pool.ts) ║
-- ║  ─────────────────────────────────────────────────────────────────────  ║
-- ║  transactions          deal_conditions   seller_conditions              ║
-- ║  deal_ratings (044 — stars system)       payment_proofs                 ║
-- ║  shipment_proofs       delivery_proofs   shipping_fee_disputes          ║
-- ║  seller_penalties      escrow            product_media                  ║
-- ║  digital_deal_disputes vault_access_audit                               ║
-- ║                                                                         ║
-- ║  These tables are unreachable via the Supabase anon key.               ║
-- ║  They have no RLS (Supabase RLS only applies to Supabase PostgreSQL).  ║
-- ║  Access is enforced at the API layer (Express + service-role only).    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- NOTE — migrations 041–044 label their SQL files "run in Supabase SQL editor"
-- but all their tables (transactions, deal_conditions, seller_conditions,
-- deal_ratings-stars) are actually bootstrapped via pg-pool.ts on the Replit
-- PostgreSQL instance.  The Supabase SQL files for those migrations are
-- documentation artifacts only; the tables do not exist in Supabase.  The
-- only real Supabase-side changes in those migrations are the notifications
-- type CHECK constraint extensions, which DID run in Supabase successfully.
--
-- =============================================================================
-- ACCESS MODEL
-- ═══════════════
-- • Express API (port 8080) → SUPABASE_SERVICE_ROLE_KEY → bypasses all RLS.
-- • Frontend (anon key) → Supabase auth calls ONLY (signIn, signUp,
--   resetPasswordForEmail, updateUser, OAuth). Zero .from() / .storage calls
--   confirmed by full codebase grep. 
-- • Supabase Realtime → used client-side for `auctions` (live bid updates)
--   and `notifications` (in-app badge). SELECT policies on those tables gate
--   what the WebSocket stream exposes.
-- • RLS exists for defence-in-depth: prevents direct PostgREST abuse if the
--   anon/authenticated key is ever used to probe tables directly.
--
-- =============================================================================
-- AUDIT RESULTS — ALL SUPABASE TABLES
-- ═════════════════════════════════════
--
--  ✅ profiles            RLS on; select_authenticated, insert_own, update_own,
--                         admin_update_any — migration 006
--  ✅ auctions            RLS on; select (status != 'removed'), insert_own,
--                         delete_own_no_bids, admin overrides — migration 006
--  ✅ bids                RLS on; public select, insert_own (not seller);
--                         Realtime publication — migrations 002, 006
--  ✅ likes               RLS on; own-row SELECT/INSERT/DELETE — migration 006
--  ✅ reports             RLS on; own SELECT/INSERT, admin overrides — 006
--  ✅ blocks              RLS on; own-row SELECT/INSERT/DELETE — migration 006
--  ✅ contact_requests    RLS on; parties SELECT, requester INSERT — 006
--  ✅ notifications       RLS on; own SELECT/UPDATE, server INSERT only;
--                         Realtime publication — migrations 003, 006
--  ✅ moderation_queue    RLS on; admin-only — migration 006
--  ✅ admin_actions       RLS on; admin-only, append-only — migration 006
--  ✅ user_devices        RLS on; own CRUD — migration 007
--  ✅ user_follows        RLS on; auth SELECT, own INSERT/DELETE — 014
--  ✅ saved_auctions      RLS on; own SELECT/INSERT/DELETE — migration 015
--  ✅ admin_notifications RLS on; admin-only SELECT/UPDATE — migration 018
--  ✅ content_signals     RLS on; own upsert + service_role — migration 024
--  ✅ auction_deals       RLS on; service_role + parties SELECT — migration 028
--  ✅ deal_ratings (028)  RLS on; service_role + public SELECT — migration 028
--  ✅ password_reset_otps RLS on; service_role only — migration 031
--  ✅ auction_view_events RLS on; service_role + owner SELECT — migration 027
--  ✅ auction_view_stats  RLS on; service_role + public SELECT — migration 027
--
--  ⚠️  auction_unlocks    RLS intentionally disabled (migration 032 comment).
--                         All access is via service_role through the API.
--                         GAP: no explicit REVOKE prevents the anon/authenticated
--                         roles from reaching the table via PostgREST grants.
--                         FIXED BELOW: revoke all PostgREST access.
--
--  ❌ seller_ratings      RLS NOT enabled; no policies exist.
--                         Any caller with the anon or authenticated key can
--                         SELECT, INSERT, UPDATE, DELETE any row via PostgREST.
--                         FIXED BELOW.
--
-- =============================================================================


-- =============================================================================
-- FIX 1: seller_ratings — enable RLS and add policies
-- =============================================================================
--
-- Table created in migration 038 (Supabase). No ENABLE ROW LEVEL SECURITY or
-- policies were included in that migration, leaving the table fully open.
--
-- Correct access model:
--   READ   — any authenticated user can read ratings on any profile.
--            Ratings are a public trust signal. When is_anonymous = true the
--            API layer omits rater_user_id from the response; RLS does not
--            need to enforce this projection (service_role handles the read).
--   INSERT — only the rater (rater_user_id = auth.uid()).
--            One-per-deal enforcement is the UNIQUE(deal_id, rater_user_id)
--            constraint; deal completion checks are at the API layer.
--   UPDATE / DELETE — none; ratings are immutable once submitted.
--   anon   — no access; ratings require a logged-in user to be meaningful.
--
-- =============================================================================

ALTER TABLE seller_ratings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "seller_ratings_select_authenticated" ON seller_ratings;
CREATE POLICY "seller_ratings_select_authenticated"
  ON seller_ratings
  FOR SELECT
  TO authenticated
  USING (TRUE);

DROP POLICY IF EXISTS "seller_ratings_insert_own" ON seller_ratings;
CREATE POLICY "seller_ratings_insert_own"
  ON seller_ratings
  FOR INSERT
  TO authenticated
  WITH CHECK (rater_user_id = auth.uid());

-- No UPDATE or DELETE policies — ratings are append-only.


-- =============================================================================
-- FIX 2: auction_unlocks — revoke PostgREST grants
-- =============================================================================
--
-- Migration 032 disabled RLS intentionally (all reads/writes go through the
-- Express API using service_role). However, disabling RLS alone does not
-- prevent direct PostgREST access — PostgREST requires an explicit GRANT to
-- expose a table, and the default Supabase setup grants SELECT to anon and
-- authenticated on public schema tables.
--
-- Since auction_unlocks must never be reachable via the anon/authenticated
-- key (it contains payment status and Gumroad tokens), we revoke those grants
-- explicitly. Service_role retains full access via its RLS/grant bypass.
--
-- =============================================================================

REVOKE ALL ON TABLE public.auction_unlocks FROM anon;
REVOKE ALL ON TABLE public.auction_unlocks FROM authenticated;


-- =============================================================================
-- REPLIT POSTGRESQL TABLES — NOT IN SCOPE FOR THIS MIGRATION
-- =============================================================================
--
-- The following tables live in the Replit-managed PostgreSQL instance and are
-- bootstrapped at server startup by bootstrapTransactionsTable() in pg-pool.ts.
-- Supabase RLS cannot be applied to them. Access security is enforced
-- exclusively at the Express API layer (all routes require a valid JWT;
-- the pool is only called from authenticated server-side handlers).
--
--   transactions          — core Secure Deal record
--   deal_conditions       — buyer terms per deal
--   seller_conditions     — seller terms per deal
--   deal_ratings (044)    — post-deal star ratings
--   payment_proofs        — buyer payment receipts
--   shipment_proofs       — seller shipping evidence
--   delivery_proofs       — buyer delivery confirmation
--   shipping_fee_disputes — who pays shipping fee
--   seller_penalties      — admin-imposed penalties
--   escrow                — escrow ledger rows
--   product_media         — deal media assets
--   digital_deal_disputes — digital vault disputes
--   vault_access_audit    — immutable vault reveal log
--
-- =============================================================================


-- =============================================================================
-- BACKEND-LAYER ENFORCEMENT CHECKLIST (informational — not RLS)
-- =============================================================================
--
-- The following rules are enforced in the Express API (already implemented):
--
-- 1. Bid amount > current_bid + min_increment   (SELECT FOR UPDATE transaction)
-- 2. Auction active + ends_at > now()           (checked before bid INSERT)
-- 3. Seller cannot bid on own auction           (API check before INSERT)
-- 4. Profile column protection                  (Zod strips is_admin, is_banned,
--                                                ban_reason in PATCH /users/me)
-- 5. Auction field protection                   (seller PATCH: title/description only)
-- 6. Block-feed exclusion                       (WHERE NOT EXISTS blocks in feed query)
-- 7. Notification fan-out                       (post-bid server logic)
-- 8. seller_ratings.is_anonymous                (API strips rater_user_id when true)
-- 9. Replit PG table auth                       (all pool.query() calls are
--                                                behind JWT-verified Express routes)
--
-- =============================================================================


-- Reload PostgREST schema cache so new policies and grants take effect.
NOTIFY pgrst, 'reload schema';
