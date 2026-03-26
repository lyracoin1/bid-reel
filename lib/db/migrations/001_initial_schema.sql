-- =============================================================================
-- BidReel MVP — Initial Database Schema
-- Target: Supabase PostgreSQL
-- =============================================================================
--
-- Design notes:
--
-- 1. All tables use UUID primary keys (gen_random_uuid()).
--    Supabase generates these natively via pgcrypto.
--
-- 2. The `profiles` table is the single source of truth for user data.
--    It mirrors auth.users (Supabase Auth) via the `id` foreign key.
--    The phone number is stored here for internal WhatsApp link generation
--    but must NEVER be returned in public API responses.
--
-- 3. Denormalized counters (bid_count, like_count on auctions) are maintained
--    by database triggers rather than application-level logic. This keeps
--    feed queries O(1) without aggregate joins.
--
-- 4. Soft-delete pattern via status columns (active / ended / removed) is
--    preferred over hard deletes so admin audit trails remain intact.
--
-- 5. RLS (Row Level Security) policy stubs are included as comments.
--    Activate them after testing is stable. All tables have RLS enabled
--    but no policies = deny-all (safe default for Supabase).
--    Backend API routes bypass RLS via the service_role key; client-side
--    queries (if ever used) would be subject to RLS policies.
--
-- 6. created_at defaults to now() on all tables. updated_at is tracked
--    where mutation is expected (profiles, auctions). A shared trigger
--    function handles updated_at automatically.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";        -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";         -- trigram index for text search

-- ---------------------------------------------------------------------------
-- Shared trigger: auto-update updated_at on mutation
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Enum types
-- ---------------------------------------------------------------------------

-- Auction lifecycle
CREATE TYPE auction_status AS ENUM ('active', 'ended', 'removed');

-- Auction content categories (matches OpenAPI AuctionCategory)
CREATE TYPE auction_category AS ENUM (
  'electronics',
  'fashion',
  'collectibles',
  'home_and_garden',
  'vehicles',
  'jewelry',
  'art',
  'sports',
  'other'
);

-- Report reasons (matches OpenAPI ReportReason)
CREATE TYPE report_reason AS ENUM (
  'spam_or_fake',
  'offensive_content',
  'prohibited_item',
  'other'
);

-- Report lifecycle
CREATE TYPE report_status AS ENUM ('pending', 'dismissed', 'actioned');

-- Moderation queue source
CREATE TYPE moderation_source AS ENUM ('user_report', 'system');

-- Moderation queue status
CREATE TYPE moderation_status AS ENUM ('pending', 'reviewed', 'dismissed');

-- Admin action types (what an admin did)
CREATE TYPE admin_action_type AS ENUM (
  'remove_auction',
  'ban_user',
  'unban_user',
  'dismiss_report',
  'resolve_report'
);

-- What the admin action targeted
CREATE TYPE admin_target_type AS ENUM ('auction', 'user', 'report');

-- Contact request status
CREATE TYPE contact_status AS ENUM ('pending', 'delivered');

-- =============================================================================
-- Table: profiles
-- =============================================================================
-- One row per Supabase Auth user. Created automatically on first login via
-- a database trigger on auth.users INSERT (wire this up in Supabase dashboard
-- under Auth → Hooks, or via a trigger on auth.users if allowed).
--
-- PHONE PRIVACY: `phone` is stored here for wa.me link construction only.
-- It must be SELECT-gated: never expose in any public-facing view or RLS policy.
-- The backend service reads it internally via the service_role key.
-- =============================================================================
CREATE TABLE profiles (
  id             UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Phone number in E.164 format (copied from auth.users at registration).
  -- NEVER returned in public API responses; used only for WhatsApp deep-link.
  phone          TEXT NOT NULL,

  display_name   TEXT CHECK (char_length(display_name) BETWEEN 2 AND 50),
  avatar_url     TEXT,
  bio            TEXT CHECK (char_length(bio) <= 300),

  -- Role / permissions
  -- Keeping it simple for MVP: a boolean flag.
  -- Scalable path: replace with a roles table + profiles_roles join later.
  is_admin       BOOLEAN NOT NULL DEFAULT FALSE,
  is_banned      BOOLEAN NOT NULL DEFAULT FALSE,
  ban_reason     TEXT,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Indexes
CREATE INDEX idx_profiles_is_banned ON profiles (is_banned);
-- Used when filtering banned users out of feeds/searches.

-- RLS planning notes (do not activate until backend is tested):
-- ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
-- POLICY "Authenticated users can read public profile columns":
--   USING (auth.uid() IS NOT NULL)
--   -- SELECT only: id, display_name, avatar_url, bio, is_banned (NOT phone)
-- POLICY "Users can update their own profile":
--   USING (auth.uid() = id)
-- POLICY "Admins can read all columns including phone":
--   USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin))

