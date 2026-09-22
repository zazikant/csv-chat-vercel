-- ============================================================
--  RUN EACH STATEMENT ONE AT A TIME IN SUPABASE SQL EDITOR
--  Copy-paste statement 1, click Run, verify it says "Success"
--  Then statement 2, then statement 3.
-- ============================================================

-- STATEMENT 1: Drop the broken trigger
DROP TRIGGER IF EXISTS trg_contacts_rollup ON public.contacts;


-- STATEMENT 2: Replace the function (with DELETE → return old fix)
CREATE OR REPLACE FUNCTION public.contacts_before_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF tg_op = 'DELETE' THEN
        RETURN old;
    END IF;
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


-- STATEMENT 3: Recreate the trigger WITHOUT DELETE
CREATE TRIGGER trg_contacts_rollup
    BEFORE INSERT OR UPDATE ON public.contacts
    FOR EACH ROW EXECUTE FUNCTION public.contacts_before_trigger();


-- STATEMENT 4 (verification): Run this and paste me the output
SELECT tgname, pg_get_triggerdef(oid) as def
FROM pg_trigger
WHERE tgrelid = 'public.contacts'::regclass AND NOT tgisinternal
ORDER BY tgname;
