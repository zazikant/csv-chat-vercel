-- =============================================================================
--  APPLY THIS IN SQL EDITOR — copy-paste the WHOLE thing, then click Run.
--
--  After running, run this to verify:
--    SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger
--    WHERE tgrelid = 'public.contacts'::regclass AND NOT tgisinternal;
--
--  You should see:
--    trg_contacts_rollup BEFORE INSERT OR UPDATE ON public.contacts  (NO DELETE!)
--    trg_contacts_after  AFTER INSERT OR DELETE OR UPDATE ON public.contacts
-- =============================================================================

-- Step 1: Drop the broken trigger
DROP TRIGGER IF EXISTS trg_contacts_rollup ON public.contacts;

-- Step 2: Replace the function body
-- CRITICAL CHANGE: For DELETE, return OLD (not NEW which is NULL → cancels delete)
CREATE OR REPLACE FUNCTION public.contacts_before_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    -- For DELETE: return OLD so the delete proceeds
    IF tg_op = 'DELETE' THEN
        RETURN old;
    END IF;

    -- For INSERT/UPDATE: set auto-maintained fields + normalize tags
    new.last_activity_date := CASE
        WHEN new.opens > 0 OR new.clicks > 0 THEN coalesce(new.last_activity_date, now())
        ELSE null
    END;
    new.engagement_score := CASE
        WHEN new.clicks > 0 THEN 'HOT'
        WHEN new.opens  > 0 THEN 'WARM'
        ELSE 'COLD'
    END;
    new.updated_at := now();
    -- Normalize tags: lowercase + dedupe + SORT
    IF new.tags IS NULL THEN
        new.tags := '{}';
    ELSIF array_length(new.tags, 1) > 0 THEN
        SELECT coalesce(array_agg(DISTINCT lower(trim(t))) ORDER BY lower(trim(t)), '{}')
        INTO new.tags
        FROM unnest(new.tags) AS t
        WHERE trim(t) <> '';
    ELSE
        new.tags := '{}';
    END IF;
    RETURN new;
END;
$$;

-- Step 3: Recreate trigger WITHOUT DELETE — only INSERT + UPDATE
CREATE TRIGGER trg_contacts_rollup
    BEFORE INSERT OR UPDATE ON public.contacts
    FOR EACH ROW EXECUTE FUNCTION public.contacts_before_trigger();

-- Step 4: Verify (run this separately after the steps above)
-- SELECT tgname, pg_get_triggerdef(oid) as def
-- FROM pg_trigger
-- WHERE tgrelid = 'public.contacts'::regclass AND NOT tgisinternal
-- ORDER BY tgname;