COMMENT ON TABLE  profiles                IS 'Extended user data mirroring auth.users. Phone stored for WhatsApp use only — never expose publicly.';
COMMENT ON COLUMN profiles.phone          IS 'E.164 phone number. Internal-only: never returned in API responses.';
COMMENT ON COLUMN profiles.is_admin       IS 'Simple admin flag for MVP. Replace with roles table when multi-role is needed.';

-- =============================================================================
-- Table: auctions
-- =============================================================================
-- Core listing table. One row per published auction.
--
-- DENORMALIZATION: bid_count and like_count are maintained by triggers rather
-- than computed via COUNT() at query time. Feed queries read millions of rows;
-- eliminating joins here is a meaningful performance win.
--
-- PRICING: current_price starts equal to start_price. The trigger on bids
-- updates it to the new highest bid amount on every successful bid INSERT.
-- minimum_increment defaults to 1.00 and can be customized per listing.
--
-- DURATION: ends_at = created_at + 3 days is enforced by a CHECK constraint.
-- A background job (Supabase pg_cron or external scheduler) should flip
-- status to 'ended' when ends_at has passed. Alternatively, status can be
-- computed on read and 'ended' rows written lazily on the first post-expiry read.
-- =============================================================================
CREATE TABLE auctions (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id         UUID        NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  -- ON DELETE RESTRICT: prevent profile deletion if active auctions exist.
  -- Seller must be banned (soft action) rather than deleted in this case.

  title             TEXT        NOT NULL CHECK (char_length(title) BETWEEN 3 AND 80),
  description       TEXT        CHECK (char_length(description) <= 500),
  category          auction_category NOT NULL,

  -- Media (URLs pointing to Supabase Storage buckets)
  video_url         TEXT        NOT NULL,
  thumbnail_url     TEXT        NOT NULL,

  -- Pricing
  start_price       NUMERIC(12,2) NOT NULL CHECK (start_price > 0),
  current_price     NUMERIC(12,2) NOT NULL CHECK (current_price >= start_price),
  minimum_increment NUMERIC(12,2) NOT NULL DEFAULT 1.00 CHECK (minimum_increment > 0),

  -- Counters — maintained by triggers (see below)
  bid_count         INTEGER     NOT NULL DEFAULT 0 CHECK (bid_count >= 0),
  like_count        INTEGER     NOT NULL DEFAULT 0 CHECK (like_count >= 0),

  -- Lifecycle
  status            auction_status NOT NULL DEFAULT 'active',
  ends_at           TIMESTAMPTZ NOT NULL,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Enforce 3-day window: ends_at must be within 3 days (+/- 60s tolerance)
  CONSTRAINT chk_auction_duration CHECK (
    ends_at BETWEEN (created_at + INTERVAL '2 days 23 hours')
                AND (created_at + INTERVAL '3 days 1 hour')
  )
);

CREATE TRIGGER trg_auctions_updated_at
  BEFORE UPDATE ON auctions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Indexes
CREATE INDEX idx_auctions_seller_id
  ON auctions (seller_id);
-- Profile page: "all auctions by this seller"

CREATE INDEX idx_auctions_feed
  ON auctions (status, ends_at ASC)
  WHERE status = 'active';
-- Feed query: active-only auctions ordered by ending soonest (partial index,
-- much smaller than a full-table index on all statuses).

CREATE INDEX idx_auctions_status
  ON auctions (status);
-- Admin panel: filter by status

CREATE INDEX idx_auctions_created_at
  ON auctions (created_at DESC);
-- Newest listings query, used on profile pages

-- Full-text search on title (for Search/Explore screen in later phase)
CREATE INDEX idx_auctions_title_trgm
  ON auctions USING gin (title gin_trgm_ops);

-- RLS planning notes:
-- ALTER TABLE auctions ENABLE ROW LEVEL SECURITY;
-- POLICY "Anyone authenticated can read active non-removed auctions"
--   USING (auth.uid() IS NOT NULL AND status != 'removed')
-- POLICY "Sellers can update/delete their own auctions (only when bid_count = 0)"
--   USING (auth.uid() = seller_id)
-- POLICY "Admins can see and update all auctions"
--   USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin))

