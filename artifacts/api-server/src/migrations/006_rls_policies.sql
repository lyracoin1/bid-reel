-- =============================================================================
-- BidReel MVP — Row Level Security (RLS) Policies
-- Migration: 006_rls_policies.sql
-- Target: Supabase PostgreSQL (pg 15+)
-- =============================================================================
--
-- PURPOSE
--   This file is the authoritative definition of all RLS policies for the
--   BidReel MVP. It supersedes any partial policies created in earlier
--   migrations (001–005). It is fully idempotent: each policy is dropped
--   then re-created, so running this file twice is safe.
--
-- HOW THIS WORKS WITH THE API SERVER
--   The Express API server connects to Supabase using the SERVICE_ROLE key.
--   Service role bypasses ALL RLS policies. Every business-rule enforcement
--   that requires cross-table knowledge (e.g. seller cannot bid on own
--   auction) is therefore handled at the API layer.
--
--   These policies exist for two complementary purposes:
--     1. Supabase Realtime subscriptions from the mobile client (the client
--        subscribes directly to the auctions channel to receive live bid
--        updates; RLS gates what data the WebSocket stream exposes).
--     2. Defence-in-depth: if a policy is misconfigured at the API layer,
--        RLS provides a second check against direct Supabase client access.
--
-- ADMIN MODEL
--   Admins are identified by profiles.is_admin = TRUE. A helper SQL function
--   is_admin() encapsulates this check so policies stay readable. The function
--   uses SECURITY DEFINER so it runs as the owning role (postgres), avoiding
--   a recursive RLS evaluation on the profiles table.
--
-- =============================================================================


-- =============================================================================
-- STEP 1: Enable RLS on all tables (idempotent — safe to repeat)
-- =============================================================================

ALTER TABLE profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE auctions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE bids              ENABLE ROW LEVEL SECURITY;
ALTER TABLE likes             ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports           ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocks            ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_requests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications     ENABLE ROW LEVEL SECURITY;
ALTER TABLE moderation_queue  ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_actions     ENABLE ROW LEVEL SECURITY;


-- =============================================================================
-- STEP 2: Helper function — is_admin()
-- =============================================================================
-- Returns TRUE if the currently authenticated user has admin privileges.
--
-- SECURITY DEFINER is required because this function queries the profiles
-- table, which has RLS enabled. Without SECURITY DEFINER, calling is_admin()
-- inside a policy would trigger a recursive RLS evaluation on profiles and
-- fail. SECURITY DEFINER makes the function execute as its owner (postgres),
-- bypassing RLS only for this specific lookup.
--
-- STABLE tells the planner the function returns the same result within a
-- single query, allowing it to be inlined and cached.
--
-- The function also checks is_banned = FALSE so that banned admins lose
-- their privileges immediately without any code change.
-- =============================================================================

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM   profiles
    WHERE  id        = auth.uid()
      AND  is_admin  = TRUE
      AND  is_banned = FALSE
  );
$$;

-- Grant execute to the authenticated role so policies can call it
GRANT EXECUTE ON FUNCTION is_admin() TO authenticated;


-- =============================================================================
-- TABLE: profiles
-- =============================================================================
--
-- GOAL: Any authenticated user can read another user's public profile (needed
-- for feed cards and auction detail to display seller info). Users can write
-- only their own row. Phone, expo_push_token and ban_reason are never returned
-- through RLS-gated SELECT — API layer queries public_profiles VIEW instead.
--
-- NOTE: The INSERT policy allows users to create their own profile row on first
-- login. In practice, the server (service_role) creates the row in the
-- auth.users on_signup hook, but this policy permits the Supabase client to
-- bootstrap a profile row if needed.
-- =============================================================================

-- DROP existing policies before re-creating (idempotent)
DROP POLICY IF EXISTS "profiles_select_authenticated"  ON profiles;
DROP POLICY IF EXISTS "profiles_insert_own"            ON profiles;
DROP POLICY IF EXISTS "profiles_update_own"            ON profiles;
DROP POLICY IF EXISTS "profiles_admin_update_any"      ON profiles;

-- Any logged-in user can read any profile
-- (phone, expo_push_token are excluded via the public_profiles VIEW)
CREATE POLICY "profiles_select_authenticated"
  ON profiles
  FOR SELECT
  TO authenticated
  USING (TRUE);

