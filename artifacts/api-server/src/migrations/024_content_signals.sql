-- Migration 024: Content Signals — Interested / Not Interested
--
-- Creates the content_signals table so users can signal their interest level
-- in an auction. One signal per user per auction (UNIQUE constraint with upsert).
-- Signals are: 'interested' | 'not_interested'.
--
-- Future use: feed ranking / personalisation queries will join this table to
-- boost interested content and suppress not-interested content per viewer.
--
-- Apply in Supabase SQL editor before deploying server changes that reference
-- the content_signals table.

CREATE TABLE IF NOT EXISTS content_signals (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES profiles(id)  ON DELETE CASCADE,
  auction_id  UUID        NOT NULL REFERENCES auctions(id)  ON DELETE CASCADE,
  signal      TEXT        NOT NULL CHECK (signal IN ('interested', 'not_interested')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, auction_id)
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_content_signals_user    ON content_signals(user_id);
CREATE INDEX IF NOT EXISTS idx_content_signals_auction ON content_signals(auction_id);
CREATE INDEX IF NOT EXISTS idx_content_signals_signal  ON content_signals(signal);

-- RLS: users can read/write only their own signals; service role bypasses RLS.
ALTER TABLE content_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Users can upsert own signals"
  ON content_signals
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Allow anon read for admin aggregate queries (signal counts are not sensitive).
CREATE POLICY IF NOT EXISTS "Service role full access"
  ON content_signals
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
