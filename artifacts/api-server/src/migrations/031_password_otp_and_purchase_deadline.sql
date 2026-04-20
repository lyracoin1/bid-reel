-- =============================================================================
-- Migration 031: Password-reset OTP table + purchase-deadline tracking
-- =============================================================================
-- Adds two independent feature surfaces in one idempotent migration:
--
--   A. password_reset_otps
--      WhatsApp OTP storage for the "Forgot password" flow. Stores ONLY a
--      hash of the 6-digit code, never the plaintext. Per-row attempt and
--      resend counters are enforced at the API layer.
--
--   B. auctions.purchase_deadline + reminder/expiry markers
--      The 48-hour deadline a winner has to complete the purchase, plus
--      idempotency stamps for the reminder and expired-deadline messages
--      so the scheduler never sends them twice.
--
-- Idempotent — safe to re-run. Adds nothing destructive to existing tables.
-- =============================================================================

-- ─── A. password_reset_otps ─────────────────────────────────────────────────
-- One row per request. The API enforces:
--   • code_hash is HMAC-SHA256(salt, code); plaintext is never stored.
--   • attempts up to MAX_VERIFY_ATTEMPTS (3) before the row is invalidated.
--   • resends up to MAX_RESENDS (3) per active row before lockout.
--   • expires_at = created_at + 10 minutes.
--   • consumed_at is stamped on first successful verify; row cannot be reused.

CREATE TABLE IF NOT EXISTS password_reset_otps (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID         NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  phone        TEXT         NOT NULL,
  code_hash    TEXT         NOT NULL,
  salt         TEXT         NOT NULL,
  channel      TEXT         NOT NULL DEFAULT 'whatsapp'
                            CHECK (channel IN ('whatsapp', 'sms')),
  attempts     INTEGER      NOT NULL DEFAULT 0,
  resends      INTEGER      NOT NULL DEFAULT 0,
  expires_at   TIMESTAMPTZ  NOT NULL,
  consumed_at  TIMESTAMPTZ  NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pwd_otps_user_active
  ON password_reset_otps (user_id, consumed_at, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_pwd_otps_phone
  ON password_reset_otps (phone);

CREATE OR REPLACE FUNCTION set_password_reset_otps_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pwd_otps_updated_at ON password_reset_otps;
CREATE TRIGGER trg_pwd_otps_updated_at
  BEFORE UPDATE ON password_reset_otps
  FOR EACH ROW EXECUTE FUNCTION set_password_reset_otps_updated_at();

ALTER TABLE password_reset_otps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pwd_otps: service role full access" ON password_reset_otps;
CREATE POLICY "pwd_otps: service role full access"
  ON password_reset_otps FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE password_reset_otps IS
  'WhatsApp OTPs for password reset. Stores HMAC hash only; per-row attempt/resend caps enforced by API.';

-- ─── B. Purchase-deadline columns on auctions ───────────────────────────────
-- purchase_deadline       — exactly 48 hours after the win/buy event.
-- reminder_24h_sent_at    — stamped when the 24h-after-win reminder fires.
-- expired_notified_at     — stamped when the 48h-passed expired notice fires.
--                           Doubles as the "ready for future strike handling"
--                           marker — strike issuance can SELECT all auctions
--                           with this stamped and no completed deal.
--
-- All three columns are nullable; nothing is backfilled. Existing/legacy
-- auctions remain untouched until they newly transition through the win or
-- buy paths that populate purchase_deadline.

ALTER TABLE auctions
  ADD COLUMN IF NOT EXISTS purchase_deadline       TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS reminder_24h_sent_at    TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS expired_notified_at     TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_auctions_purchase_deadline_pending
  ON auctions (purchase_deadline)
  WHERE purchase_deadline IS NOT NULL
    AND expired_notified_at IS NULL;

COMMENT ON COLUMN auctions.purchase_deadline IS
  'When set, the winner has until this timestamp to complete the purchase. Always = win_time + 48h.';
COMMENT ON COLUMN auctions.reminder_24h_sent_at IS
  'Idempotency stamp — non-NULL means the 24h-mark reminder was already sent.';
COMMENT ON COLUMN auctions.expired_notified_at IS
  'Idempotency stamp — non-NULL means the deadline-expired notice was already sent. Marker for future strike pipeline.';

-- ─── C. PostgREST schema reload ─────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
