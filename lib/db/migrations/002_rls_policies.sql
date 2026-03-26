-- =============================================================================
-- BidReel MVP — Row Level Security (RLS) Policies
-- Target: Supabase PostgreSQL
-- Run after: 001_initial_schema.sql
-- =============================================================================
--
-- Overview:
--
--   This file enables RLS on all nine application tables and defines policies
--   that enforce the principle of least privilege:
--
--     • Unauthenticated users: no access to any table
--     • Authenticated users: scoped access per table (own rows, public reads)
--     • Admin users: elevated read/write via is_admin() helper function
--     • Service role (backend): bypasses RLS entirely — all business-rule
--       validation (e.g. bid amount > current_price) lives in the API layer
--
--   Phone privacy:
--     RLS cannot restrict individual columns. The `profiles` table SELECT
--     policy allows authenticated reads of all rows, but phone protection
--     is enforced at two other layers:
--       1. The `v_public_profiles` view explicitly omits the phone column.
--          All public-facing API responses must query this view.
--       2. The backend Express API never maps the phone field to any
--          response DTO.
--     This is the standard Supabase pattern for column-level privacy.
--
--   Admin model:
--     Admins are identified by profiles.is_admin = TRUE. The `is_admin()`
--     helper function checks this with SECURITY DEFINER so it can query
--     profiles without triggering RLS recursion.
--     A banned admin (is_banned = TRUE) loses admin privileges.
--
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helper function: is_admin()
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER: runs with owner privileges, bypassing RLS on `profiles`.
-- This avoids an infinite recursion loop when a profiles SELECT policy tries
-- to call is_admin() which itself queries profiles.
--
-- STABLE: marks the function as returning the same result for the same inputs
-- within a single transaction — Postgres can cache the result per query, which
-- is important for performance since many policies call this function.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles
    WHERE id         = auth.uid()
      AND is_admin   = TRUE
      AND is_banned  = FALSE
  );
$$;

-- Grant execute to authenticated role so policies can use it.
GRANT EXECUTE ON FUNCTION is_admin() TO authenticated;

COMMENT ON FUNCTION is_admin() IS
  'Returns TRUE if the calling user is a non-banned admin. '
  'SECURITY DEFINER avoids RLS recursion on profiles. '
  'Always check is_banned to prevent a banned admin from retaining privileges.';

-- =============================================================================
-- TABLE: profiles
-- =============================================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- SELECT — any authenticated user can read any profile row.
-- IMPORTANT: phone is not protected at the policy level — it is excluded
-- from v_public_profiles and must never be returned by the API layer.
-- The backend uses the service_role key (bypasses RLS) when it needs phone
-- to build the wa.me URL. No policy grants anonymous access.
CREATE POLICY "profiles_select_authenticated"
  ON profiles
  FOR SELECT
  TO authenticated
  USING (TRUE);

-- INSERT — users can only insert their own profile row.
-- This is called once at registration via a backend route (service_role),
-- so this policy is a safety net rather than the primary creation path.
-- The id must equal auth.uid() to prevent impersonation.
CREATE POLICY "profiles_insert_own"
  ON profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

