-- =============================================================================
-- BidReel — Migration 019: Email-First Auth + Admin User Setup
-- =============================================================================
-- Run in Supabase SQL editor (idempotent — safe to re-run).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Add email column to profiles (already in base schema comment, ensure it exists)
-- ---------------------------------------------------------------------------
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS email TEXT;

-- ---------------------------------------------------------------------------
-- 2. Backfill email from auth.users for any existing profile rows
-- ---------------------------------------------------------------------------
UPDATE profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id
  AND p.email IS NULL
  AND u.email IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Trigger: auto-create a profile row whenever a new Supabase Auth user signs up
--    This eliminates the need for the API to call upsertProfile on first login.
--    phone, username, display_name are left NULL — filled during profile completion.
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
    SET email = EXCLUDED.email;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- 4. Upsert admin profile for lyracoin950@gmail.com
--    The auth.users row must already exist (created via Supabase dashboard or signUp).
--    Sets is_admin = true and is_completed = true so admin can bypass profile setup.
-- ---------------------------------------------------------------------------
INSERT INTO public.profiles (id, email, is_admin, is_completed)
SELECT
  u.id,
  u.email,
  true,
  true
FROM auth.users u
WHERE u.email = 'lyracoin950@gmail.com'
ON CONFLICT (id) DO UPDATE
  SET
    is_admin    = true,
    is_completed = true,
    email       = EXCLUDED.email;

-- ---------------------------------------------------------------------------
-- 5. Update is_completed trigger so that setting username still marks profile done.
--    (Phone is collected as profile data but is NOT required for is_completed.)
--    The existing trigger (migration 017) already handles username → is_completed.
--    No change needed here.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Verification queries (uncomment to check):
-- ---------------------------------------------------------------------------
-- SELECT id, email, is_admin, is_completed FROM profiles WHERE email = 'lyracoin950@gmail.com';
-- SELECT COUNT(*) FROM profiles WHERE email IS NOT NULL;
-- SELECT trigger_name FROM information_schema.triggers WHERE event_object_table = 'users';