COMMENT ON TABLE  auctions                  IS 'Auction listings. bid_count and like_count are denormalized counters maintained by triggers.';
COMMENT ON COLUMN auctions.current_price    IS 'Highest bid so far. Starts equal to start_price. Updated by trigger on bids INSERT.';
COMMENT ON COLUMN auctions.minimum_increment IS 'Each bid must exceed current_price by at least this amount.';
COMMENT ON COLUMN auctions.ends_at          IS 'Fixed 3-day window from created_at. A scheduler flips status to ended after this passes.';

-- =============================================================================
-- Table: bids
-- =============================================================================
-- One row per bid event. Immutable — bids are never updated or deleted
-- (hard rule: bidding is a financial record even in MVP).
--
-- ORDERING: bid history is retrieved ordered by placed_at DESC (most recent first).
-- The top bid is the row with the MAX(amount) for a given auction_id.
--
-- VALIDATION at application layer:
--   • amount > current_price on the auction (race condition handled by
--     checking inside a transaction or using advisory locks)
--   • auction.status = 'active' AND auction.ends_at > now()
--   • bidder_id != auction.seller_id
-- =============================================================================
CREATE TABLE bids (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id  UUID          NOT NULL REFERENCES auctions(id) ON DELETE RESTRICT,
  bidder_id   UUID          NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  amount      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  placed_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  -- placed_at is explicit (not created_at) to match domain language.

  CONSTRAINT uq_bids_bidder_amount_auction UNIQUE (auction_id, bidder_id, amount)
  -- Prevents exact duplicate bids from the same user on the same auction
  -- at the same price point (double-click protection). Amount uniqueness
  -- per (auction, bidder) pair is intentional — they can bid higher but not identical.
);

-- Indexes
CREATE INDEX idx_bids_auction_id
  ON bids (auction_id, placed_at DESC);
-- Bid history: all bids for an auction, newest first

CREATE INDEX idx_bids_auction_amount
  ON bids (auction_id, amount DESC);
-- Finding the top bid for an auction efficiently

CREATE INDEX idx_bids_bidder_id
  ON bids (bidder_id, placed_at DESC);
-- User's bid history on their Activity / Profile screen

-- Trigger: update auctions.current_price and bid_count after each successful bid
CREATE OR REPLACE FUNCTION update_auction_on_bid()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE auctions
  SET
    current_price = NEW.amount,
    bid_count     = bid_count + 1,
    updated_at    = now()
  WHERE id = NEW.auction_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_bids_update_auction
  AFTER INSERT ON bids
  FOR EACH ROW EXECUTE FUNCTION update_auction_on_bid();

-- RLS planning notes:
-- ALTER TABLE bids ENABLE ROW LEVEL SECURITY;
-- POLICY "Authenticated users can read bids on any auction"
--   USING (auth.uid() IS NOT NULL)
-- POLICY "Authenticated users can insert their own bids"
--   WITH CHECK (auth.uid() = bidder_id)
-- Note: business-rule validation (amount > current_price, auction active)
--   is enforced at the API layer, not via RLS.

COMMENT ON TABLE  bids            IS 'Immutable bid events. Business rule validation occurs at the API layer. Trigger maintains auctions.current_price and bid_count.';
COMMENT ON COLUMN bids.placed_at  IS 'Explicit domain field (not renamed created_at) since timestamp carries business meaning.';

-- =============================================================================
-- Table: likes
-- =============================================================================
-- One row per (user, auction) like. The UNIQUE constraint makes likes
-- idempotent at the database level — inserting twice on the same pair is a
-- no-op conflict, and the application can use ON CONFLICT DO NOTHING.
-- =============================================================================
CREATE TABLE likes (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id  UUID        NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_likes_user_auction UNIQUE (user_id, auction_id)
  -- Enforces one-like-per-user-per-auction at the DB level.
);

-- Indexes
-- uq_likes_user_auction creates a unique index covering (user_id, auction_id),
-- which also serves the common query: "has this user liked this auction?"
-- An additional index on auction_id alone serves the opposite query:
CREATE INDEX idx_likes_auction_id ON likes (auction_id);
-- "all likes on this auction" (used to refresh like_count after a failure)