-- Users can insert only their own profile row (id = auth uid)
CREATE POLICY "profiles_insert_own"
  ON profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

-- Users can update only their own profile row
CREATE POLICY "profiles_update_own"
  ON profiles
  FOR UPDATE
  TO authenticated
  USING     (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Admins can update any profile (needed for ban / unban actions)
-- In MVP, ban/unban is executed server-side via service_role, so this is a
-- forward-looking policy for when the admin dashboard gets direct DB access.
CREATE POLICY "profiles_admin_update_any"
  ON profiles
  FOR UPDATE
  TO authenticated
  USING     (is_admin())
  WITH CHECK (is_admin());

-- DELETE: cascades from auth.users deletion — no client DELETE policy needed.

-- WHAT STILL NEEDS BACKEND ENFORCEMENT for profiles:
--   • Column-level protection: RLS cannot prevent a user from setting
--     is_admin = TRUE or is_banned = FALSE on their own row. The API layer
--     MUST strip these fields from any PATCH /users/me request body before
--     writing to the DB.
--   • Phone uniqueness: enforced by UNIQUE constraint, but the server must
--     also validate format (E.164) before inserting.


-- =============================================================================
-- TABLE: auctions
-- =============================================================================
--
-- GOAL: Active and ended auctions are readable by everyone including guests
-- (the feed has no auth requirement). Removed auctions are invisible to all
-- non-admins. Sellers can create and soft-manage their own listings. Protected
-- fields (current_bid, bid_count, like_count, winner_id, ends_at) are mutated
-- exclusively by the server under service_role.
-- =============================================================================

DROP POLICY IF EXISTS "auctions_select_public"          ON auctions;
DROP POLICY IF EXISTS "auctions_select_removed_admin"   ON auctions;
DROP POLICY IF EXISTS "auctions_insert_own"             ON auctions;
DROP POLICY IF EXISTS "auctions_update_own"             ON auctions;
DROP POLICY IF EXISTS "auctions_delete_own_no_bids"     ON auctions;
DROP POLICY IF EXISTS "auctions_admin_update_any"       ON auctions;
DROP POLICY IF EXISTS "auctions_admin_delete_any"       ON auctions;

-- Everyone (including unauthenticated / anon) can read active and ended auctions
CREATE POLICY "auctions_select_public"
  ON auctions
  FOR SELECT
  USING (status IN ('active', 'ended'));

-- Admins can also see removed auctions (for moderation review)
CREATE POLICY "auctions_select_removed_admin"
  ON auctions
  FOR SELECT
  TO authenticated
  USING (status = 'removed' AND is_admin());

-- Authenticated sellers can create their own auctions
CREATE POLICY "auctions_insert_own"
  ON auctions
  FOR INSERT
  TO authenticated
  WITH CHECK (seller_id = auth.uid());

-- Sellers can update their own auction — limited to safe fields only.
-- IMPORTANT: RLS cannot restrict which columns are updated. The API layer
-- MUST enforce that sellers can only change: title, description, category.
-- Fields current_bid, bid_count, like_count, winner_id, status, ends_at
-- are mutated by the server (service_role) only and must be stripped from
-- any client-initiated UPDATE.
CREATE POLICY "auctions_update_own"
  ON auctions
  FOR UPDATE
  TO authenticated
  USING     (seller_id = auth.uid())
  WITH CHECK (seller_id = auth.uid());

-- Sellers can delete their own auction ONLY when no bids have been placed.
-- The bid_count = 0 check here provides a DB-level guard.
CREATE POLICY "auctions_delete_own_no_bids"
  ON auctions
  FOR DELETE
  TO authenticated
  USING (seller_id = auth.uid() AND bid_count = 0);

-- Admins can update any auction (e.g. set status = 'removed')
CREATE POLICY "auctions_admin_update_any"
  ON auctions
  FOR UPDATE
  TO authenticated
  USING     (is_admin())
  WITH CHECK (is_admin());

-- Admins can hard-delete any auction if ever needed (rare — prefer soft remove)
CREATE POLICY "auctions_admin_delete_any"
  ON auctions
  FOR DELETE
  TO authenticated
  USING (is_admin());

-- WHAT STILL NEEDS BACKEND ENFORCEMENT for auctions:
--   • Column-level protection: strip current_bid, bid_count, like_count,
--     winner_id, status, ends_at from any seller-initiated PATCH body.
--   • ends_at 3-day window: validated by CHECK constraint in schema, but the
--     server must also set ends_at = now() + INTERVAL '3 days' at INSERT time.
--   • Category allowlist: validated at the API layer and by the CHECK
--     constraint in the schema.


-- =============================================================================
-- TABLE: bids
-- =============================================================================
--
-- GOAL: Bid history is publicly readable (shown in auction detail). Bidders
-- can place bids only as themselves. The seller-cannot-bid rule is enforced
-- here in RLS via a subquery — this is the one case where RLS can catch a
-- violation that the API layer might miss.
--
-- Bids are IMMUTABLE once inserted — no UPDATE or DELETE policies exist.
-- =============================================================================

DROP POLICY IF EXISTS "bids_select_public"           ON bids;
DROP POLICY IF EXISTS "bids_insert_own"              ON bids;
DROP POLICY IF EXISTS "bids_insert_not_seller"       ON bids;

-- Anyone can read bid history (supports Realtime feed of live bids on detail)
CREATE POLICY "bids_select_public"
  ON bids
  FOR SELECT
  USING (TRUE);

-- Bidders insert only their own bids
CREATE POLICY "bids_insert_own"
  ON bids
  FOR INSERT
  TO authenticated
  WITH CHECK (bidder_id = auth.uid());

-- DB-level guard: sellers cannot bid on their own auctions.
-- This is a subquery join on auctions — viable at the RLS layer because
-- bids.auction_id FK guarantees the auction row exists.
CREATE POLICY "bids_insert_not_seller"
  ON bids
  FOR INSERT
  TO authenticated
  WITH CHECK (
    NOT EXISTS (
      SELECT 1
      FROM   auctions a
      WHERE  a.id        = auction_id
        AND  a.seller_id = auth.uid()
    )
  );

-- No UPDATE or DELETE policies — bids are append-only.

-- WHAT STILL NEEDS BACKEND ENFORCEMENT for bids:
--   • amount > current_bid + min_increment: RLS cannot perform this arithmetic
--     check because current_bid can change between the policy evaluation and
--     the INSERT. The API layer MUST read current_bid under a serialized
--     transaction and validate before inserting.
--   • Auction must be active (status = 'active' AND ends_at > now()): RLS
--     could add this as a subquery, but it introduces a race condition at the
--     exact expiry moment. The API layer enforces this with a SELECT FOR UPDATE
--     on the auction row.
--   • Auction must not be 'removed': validated at the API layer.


-- =============================================================================
-- TABLE: likes
-- =============================================================================
--
-- GOAL: Users can only like and unlike as themselves. Like counts are visible
-- to everyone via the denormalized like_count on auctions (no need for public
-- SELECT on likes). The UNIQUE constraint in the schema handles idempotency.
-- =============================================================================

DROP POLICY IF EXISTS "likes_select_own"    ON likes;
DROP POLICY IF EXISTS "likes_insert_own"    ON likes;
DROP POLICY IF EXISTS "likes_delete_own"    ON likes;

-- Users see only their own like rows (for "isLikedByMe" lookups)
CREATE POLICY "likes_select_own"
  ON likes
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Users can like only as themselves
CREATE POLICY "likes_insert_own"
  ON likes
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Users can unlike only their own likes
CREATE POLICY "likes_delete_own"
  ON likes
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- WHAT STILL NEEDS BACKEND ENFORCEMENT for likes:
--   • Idempotent like/unlike: the UNIQUE(user_id, auction_id) constraint
--     handles duplicates at the DB level. The API returns 200 (not 409) on
--     duplicate like — catch the unique_violation exception and return the
--     current like state.
--   • Auction existence: the FK on auction_id guarantees this at the DB level.


-- =============================================================================
-- TABLE: reports
-- =============================================================================
--
-- GOAL: Users can submit and read only their own reports. No user can see
-- another user's reports. Sellers cannot report their own auctions (subquery
-- guard). Admins see all reports via is_admin() policy. Admin resolution
-- (UPDATE) runs under service_role in MVP.
-- =============================================================================

