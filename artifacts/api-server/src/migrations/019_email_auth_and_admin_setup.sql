-- =============================================================================
-- BidReel — Migration 019: Email-First Auth + Admin User Setup
-- =============================================================================
-- Run AFTER migration 018 (admin_notifications).
-- Fully idempotent — safe to re-run.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. Add email column to profiles
--    Email is the new auth identity. It is populated from auth.users on signup
--    via the trigger in section 4 below, and backfilled for existing rows here.
-- ---------------------------------------------------------------------------
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS email TEXT;


-- ---------------------------------------------------------------------------
-- 2. Drop the UNIQUE constraint on profiles.phone
--    Phone was previously the auth identity (one account per number).
--    It is now a contact/WhatsApp field only — uniqueness is no longer enforced
--    at the DB level so households, family members, etc. are not blocked.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM   information_schema.table_constraints
    WHERE  table_name       = 'profiles'
      AND  constraint_name  = 'profiles_phone_unique'
      AND  constraint_type  = 'UNIQUE'
  ) THEN
    ALTER TABLE profiles DROP CONSTRAINT profiles_phone_unique;
    RAISE NOTICE 'Dropped UNIQUE constraint profiles_phone_unique';
  ELSE
    RAISE NOTICE 'Constraint profiles_phone_unique does not exist — skipping';
  END IF;
END
$$;

-- Drop the old phone index that only served the unique-auth lookup pattern.
-- A partial index for non-null phone rows is re-created below.
DROP INDEX IF EXISTS idx_profiles_phone;
CREATE INDEX IF NOT EXISTS idx_profiles_phone
  ON profiles (phone)
  WHERE phone IS NOT NULL;


-- ---------------------------------------------------------------------------
-- 3. Backfill email from auth.users for all existing profile rows
-- ---------------------------------------------------------------------------
UPDATE profiles p
SET    email = u.email
FROM   auth.users u
WHERE  p.id     = u.id
  AND  p.email  IS NULL
  AND  u.email  IS NOT NULL;


-- ---------------------------------------------------------------------------
-- 4. Add a UNIQUE index on profiles.email
--    One profile per auth account — the trigger below enforces this on INSERT
--    via ON CONFLICT (id), but an explicit index makes lookups fast and prevents
--    any edge-case duplicate from slipping through.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_unique
  ON profiles (email)
  WHERE email IS NOT NULL;


-- ---------------------------------------------------------------------------
-- 5. Trigger: auto-create a profile row whenever a new Supabase Auth user
--    signs up (email/password, magic-link, OAuth — any provider).
--    phone, username, display_name are left NULL — filled during onboarding.
--    The API's /auth/ensure-profile endpoint is a belt-and-suspenders fallback.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, is_completed)
  VALUES (NEW.id, NEW.email, false)
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email;   -- keep email in sync if it changes
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_auth_user();


-- ---------------------------------------------------------------------------
-- 6. Remove the old phone-based NOT NULL constraint (if it was ever set)
--    Phone is now optional at the DB level. It is required by the API /profile
--    completion step, but that is enforced in application code, not the DB.
-- ---------------------------------------------------------------------------
ALTER TABLE profiles
  ALTER COLUMN phone DROP NOT NULL;


-- ---------------------------------------------------------------------------
-- 7. Profile completion definition
--    is_completed is set to true by the trigger in migration 017 when username
--    is first set (BEFORE UPDATE). That trigger is unchanged — phone and
--    display_name being present is validated by the API, not the DB trigger.
--    No changes to migration 017 trigger needed.
--
--    Admin override: is_completed = true is set explicitly in section 8 for
--    the admin account so admin can skip the onboarding flow.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 8. Upsert admin profile for lyracoin950@gmail.com
--    The auth.users row must already exist (created via Supabase Auth dashboard
--    or the app's signup flow). If the user hasn't signed up yet, this INSERT
--    will silently no-op (no matching row in auth.users), and you can re-run
--    the migration after signup.
-- ---------------------------------------------------------------------------
INSERT INTO public.profiles (id, email, is_admin, is_completed)
SELECT
  u.id,
  u.email,
  true,   -- grant admin
  true    -- skip onboarding
FROM auth.users u
WHERE u.email = 'lyracoin950@gmail.com'
ON CONFLICT (id) DO UPDATE
  SET
    is_admin     = true,
    is_completed = true,
    email        = EXCLUDED.email;

-- Log outcome so you can see the result in the SQL editor output
DO $$
DECLARE
  v_count int;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM profiles
  WHERE email = 'lyracoin950@gmail.com'
    AND is_admin = true;

  IF v_count = 1 THEN
    RAISE NOTICE '✅ Admin account lyracoin950@gmail.com is promoted (is_admin = true, is_completed = true)';
  ELSE
    RAISE NOTICE '⚠️  Admin account NOT found — ensure lyracoin950@gmail.com has signed up in Supabase Auth first, then re-run this migration';
  END IF;
END
$$;


-- ---------------------------------------------------------------------------
-- Verification queries — uncomment and run separately to confirm results
-- ---------------------------------------------------------------------------
-- SELECT id, email, is_admin, is_completed, username, phone
-- FROM profiles
-- WHERE email = 'lyracoin950@gmail.com';
--
-- SELECT COUNT(*) AS total_profiles,
--        COUNT(email) AS with_email,
--        COUNT(*) FILTER (WHERE is_admin) AS admins
-- FROM profiles;
--
-- SELECT trigger_name, event_object_table, action_timing
-- FROM information_schema.triggers
-- WHERE event_object_schema = 'public'
--    OR (trigger_schema = 'public' AND event_object_table = 'users');
--
-- SELECT conname, contype
-- FROM pg_constraint
-- WHERE conrelid = 'profiles'::regclass;
