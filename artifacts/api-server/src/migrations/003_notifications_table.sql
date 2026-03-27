-- Migration 003: notifications table
-- Run in Supabase SQL editor after 002_bids_table.sql

CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('outbid', 'auction_started', 'auction_won', 'new_bid')),
  message     TEXT NOT NULL,
  auction_id  UUID REFERENCES auctions(id) ON DELETE SET NULL,
  read        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

-- Feed for a specific user, unread first, most recent first
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications (user_id, read, created_at DESC);

-- ── Row Level Security ────────────────────────────────────────────────────────

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Users can only read their own notifications
CREATE POLICY "Users read own notifications"
  ON notifications FOR SELECT
  USING (auth.uid() = user_id);

-- Users can mark their own notifications as read (UPDATE read column only)
CREATE POLICY "Users update own notifications"
  ON notifications FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Only service role can insert notifications (server-side triggers)
-- No INSERT policy needed for authenticated users.

-- ── Realtime publication ──────────────────────────────────────────────────────
-- Enables Supabase Realtime for per-user notification delivery.
-- The frontend subscribes with filter: user_id=eq.{userId}

ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
