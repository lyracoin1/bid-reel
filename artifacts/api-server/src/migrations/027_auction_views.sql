-- =============================================================================
-- Migration 027: Auction Views (impressions / qualified / engaged)
-- =============================================================================
-- Real, server-authoritative view tracking system. The frontend reports raw
-- events ("this card was visible for 2.3s in the feed"). The server decides
-- what counts as a view, what's a duplicate, what's engaged, and writes the
-- pre-aggregated counters that the public app and the admin dashboard read.
--
-- Three internal levels:
--   1. impression       — card appeared on screen
--   2. qualified view   — visible long enough to count (server decides)
--   3. engaged view     — viewer interacted after a recent qualified view
--                         (like / save / open detail / bid)
--
-- Public `views` count == auction_view_stats.qualified_views_count.
--
-- Idempotent — safe to re-run.
-- =============================================================================

-- ─── A. auction_view_events ─────────────────────────────────────────────────
-- Raw event log. One row per accepted POST /api/auctions/:id/view call,
-- and one row per accepted engagement call. Used for analytics, debugging,
-- and as the source of truth for dedupe / unique-viewer queries.

CREATE TABLE IF NOT EXISTS auction_view_events (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id   UUID         NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  user_id      UUID         NULL     REFERENCES profiles(id) ON DELETE SET NULL,
  session_id   TEXT         NULL,
  platform     TEXT         NOT NULL DEFAULT 'web'
                            CHECK (platform IN ('web', 'android', 'ios')),
  source       TEXT         NOT NULL DEFAULT 'feed'
                            CHECK (source IN ('feed', 'profile', 'search', 'saved', 'direct')),
  watch_ms     INTEGER      NOT NULL DEFAULT 0,
  event_type   TEXT         NOT NULL
                            CHECK (event_type IN ('impression', 'qualified_view', 'qualified_view_dedup', 'engaged_view')),
  is_qualified BOOLEAN      NOT NULL DEFAULT false,
  is_engaged   BOOLEAN      NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT auction_view_events_viewer_present
    CHECK (user_id IS NOT NULL OR (session_id IS NOT NULL AND length(session_id) > 0))
);

-- Per-auction recency scans (dedupe + unique-viewer probes).
CREATE INDEX IF NOT EXISTS idx_view_events_auction_created
  ON auction_view_events (auction_id, created_at DESC);

-- Per-viewer-per-auction lookups for the dedupe / unique queries.
CREATE INDEX IF NOT EXISTS idx_view_events_auction_user
  ON auction_view_events (auction_id, user_id) WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_view_events_auction_session
  ON auction_view_events (auction_id, session_id) WHERE session_id IS NOT NULL;

-- ─── B. auction_view_stats ──────────────────────────────────────────────────
-- Pre-aggregated counters per auction so the public list query stays cheap
-- (no GROUP BY over millions of events on every feed fetch).

