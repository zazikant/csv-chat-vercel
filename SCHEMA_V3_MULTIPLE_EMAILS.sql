-- =============================================================================
--  SCHEMA v3: Multiple rows per email (email no longer the PK)
--
--  Run in Supabase SQL Editor. This changes the contacts table from
--  email-as-PK to id-as-PK, allowing the same email to appear multiple times
--  (one row per mailer).
--
--  Safe to run — preserves all existing data.
-- =============================================================================

-- Step 1: Add an auto-incrementing id column (if it doesn't exist)
-- This becomes the new primary key.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'contacts' AND column_name = 'id'
    ) THEN
        ALTER TABLE public.contacts ADD COLUMN id bigserial;
    END IF;
END;
$$;

-- Step 2: Drop the old email-as-primary-key constraint
-- (The constraint is named contacts_pkey)
ALTER TABLE public.contacts DROP CONSTRAINT IF EXISTS contacts_pkey;

-- Step 3: Set id as the new primary key
ALTER TABLE public.contacts DROP CONSTRAINT IF EXISTS contacts_id_pkey;
ALTER TABLE public.contacts ADD CONSTRAINT contacts_pkey PRIMARY KEY (id);

-- Step 4: Make email NOT NULL (it's required, just not unique)
ALTER TABLE public.contacts ALTER COLUMN email SET NOT NULL;

-- Step 5: Add a UNIQUE constraint on (email, mailer_id) to prevent exact duplicates
-- This allows the same email to appear multiple times (one per mailer), but
-- prevents two rows with the same (email, mailer_id).
-- (NULL mailer_id values are treated as distinct by PostgreSQL, so unassigned
-- contacts can have multiple rows too — that's fine.)
ALTER TABLE public.contacts DROP CONSTRAINT IF EXISTS contacts_email_mailer_unique;
ALTER TABLE public.contacts ADD CONSTRAINT contacts_email_mailer_unique UNIQUE (email, mailer_id);

-- Step 6: Add an index on email for fast lookups (since it's no longer the PK)
CREATE INDEX IF NOT EXISTS contacts_email_idx ON public.contacts (email);

-- Step 7: Verify the new schema
-- Run this to confirm:
-- SELECT column_name, data_type, is_nullable FROM information_schema.columns
-- WHERE table_name = 'contacts' AND table_schema = 'public'
-- ORDER BY ordinal_position;
--
-- Expected: id should be bigint, NOT NULL. email should be text, NOT NULL.
-- And the PK should be on id, not email.