-- UPDATE — users can only update their own profile.
-- Column-level restrictions (e.g. preventing self-promotion to is_admin)
-- must be enforced in the API layer — RLS cannot restrict individual columns.
-- The API must never allow clients to send is_admin, is_banned, or phone
-- in an update payload.
CREATE POLICY "profiles_update_own"
  ON profiles
  FOR UPDATE
  TO authenticated
  USING    (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- DELETE — disallowed for all regular users via RLS.
-- Profiles are soft-banned, never hard-deleted, to preserve audit trail.
-- Only service_role (backend admin endpoints) may delete profiles.
-- No DELETE policy defined = deny by default.

-- Admin override — admins can update any profile (for ban/unban operations).
CREATE POLICY "profiles_update_admin"
  ON profiles
  FOR UPDATE
  TO authenticated
  USING    (is_admin())
  WITH CHECK (is_admin());

COMMENT ON TABLE profiles IS
  'RLS: authenticated users can SELECT all rows (phone excluded at API/view layer). '
  'Users INSERT/UPDATE own row only. Admins can UPDATE any row. No DELETE via RLS.';

-- =============================================================================
-- TABLE: auctions
-- =============================================================================

ALTER TABLE auctions ENABLE ROW LEVEL SECURITY;

-- SELECT — authenticated users can read active and ended auctions.
-- 'removed' auctions are hidden from regular users; admins see all.
CREATE POLICY "auctions_select_active_ended"
  ON auctions
  FOR SELECT
  TO authenticated
  USING (
    status IN ('active', 'ended')
    OR is_admin()
    OR seller_id = auth.uid()
    -- Sellers can always see their own listings regardless of status,
    -- so they can see when their listing was removed (with a UI message).
  );

-- INSERT — authenticated users can create auctions only as themselves.
-- Business rules (valid video_url, ends_at = now()+3d) enforced in API layer.
CREATE POLICY "auctions_insert_own"
  ON auctions
  FOR INSERT
  TO authenticated
  WITH CHECK (seller_id = auth.uid());

-- UPDATE — sellers can update their own auctions.
-- IMPORTANT: current_price, bid_count, and like_count must NOT be modifiable
-- via the API layer. These fields are maintained exclusively by DB triggers.
-- The API update route must use an explicit allowlist of updatable columns:
--   title, description, category — only permitted when bid_count = 0.
-- Status transitions (active → removed) are handled by admin endpoints only.
-- This policy trusts the API layer for column restrictions.
CREATE POLICY "auctions_update_own"
  ON auctions
  FOR UPDATE
  TO authenticated
  USING    (seller_id = auth.uid())
  WITH CHECK (seller_id = auth.uid());

-- Admins can update any auction (e.g. force status = 'removed').
CREATE POLICY "auctions_update_admin"
  ON auctions
  FOR UPDATE
  TO authenticated
  USING    (is_admin())
  WITH CHECK (is_admin());

-- DELETE — sellers can delete their own auction only when no bids have been placed.
-- The bid_count = 0 check is enforced at both policy and API layers.
CREATE POLICY "auctions_delete_own_no_bids"
  ON auctions
  FOR DELETE
  TO authenticated
  USING (seller_id = auth.uid() AND bid_count = 0);

-- Admins can delete any auction.
CREATE POLICY "auctions_delete_admin"
  ON auctions
  FOR DELETE
  TO authenticated
  USING (is_admin());

COMMENT ON TABLE auctions IS
  'RLS: authenticated users read active/ended. Sellers insert/update/delete own (delete only if bid_count=0). '
  'Admins read/update/delete all. current_price, bid_count, like_count are trigger-maintained — API must never allow direct writes to those columns.';

-- =============================================================================
-- TABLE: bids
-- =============================================================================

ALTER TABLE bids ENABLE ROW LEVEL SECURITY;

-- SELECT — any authenticated user can read bid history on any auction.
-- Bid amounts and bidder identities are public (this is standard auction UX).
-- If anonymized bidding is needed later, restrict to auction participant or owner.
CREATE POLICY "bids_select_authenticated"
  ON bids
  FOR SELECT
  TO authenticated
  USING (TRUE);

-- INSERT — users can only insert bids as themselves.
-- Critical business rules that RLS CANNOT enforce (must be done in API layer):
--   1. amount > auctions.current_price (requires cross-table check in a transaction)
--   2. auction.status = 'active' AND auction.ends_at > now()
--   3. bidder_id != auction.seller_id (seller cannot bid on own listing)
--   4. Minimum bid increment: amount >= current_price + minimum_increment
-- The WITH CHECK only ensures identity — the API does the rest.
CREATE POLICY "bids_insert_own"
  ON bids
  FOR INSERT
  TO authenticated
  WITH CHECK (bidder_id = auth.uid());

-- UPDATE — none. Bids are immutable records.
-- DELETE — none. Bids are immutable records.
-- Violation of these is prevented by the absence of UPDATE/DELETE policies
-- (deny by default when RLS is enabled).

COMMENT ON TABLE bids IS
  'RLS: all authenticated users read bids. Users insert only as themselves. '
  'No UPDATE/DELETE allowed. Business rules (amount > current_price, auction active, not own auction) '
  'MUST be enforced in API layer — RLS cannot do cross-table validation efficiently here.';

-- =============================================================================
-- TABLE: likes
-- =============================================================================

ALTER TABLE likes ENABLE ROW LEVEL SECURITY;

-- SELECT — any authenticated user can read likes.
-- Useful for "is this auction liked by me?" and like count cross-checks.
CREATE POLICY "likes_select_authenticated"
  ON likes
  FOR SELECT
  TO authenticated
  USING (TRUE);

-- INSERT — users can only like as themselves.
-- The UNIQUE(user_id, auction_id) constraint handles idempotency at DB level.
-- The API should use ON CONFLICT DO NOTHING on INSERT.
CREATE POLICY "likes_insert_own"
  ON likes
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- DELETE — users can only unlike their own likes.
CREATE POLICY "likes_delete_own"
  ON likes
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- UPDATE — none. Likes have no mutable fields.

COMMENT ON TABLE likes IS
  'RLS: all authenticated users read likes. Users insert/delete only their own rows. '
  'UNIQUE(user_id, auction_id) makes the operation idempotent at DB level.';

-- =============================================================================
-- TABLE: reports
-- =============================================================================

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

-- SELECT — users can only read reports they filed themselves.
-- Admins can read all reports for moderation.
-- This prevents users from seeing other users' reports or using the reports
-- table as a surveillance tool.
CREATE POLICY "reports_select_own"
  ON reports
  FOR SELECT
  TO authenticated
  USING (
    reporter_id = auth.uid()
    OR is_admin()
  );

-- INSERT — users can only submit reports as themselves.
-- Business rules for API layer:
--   1. Users cannot report their own auctions.
--   2. UNIQUE(reporter_id, auction_id) prevents duplicate reports per user
--      (enforced by DB constraint, not just here).
CREATE POLICY "reports_insert_own"
  ON reports
  FOR INSERT
  TO authenticated
  WITH CHECK (reporter_id = auth.uid());

-- UPDATE — regular users cannot update reports after filing.
-- Admins (via service_role) can update status, resolved_by, resolved_at, admin_note.
-- No authenticated-role UPDATE policy is defined here; resolution is done
-- via service_role in the backend admin routes.

-- DELETE — not permitted. Reports are permanent records.

COMMENT ON TABLE reports IS
  'RLS: users read/insert only their own reports. Admins read all. '
  'No UPDATE/DELETE via authenticated role — resolution performed by backend via service_role. '
  'Business rule: users cannot report own auction — must be enforced in API layer.';

-- =============================================================================
-- TABLE: blocks
-- =============================================================================

ALTER TABLE blocks ENABLE ROW LEVEL SECURITY;

-- SELECT — users can only read their own block list.
-- A blocked user must not be able to tell they are blocked by querying this table.
CREATE POLICY "blocks_select_own"
  ON blocks
  FOR SELECT
  TO authenticated
  USING (blocker_id = auth.uid());

-- INSERT — users can only create blocks as the blocker.
-- The CHECK constraint (blocker_id != blocked_id) on the table prevents self-blocks.
-- Additional API-layer check: the target user should exist and not be already blocked
-- (the UNIQUE constraint handles the latter).
CREATE POLICY "blocks_insert_own"
  ON blocks
  FOR INSERT
  TO authenticated
  WITH CHECK (blocker_id = auth.uid());

-- DELETE — users can only remove their own blocks.
CREATE POLICY "blocks_delete_own"
  ON blocks
  FOR DELETE
  TO authenticated
  USING (blocker_id = auth.uid());

-- UPDATE — none. Blocks have no mutable fields.

COMMENT ON TABLE blocks IS
  'RLS: users read/insert/delete only their own block rows. '
  'Blocked users cannot detect they are blocked by querying this table. '
  'Feed query excludes blocked sellers at API layer using blocker_id = me filter.';

-- =============================================================================
-- TABLE: contact_requests
-- =============================================================================

ALTER TABLE contact_requests ENABLE ROW LEVEL SECURITY;

-- SELECT — requester can see their outbound contact requests;
-- seller can see inbound contact requests on their auctions.
-- This supports future features like seller seeing "X buyers are interested."
CREATE POLICY "contact_requests_select_parties"
  ON contact_requests
  FOR SELECT
  TO authenticated
  USING (
    requester_id = auth.uid()
    OR seller_id = auth.uid()
    OR is_admin()
  );

-- INSERT — only the requester can create the row, and they must be the requester.
-- Business rules for API layer:
--   1. requester_id != seller_id (CHECK constraint also handles this)
--   2. The auction must be active
--   3. Rate limiting: avoid contact spam (not enforceable in RLS)
CREATE POLICY "contact_requests_insert_own"
  ON contact_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (requester_id = auth.uid());

-- UPDATE — the requester can update status to 'delivered' after the client
-- confirms the WhatsApp link was opened. Seller cannot change status.
-- Limit updatable columns at the API layer (only status field).
CREATE POLICY "contact_requests_update_requester"
  ON contact_requests
  FOR UPDATE
  TO authenticated
  USING    (requester_id = auth.uid())
  WITH CHECK (requester_id = auth.uid());

-- DELETE — not permitted. Contact requests are audit records.

COMMENT ON TABLE contact_requests IS
  'RLS: requester and seller can read relevant rows. Only requester inserts/updates. '
  'No DELETE — contact requests are audit records. Phone is NEVER stored here.';

-- =============================================================================
-- TABLE: moderation_queue
-- =============================================================================

ALTER TABLE moderation_queue ENABLE ROW LEVEL SECURITY;

-- SELECT — admins only.
-- Regular authenticated users have no visibility into the moderation queue.
CREATE POLICY "moderation_queue_select_admin"
  ON moderation_queue
  FOR SELECT
  TO authenticated
  USING (is_admin());

-- INSERT — only via service_role (backend creates queue entries when reports
-- exceed a threshold or system flags an auction). No authenticated-role INSERT
-- policy is defined — regular users never create queue entries directly.

-- UPDATE — admins only (to mark items reviewed).
CREATE POLICY "moderation_queue_update_admin"
  ON moderation_queue
  FOR UPDATE
  TO authenticated
  USING    (is_admin())
  WITH CHECK (is_admin());

-- DELETE — not permitted. Queue entries are a paper trail.

COMMENT ON TABLE moderation_queue IS
  'RLS: admin read/update only. Regular users have zero access. '
  'INSERT performed by backend via service_role (not by authenticated clients).';

-- =============================================================================
-- TABLE: admin_actions
-- =============================================================================

ALTER TABLE admin_actions ENABLE ROW LEVEL SECURITY;

-- SELECT — admins only. Regular users cannot audit admin activity.
CREATE POLICY "admin_actions_select_admin"
  ON admin_actions
  FOR SELECT
  TO authenticated
  USING (is_admin());

-- INSERT — admins only. The backend writes audit rows via service_role,
-- but this policy allows direct authenticated admin writes if needed
-- (e.g. Supabase Studio admin usage). admin_id must equal the caller.
CREATE POLICY "admin_actions_insert_admin"
  ON admin_actions
  FOR INSERT
  TO authenticated
  WITH CHECK (is_admin() AND admin_id = auth.uid());

-- UPDATE — none. admin_actions is an append-only log. No policy = deny.
-- DELETE — none. Audit records must never be erased. No policy = deny.

COMMENT ON TABLE admin_actions IS
  'RLS: admin read/insert only. No UPDATE or DELETE — append-only audit log. '
  'admin_id must equal the calling user on INSERT.';

-- =============================================================================
-- Grant usage on public schema to Supabase roles
-- (Required if custom roles are introduced later)
-- =============================================================================
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO anon;

-- View access: only authenticated role can query the safe public views.
-- anon (unauthenticated) gets no access.
GRANT SELECT ON v_public_profiles    TO authenticated;
GRANT SELECT ON v_auction_feed       TO authenticated;
GRANT SELECT ON v_admin_report_queue TO authenticated;
-- Note: v_admin_report_queue RLS is handled by underlying tables, not the view.
-- A non-admin calling SELECT on v_admin_report_queue will get 0 rows because
-- reports and auctions RLS filters them out.

-- =============================================================================
-- SUMMARY
-- =============================================================================
--
-- PROTECTED BY RLS
-- ─────────────────────────────────────────────────────────────────────────────
-- profiles          users read all rows; insert/update own row only; admin update any
-- auctions          users read active/ended; insert/update/delete own (delete: bid_count=0 only); admin all
-- bids              all authenticated users read; insert as self only; no update/delete
-- likes             all authenticated users read; insert/delete as self only
-- reports           users read/insert own only; admin reads all
-- blocks            users read/insert/delete own only (hidden from blocked party)
-- contact_requests  parties read relevant rows; requester inserts/updates; admin reads all
-- moderation_queue  admin only
-- admin_actions     admin read/insert only; no update/delete (append-only)
--
-- MUST BE ENFORCED IN BACKEND LOGIC (API layer / service_role)
-- ─────────────────────────────────────────────────────────────────────────────
-- • Bid: amount > current_price (cross-table, needs transaction)
-- • Bid: auction.status = 'active' AND auction.ends_at > now()
-- • Bid: bidder_id != auction.seller_id (seller cannot bid own auction)
-- • Bid: amount >= current_price + minimum_increment
-- • Auction update: only title/description/category allowed when bid_count > 0
-- • Auction update: current_price, bid_count, like_count are read-only at API level
-- • Profile update: is_admin, is_banned, phone must not be updatable by client
-- • Report: reporter cannot report their own auction
-- • Contact: requester != seller (DB constraint covers it, but validate in API too)
-- • Contact: auction must be active before generating wa.me link
-- • Contact: rate-limiting (not enforceable in RLS)
-- • Phone: never map profiles.phone to any API response DTO; use v_public_profiles
-- • Admin status transitions: auction status changes only via admin API routes
--
-- POLICY LIMITATIONS FOR THIS MVP
-- ─────────────────────────────────────────────────────────────────────────────
-- • Column-level security is not possible with RLS; phone privacy relies on
--   v_public_profiles view + API DTO allowlist patterns
-- • is_admin() uses SECURITY DEFINER — review and rotate function owner if
--   privilege escalation is a concern in a larger team setup
-- • The admin role is a simple boolean flag; for multi-role systems, replace
--   with a roles table + profiles_roles join and update is_admin() accordingly
-- • Rate limiting (OTP, contact requests, bid spam) cannot be expressed in RLS
--   and must live in API middleware or Supabase Edge Functions
-- • The `anon` role has no table access — all app traffic requires a valid
--   Supabase Auth session (phone OTP), which is the intended MVP posture
-- =============================================================================
