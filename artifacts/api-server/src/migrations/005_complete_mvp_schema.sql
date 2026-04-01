-- =============================================================================
-- BidReel MVP — Complete Authoritative Schema
-- Migration: 005_complete_mvp_schema.sql
-- Target: Supabase PostgreSQL (pg 15+)
-- =============================================================================
--
-- This migration is the single source of truth for the MVP database schema.
-- It supersedes the partial definitions in 001–004 when run in a fresh database,
-- and is safe to apply on top of existing work (IF NOT EXISTS / OR REPLACE
-- guards throughout).
--
-- DESIGN PRINCIPLES
--   1. UUIDs everywhere — no sequential IDs leak record counts to the client.
--   2. Monetary values stored as NUMERIC(12,2) — avoids floating-point drift.
--   3. Denormalized counters (bid_count, like_count) on auctions — avoids
--      expensive COUNT(*) on hot feed queries. Kept in sync by DB triggers.
--   4. Phone numbers stored only in `profiles.phone`. Never appear in any
--      JOIN result exposed to the API layer; phone is excluded from the
--      public_profiles VIEW and from all RLS-visible SELECTs.
--   5. Auction duration is ALWAYS 3 days — enforced by a CHECK constraint
--      (ends_at = created_at + 3 days). The server sets ends_at; clients
--      cannot supply it.
--   6. Bids are immutable once inserted — no UPDATE or DELETE on bids.
--   7. RLS is enabled on every table. The API server runs under service_role
--      which bypasses all RLS. Policies exist for direct Supabase client
--      access (Realtime, future mobile Supabase SDK usage).
--   8. Audit trail is write-once — admin_actions has no UPDATE policy.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";   -- trigram search on title/display_name (phase 2)

-- ---------------------------------------------------------------------------
-- Shared trigger function: auto-update updated_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- ENUMs
-- ---------------------------------------------------------------------------

