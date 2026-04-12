-- ────────────────────────────────────────────────────────────────────────────
-- 018_admin_notifications.sql
--
-- Creates the admin_notifications table — a shared inbox for all admin users.
-- Separate from the user-facing notifications table.
--
-- Populated automatically by DB triggers on:
--   • profiles INSERT  → new user signed up
--   • auctions INSERT  → new auction published
--   • reports  INSERT  → new report submitted
--
-- Also populated by the API server when an admin triggers a deployment.
--
-- RLS: only authenticated users with is_admin = true can read / mark as read.
--      Service role and trigger functions (SECURITY DEFINER / postgres) bypass
--      RLS by default and can INSERT freely.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS admin_notifications (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  type       text        NOT NULL,
  title      text        NOT NULL,
  message    text        NOT NULL,
  is_read    boolean     NOT NULL DEFAULT false,
  metadata   jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for common access patterns
CREATE INDEX IF NOT EXISTS admin_notifs_created_idx
  ON admin_notifications (created_at DESC);

CREATE INDEX IF NOT EXISTS admin_notifs_unread_idx
  ON admin_notifications (is_read)
  WHERE is_read = false;

-- ─── Row Level Security ───────────────────────────────────────────────────────

ALTER TABLE admin_notifications ENABLE ROW LEVEL SECURITY;

-- Only admins can read
CREATE POLICY "admin_notifs_select"
  ON admin_notifications
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.is_admin = true
    )
  );

-- Only admins can mark as read (UPDATE)
CREATE POLICY "admin_notifs_update"
  ON admin_notifications
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.is_admin = true
    )
  );

-- ─── Trigger: New user signed up ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION notify_admin_new_user()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  INSERT INTO admin_notifications (type, title, message, metadata)
  VALUES (
    'new_user',
    'مستخدم جديد انضم للمنصة',
    COALESCE(NEW.display_name, 'مستخدم مجهول') || ' سجّل حساباً جديداً',
    jsonb_build_object(
      'user_id',      NEW.id,
      'display_name', NEW.display_name,
      'created_at',   NEW.created_at
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_notify_new_user ON profiles;
CREATE TRIGGER trg_admin_notify_new_user
  AFTER INSERT ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION notify_admin_new_user();

-- ─── Trigger: New auction published ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION notify_admin_new_auction()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  INSERT INTO admin_notifications (type, title, message, metadata)
  VALUES (
    'new_auction',
    'مزاد جديد تم نشره',
    'تم نشر مزاد: "' || NEW.title || '"',
    jsonb_build_object(
      'auction_id', NEW.id,
      'seller_id',  NEW.seller_id,
      'title',      NEW.title,
      'category',   NEW.category
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_notify_new_auction ON auctions;
CREATE TRIGGER trg_admin_notify_new_auction
  AFTER INSERT ON auctions
  FOR EACH ROW
  EXECUTE FUNCTION notify_admin_new_auction();

-- ─── Trigger: New report submitted ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION notify_admin_new_report()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  INSERT INTO admin_notifications (type, title, message, metadata)
  VALUES (
    'new_report',
    'بلاغ جديد يحتاج مراجعة',
    'تم تقديم بلاغ جديد — السبب: ' || NEW.reason,
    jsonb_build_object(
      'report_id',  NEW.id,
      'auction_id', NEW.auction_id,
      'reason',     NEW.reason,
      'details',    NEW.details
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_notify_new_report ON reports;
CREATE TRIGGER trg_admin_notify_new_report
  AFTER INSERT ON reports
  FOR EACH ROW
  EXECUTE FUNCTION notify_admin_new_report();