-- Trigger: maintain auctions.like_count on like/unlike
CREATE OR REPLACE FUNCTION update_auction_like_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE auctions SET like_count = like_count + 1, updated_at = now()
    WHERE id = NEW.auction_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE auctions SET like_count = GREATEST(like_count - 1, 0), updated_at = now()
    WHERE id = OLD.auction_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_likes_update_auction
  AFTER INSERT OR DELETE ON likes
  FOR EACH ROW EXECUTE FUNCTION update_auction_like_count();

-- RLS planning notes:
-- ALTER TABLE likes ENABLE ROW LEVEL SECURITY;
-- POLICY "Authenticated users can read all likes"
--   USING (auth.uid() IS NOT NULL)
-- POLICY "Users can manage their own likes only"
--   USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)

COMMENT ON TABLE likes IS 'One row per (user, auction) like. UNIQUE constraint makes like/unlike idempotent. Trigger maintains auctions.like_count.';

-- =============================================================================
-- Table: reports
-- =============================================================================
-- Users report auction listings for policy violations.
-- One report per (reporter, auction) pair prevents spam reporting.
-- The status lifecycle: pending → (dismissed | actioned).
-- =============================================================================
CREATE TABLE reports (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID          NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
  -- SET NULL: if the reporter is deleted/banned we keep the report for audit purposes.
  auction_id  UUID          NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  reason      report_reason NOT NULL,
  details     TEXT          CHECK (char_length(details) <= 500),
  status      report_status NOT NULL DEFAULT 'pending',

  -- Admin resolution metadata
  resolved_by UUID          REFERENCES profiles(id) ON DELETE SET NULL,
  admin_note  TEXT          CHECK (char_length(admin_note) <= 500),
  resolved_at TIMESTAMPTZ,

  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT uq_reports_reporter_auction UNIQUE (reporter_id, auction_id),
  -- One report per (reporter, auction). Prevents spam; the reporter can
  -- update their reason by filing a single report — not multiple.

  CONSTRAINT chk_report_resolution CHECK (
    (status = 'pending' AND resolved_at IS NULL AND resolved_by IS NULL)
    OR
    (status IN ('dismissed', 'actioned') AND resolved_at IS NOT NULL)
  )
  -- Ensures resolved_at is always set when a report is closed.
);

-- Indexes
CREATE INDEX idx_reports_status ON reports (status, created_at DESC);
-- Admin queue: pending reports in chronological order

CREATE INDEX idx_reports_auction_id ON reports (auction_id);
-- "all reports on this auction" — useful for moderation detail view

CREATE INDEX idx_reports_reporter_id ON reports (reporter_id);
-- "reports filed by this user" — audit trail

-- RLS planning notes:
-- ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
-- POLICY "Users can create reports on auctions they don't own"
--   WITH CHECK (auth.uid() = reporter_id
--               AND NOT EXISTS (SELECT 1 FROM auctions WHERE id = auction_id AND seller_id = auth.uid()))
-- POLICY "Users can read only their own reports"
--   USING (auth.uid() = reporter_id)
-- POLICY "Admins can read all reports"
--   USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin))

COMMENT ON TABLE  reports             IS 'User-submitted policy violation reports. One per (reporter, auction) pair.';
COMMENT ON COLUMN reports.reporter_id IS 'SET NULL on deletion to preserve audit trail without PII.';

-- =============================================================================
-- Table: blocks
-- =============================================================================
-- Users block other users. Blocked user's auctions are hidden from the
-- blocker's feed and profile searches.
-- Blocking is bidirectional only in feed filtering — it is NOT symmetric:
-- User A blocking User B does not mean B has blocked A.
-- The feed query filters: WHERE seller_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)
-- =============================================================================
CREATE TABLE blocks (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id  UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  blocked_id  UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_blocks UNIQUE (blocker_id, blocked_id),
  -- Prevents duplicate block rows. ON CONFLICT DO NOTHING for idempotent unblock.

  CONSTRAINT chk_blocks_no_self_block CHECK (blocker_id != blocked_id)
  -- A user cannot block themselves. Enforced here and at the API layer.
);

-- Indexes
CREATE INDEX idx_blocks_blocker_id ON blocks (blocker_id);
-- Feed filter: "all users this user has blocked" — most common query path

CREATE INDEX idx_blocks_blocked_id ON blocks (blocked_id);
-- Reverse lookup: "who has blocked this user" — used in admin moderation

