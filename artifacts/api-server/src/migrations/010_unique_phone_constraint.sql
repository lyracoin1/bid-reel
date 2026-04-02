-- Migration 010: Enforce UNIQUE constraint on profiles.phone
-- Ensures one account per phone number at the database level.
-- Run this AFTER removing any duplicate phone entries.

-- Safety: remove any remaining duplicates (keep oldest per phone)
DELETE FROM profiles
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY phone ORDER BY created_at ASC) AS rn
    FROM profiles
    WHERE phone IS NOT NULL
  ) ranked
  WHERE rn > 1
);

-- Add the UNIQUE constraint (idempotent via IF NOT EXISTS workaround)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name = 'profiles'
      AND constraint_type = 'UNIQUE'
      AND constraint_name = 'profiles_phone_unique'
  ) THEN
    ALTER TABLE profiles ADD CONSTRAINT profiles_phone_unique UNIQUE (phone);
  END IF;
END $$;