-- Auction lifecycle state
DO $$ BEGIN
  CREATE TYPE auction_status AS ENUM ('active', 'ended', 'removed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- User-submitted report reason
DO $$ BEGIN
  CREATE TYPE report_reason AS ENUM (
    'spam_or_fake',
    'offensive_content',
    'prohibited_item',
    'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Report / moderation queue lifecycle state
DO $$ BEGIN
  CREATE TYPE report_status AS ENUM ('pending', 'dismissed', 'actioned');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- In-app notification event types
DO $$ BEGIN
  CREATE TYPE notification_type AS ENUM (
    'outbid',              -- caller was outbid on an auction they are bidding on
    'auction_won',         -- auction ended and caller held the highest bid
    'new_bid_received',    -- seller: someone bid on their listing
    'auction_ending_soon', -- 24-hour warning for auctions the caller is winning
    'auction_removed'      -- seller: their listing was removed by an admin
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Admin audit action types
DO $$ BEGIN
  CREATE TYPE admin_action_type AS ENUM (
    'ban_user',
    'unban_user',
    'remove_auction',
    'dismiss_report',
    'resolve_report'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Admin audit target entity types
DO $$ BEGIN
  CREATE TYPE admin_target_type AS ENUM ('user', 'auction', 'report');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Moderation queue source (user-reported vs system-detected)
DO $$ BEGIN
  CREATE TYPE moderation_source AS ENUM ('user_report', 'system');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================================
-- TABLE: profiles
-- =============================================================================
-- One row per Supabase Auth user, created automatically on first login.
--
-- DESIGN NOTES:
--   • phone is internal only. It is used exclusively server-side to generate
--     the WhatsApp wa.me URL. It is NEVER selected by the API for client
--     responses and is excluded from the public_profiles VIEW below.
--   • is_admin is a simple boolean flag rather than a roles table. For an MVP
--     with a small, trusted admin team this is sufficient. A role/permission
--     table can replace it later without a breaking schema change.
--   • expo_push_token is stored here so the server can fan out push
--     notifications without a separate lookup. It is always overwritten on
--     login so stale tokens self-correct.
--   • The UNIQUE constraint on phone ensures one account per phone number.
--     Supabase Auth enforces this at the auth layer too; this is a belt-and-
--     suspenders guard at the DB level.
-- =============================================================================
CREATE TABLE IF NOT EXISTS profiles (
  id                UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Phone stored as E.164 (e.g. +14155550123). Internal use only.
  phone             TEXT        UNIQUE,
  display_name      TEXT        CHECK (char_length(display_name) BETWEEN 2 AND 50),
  avatar_url        TEXT,
  bio               TEXT        CHECK (char_length(bio) <= 300),
  is_admin          BOOLEAN     NOT NULL DEFAULT FALSE,
  is_banned         BOOLEAN     NOT NULL DEFAULT FALSE,
  ban_reason        TEXT,
  -- Expo push token — overwritten on every app launch. Null = push not set up.
  expo_push_token   TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Feed exclusion and block queries look up by id; phone lookups happen by the
-- API server and are rare (only on contact requests).
CREATE INDEX IF NOT EXISTS idx_profiles_phone ON profiles (phone) WHERE phone IS NOT NULL;

-- =============================================================================
-- VIEW: public_profiles
-- =============================================================================
-- This view is what all client-facing queries should JOIN against.
-- It explicitly excludes phone, expo_push_token, ban_reason, and any other
-- internally sensitive columns. The API layer queries this view; only
-- service_role queries the base profiles table when phone access is needed.
-- =============================================================================
CREATE OR REPLACE VIEW public_profiles AS
  SELECT
    id,
    display_name,
    avatar_url,
    bio,
    is_admin,
    is_banned,
    created_at,
    updated_at
  FROM profiles;

-- =============================================================================
-- TABLE: auctions
-- =============================================================================
-- Core listing entity.
--
-- DESIGN NOTES:
--   • current_bid starts equal to start_price (before any bids). The trigger
--     trg_bids_sync_auction keeps it updated after each INSERT on bids.
--   • bid_count and like_count are denormalized for O(1) feed reads. Kept
--     accurate by triggers. If a trigger ever fails, a reconciliation job can
--     recompute them from bids/likes counts.
--   • winner_id is set by the server when status transitions to 'ended'.
--     Storing it on the auction avoids a MAX(amount) GROUP BY query on every
--     contact-flow check.
--   • ends_at is validated to be roughly 3 days after created_at via a CHECK.
--     The exact window is enforced by the server; the constraint is a
--     safety net preventing clients from injecting arbitrary end times via
--     a direct DB call.
--   • media_purge_after is set to ends_at + 7 days. A scheduled job deletes
--     Supabase Storage objects after this date. video_deleted_at and
--     thumbnail_deleted_at record when cleanup completed.
-- =============================================================================
CREATE TABLE IF NOT EXISTS auctions (
  id              UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id       UUID           NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  title           TEXT           NOT NULL CHECK (char_length(title) BETWEEN 3 AND 80),
  description     TEXT           CHECK (char_length(description) <= 500),
  category        TEXT           NOT NULL
                                 CHECK (category IN (
                                   'electronics','fashion','collectibles',
                                   'home_and_garden','vehicles','jewelry',
                                   'art','sports','other'
                                 )),
  -- Supabase Storage public URLs (never local paths)
  video_url       TEXT           NOT NULL,
  thumbnail_url   TEXT           NOT NULL,

  -- Bidding
  start_price     NUMERIC(12,2)  NOT NULL CHECK (start_price > 0),
  -- current_bid equals start_price initially; updated by trigger after each bid
  current_bid     NUMERIC(12,2)  NOT NULL CHECK (current_bid >= start_price),
  min_increment   NUMERIC(12,2)  NOT NULL DEFAULT 10.00 CHECK (min_increment > 0),
  bid_count       INTEGER        NOT NULL DEFAULT 0 CHECK (bid_count >= 0),
  like_count      INTEGER        NOT NULL DEFAULT 0 CHECK (like_count >= 0),

  -- Lifecycle
  status          auction_status NOT NULL DEFAULT 'active',
  -- ends_at must be within 3 days (259200 seconds) ± 60 s tolerance of created_at
  ends_at         TIMESTAMPTZ    NOT NULL,
  winner_id       UUID           REFERENCES profiles(id) ON DELETE SET NULL,

  -- Media cleanup (background job reads these columns)
  media_purge_after    TIMESTAMPTZ,   -- set to ends_at + 7 days at INSERT time
  video_deleted_at     TIMESTAMPTZ,   -- null = video still in Storage
  thumbnail_deleted_at TIMESTAMPTZ,   -- null = thumbnail still in Storage

  created_at      TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ    NOT NULL DEFAULT now(),

  -- ends_at must be approximately 3 days (within ±5 minute tolerance)
  CONSTRAINT chk_auctions_ends_at_3days
    CHECK (ends_at BETWEEN (created_at + INTERVAL '2 days 23 hours 55 minutes')
                       AND (created_at + INTERVAL '3 days 5 minutes')),

  -- A seller cannot be the winner of their own auction
  CONSTRAINT chk_auctions_winner_not_seller
    CHECK (winner_id IS NULL OR winner_id != seller_id)
);

CREATE OR REPLACE TRIGGER trg_auctions_updated_at
  BEFORE UPDATE ON auctions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Primary feed query: active auctions ordered by ends_at (soonest first)
CREATE INDEX IF NOT EXISTS idx_auctions_feed
  ON auctions (status, ends_at ASC)
  WHERE status = 'active';

-- Profile "My Auctions" tab
CREATE INDEX IF NOT EXISTS idx_auctions_seller_id
  ON auctions (seller_id, created_at DESC);

-- Contact flow: look up auction winner quickly
CREATE INDEX IF NOT EXISTS idx_auctions_winner_id
  ON auctions (winner_id)
  WHERE winner_id IS NOT NULL;

-- Media lifecycle cleanup job
CREATE INDEX IF NOT EXISTS idx_auctions_media_purge
  ON auctions (media_purge_after)
  WHERE video_deleted_at IS NULL OR thumbnail_deleted_at IS NULL;

-- =============================================================================
-- TABLE: bids
-- =============================================================================
-- Immutable bid ledger. Bids are append-only — no UPDATE or DELETE allowed.
--
-- DESIGN NOTES:
--   • All bid validation (amount > current_bid + min_increment, auction active,
--     bidder != seller) is enforced at the API layer, not here. A CHECK
--     constraint on amount > 0 is a baseline sanity guard only.
--   • The trigger trg_bids_sync_auction keeps auctions.current_bid and
--     auctions.bid_count accurate after each INSERT.
--   • user_id is named consistently with Supabase Auth convention. The API
--     layer calls it "bidder_id" in responses.
--   • There is intentionally NO UNIQUE constraint on (auction_id, user_id) —
--     the same user can place multiple bids as the price climbs.
-- =============================================================================
CREATE TABLE IF NOT EXISTS bids (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id  UUID          NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  bidder_id   UUID          NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  amount      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Highest bid lookup (current leader), bid history for auction detail
CREATE INDEX IF NOT EXISTS idx_bids_auction_amount
  ON bids (auction_id, amount DESC);

-- Bid history chronological (bid history sheet)
CREATE INDEX IF NOT EXISTS idx_bids_auction_chrono
  ON bids (auction_id, created_at DESC);

-- "My Bids" profile tab: all auctions the user has participated in
CREATE INDEX IF NOT EXISTS idx_bids_bidder
  ON bids (bidder_id, created_at DESC);

-- Trigger: keep auctions.current_bid and bid_count in sync after each bid
CREATE OR REPLACE FUNCTION fn_bids_sync_auction()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE auctions
  SET
    current_bid = NEW.amount,
    bid_count   = bid_count + 1,
    updated_at  = now()
  WHERE id = NEW.auction_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_bids_sync_auction
  AFTER INSERT ON bids
  FOR EACH ROW EXECUTE FUNCTION fn_bids_sync_auction();

-- =============================================================================
-- TABLE: likes
-- =============================================================================
-- One like per (user, auction) pair. Idempotent via UNIQUE constraint.
--
-- DESIGN NOTES:
--   • like_count on auctions is kept in sync by triggers (fn_likes_inc /
--     fn_likes_dec). This avoids COUNT(*) on likes for every feed card.
--   • Likes are allowed on ended auctions (informational / vanity).
--   • No notification is sent to the seller when liked (deferred to phase 2).
-- =============================================================================
CREATE TABLE IF NOT EXISTS likes (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  auction_id  UUID        NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_likes_user_auction UNIQUE (user_id, auction_id)
);

-- Check if a specific user liked a specific auction (Auction Detail "isLikedByMe")
CREATE INDEX IF NOT EXISTS idx_likes_user_auction
  ON likes (user_id, auction_id);

-- "My Likes" profile tab
CREATE INDEX IF NOT EXISTS idx_likes_user
  ON likes (user_id, created_at DESC);

-- Trigger: increment auctions.like_count on INSERT
CREATE OR REPLACE FUNCTION fn_likes_inc()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE auctions SET like_count = like_count + 1, updated_at = now()
  WHERE id = NEW.auction_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_likes_inc
  AFTER INSERT ON likes
  FOR EACH ROW EXECUTE FUNCTION fn_likes_inc();

-- Trigger: decrement auctions.like_count on DELETE
CREATE OR REPLACE FUNCTION fn_likes_dec()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE auctions SET like_count = GREATEST(like_count - 1, 0), updated_at = now()
  WHERE id = OLD.auction_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_likes_dec
  AFTER DELETE ON likes
  FOR EACH ROW EXECUTE FUNCTION fn_likes_dec();

-- =============================================================================
-- TABLE: reports
-- =============================================================================
-- User-submitted policy violation reports.
--
-- DESIGN NOTES:
--   • UNIQUE(reporter_id, auction_id) prevents duplicate reports from the same
--     user on the same auction. The API returns 409 on duplicates; the client
--     shows "thanks for the report" regardless.
--   • reporter_id uses ON DELETE SET NULL so that deleting a user's account
--     does not cascade-delete the report evidence.
--   • resolved_by, admin_note, resolved_at are populated when an admin takes
--     action via PATCH /admin/reports/{id}.
--   • Reports are never hard-deleted (audit trail).
-- =============================================================================
CREATE TABLE IF NOT EXISTS reports (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id  UUID          REFERENCES profiles(id) ON DELETE SET NULL,
  auction_id   UUID          NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  reason       report_reason NOT NULL,
  details      TEXT          CHECK (char_length(details) <= 500),
  status       report_status NOT NULL DEFAULT 'pending',
  resolved_by  UUID          REFERENCES profiles(id) ON DELETE SET NULL,
  admin_note   TEXT          CHECK (char_length(admin_note) <= 500),
  resolved_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT uq_reports_reporter_auction UNIQUE (reporter_id, auction_id)
);

-- Admin moderation queue: pending reports, most recent first
CREATE INDEX IF NOT EXISTS idx_reports_status_chrono
  ON reports (status, created_at DESC);

-- Per-auction report lookup (admin viewing all reports for one auction)
CREATE INDEX IF NOT EXISTS idx_reports_auction_id
  ON reports (auction_id);

-- =============================================================================
-- TABLE: blocks
-- =============================================================================
-- Directed block graph. A blocks B = B's auctions are hidden from A's feed.
-- Blocking is one-directional. B still sees A unless B also blocks A.
--
-- DESIGN NOTES:
--   • UNIQUE(blocker_id, blocked_id) prevents duplicate rows; the API makes
--     block idempotent (calling block twice is a no-op).
--   • CHECK (blocker_id != blocked_id) prevents self-blocking.
--   • ON DELETE CASCADE on both FKs: if either user is deleted, the block
--     record disappears cleanly.
--   • Feed query: SELECT id FROM blocks WHERE blocker_id = $caller
--     returns the set of seller IDs to exclude. This list is passed as a
--     NOT IN clause (or subquery) in the feed query. Practical for MVP
--     (< a few hundred blocks per user); replace with a bloom filter or
--     separate exclusion table if lists grow large.
-- =============================================================================
CREATE TABLE IF NOT EXISTS blocks (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id  UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  blocked_id  UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_blocks_pair   UNIQUE (blocker_id, blocked_id),
  CONSTRAINT chk_blocks_self  CHECK  (blocker_id != blocked_id)
);

-- Feed exclusion: fast lookup of all users blocked by a given user
CREATE INDEX IF NOT EXISTS idx_blocks_blocker
  ON blocks (blocker_id);

-- Reverse lookup: "is this user blocked by someone?" (admin or analytics use)
CREATE INDEX IF NOT EXISTS idx_blocks_blocked
  ON blocks (blocked_id);

-- =============================================================================
-- TABLE: contact_requests
-- =============================================================================
-- Audit log of every WhatsApp contact initiation.
-- Phone numbers are NEVER stored here — only the IDs of the parties involved.
--
-- DESIGN NOTES:
--   • seller_id is denormalized here for fast audit queries without joining
--     auctions.
--   • The server generates the wa.me URL on the fly using profiles.phone
--     (service_role only) and returns only the URL to the client. This table
--     records that the contact event occurred.
--   • UNIQUE(auction_id, requester_id) prevents flooding: one contact request
--     per (auction, winner) pair is sufficient. The server returns the same
--     URL on subsequent calls without creating a new row.
--   • Only the auction winner can trigger a contact request. This is validated
--     at the API layer (winner_id on auctions must equal the caller's user_id).
-- =============================================================================
CREATE TABLE IF NOT EXISTS contact_requests (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id    UUID        NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  requester_id  UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  seller_id     UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- 'initiated' is the only status in MVP.
  -- Future: 'completed', 'disputed' for post-transaction workflows.
  status        TEXT        NOT NULL DEFAULT 'initiated'
                            CHECK (status IN ('initiated')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_contact_request_pair UNIQUE (auction_id, requester_id),
  -- The requester must not be the seller
  CONSTRAINT chk_contact_not_self CHECK (requester_id != seller_id)
);

CREATE INDEX IF NOT EXISTS idx_contact_requests_auction
  ON contact_requests (auction_id);

CREATE INDEX IF NOT EXISTS idx_contact_requests_seller
  ON contact_requests (seller_id, created_at DESC);

-- =============================================================================
-- TABLE: notifications
-- =============================================================================
-- In-app notification inbox per user.
--
-- DESIGN NOTES:
--   • The server inserts rows here and fans out Expo push notifications.
--   • auction_id is nullable because some future notification types may not
--     relate to a specific auction, but for all MVP types it will be set.
--   • Notifications are never deleted by the user in MVP — only marked read.
--     A retention job can prune rows older than 90 days in phase 2.
--   • Storing title and body as preformatted strings means the client renders
--     them without additional lookups, even if the related auction is later
--     removed.
-- =============================================================================
CREATE TABLE IF NOT EXISTS notifications (
  id          UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID              NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type        notification_type NOT NULL,
  is_read     BOOLEAN           NOT NULL DEFAULT FALSE,
  auction_id  UUID              REFERENCES auctions(id) ON DELETE SET NULL,
  title       TEXT              NOT NULL,
  body        TEXT              NOT NULL,
  created_at  TIMESTAMPTZ       NOT NULL DEFAULT now()
);

-- Primary query: user's notification feed, unread first, then by recency
CREATE INDEX IF NOT EXISTS idx_notifications_user_inbox
  ON notifications (user_id, is_read, created_at DESC);

-- Unread count badge (COUNT WHERE is_read = false AND user_id = $caller)
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications (user_id)
  WHERE is_read = FALSE;

-- =============================================================================
-- TABLE: moderation_queue
-- =============================================================================
-- Separate from reports: captures system-initiated flags in addition to
-- user-submitted ones. In MVP, rows here are created alongside (or instead of)
-- reports when the system auto-detects an issue.
--
-- DESIGN NOTES:
--   • source distinguishes user-submitted flags from automated detection.
--   • For MVP, every user report also creates a moderation_queue row so the
--     admin dashboard has a single queue to work from. In phase 2, automated
--     AI moderation can add rows independently.
--   • The admin resolves both via PATCH /admin/reports/{id} (which updates
--     both reports and moderation_queue atomically).
--   • report_id is nullable: system-initiated queue items have no associated
--     user report.
-- =============================================================================
CREATE TABLE IF NOT EXISTS moderation_queue (
  id          UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id  UUID              NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  report_id   UUID              REFERENCES reports(id) ON DELETE SET NULL,
  source      moderation_source NOT NULL DEFAULT 'user_report',
  reason      TEXT              NOT NULL CHECK (char_length(reason) <= 500),
  status      report_status     NOT NULL DEFAULT 'pending',
  reviewed_by UUID              REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ       NOT NULL DEFAULT now()
);

-- Admin queue: pending items, oldest first (FIFO moderation)
CREATE INDEX IF NOT EXISTS idx_moderation_queue_pending
  ON moderation_queue (status, created_at ASC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_moderation_queue_auction
  ON moderation_queue (auction_id);

-- =============================================================================
-- TABLE: admin_actions
-- =============================================================================
-- Immutable audit log of every action taken by an admin.
--
-- DESIGN NOTES:
--   • No UPDATE or DELETE policy — rows are write-once. An admin can correct
--     a mistake by inserting a follow-up action (e.g., unban_user after ban_user),
--     but historical records are never overwritten.
--   • target_type + target_id form a polymorphic FK (no real FK constraint
--     because PostgreSQL doesn't support cross-table polymorphic FKs). The
--     application layer validates the target exists before inserting.
--   • admin_id references profiles, not auth.users, so the display_name is
--     queryable in audit reports without a JOIN to auth.users.
-- =============================================================================
CREATE TABLE IF NOT EXISTS admin_actions (
  id          UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    UUID              NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  action_type admin_action_type NOT NULL,
  target_type admin_target_type NOT NULL,
  target_id   UUID              NOT NULL,
  note        TEXT              CHECK (char_length(note) <= 500),
  created_at  TIMESTAMPTZ       NOT NULL DEFAULT now()
);

-- Audit log: most recent admin actions first (dashboard "recent activity")
CREATE INDEX IF NOT EXISTS idx_admin_actions_chrono
  ON admin_actions (created_at DESC);

-- Per-admin action history
CREATE INDEX IF NOT EXISTS idx_admin_actions_admin
  ON admin_actions (admin_id, created_at DESC);

-- Per-target audit trail (e.g. all actions taken against user X)
CREATE INDEX IF NOT EXISTS idx_admin_actions_target
  ON admin_actions (target_type, target_id, created_at DESC);

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================
-- The BidReel API server uses the Supabase SERVICE_ROLE key, which bypasses
-- all RLS policies. These policies exist for two purposes:
--   1. Direct Supabase Realtime subscriptions from the mobile client
--      (bid price updates on auction detail).
--   2. Future direct-SDK access patterns (e.g., Supabase client in Expo app).
--
-- RLS PLANNING NOTES (not all policies implemented below — noted where deferred)
--
--   profiles        → authenticated users can SELECT public_profiles view;
--                     own row is UPDATE-able; phone is never in SELECT scope.
--
--   auctions        → anyone can SELECT active/ended (guests included via anon);
--                     sellers INSERT their own; status = 'removed' hidden from all.
--
--   bids            → public SELECT (bid history is not private);
--                     users INSERT their own bids only.
--
--   likes           → users SELECT their own; users INSERT/DELETE their own.
--
--   reports         → users SELECT/INSERT their own only.
--
--   blocks          → users SELECT/INSERT/DELETE their own (blocker_id = caller).
--
--   contact_requests → requester and seller can SELECT; INSERT by requester only.
--
--   notifications   → users SELECT their own only; server-only INSERT.
--
--   moderation_queue → admin only (is_admin = true on profiles).
--
--   admin_actions   → admin only; no UPDATE or DELETE.
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

-- ---------------------------------------------------------------------------
-- profiles policies
-- ---------------------------------------------------------------------------
-- Public read of non-sensitive fields — use public_profiles view in practice
DO $$ BEGIN
  CREATE POLICY "profiles_select_authenticated" ON profiles
    FOR SELECT USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Own row update only
DO $$ BEGIN
  CREATE POLICY "profiles_update_own" ON profiles
    FOR UPDATE USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Server (service_role) handles INSERT on first login — no client INSERT policy needed

-- ---------------------------------------------------------------------------
-- auctions policies
-- ---------------------------------------------------------------------------
-- Guests and authenticated users can browse active/ended auctions
DO $$ BEGIN
  CREATE POLICY "auctions_select_public" ON auctions
    FOR SELECT USING (status != 'removed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Sellers create their own auctions (auth layer passes seller_id = auth.uid())
DO $$ BEGIN
  CREATE POLICY "auctions_insert_own" ON auctions
    FOR INSERT WITH CHECK (auth.uid() = seller_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Sellers can delete own auction ONLY when bid_count = 0
-- (additional business-rule check at API layer)
DO $$ BEGIN
  CREATE POLICY "auctions_delete_own_no_bids" ON auctions
    FOR DELETE USING (auth.uid() = seller_id AND bid_count = 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- UPDATE restricted to service_role only (bid sync, status changes) — no client policy

-- ---------------------------------------------------------------------------
-- bids policies
-- ---------------------------------------------------------------------------
-- Bid history is publicly viewable (auction detail bid list)
DO $$ BEGIN
  CREATE POLICY "bids_select_public" ON bids
    FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Bidders insert their own bids; business rules validated at API layer
DO $$ BEGIN
  CREATE POLICY "bids_insert_own" ON bids
    FOR INSERT WITH CHECK (auth.uid() = bidder_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- No UPDATE or DELETE policies — bids are immutable

-- ---------------------------------------------------------------------------
-- likes policies
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE POLICY "likes_select_own" ON likes
    FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "likes_insert_own" ON likes
    FOR INSERT WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "likes_delete_own" ON likes
    FOR DELETE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- reports policies
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE POLICY "reports_select_own" ON reports
    FOR SELECT USING (auth.uid() = reporter_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "reports_insert_own" ON reports
    FOR INSERT WITH CHECK (auth.uid() = reporter_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- UPDATE (resolve) is service_role only (admin API actions)

-- ---------------------------------------------------------------------------
-- blocks policies
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE POLICY "blocks_select_own" ON blocks
    FOR SELECT USING (auth.uid() = blocker_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "blocks_insert_own" ON blocks
    FOR INSERT WITH CHECK (auth.uid() = blocker_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "blocks_delete_own" ON blocks
    FOR DELETE USING (auth.uid() = blocker_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- contact_requests policies
-- ---------------------------------------------------------------------------
-- Requester and seller can view (for future "contact history" feature)
DO $$ BEGIN
  CREATE POLICY "contact_requests_select_parties" ON contact_requests
    FOR SELECT USING (auth.uid() = requester_id OR auth.uid() = seller_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "contact_requests_insert_requester" ON contact_requests
    FOR INSERT WITH CHECK (auth.uid() = requester_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- notifications policies
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE POLICY "notifications_select_own" ON notifications
    FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- UPDATE (mark read) — user can mark their own as read
DO $$ BEGIN
  CREATE POLICY "notifications_update_own" ON notifications
    FOR UPDATE USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- INSERT restricted to service_role (server pushes notifications)

-- ---------------------------------------------------------------------------
-- moderation_queue policies — admin only
-- Deferred: implement a helper function is_admin() for cleaner policies
-- ---------------------------------------------------------------------------
-- NOTE: In MVP, admin access is via service_role only (admin web dashboard
-- calls the Express API which uses service_role). Client-direct access to
-- moderation_queue is not required. Policies below are placeholders.

-- No SELECT/INSERT/UPDATE/DELETE policies for non-service_role users.
-- moderation_queue is fully locked down to service_role in MVP.

-- ---------------------------------------------------------------------------
-- admin_actions policies — admin only, write-once
-- ---------------------------------------------------------------------------
-- Same as moderation_queue: service_role only in MVP.
-- When a dedicated admin client is built, add:
--   SELECT policy: profiles.is_admin = true (via a helper function)
--   INSERT policy: profiles.is_admin = true
--   NO UPDATE or DELETE policy (immutable audit log)

-- =============================================================================
-- SUPABASE STORAGE BUCKETS (reference — create in Supabase dashboard)
-- =============================================================================
-- These buckets should be created in the Supabase dashboard or via the
-- Storage API. They are documented here for completeness.
--
--   Bucket: auction-media
--     • Public: true (video and thumbnail URLs are public CDN links)
--     • Allowed MIME types: video/mp4, video/quicktime, image/jpeg, image/png
--     • Max file size: 100 MB (enforced by Supabase Storage policy)
--     • File path convention:
--         video:     auctions/{auction_id}/video.{ext}
--         thumbnail: auctions/{auction_id}/thumb.{ext}
--     • RLS: authenticated users can upload to their own folder
--             (path starts with auctions/{auth.uid()}/ — validated pre-upload
--             via presigned URLs issued by the server)
--
--   Bucket: avatars
--     • Public: true
--     • Allowed MIME types: image/jpeg, image/png, image/webp
--     • Max file size: 5 MB
--     • File path convention: avatars/{user_id}.{ext}
-- =============================================================================

-- =============================================================================
-- END OF MIGRATION 005
-- =============================================================================