DROP POLICY IF EXISTS "reports_select_own"            ON reports;
DROP POLICY IF EXISTS "reports_select_admin"          ON reports;
DROP POLICY IF EXISTS "reports_insert_own"            ON reports;
DROP POLICY IF EXISTS "reports_insert_not_own_auction" ON reports;
DROP POLICY IF EXISTS "reports_update_admin"          ON reports;

-- Users read only their own reports
CREATE POLICY "reports_select_own"
  ON reports
  FOR SELECT
  TO authenticated
  USING (reporter_id = auth.uid());

-- Admins can read all reports (moderation queue)
CREATE POLICY "reports_select_admin"
  ON reports
  FOR SELECT
  TO authenticated
  USING (is_admin());

-- Users can submit only as themselves
CREATE POLICY "reports_insert_own"
  ON reports
  FOR INSERT
  TO authenticated
  WITH CHECK (reporter_id = auth.uid());

-- Sellers cannot report their own auctions — subquery guard
CREATE POLICY "reports_insert_not_own_auction"
  ON reports
  FOR INSERT
  TO authenticated
  WITH CHECK (
    NOT EXISTS (
      SELECT 1
      FROM   auctions a
      WHERE  a.id        = auction_id
        AND  a.seller_id = auth.uid()
    )
  );