-- RLS planning notes:
-- ALTER TABLE blocks ENABLE ROW LEVEL SECURITY;
-- POLICY "Users can only read and manage their own block list"
--   USING (auth.uid() = blocker_id)
--   WITH CHECK (auth.uid() = blocker_id)

COMMENT ON TABLE blocks IS 'User block list. Feed queries exclude sellers in the caller''s block list. Not symmetric.';

-- =============================================================================
-- Table: contact_requests
-- =============================================================================
-- Tracks when a buyer requests contact with a seller via WhatsApp.
-- The actual wa.me URL is built by the API server using the seller's phone
-- from profiles. The phone is NEVER stored here.
--
-- This table serves as an audit log of contact attempts, useful for
-- moderation (e.g., identifying harassment patterns) and future features
-- (e.g., contact rate limiting, analytics).
-- =============================================================================
CREATE TABLE contact_requests (
  id           UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id   UUID           NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  requester_id UUID           NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  seller_id    UUID           NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status       contact_status NOT NULL DEFAULT 'pending',
  -- 'pending' = link was generated, 'delivered' = client confirmed link was opened
  -- (delivered state can be set by a follow-up API call from the client)

  created_at   TIMESTAMPTZ    NOT NULL DEFAULT now(),

  CONSTRAINT chk_contact_not_self CHECK (requester_id != seller_id)
  -- A seller cannot contact themselves via an auction.
);

-- Indexes
CREATE INDEX idx_contact_requests_requester ON contact_requests (requester_id, created_at DESC);
-- Future: rate-limiting — "how many contact requests has this user made in the last hour?"

CREATE INDEX idx_contact_requests_seller ON contact_requests (seller_id, created_at DESC);
-- Future: seller analytics — "how many buyers contacted me this week?"

CREATE INDEX idx_contact_requests_auction ON contact_requests (auction_id);
-- Per-auction contact history for moderation

-- RLS planning notes:
-- ALTER TABLE contact_requests ENABLE ROW LEVEL SECURITY;
-- POLICY "Requesters can read their own contact requests"
--   USING (auth.uid() = requester_id)
-- POLICY "Sellers can read contact requests on their auctions"
--   USING (auth.uid() = seller_id)
-- POLICY "Admins can read all contact requests"
--   USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin))

COMMENT ON TABLE  contact_requests           IS 'Audit log of WhatsApp contact link generation. Phone number is NEVER stored here.';
COMMENT ON COLUMN contact_requests.status    IS 'pending = link generated; delivered = client confirmed the link was opened.';

-- =============================================================================
-- Table: moderation_queue
-- =============================================================================
-- Aggregated moderation cases that need admin attention.
-- A moderation queue entry may be created by:
--   (a) User reports accumulating on the same auction (source = 'user_report')
--   (b) System auto-flagging (source = 'system') — e.g., rapid bid activity
--       that looks like shill bidding (later phase feature)
--
-- This table decouples the reports table from admin workflow: multiple reports
-- on the same auction roll up into a single queue entry, avoiding duplicate
-- admin work.
-- =============================================================================
CREATE TABLE moderation_queue (
  id          UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id  UUID              NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  source      moderation_source NOT NULL,
  reason      TEXT              NOT NULL CHECK (char_length(reason) <= 500),
  status      moderation_status NOT NULL DEFAULT 'pending',

  reviewed_by UUID              REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,

  created_at  TIMESTAMPTZ       NOT NULL DEFAULT now(),

  CONSTRAINT uq_moderation_auction_source UNIQUE (auction_id, source),
  -- One open queue entry per (auction, source) type. Additional reports on the
  -- same auction don't create duplicate queue entries — they update the existing one.

  CONSTRAINT chk_moderation_resolution CHECK (
    (status = 'pending'  AND reviewed_at IS NULL)
    OR
    (status != 'pending' AND reviewed_at IS NOT NULL)
  )
);

-- Indexes
CREATE INDEX idx_moderation_status ON moderation_queue (status, created_at ASC);
-- Admin panel: open queue sorted oldest-first (fairness)

CREATE INDEX idx_moderation_auction ON moderation_queue (auction_id);
-- Look up all queue entries for a specific auction

-- RLS planning notes:
-- ALTER TABLE moderation_queue ENABLE ROW LEVEL SECURITY;
-- POLICY "Only admins can read and update moderation_queue"
--   USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin))

COMMENT ON TABLE moderation_queue IS 'Aggregated moderation cases. Multiple user reports roll up to one entry per auction. Decouples reports from admin workflow.';

