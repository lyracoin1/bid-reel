-- ---------------------------------------------------------------------------
-- Migration 023: Profile completeness gate — location field + updated trigger
-- ---------------------------------------------------------------------------
--
-- Context:
--   The profile completeness definition has been expanded. A user account is
--   only considered "complete" (is_completed = true) when ALL of the following
--   fields are present:
--
--     1. username      — unique handle (added in 016_add_username.sql)
--     2. display_name  — public name
--     3. phone         — E.164 WhatsApp number (profile/contact field, not auth)
--     4. avatar_url    — profile photo
--     5. location      — [ADDED HERE] city/region, nullable TEXT
--                        Required for completeness once this migration is live.
--
--   NOTE: location will be enforced in the backend isProfileComplete() helper
--   (artifacts/api-server/src/lib/profiles.ts) once this migration has been
--   applied to production. The TODO(migration-023) comment in that file marks
--   the exact line to uncomment.
--
-- Changes in this file:
--   1. Add `location` column (nullable TEXT) to the profiles table.
--   2. Replace the existing trg_set_profile_completed trigger with an updated
--      version that sets is_completed = true only when all 5 required fields
--      are present.
--   3. Backfill: re-evaluate is_completed for all existing rows.
-- ---------------------------------------------------------------------------

-- 1. Add location column (idempotent)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS location TEXT;

-- 2. Update the completeness trigger function
-- (The old function only checked username IS NOT NULL.)
CREATE OR REPLACE FUNCTION set_profile_completed()
RETURNS TRIGGER AS $$
BEGIN
  NEW.is_completed := (
    NEW.username     IS NOT NULL AND
    NEW.display_name IS NOT NULL AND
    NEW.phone        IS NOT NULL AND
    NEW.avatar_url   IS NOT NULL AND
    NEW.location     IS NOT NULL
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger already exists from migration 017; CREATE OR REPLACE on the function
-- is sufficient — the trigger itself still fires on INSERT/UPDATE.
-- If the trigger was dropped manually, re-create it:
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_set_profile_completed'
      AND tgrelid = 'profiles'::regclass
  ) THEN
    CREATE TRIGGER trg_set_profile_completed
      BEFORE INSERT OR UPDATE ON profiles
      FOR EACH ROW EXECUTE FUNCTION set_profile_completed();
  END IF;
END
$$;

-- 3. Backfill: re-evaluate is_completed for every existing profile row.
--    Users who were previously marked complete with only username set will now
--    be marked incomplete until they complete all fields via the onboarding UI.
UPDATE profiles SET
  is_completed = (
    username     IS NOT NULL AND
    display_name IS NOT NULL AND
    phone        IS NOT NULL AND
    avatar_url   IS NOT NULL AND
    location     IS NOT NULL
  );

-- ---------------------------------------------------------------------------
-- After applying this migration:
--   1. Uncomment `&& row.location !== null` in profiles.ts isProfileComplete()
--      (search for TODO(migration-023)).
--   2. Uncomment `missingFields.push("location")` in api/admin/users.ts
--      (search for TODO(migration-023)).
--   3. Deploy both api-server and bidreel-web.
-- ---------------------------------------------------------------------------