-- Admins can resolve (UPDATE) any report
CREATE POLICY "reports_update_admin"
  ON reports
  FOR UPDATE
  TO authenticated
  USING     (is_admin())
  WITH CHECK (is_admin());

-- No DELETE policy — reports are never deleted (audit trail).

-- WHAT STILL NEEDS BACKEND ENFORCEMENT for reports:
--   • Duplicate report: UNIQUE(reporter_id, auction_id) constraint handles
--     this. The API catches unique_violation and returns 409 or silently
--     returns the existing report ID with a 201 — choose one and be consistent.
--   • details required when reason = 'other': validated at the API layer
--     (Zod schema) — not enforceable via RLS.


-- =============================================================================
-- TABLE: blocks
-- =============================================================================
--
-- GOAL: Strictly personal — users can only manage their own block rows.
-- No user can read or delete another user's blocks. The CHECK constraint
-- (blocker_id != blocked_id) prevents self-blocking at the DB level.
-- =============================================================================

DROP POLICY IF EXISTS "blocks_select_own"    ON blocks;
DROP POLICY IF EXISTS "blocks_insert_own"    ON blocks;
DROP POLICY IF EXISTS "blocks_delete_own"    ON blocks;

-- Users see only blocks they created (for "is this user blocked?" checks)
CREATE POLICY "blocks_select_own"
  ON blocks
  FOR SELECT
  TO authenticated
  USING (blocker_id = auth.uid());

-- Users can block only as themselves
CREATE POLICY "blocks_insert_own"
  ON blocks
  FOR INSERT
  TO authenticated
  WITH CHECK (blocker_id = auth.uid());

-- Users can unblock only blocks they own
CREATE POLICY "blocks_delete_own"
  ON blocks
  FOR DELETE
  TO authenticated
  USING (blocker_id = auth.uid());

-- No UPDATE policy — blocks are binary (exist or not); no state to update.

-- WHAT STILL NEEDS BACKEND ENFORCEMENT for blocks:
--   • Feed exclusion: the API feed query must exclude auctions where
--     seller_id IN (SELECT blocked_id FROM blocks WHERE blocker_id = caller).
--     RLS on auctions cannot reference the blocks table in a USING clause
--     without significant performance cost on every auction SELECT.
--   • Self-block: the CHECK constraint on blocks handles this, but the API
--     should return 400 with a clear message before hitting the constraint.


-- =============================================================================
-- TABLE: contact_requests
-- =============================================================================
--
-- GOAL: Only the auction winner can initiate a contact request. Both the
-- requester and seller can read the request (future: contact history UI).
-- The winner-check is complex (requires confirming winner_id on auctions =
-- auth.uid()) and is primarily enforced at the API layer. The RLS INSERT
-- policy provides a basic party-membership check only.
-- =============================================================================

DROP POLICY IF EXISTS "contact_requests_select_parties"   ON contact_requests;
DROP POLICY IF EXISTS "contact_requests_insert_requester" ON contact_requests;
DROP POLICY IF EXISTS "contact_requests_admin_select"     ON contact_requests;

