-- =============================================================================
-- BidReel MVP — user_devices table
-- Migration: 007_user_devices.sql
-- =============================================================================
--
-- Stores FCM device tokens per user so the server can fan out push
-- notifications.  Multiple devices per user are supported (the same user
-- logged in on phone + tablet, for example).
--
-- DESIGN NOTES:
--   • (user_id, token) UNIQUE prevents duplicate registrations from the same
--     device re-registering with the same token.
--   • On token refresh the client calls the register endpoint again; the
--     UPSERT (ON CONFLICT DO NOTHING) keeps the row unchanged.  If the client
--     sends a new token for the same device, a new row is inserted.
--   • last_seen_at is bumped on every successful registration call.  A cron
--     job can prune rows where last_seen_at < now() - 90 days.
--   • platform tracks "web", "ios", or "android" for future filtering.
-- =============================================================================

CREATE TABLE IF NOT EXISTS user_devices (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  token         TEXT        NOT NULL,
  platform      TEXT        NOT NULL DEFAULT 'web'
                            CHECK (platform IN ('web', 'ios', 'android')),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_user_devices_user_token UNIQUE (user_id, token)
);

-- Fast lookup: all device tokens for a given user (notification fan-out)
CREATE INDEX IF NOT EXISTS idx_user_devices_user_id
  ON user_devices (user_id);

-- Prune stale tokens (cron or manual cleanup)
CREATE INDEX IF NOT EXISTS idx_user_devices_last_seen
  ON user_devices (last_seen_at);

-- ── Row Level Security ────────────────────────────────────────────────────────

ALTER TABLE user_devices ENABLE ROW LEVEL SECURITY;

-- Users can only read their own device rows (for debugging, rarely needed)
CREATE POLICY "Users read own devices"
  ON user_devices FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own device tokens
CREATE POLICY "Users insert own devices"
  ON user_devices FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own device rows (last_seen_at refresh)
CREATE POLICY "Users update own devices"
  ON user_devices FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Users can remove their own device tokens (logout / unregister)
CREATE POLICY "Users delete own devices"
  ON user_devices FOR DELETE
  USING (auth.uid() = user_id);
