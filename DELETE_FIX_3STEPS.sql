-- ============================================================
--  FIXED SQL — no array_agg with DISTINCT + ORDER BY (which the
--  Supabase SQL Editor was choking on at "ORDER").
--
--  Run each statement ONE AT A TIME in Supabase SQL Editor.
--  Copy statement → paste → Run → verify "Success" → next statement.
-- ============================================================


-- STATEMENT 1: Drop the broken trigger
DROP TRIGGER IF EXISTS trg_contacts_rollup ON public.contacts;


-- STATEMENT 2: Replace the function body with the fixed version
-- (uses a subquery to sort tags instead of array_agg(DISTINCT ... ORDER BY ...))
CREATE OR REPLACE FUNCTION public.contacts_before_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    cleaned_tags text[];
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

    -- Normalize tags: lowercase, trim, dedupe, sort
    IF new.tags IS NULL THEN
        new.tags := '{}';
    ELSIF array_length(new.tags, 1) > 0 THEN
        SELECT array_agg(tag ORDER BY tag)
        INTO cleaned_tags
        FROM (
            SELECT DISTINCT lower(trim(t)) AS tag
            FROM unnest(new.tags) AS t
            WHERE trim(t) <> ''
        ) AS s;
        new.tags := coalesce(cleaned_tags, '{}');
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
SELECT tgname, pg_get_triggerdef(oid) AS def
FROM pg_trigger
WHERE tgrelid = 'public.contacts'::regclass AND NOT tgisinternal
ORDER BY tgname;
