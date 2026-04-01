-- =============================================================================
-- BidReel MVP — Consolidated Schema Reference
-- Target: Supabase PostgreSQL
-- =============================================================================
-- Run each block in order in the Supabase SQL editor.
-- Blocks are idempotent (IF NOT EXISTS / OR REPLACE) so they can be re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- trigram text search

-- ---------------------------------------------------------------------------
-- Shared trigger: auto-update updated_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- Table: users (profiles)
-- =============================================================================
-- One row per Supabase Auth user. Created on first login.
-- Phone number is internal-only (WhatsApp link generation).
-- Email is used for the register/login flow.
-- =============================================================================
CREATE TABLE IF NOT EXISTS profiles (
  id            UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email         TEXT,                                      -- set on email/password signup
  phone         TEXT,                                      -- set on phone/OTP signup
  display_name  TEXT        CHECK (char_length(display_name) BETWEEN 2 AND 50),
  avatar_url    TEXT,
  bio           TEXT        CHECK (char_length(bio) <= 300),
  is_admin      BOOLEAN     NOT NULL DEFAULT FALSE,
  is_banned     BOOLEAN     NOT NULL DEFAULT FALSE,
  ban_reason    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- Table: auctions
-- =============================================================================
-- Core listing. current_bid and bid_count are denormalized counters.
-- Auction duration is fixed at 3 days from creation.
-- =============================================================================
CREATE TYPE IF NOT EXISTS auction_status AS ENUM ('active', 'ended', 'removed');

CREATE TABLE IF NOT EXISTS auctions (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id     UUID          NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  title         TEXT          NOT NULL CHECK (char_length(title) BETWEEN 3 AND 80),
  description   TEXT          CHECK (char_length(description) <= 500),
  category      TEXT          NOT NULL,
  video_url     TEXT          NOT NULL,
  thumbnail_url TEXT          NOT NULL,
  start_price   NUMERIC(12,2) NOT NULL CHECK (start_price > 0),
  current_bid   NUMERIC(12,2) NOT NULL CHECK (current_bid >= start_price),
  min_increment NUMERIC(12,2) NOT NULL DEFAULT 10.00 CHECK (min_increment > 0),
  bid_count     INTEGER       NOT NULL DEFAULT 0 CHECK (bid_count >= 0),
  like_count    INTEGER       NOT NULL DEFAULT 0 CHECK (like_count >= 0),
  status        auction_status NOT NULL DEFAULT 'active',
  starts_at     TIMESTAMPTZ,
  ends_at       TIMESTAMPTZ   NOT NULL,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER trg_auctions_updated_at
  BEFORE UPDATE ON auctions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_auctions_feed
  ON auctions (status, ends_at ASC)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_auctions_seller_id
  ON auctions (seller_id);

-- =============================================================================
-- Table: bids
-- =============================================================================
-- Immutable bid events. API enforces:
--   • amount > current_bid + min_increment
--   • auction must be active and not expired
--   • bidder cannot be the seller
-- =============================================================================
CREATE TABLE IF NOT EXISTS bids (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id  UUID          NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  user_id     UUID          NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  amount      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bids_auction_amount
  ON bids (auction_id, amount DESC);

CREATE INDEX IF NOT EXISTS idx_bids_user
  ON bids (user_id, created_at DESC);

-- Trigger: keep auctions.current_bid and bid_count in sync
CREATE OR REPLACE FUNCTION update_auction_on_bid()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE auctions
  SET current_bid = NEW.amount,
      bid_count   = bid_count + 1,
      updated_at  = now()
  WHERE id = NEW.auction_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_bids_update_auction
  AFTER INSERT ON bids
  FOR EACH ROW EXECUTE FUNCTION update_auction_on_bid();

-- =============================================================================
-- Table: reports
-- =============================================================================
-- Users flag auctions for policy violations.
-- One report per (reporter, auction) pair (enforced by UNIQUE constraint).
-- =============================================================================
CREATE TYPE IF NOT EXISTS report_reason AS ENUM (
  'spam_or_fake',
  'offensive_content',
  'prohibited_item',
  'other'
);

CREATE TYPE IF NOT EXISTS report_status AS ENUM ('pending', 'dismissed', 'actioned');

CREATE TABLE IF NOT EXISTS reports (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id  UUID          REFERENCES profiles(id) ON DELETE SET NULL,
  auction_id   UUID          NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  reason       report_reason NOT NULL,
  details      TEXT          CHECK (char_length(details) <= 500),
  status       report_status NOT NULL DEFAULT 'pending',
  resolved_by  UUID          REFERENCES profiles(id) ON DELETE SET NULL,
  admin_note   TEXT,
  resolved_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT uq_reports_reporter_auction UNIQUE (reporter_id, auction_id)
);

CREATE INDEX IF NOT EXISTS idx_reports_status
  ON reports (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reports_auction_id
  ON reports (auction_id);

-- =============================================================================
-- Row Level Security
-- =============================================================================
-- Enable RLS — service_role key (used by the API server) bypasses all policies.
-- These policies cover direct Supabase client access (e.g., future mobile app).

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE auctions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bids     ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports  ENABLE ROW LEVEL SECURITY;

-- profiles: authenticated users can read; users manage their own row
CREATE POLICY IF NOT EXISTS "profiles_read" ON profiles
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY IF NOT EXISTS "profiles_update_own" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- auctions: anyone authenticated can read active auctions; sellers insert their own
CREATE POLICY IF NOT EXISTS "auctions_read" ON auctions
  FOR SELECT USING (auth.uid() IS NOT NULL AND status != 'removed');

CREATE POLICY IF NOT EXISTS "auctions_insert_own" ON auctions
  FOR INSERT WITH CHECK (auth.uid() = seller_id);

-- bids: public read; users insert their own bids
CREATE POLICY IF NOT EXISTS "bids_read" ON bids
  FOR SELECT USING (true);

CREATE POLICY IF NOT EXISTS "bids_insert_own" ON bids
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- reports: users read and insert their own reports
CREATE POLICY IF NOT EXISTS "reports_read_own" ON reports
  FOR SELECT USING (auth.uid() = reporter_id);

CREATE POLICY IF NOT EXISTS "reports_insert_own" ON reports
  FOR INSERT WITH CHECK (auth.uid() = reporter_id);
