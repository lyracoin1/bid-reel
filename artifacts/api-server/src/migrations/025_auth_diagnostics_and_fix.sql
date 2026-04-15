-- =============================================================================
-- BidReel — Migration 025: Auth + Profile Bootstrap Fix
-- =============================================================================
-- Purpose:
--   1. Diagnose the current state of auth users vs profiles (run the SELECT
--      queries first before applying changes).
--   2. Backfill profile rows for any auth users who slipped through without one.
--   3. Ensure the on_auth_user_created trigger fires on BOTH INSERT and UPDATE
--      so that email confirmation (which updates auth.users) also upserts the
--      profile row.
--   4. Confirm the profiles.email column exists (added in migration 019).
--
-- HOW TO USE:
--   Step 1 — Uncomment and run the DIAGNOSTIC queries to understand your state.
--   Step 2 — Run the FIX section below.
--   Step 3 — In the Supabase Dashboard go to:
--               Authentication → Settings → Email → "Confirm email"
--             and turn it OFF (unless you intend to keep confirmation flow).
-- =============================================================================


-- =============================================================================
-- DIAGNOSTIC QUERIES — uncomment and run first
-- =============================================================================

-- 1a. How many auth users have no matching profile row?
-- SELECT COUNT(*) AS users_without_profile
-- FROM auth.users u
-- LEFT JOIN profiles p ON p.id = u.id
-- WHERE p.id IS NULL;

-- 1b. List them (most recent first):
-- SELECT u.id, u.email, u.created_at, u.email_confirmed_at,
--        u.raw_app_meta_data->>'provider' AS provider
-- FROM auth.users u
-- LEFT JOIN profiles p ON p.id = u.id
-- WHERE p.id IS NULL
-- ORDER BY u.created_at DESC
-- LIMIT 50;

-- 2. Check how many new users are unconfirmed (email confirmation is ON):
-- SELECT COUNT(*) AS unconfirmed
-- FROM auth.users
-- WHERE email_confirmed_at IS NULL
--   AND raw_app_meta_data->>'provider' = 'email';

-- 3. Verify the signup trigger exists:
-- SELECT trigger_name, event_manipulation, action_timing
-- FROM information_schema.triggers
-- WHERE trigger_schema = 'public'
--    OR (event_object_schema = 'public' AND event_object_table = 'users');

-- 4. Confirm profiles.email column exists:
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name = 'profiles' AND column_name = 'email';

-- 5. Show profile completion stats:
-- SELECT
--   COUNT(*) AS total_profiles,
--   COUNT(username) AS have_username,
--   COUNT(*) FILTER (WHERE username IS NULL) AS no_username_yet,
--   COUNT(*) FILTER (WHERE is_completed) AS completed
-- FROM profiles;


-- =============================================================================
-- FIX SECTION
-- =============================================================================

-- ---------------------------------------------------------------------------
-- F1. Ensure profiles.email column exists (idempotent, migration 019 may not
--     have been applied on all environments).
-- ---------------------------------------------------------------------------
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS email TEXT;


-- ---------------------------------------------------------------------------
-- F2. Backfill profile rows for any auth.users that have no matching profile.
--     This catches users who signed up before the trigger was installed, or
--     users whose trigger INSERT failed silently.
-- ---------------------------------------------------------------------------
INSERT INTO profiles (id, email, is_completed)
SELECT
  u.id,
  u.email,
  false
FROM auth.users u
LEFT JOIN profiles p ON p.id = u.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;


-- ---------------------------------------------------------------------------
-- F3. Backfill email on profile rows that are missing it.
-- ---------------------------------------------------------------------------
UPDATE profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id
  AND p.email IS NULL
  AND u.email IS NOT NULL;


-- ---------------------------------------------------------------------------
-- F4. Re-create the auth signup trigger to also fire on UPDATE.
--     Supabase email confirmation does an UPDATE on auth.users to set
--     email_confirmed_at.  If the trigger only fires on INSERT, this UPDATE
--     is missed.  Firing on both ensures the profile row always exists after
--     confirmation too.
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
    SET email = EXCLUDED.email;  -- keep email in sync
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT OR UPDATE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_auth_user();


-- ---------------------------------------------------------------------------
-- F5. Re-evaluate is_completed for all profiles rows to match the current
--     completeness definition (all 5 fields required).
-- ---------------------------------------------------------------------------
UPDATE profiles
SET is_completed = (
  username     IS NOT NULL AND
  display_name IS NOT NULL AND
  phone        IS NOT NULL AND
  avatar_url   IS NOT NULL AND
  location     IS NOT NULL
);


-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_orphans   int;
  v_no_email  int;
  v_trigger   int;
BEGIN
  SELECT COUNT(*) INTO v_orphans
  FROM auth.users u
  LEFT JOIN profiles p ON p.id = u.id
  WHERE p.id IS NULL;

  SELECT COUNT(*) INTO v_no_email
  FROM profiles
  WHERE email IS NULL;

  SELECT COUNT(*) INTO v_trigger
  FROM information_schema.triggers
  WHERE trigger_name = 'on_auth_user_created';

  RAISE NOTICE '=== Migration 025 results ===';
  RAISE NOTICE 'auth.users with no profile row: %', v_orphans;
  RAISE NOTICE 'profiles with no email:         %', v_no_email;
  RAISE NOTICE 'on_auth_user_created trigger:   % instance(s)', v_trigger;

  IF v_orphans > 0 THEN
    RAISE WARNING 'Some auth users still have no profile row — investigate manually';
  ELSE
    RAISE NOTICE '✅ All auth users have a profile row';
  END IF;
END
$$;
