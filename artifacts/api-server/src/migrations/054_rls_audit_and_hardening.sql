-- =============================================================================
-- Migration 054: RLS Audit & Hardening
-- =============================================================================
-- Produced by a full cross-table audit of migrations 001–053.
--
-- ACCESS MODEL RECAP
-- ══════════════════
-- • The Express API server (port 8080) is the ONLY data path for the web/mobile
--   clients. It uses SUPABASE_SERVICE_ROLE_KEY, which bypasses ALL RLS.
-- • The Supabase anon key is used by the frontend ONLY for auth calls
--   (signIn, signUp, resetPasswordForEmail, updateUser, OAuth). No frontend
--   .from() / .select() / .storage calls exist — confirmed by codebase grep.
-- • Supabase Realtime is used client-side for `auctions` (live bid price
--   updates) and `notifications` (in-app badge/toast). Both tables have
--   appropriate SELECT-only Realtime-relevant policies (from migrations 002/003).
--
-- WHY RLS STILL MATTERS (defence-in-depth + Realtime gating)
-- ═══════════════════════════════════════════════════════════
-- 1. Realtime WebSocket streams are gated by the SELECT policies of the
--    subscribed table. Without a SELECT policy, Realtime leaks all rows.
-- 2. The anon/authenticated roles can query PostgREST directly using the
--    public anon key if a table has no RLS. Defence-in-depth requires that
--    every Supabase table be properly locked down even when the primary
--    data path is the Express API.
-- 3. Future features (Supabase Edge Functions, direct SDK calls) inherit
--    the correct posture automatically.
--
-- TABLES IN SCOPE (Supabase PostgreSQL only)
-- ══════════════════════════════════════════
-- Tables living in Replit PostgreSQL (DATABASE_URL — bootstrapped by
-- pg-pool.ts) are out of scope: payment_proofs, shipment_proofs,
-- delivery_proofs, shipping_fee_disputes, seller_penalties, escrow.
-- Those tables are never reachable from the Supabase anon key.
--
-- AUDIT FINDINGS
-- ══════════════
-- ✅ profiles           — RLS on; policies in 006 (select_authenticated,
--                         insert_own, update_own, admin_update_any)
-- ✅ auctions           — RLS on; policies in 006 (select != 'removed',
--                         insert_own, delete_own_no_bids, admin overrides)
-- ✅ bids               — RLS on; policies in 006 (public select, insert_own,
--                         not-seller guard); Realtime on
-- ✅ likes              — RLS on; own-row SELECT/INSERT/DELETE in 006
-- ✅ reports            — RLS on; own-row SELECT/INSERT, admin overrides in 006
-- ✅ blocks             — RLS on; own-row SELECT/INSERT/DELETE in 006
-- ✅ contact_requests   — RLS on; parties SELECT, requester INSERT in 006
-- ✅ notifications      — RLS on; own SELECT/UPDATE, server INSERT; Realtime on
-- ✅ moderation_queue   — RLS on; admin-only in 006
-- ✅ admin_actions      — RLS on; admin-only, append-only in 006
-- ✅ user_devices       — RLS on; own CRUD in 007
-- ✅ user_follows       — RLS on; auth SELECT, own INSERT/DELETE in 014
-- ✅ saved_auctions     — RLS on; own SELECT/INSERT/DELETE in 015
-- ✅ admin_notifications— RLS on; admin-only SELECT/UPDATE in 018
-- ✅ content_signals    — RLS on; own upsert + service_role in 024
-- ✅ auction_deals      — RLS on; service_role + parties SELECT in 028
-- ✅ deal_ratings (028) — RLS on; service_role + public SELECT in 028
-- ✅ password_reset_otps— RLS on; service_role only in 031
-- ✅ auction_view_events— RLS on; service_role + owner SELECT in 027
-- ✅ auction_view_stats — RLS on; service_role + public SELECT in 027
-- ✅ deal_conditions    — RLS on; parties SELECT, buyer INSERT/UPDATE in 042
-- ✅ seller_conditions  — RLS on; parties SELECT, seller INSERT/UPDATE in 043
-- ✅ deal_ratings (044) — RLS on; parties SELECT, rater INSERT in 044
--
-- ⚠️  auction_unlocks   — RLS intentionally disabled (comment in 032).
--                         All access via service_role. Explicitly confirmed OK.
--                         This migration adds a clarifying comment index.
--
-- ❌ seller_ratings     — RLS NOT enabled; NO policies. Any anon user can
--                         SELECT, INSERT, UPDATE, DELETE any row via PostgREST.
--                         FIXED BELOW.
--
-- ❌ transactions       — RLS enabled but SELECT policy is USING(true),
--                         exposing ALL rows (seller_id, buyer_id, price, terms,
--                         description, payment_link) to the public anon key.
--                         FIXED BELOW: gated to deal parties only.
--
-- NOTE: deal_ratings schema conflict
-- ════════════════════════════════════
-- Migration 028 creates deal_ratings (boolean f1-f5, refs auction_deals.id).
-- Migration 044 also runs CREATE TABLE IF NOT EXISTS deal_ratings with a stars
-- column referencing transactions(deal_id). Because migration 028 runs first,
-- migration 044's CREATE TABLE is a no-op — the existing schema (from 028)
-- stays in place. The 044 RLS policies ARE applied to the 028-schema table.
-- The 044 INSERT policy (rater_id = auth.uid()) is safe regardless of schema.
-- The 044 SELECT policy (EXISTS on transactions) will never match rows whose
-- deal_id references auction_deals — this is harmless (it just makes the
-- SELECT policy more restrictive than intended). The service_role policy from
-- 028 grants the API full access. No code change is needed here, but the
-- 044 migration should be reconciled with 028 in a future schema cleanup.
--
-- =============================================================================