CREATE TABLE IF NOT EXISTS auction_view_stats (
  auction_id            UUID         PRIMARY KEY REFERENCES auctions(id) ON DELETE CASCADE,
  impressions_count     INTEGER      NOT NULL DEFAULT 0 CHECK (impressions_count     >= 0),
  qualified_views_count INTEGER      NOT NULL DEFAULT 0 CHECK (qualified_views_count >= 0),
  engaged_views_count   INTEGER      NOT NULL DEFAULT 0 CHECK (engaged_views_count   >= 0),
  unique_viewers_count  INTEGER      NOT NULL DEFAULT 0 CHECK (unique_viewers_count  >= 0),
  last_viewed_at        TIMESTAMPTZ  NULL,
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Top-views ranking on the admin dashboard.
CREATE INDEX IF NOT EXISTS idx_view_stats_qualified_desc
  ON auction_view_stats (qualified_views_count DESC);
CREATE INDEX IF NOT EXISTS idx_view_stats_engaged_desc
  ON auction_view_stats (engaged_views_count DESC);
CREATE INDEX IF NOT EXISTS idx_view_stats_last_viewed
  ON auction_view_stats (last_viewed_at DESC);

-- ─── C. record_auction_view ─────────────────────────────────────────────────
-- Atomic accept / dedupe / count. Called by POST /api/auctions/:id/view.
--
-- Rules:
--   - watch_ms >= 2000 → candidate for qualified view
--   - dedupe per (auction_id, viewer_key) within rolling 30 minutes
--     (viewer_key = user_id when present, else session_id)
--   - unique_viewers_count increments only on the very first event ever for
--     that (auction_id, viewer_key) pair
--   - every accepted call increments impressions_count (so the impression
--     counter is the raw call count; qualified is the deduped subset)

CREATE OR REPLACE FUNCTION record_auction_view(
  p_auction_id UUID,
  p_user_id    UUID,
  p_session_id TEXT,
  p_platform   TEXT,
  p_source     TEXT,
  p_watch_ms   INTEGER
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_viewer_key       TEXT;
  v_qualified        BOOLEAN;
  v_recent_qualified BOOLEAN := false;
  v_first_time       BOOLEAN;
  v_event_type       TEXT;
  v_count_qualified  INT := 0;
  v_count_unique     INT := 0;
BEGIN
  v_viewer_key := COALESCE(p_user_id::text, p_session_id);
  IF v_viewer_key IS NULL OR length(v_viewer_key) = 0 THEN
    RAISE EXCEPTION 'record_auction_view: either user_id or session_id is required';
  END IF;

  v_qualified := COALESCE(p_watch_ms, 0) >= 2000;

  IF v_qualified THEN
    SELECT EXISTS(
      SELECT 1
        FROM auction_view_events
       WHERE auction_id = p_auction_id
         AND is_qualified = true
         AND COALESCE(user_id::text, session_id) = v_viewer_key
         AND created_at > now() - interval '30 minutes'
    ) INTO v_recent_qualified;
  END IF;

  SELECT NOT EXISTS(
    SELECT 1
      FROM auction_view_events
     WHERE auction_id = p_auction_id
       AND COALESCE(user_id::text, session_id) = v_viewer_key
  ) INTO v_first_time;

  IF v_qualified AND NOT v_recent_qualified THEN
    v_event_type := 'qualified_view';
    v_count_qualified := 1;
  ELSIF v_qualified THEN
    v_event_type := 'qualified_view_dedup';
  ELSE
    v_event_type := 'impression';
  END IF;

  IF v_first_time THEN
    v_count_unique := 1;
  END IF;

  INSERT INTO auction_view_events(
    auction_id, user_id, session_id, platform, source, watch_ms,
    event_type, is_qualified, is_engaged
  ) VALUES (
    p_auction_id, p_user_id, NULLIF(p_session_id, ''), p_platform, p_source, COALESCE(p_watch_ms, 0),
    v_event_type, (v_qualified AND NOT v_recent_qualified), false
  );

  INSERT INTO auction_view_stats(
    auction_id, impressions_count, qualified_views_count,
    engaged_views_count, unique_viewers_count, last_viewed_at, updated_at
  ) VALUES (
    p_auction_id, 1, v_count_qualified, 0, v_count_unique, now(), now()
  )
  ON CONFLICT (auction_id) DO UPDATE
    SET impressions_count     = auction_view_stats.impressions_count     + 1,
        qualified_views_count = auction_view_stats.qualified_views_count + v_count_qualified,
        unique_viewers_count  = auction_view_stats.unique_viewers_count  + v_count_unique,
        last_viewed_at        = now(),
        updated_at            = now();

  RETURN jsonb_build_object(
    'event_type', v_event_type,
    'qualified',  (v_qualified AND NOT v_recent_qualified),
    'dedup',      (v_qualified AND v_recent_qualified),
    'unique',     v_first_time
  );
END;
$$;

-- ─── D. record_auction_engagement ───────────────────────────────────────────
-- Marks the viewer's most recent (≤30 min) qualified-view event as engaged
-- and bumps engaged_views_count exactly once. No-op when the viewer has not
-- had a recent qualified view (engagement without a view does not count).

CREATE OR REPLACE FUNCTION record_auction_engagement(
  p_auction_id UUID,
  p_user_id    UUID,
  p_session_id TEXT,
  p_action     TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_viewer_key TEXT;
  v_event_id   UUID;
BEGIN
  v_viewer_key := COALESCE(p_user_id::text, p_session_id);
  IF v_viewer_key IS NULL OR length(v_viewer_key) = 0 THEN
    RETURN jsonb_build_object('engaged', false, 'reason', 'no_viewer_key');
  END IF;

  SELECT id INTO v_event_id
    FROM auction_view_events
   WHERE auction_id = p_auction_id
     AND is_qualified = true
     AND is_engaged   = false
     AND COALESCE(user_id::text, session_id) = v_viewer_key
     AND created_at > now() - interval '30 minutes'
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_event_id IS NULL THEN
    RETURN jsonb_build_object('engaged', false, 'reason', 'no_recent_qualified_view', 'action', p_action);
  END IF;

  UPDATE auction_view_events
     SET is_engaged = true,
         event_type = 'engaged_view'
   WHERE id = v_event_id;

  INSERT INTO auction_view_stats(
    auction_id, impressions_count, qualified_views_count,
    engaged_views_count, unique_viewers_count, last_viewed_at, updated_at
  ) VALUES (p_auction_id, 0, 0, 1, 0, now(), now())
  ON CONFLICT (auction_id) DO UPDATE
    SET engaged_views_count = auction_view_stats.engaged_views_count + 1,
        updated_at          = now();

  RETURN jsonb_build_object('engaged', true, 'action', p_action, 'event_id', v_event_id);
END;
$$;

-- ─── E. Row-Level Security ──────────────────────────────────────────────────
-- Both tables are written exclusively through the SECURITY DEFINER functions
-- (called by the API server using the service-role key). Direct anon access
-- is blocked. Authenticated users may read their own event rows for debugging.

ALTER TABLE auction_view_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction_view_stats  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "view_events: service role full access" ON auction_view_events;
CREATE POLICY "view_events: service role full access"
  ON auction_view_events FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "view_events: owner can read own" ON auction_view_events;
CREATE POLICY "view_events: owner can read own"
  ON auction_view_events FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "view_stats: service role full access" ON auction_view_stats;
CREATE POLICY "view_stats: service role full access"
  ON auction_view_stats FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "view_stats: anyone can read counters" ON auction_view_stats;
CREATE POLICY "view_stats: anyone can read counters"
  ON auction_view_stats FOR SELECT USING (true);

-- ─── F. PostgREST schema cache reload ───────────────────────────────────────
-- So the new tables / functions are visible to the API immediately.
NOTIFY pgrst, 'reload schema';