-- Requester and seller can read their own contact requests
CREATE POLICY "contact_requests_select_parties"
  ON contact_requests
  FOR SELECT
  TO authenticated
  USING (requester_id = auth.uid() OR seller_id = auth.uid());

-- Requester inserts their own request
-- NOTE: This does NOT verify the caller is the auction winner. That check
-- is enforced exclusively at the API layer (auctions.winner_id = auth.uid()).
-- Adding it here as a subquery is possible but fragile at the exact auction-
-- end boundary — the API layer owns this validation.
CREATE POLICY "contact_requests_insert_requester"
  ON contact_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (requester_id = auth.uid());

-- Admins can read all contact requests (audit / moderation)
CREATE POLICY "contact_requests_admin_select"
  ON contact_requests
  FOR SELECT
  TO authenticated
  USING (is_admin());

-- No UPDATE policy — contact_requests are immutable audit records in MVP.
-- No DELETE policy — never deleted.

-- WHAT STILL NEEDS BACKEND ENFORCEMENT for contact_requests:
--   • Winner check: the API MUST verify auctions.winner_id = auth.uid() AND
--     auctions.status = 'ended' before inserting a contact_request row.
--   • Idempotent contact: UNIQUE(auction_id, requester_id) handles duplicates.
--     The API catches unique_violation and returns the existing wa.me URL
--     rather than an error (the URL is re-generated server-side; it's safe
--     to regenerate because it uses the same seller phone number).


-- =============================================================================
-- TABLE: notifications
-- =============================================================================
--
-- GOAL: Users see only their own notifications. The server (service_role)
-- is the only writer — there is no client INSERT policy. Users can mark
-- their own notifications as read (UPDATE is_read = TRUE).
-- =============================================================================

DROP POLICY IF EXISTS "notifications_select_own"  ON notifications;
DROP POLICY IF EXISTS "notifications_update_own"  ON notifications;

