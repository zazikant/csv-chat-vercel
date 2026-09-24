-- ============================================================================
-- FIX: Re-backfill created_date from created_at (the real insertion timestamp)
-- ----------------------------------------------------------------------------
-- PROBLEM:
--   The original ADD_CREATED_DATE.sql migration backfilled ALL existing rows
--   with created_date = CURRENT_DATE. This means 268 rows all show today's
--   date, so the chatbot's "show latest record created today" query returns
--   a random row (whichever happens to come first alphabetically) instead of
--   the one row that was genuinely added today.
--
-- FIX:
--   We have a real `created_at` timestamp column (auto-managed by Supabase).
--   Use it to populate `created_date` properly. After this runs:
--     - zazikant@gmail.com (added 2026-09-24 04:44 UTC) → created_date = 2026-09-24
--     - All other rows (added 2026-09-23)               → created_date = 2026-09-23
--   Now "show latest created today" correctly returns zazikant@gmail.com.
--
-- Run this in Supabase → SQL Editor.
-- ============================================================================

UPDATE public.main_contacts
   SET created_date = created_at::date
 WHERE created_at IS NOT NULL;

-- Optional: verify — should show only 1 row (zazikant@gmail.com) for today.
-- SELECT email, created_at, created_date
--   FROM public.main_contacts
--  WHERE created_date = CURRENT_DATE
--  ORDER BY created_at DESC;