-- =============================================================================
-- FIX 1: seller_ratings — enable RLS and add policies
-- =============================================================================
--
-- Who needs access?
--   READ  — any authenticated user can read ratings on a profile they can
--           already see (ratings are a public trust signal; the rater may be
--           anonymous per is_anonymous flag — the API layer enforces that).
--   INSERT — the rater (rater_user_id = auth.uid()) only.
--             Business rules (must have a completed deal, one rating per deal)
--             are enforced at the API layer.
--   UPDATE / DELETE — none; ratings are immutable once submitted.
--   Service role — bypasses RLS for admin operations.
--
-- =============================================================================

ALTER TABLE seller_ratings ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read seller ratings.
-- The is_anonymous flag is enforced at the API layer (the API strips
-- rater_user_id from the response when is_anonymous = true).
DROP POLICY IF EXISTS "seller_ratings_select_authenticated" ON seller_ratings;
CREATE POLICY "seller_ratings_select_authenticated"
  ON seller_ratings
  FOR SELECT
  TO authenticated
  USING (TRUE);

-- Only the rater can submit a rating (rater_user_id = caller's uid).
-- One-per-deal enforcement is via the UNIQUE(deal_id, rater_user_id) constraint.
DROP POLICY IF EXISTS "seller_ratings_insert_own" ON seller_ratings;
CREATE POLICY "seller_ratings_insert_own"
  ON seller_ratings
  FOR INSERT
  TO authenticated
  WITH CHECK (rater_user_id = auth.uid());

-- No UPDATE or DELETE policies — ratings are append-only.
-- The audit log must remain immutable; corrections go through admin API.


-- =============================================================================
-- FIX 2: transactions — restrict SELECT to deal parties only
-- =============================================================================
--
-- The existing "public_read_by_deal_id" policy (USING true) was intended to
-- allow buyers who only have the deal_id (payment link) to read the deal
-- before they are assigned as buyer_id. In practice this exposes ALL rows —
-- including seller contact info, negotiated price, and deal terms — to every
-- anonymous PostgREST request.
--
-- Correct model:
--   • Authenticated seller can always read their own deals.
--   • Authenticated buyer (assigned) can read.
--   • A user who has submitted deal_conditions (potential buyer) can read
--     the deal they are negotiating — this mirrors the seller_conditions
--     SELECT policy in migration 043.
--   • Anon (unauthenticated) gets nothing through RLS. The payment-link
--     flow must be served by the Express API (service_role), which validates
--     the deal_id token and returns only the public fields needed by the
--     payment page (product_name, price, currency, payment_link). This is
--     already what the API does — no frontend directly hits Supabase for
--     transaction reads.
--
-- =============================================================================

DROP POLICY IF EXISTS "public_read_by_deal_id"  ON transactions;
DROP POLICY IF EXISTS "sellers_insert_own"       ON transactions;
DROP POLICY IF EXISTS "sellers_update_own"       ON transactions;

-- Seller can read all their own deals.
CREATE POLICY "transactions_select_seller"
  ON transactions
  FOR SELECT
  TO authenticated
  USING (seller_id = auth.uid());

-- Assigned buyer can read deals they are party to.
CREATE POLICY "transactions_select_buyer"
  ON transactions
  FOR SELECT
  TO authenticated
  USING (buyer_id = auth.uid());

-- A potential buyer who has submitted conditions for this deal can read it
-- (they need the seller's product info to pay). Mirrors seller_conditions
-- SELECT policy in migration 043.
CREATE POLICY "transactions_select_potential_buyer"
  ON transactions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM   deal_conditions dc
      WHERE  dc.deal_id   = transactions.deal_id
        AND  dc.buyer_id  = auth.uid()
    )
  );