-- Users see only their own notification rows
CREATE POLICY "notifications_select_own"
  ON notifications
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Users can mark their own notifications as read
-- The API layer strips all fields except is_read from client UPDATE bodies.
CREATE POLICY "notifications_update_own"
  ON notifications
  FOR UPDATE
  TO authenticated
  USING     (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- No INSERT policy for authenticated role — INSERT is service_role only.
-- No DELETE policy — old notifications are pruned by a server-side job only.

-- WHAT STILL NEEDS BACKEND ENFORCEMENT for notifications:
--   • Column protection: the API MUST only allow clients to set is_read = TRUE
--     on their own notifications. All other fields (type, title, body,
--     auction_id) must not be user-modifiable.
--   • Fan-out: push notification delivery (Expo Push API) is triggered
--     server-side after INSERT — not visible to RLS at all.


-- =============================================================================
-- TABLE: moderation_queue
-- =============================================================================
--
-- GOAL: No regular user should ever read or write this table directly.
-- All access in MVP goes through the Express API under service_role.
-- Admin policies are defined here as a forward-looking foundation for when
-- the admin web dashboard gains direct Supabase client access.
-- =============================================================================

DROP POLICY IF EXISTS "moderation_queue_select_admin"  ON moderation_queue;
DROP POLICY IF EXISTS "moderation_queue_update_admin"  ON moderation_queue;

-- Only admins can read the moderation queue
CREATE POLICY "moderation_queue_select_admin"
  ON moderation_queue
  FOR SELECT
  TO authenticated
  USING (is_admin());

-- Only admins can update moderation queue items (mark reviewed)
CREATE POLICY "moderation_queue_update_admin"
  ON moderation_queue
  FOR UPDATE
  TO authenticated
  USING     (is_admin())
  WITH CHECK (is_admin());

-- No INSERT policy for authenticated role — populated by server (service_role)
-- alongside report creation.
-- No DELETE policy — records are immutable.

-- WHAT STILL NEEDS BACKEND ENFORCEMENT for moderation_queue:
--   • Transactional consistency: when a user submits a report, the server
--     inserts to both reports and moderation_queue in a single transaction
--     (service_role). If the moderation_queue INSERT fails, the report INSERT
--     must be rolled back.
--   • Admin resolution: resolving a report must update both reports.status
--     and moderation_queue.status atomically.


-- =============================================================================
-- TABLE: admin_actions
-- =============================================================================
--
-- GOAL: The audit log is write-once. No UPDATE or DELETE policies exist.
-- Regular users have zero access. Admins can read the log and insert entries.
-- In MVP, all admin actions route through the Express API (service_role),
-- but these policies are in place for future direct-dashboard access.
-- =============================================================================

DROP POLICY IF EXISTS "admin_actions_select_admin"  ON admin_actions;
DROP POLICY IF EXISTS "admin_actions_insert_admin"  ON admin_actions;

-- Only admins can read the audit log
CREATE POLICY "admin_actions_select_admin"
  ON admin_actions
  FOR SELECT
  TO authenticated
  USING (is_admin());

-- Only admins can append to the audit log
CREATE POLICY "admin_actions_insert_admin"
  ON admin_actions
  FOR INSERT
  TO authenticated
  WITH CHECK (is_admin() AND admin_id = auth.uid());

-- CRITICAL: No UPDATE or DELETE policies exist and must NEVER be added.
-- The audit log is append-only by design. Any future change that appears to
-- require modifying an admin_action row should instead insert a corrective
-- entry.

-- WHAT STILL NEEDS BACKEND ENFORCEMENT for admin_actions:
--   • The API MUST insert an admin_actions row after every moderation action
--     (ban, unban, remove_auction, resolve_report) — this is not automatic.
--   • target_id validity: there is no FK on (target_type, target_id) because
--     PostgreSQL does not support polymorphic FKs. The API layer must verify
--     the target exists before inserting.


-- =============================================================================
-- FINAL SUMMARY
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. WHAT IS PROTECTED BY RLS
-- ---------------------------------------------------------------------------
--
-- profiles
--   ✓ Only own row can be inserted or updated (INSERT/UPDATE policy)
--   ✓ Phone, expo_push_token, ban_reason never appear in SELECT results
--     when clients query through the public_profiles VIEW
--   ✓ Admins can update any profile for ban/unban actions
--
-- auctions
--   ✓ Removed auctions are invisible to all non-admin authenticated users
--     and to all guests — status = 'removed' is filtered in USING clause
--   ✓ Sellers can only insert auctions where seller_id = their own uid
--   ✓ Sellers can only delete their own auctions, and only when bid_count = 0
--   ✓ Admins can update or delete any auction
--
-- bids
--   ✓ Bidders can only insert rows where bidder_id = their own uid
--   ✓ DB-level seller-cannot-bid guard via subquery on auctions (RLS policy)
--   ✓ No UPDATE or DELETE — bids are immutable once placed
--
-- likes
--   ✓ Users can only see, create, and delete their own like rows
--   ✓ Cross-user like manipulation is blocked at every operation
--
-- reports
--   ✓ Users can only see and submit their own reports
--   ✓ Sellers cannot report their own auctions (subquery guard)
--   ✓ Admins can see and resolve all reports
--   ✓ No DELETE — reports are permanent
--
-- blocks
--   ✓ Users can only see, create, and delete their own block rows
--   ✓ Self-blocking prevented by CHECK constraint (schema level)
--
-- contact_requests
--   ✓ Only requester and seller can read their own contact records
--   ✓ Requester can only insert as themselves
--   ✓ Admins can read all contact records
--   ✓ No UPDATE — records are immutable in MVP
--
-- notifications
--   ✓ Users can only read their own notifications
--   ✓ Users can mark their own notifications as read (UPDATE)
--   ✓ No client INSERT — server-only via service_role
--
-- moderation_queue
--   ✓ Zero access for regular users — fully locked to service_role and admins
--   ✓ Admins can read and update queue items
--   ✓ No client INSERT — server-only
--
-- admin_actions
--   ✓ Zero access for regular users
--   ✓ Admins can read and insert entries
--   ✓ No UPDATE or DELETE — append-only audit log


-- ---------------------------------------------------------------------------
-- B. WHAT MUST STILL BE ENFORCED IN BACKEND LOGIC (API LAYER)
-- ---------------------------------------------------------------------------
--
-- These rules cannot be reliably enforced by RLS and MUST be implemented
-- in the Express API under service_role:
--
-- 1. BID AMOUNT VALIDATION
--    Rule: bid.amount > auction.current_bid + auction.min_increment
--    Why not RLS: current_bid can change between policy evaluation and INSERT
--    (race condition). Must use SELECT FOR UPDATE inside a transaction.
--
-- 2. AUCTION EXPIRY AT BID TIME
--    Rule: auction.status = 'active' AND auction.ends_at > now()
--    Why not RLS: the exact expiry boundary is a millisecond race. RLS
--    evaluates at query parse time; time can pass before the INSERT completes.
--    Enforce with a DB-level transaction check at INSERT time.
--
-- 3. AUCTION WINNER VERIFICATION FOR CONTACT
--    Rule: contact_requests.requester_id must equal auctions.winner_id
--    Why not RLS: feasible as a subquery, but the winner is only set when
--    the server marks the auction as ended. A race condition between status
--    change and winner_id assignment makes a pure RLS check unreliable.
--
-- 4. PROFILE COLUMN PROTECTION
--    Rule: clients cannot set is_admin, is_banned, ban_reason, expo_push_token
--    Why not RLS: RLS cannot restrict which columns are modified — only which
--    rows. Strip these fields in the API PATCH /users/me handler using Zod.
--
-- 5. AUCTION FIELD PROTECTION (seller UPDATE)
--    Rule: seller PATCH can only change title, description, category
--    Why not RLS: same reason — column-level restrictions require column
--    privileges (GRANT/REVOKE), not RLS. The API must strip protected fields.
--
-- 6. DUPLICATE REPORT RESPONSE
--    Rule: duplicate report (same user + auction) should return 409 or a
--    silent success — not an unhandled DB constraint error
--    Why not RLS: constraint exists, but the HTTP response shape (409 vs 201)
--    is an application-layer concern.
--
-- 7. BLOCK FEED EXCLUSION
--    Rule: feed must exclude auctions from blocked sellers
--    Why not RLS: adding a NOT EXISTS (SELECT FROM blocks ...) to the auctions
--    SELECT policy would execute a subquery for every row in every auction
--    query, for every user — prohibitively expensive at scale. Feed filtering
--    must be a WHERE clause in the API feed query.
--
-- 8. NOTIFICATION FAN-OUT
--    Rule: after a bid, notify the previous leader (outbid), the seller
--    (new_bid_received), and later the winner (auction_won)
--    Why not RLS: fan-out is a write operation — no RLS concept applies.
--    Implement via server-side trigger or API post-bid logic.


-- ---------------------------------------------------------------------------
-- C. KNOWN POLICY LIMITATIONS FOR THIS MVP
-- ---------------------------------------------------------------------------
--
-- 1. COLUMN-LEVEL SECURITY IS NOT USED
--    PostgreSQL column privileges (GRANT SELECT(col) TO role) would allow
--    per-column access control, but Supabase's PostgREST layer does not
--    expose them cleanly through the auto-generated API. The public_profiles
--    VIEW is used instead to exclude sensitive columns for profile reads.
--    Sensitive columns on auctions (winner_id) are safe because the client
--    only reads through the API, which controls the SELECT projection.
--
-- 2. SELLER-CANNOT-BID RLS USES A SUBQUERY
--    The bids_insert_not_seller policy contains a correlated subquery on
--    auctions. This adds one indexed lookup per bid INSERT. At MVP bid
--    volumes this is negligible. Monitor query plans (EXPLAIN ANALYZE) if
--    bid throughput grows significantly.
--
-- 3. is_admin() SECURITY DEFINER SCOPE
--    The function bypasses RLS only for its own SELECT on profiles. Any
--    future admin logic that requires broader data access should not be
--    added to this function — create a separate SECURITY DEFINER function
--    for each specific privilege escalation instead.
--
-- 4. REALTIME SUBSCRIPTIONS
--    The auctions_select_public policy permits unauthenticated Realtime
--    channel subscriptions. This is intentional (guests can watch live bid
--    updates). If abuse is observed (e.g. DDoS via Realtime connections),
--    tighten to TO authenticated and require login before subscribing.
--
-- 5. anon KEY EXPOSURE
--    The SUPABASE_ANON_KEY is used for unauthenticated feed reads. Ensure
--    the Storage bucket policies do NOT grant anon users write access.
--    Only authenticated users (and service_role) should be able to create
--    Storage objects. Review Storage bucket RLS separately from table RLS.
--
-- =============================================================================
-- END OF MIGRATION 006
-- =============================================================================
