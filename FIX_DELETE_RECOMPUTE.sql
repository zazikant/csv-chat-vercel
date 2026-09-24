-- =============================================================================
--  FIX: AFTER trigger doesn't recompute mailer counters on DELETE
--
--  Bug: the condition `v_old_mailer <> v_new_mailer` evaluates to NULL when
--  v_new_mailer is NULL (which it always is during DELETE). So the recompute
--  is silently skipped on every DELETE, leaving mailer counters stale.
--
--  Fix: change the condition to handle NULL explicitly:
--    `v_new_mailer is null or v_old_mailer <> v_new_mailer`
--
--  Run each statement ONE AT A TIME in Supabase SQL Editor.
-- =============================================================================


-- STATEMENT 1: Replace the AFTER trigger function with the fixed version
CREATE OR REPLACE FUNCTION public.contacts_after_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_old_mailer text;
    v_new_mailer text;
BEGIN
    v_old_mailer := CASE WHEN tg_op = 'DELETE' OR tg_op = 'UPDATE' THEN old.mailer_id ELSE null END;
    v_new_mailer := CASE WHEN tg_op = 'INSERT' OR tg_op = 'UPDATE' THEN new.mailer_id ELSE null END;

    -- Recompute OLD mailer if it exists AND (new is null [DELETE case] OR different [UPDATE with mailer change])
    IF v_old_mailer IS NOT NULL AND (v_new_mailer IS NULL OR v_old_mailer <> v_new_mailer) THEN
        PERFORM public.recompute_mailer_counters(v_old_mailer);
    END IF;
    -- Recompute NEW mailer if it exists (INSERT or UPDATE)
    IF v_new_mailer IS NOT NULL THEN
        PERFORM public.recompute_mailer_counters(v_new_mailer);
    END IF;

    IF tg_op = 'DELETE' THEN
        RETURN old;
    END IF;
    RETURN new;
END;
$$;


-- STATEMENT 2: Force-recompute all mailers now (fixes existing stale data)
-- This loops through every mailer and calls recompute_mailer_counters on it.
DO $$
DECLARE
    m RECORD;
BEGIN
    FOR m IN SELECT mailer_id FROM public.mailers LOOP
        PERFORM public.recompute_mailer_counters(m.mailer_id);
    END LOOP;
END;
$$;


-- STATEMENT 3 (verification): Check M001 counters are now correct
SELECT mailer_id, total_sent, unique_opens, total_opens, unique_clicks, total_clicks,
       unsubscribed_count, hardbounced_count, open_rate, click_rate, hardbounce_rate
FROM public.mailers
WHERE mailer_id = 'M001';
