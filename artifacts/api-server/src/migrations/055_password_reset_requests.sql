-- =============================================================================
-- Migration 055: password_reset_requests — email-based reset rate limiting
-- =============================================================================
-- Tracks how many password-reset emails have been sent to each email address
-- within a rolling 24-hour window. The backend checks this table before calling
-- Supabase's resetPasswordForEmail, so we stay well inside Supabase's own
-- project-level SMTP rate limits and prevent abuse.
--
-- DESIGN NOTES
-- ─────────────
-- • Only a SHA-256 hash of the normalised email is stored — raw addresses are
--   never persisted (PII minimisation). The hash is used purely for deduplication.
-- • One row per email (UNIQUE on email_hash). The upsert at request time either
--   inserts the first row or increments the counter within the active window.
-- • window_start marks when the current 24-h window opened. When a new request
--   arrives after window_start + 24 h, the server resets count=1 and bumps
--   window_start to now(), effectively starting a fresh window.
-- • max_per_window = 3 (enforced at the API layer, not here).
-- • RLS: service_role only. The table is only ever touched by the Express API
--   using the service role key; no client-direct access is needed or permitted.
--
-- IDEMPOTENT — safe to re-run.
-- =============================================================================

CREATE TABLE IF NOT EXISTS password_reset_requests (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  email_hash       TEXT         NOT NULL,
  request_count    INTEGER      NOT NULL DEFAULT 1,
  window_start     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  last_request_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT uq_reset_requests_email_hash UNIQUE (email_hash)
);

CREATE INDEX IF NOT EXISTS idx_reset_requests_email_hash
  ON password_reset_requests (email_hash);

CREATE INDEX IF NOT EXISTS idx_reset_requests_window_start
  ON password_reset_requests (window_start);

-- Auto-bump updated_at
CREATE OR REPLACE FUNCTION set_password_reset_requests_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reset_requests_updated_at ON password_reset_requests;
CREATE TRIGGER trg_reset_requests_updated_at
  BEFORE UPDATE ON password_reset_requests
  FOR EACH ROW EXECUTE FUNCTION set_password_reset_requests_updated_at();

-- ── RLS: service_role only ────────────────────────────────────────────────────

ALTER TABLE password_reset_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reset_requests_service_role" ON password_reset_requests;
CREATE POLICY "reset_requests_service_role"
  ON password_reset_requests
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Revoke all PostgREST access from anon and authenticated
REVOKE ALL ON TABLE public.password_reset_requests FROM anon;
REVOKE ALL ON TABLE public.password_reset_requests FROM authenticated;

COMMENT ON TABLE password_reset_requests IS
  'Per-email reset-email rate-limiter. Stores SHA-256(lowercase_email) only. Max 3 emails per 24-hour window enforced by API.';

NOTIFY pgrst, 'reload schema';