-- =============================================================================
-- Table: admin_actions
-- =============================================================================
-- Immutable audit log of every admin action taken. Never updated or deleted.
-- Provides a complete trail for accountability and dispute resolution.
-- =============================================================================
CREATE TABLE admin_actions (
  id          UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    UUID              NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  -- RESTRICT: cannot delete a profile that has taken admin actions (audit integrity)

  action_type admin_action_type NOT NULL,
  target_type admin_target_type NOT NULL,
  target_id   UUID              NOT NULL,
  -- target_id references auctions.id, profiles.id, or reports.id depending on target_type.
  -- Not a FK because it is polymorphic. Integrity enforced at the application layer.

  note        TEXT              CHECK (char_length(note) <= 500),
  created_at  TIMESTAMPTZ       NOT NULL DEFAULT now()
  -- No updated_at: admin_actions are append-only.
);

-- Indexes
CREATE INDEX idx_admin_actions_admin ON admin_actions (admin_id, created_at DESC);
-- "all actions taken by admin X" — individual admin audit trail

CREATE INDEX idx_admin_actions_target ON admin_actions (target_type, target_id, created_at DESC);
-- "all admin actions against user Y / auction Z" — useful in admin detail views

CREATE INDEX idx_admin_actions_created_at ON admin_actions (created_at DESC);
-- Global admin activity log ordered by recency

-- RLS planning notes:
-- ALTER TABLE admin_actions ENABLE ROW LEVEL SECURITY;
-- POLICY "Only admins can read admin_actions"
--   USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin))
-- No write policy via RLS — admin_actions are only written by backend service_role

COMMENT ON TABLE  admin_actions            IS 'Immutable audit log of admin actions. Append-only. Never update or delete rows.';
COMMENT ON COLUMN admin_actions.target_id  IS 'Polymorphic FK: references auctions, profiles, or reports depending on target_type. Not a DB-level FK.';

-- =============================================================================
-- Helpful views (non-materialized, read-only)
-- =============================================================================

-- v_public_profiles: safe view that explicitly excludes the phone column.
-- Use this view in any SELECT that serves public API responses.
CREATE VIEW v_public_profiles AS
SELECT
  id,
  display_name,
  avatar_url,
  bio,
  is_admin,
  is_banned,
  created_at
FROM profiles;

COMMENT ON VIEW v_public_profiles IS 'Safe public view of profiles. Deliberately excludes phone. Use in all public-facing queries.';

-- v_auction_feed: feed-optimized view with seller info pre-joined.
-- Excludes removed auctions and soft-filters ended ones cleanly.
CREATE VIEW v_auction_feed AS
SELECT
  a.id,
  a.title,
  a.thumbnail_url,
  a.video_url,
  a.current_price,
  a.start_price,
  a.minimum_increment,
  a.bid_count,
  a.like_count,
  a.category,
  a.status,
  a.ends_at,
  a.created_at,
  -- Seller summary (no phone)
  p.id           AS seller_id,
  p.display_name AS seller_display_name,
  p.avatar_url   AS seller_avatar_url
FROM auctions a
JOIN profiles p ON p.id = a.seller_id
WHERE a.status = 'active'
  AND a.ends_at > now()
  AND p.is_banned = FALSE;

COMMENT ON VIEW v_auction_feed IS 'Feed-optimized view: active, non-expired auctions with seller summary. Excludes banned sellers.';

-- v_admin_report_queue: pre-joined report list for admin panel.
CREATE VIEW v_admin_report_queue AS
SELECT
  r.id,
  r.reason,
  r.details,
  r.status,
  r.created_at,
  r.resolved_at,
  r.admin_note,
  -- Reporter (no phone)
  rp.id           AS reporter_id,
  rp.display_name AS reporter_display_name,
  -- Auction summary
  a.id            AS auction_id,
  a.title         AS auction_title,
  a.thumbnail_url AS auction_thumbnail_url,
  a.status        AS auction_status,
  -- Seller (no phone)
  sp.id           AS seller_id,
  sp.display_name AS seller_display_name,
  sp.is_banned    AS seller_is_banned
FROM reports r
JOIN profiles rp ON rp.id = r.reporter_id
JOIN auctions a  ON a.id  = r.auction_id
JOIN profiles sp ON sp.id = a.seller_id
ORDER BY r.created_at DESC;

COMMENT ON VIEW v_admin_report_queue IS 'Pre-joined report list for admin panel. No phone numbers exposed.';

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
