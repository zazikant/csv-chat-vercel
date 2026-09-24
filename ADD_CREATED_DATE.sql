-- ============================================================================
-- Add `created_date` column to main_contacts
-- ----------------------------------------------------------------------------
-- This column stores the date (YYYY-MM-DD) on which a contact row was first
-- added to the database. It is auto-set on INSERT and never updated afterwards.
--
-- Behaviour:
--   * New rows inserted via the "Add" UI  -> API sets created_date = today
--   * New rows inserted via CSV bulk upload -> DB DEFAULT CURRENT_DATE kicks in
--   * Existing rows updated via PUT/POST-merge -> created_date is NOT touched
--   * Pre-existing rows (added before this migration) -> backfilled to today
--
-- After running this, the column shows up automatically in the Main Database
-- table UI (rightmost column "Created Date") and in CSV exports.
-- ============================================================================

-- 1. Add the column with a sensible default.
ALTER TABLE public.main_contacts
  ADD COLUMN IF NOT EXISTS created_date date DEFAULT CURRENT_DATE;

-- 2. Backfill NULLs for rows that existed before this migration.
--    (We use CURRENT_DATE instead of created_at because created_at, if present,
--    may carry a timezone-aware timestamp that doesn't cleanly cast to a date
--    in all PG versions; CURRENT_DATE is unambiguous.)
UPDATE public.main_contacts
   SET created_date = CURRENT_DATE
 WHERE created_date IS NULL;

-- 3. (Optional) Verify.
-- SELECT email, created_date FROM public.main_contacts ORDER BY created_date DESC NULLS LAST LIMIT 10;