-- Only the authenticated seller can create their own deal.
CREATE POLICY "transactions_insert_seller"
  ON transactions
  FOR INSERT
  TO authenticated
  WITH CHECK (seller_id = auth.uid());

-- Either party (seller or assigned buyer) can update relevant columns.
-- Column-level restrictions (e.g. buyer cannot change price) are enforced
-- at the API layer; RLS enforces only row ownership.
CREATE POLICY "transactions_update_party"
  ON transactions
  FOR UPDATE
  TO authenticated
  USING (
    seller_id = auth.uid()
    OR buyer_id = auth.uid()
  );

-- Revoke the broad grants that allowed anon to read all transactions.
-- Only authenticated users should interact with this table via PostgREST.
-- Service role retains full access regardless (RLS bypass).
REVOKE SELECT, INSERT, UPDATE ON TABLE public.transactions FROM anon;
GRANT  SELECT, INSERT, UPDATE ON TABLE public.transactions TO authenticated;


-- =============================================================================
-- FIX 3: auction_unlocks — document intentional RLS-disabled state
-- =============================================================================
--
-- Migration 032 explicitly disabled RLS with the comment:
--   "RLS is intentionally disabled. The API server uses the service role key
--    for all reads/writes, the same as the `bids` table."
--
-- This is confirmed safe:
--   • The anon key has no INSERT/SELECT grants on this table.
--   • All reads/writes go through the Express API using service_role.
--   • No frontend code accesses auction_unlocks directly.
--
-- Ensure the anon role cannot reach this table through PostgREST.

REVOKE ALL ON TABLE public.auction_unlocks FROM anon;
REVOKE ALL ON TABLE public.auction_unlocks FROM authenticated;
-- Service role retains full access via RLS bypass (no grant needed).


-- =============================================================================
-- STORAGE BUCKET POLICY REMINDER (not SQL — apply in Supabase dashboard)
-- =============================================================================
--
-- auction-media bucket
--   • Public: true  (video/thumbnail URLs are bare CDN links — intentional)
--   • RLS: INSERT restricted to authenticated users via presigned URLs issued
--     by the server. Direct client uploads are blocked at the API gateway.
--     Review Storage policies in the Supabase dashboard to confirm:
--       "Authenticated users can upload to their own prefix"
--       "Anyone can download objects" (public bucket)
--
-- avatars bucket
--   • Public: true
--   • INSERT: authenticated only (user's own prefix)
--
-- No anon upload policies should exist on any bucket.
--
-- =============================================================================


-- =============================================================================
-- BACKEND-LAYER ENFORCEMENT CHECKLIST (not RLS — informational)
-- =============================================================================
--
-- The following rules cannot be reliably enforced by RLS and MUST remain
-- in the Express API layer (already implemented per prior audit):
--
-- 1. Bid amount > current_bid + min_increment (race: SELECT FOR UPDATE)
-- 2. Auction status = 'active' AND ends_at > now() at bid time
-- 3. Seller cannot bid on own auction (checked at API before INSERT)
-- 4. Profile column protection (is_admin, is_banned, ban_reason stripped
--    by Zod schema in PATCH /api/users/me)
-- 5. Auction field protection (seller PATCH restricted to title/description)
-- 6. Block-feed exclusion (WHERE NOT EXISTS blocks — done in feed query)
-- 7. Notification fan-out (post-bid server logic)
-- 8. seller_ratings.is_anonymous enforcement (API strips rater_user_id
--    from SELECT response when is_anonymous = true)
-- 9. transactions: public payment-link flow served by API (service_role),
--    only exposing safe public fields (product_name, price, payment_link)
--
-- =============================================================================


-- Reload PostgREST schema cache so new policies take effect immediately.
NOTIFY pgrst, 'reload schema';
