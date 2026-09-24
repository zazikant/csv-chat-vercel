-- =============================================================================
--  MINIMAL DELETE FIX — run this in Supabase SQL Editor to fix DELETE now.
--  Safe: only drops + recreates 2 triggers + 2 functions. No data changes.
-- =============================================================================

-- 1. Drop the broken BEFORE trigger (currently fires on DELETE, returns NULL, cancels delete)
drop trigger if exists trg_contacts_rollup on public.contacts;

-- 2. Replace the function body with the fixed version:
--    - For DELETE: returns OLD (so the delete proceeds)
--    - For INSERT/UPDATE: sets auto-maintained fields + normalizes tags
create or replace function public.contacts_before_trigger()
returns trigger
language plpgsql
as $$
begin
    -- CRITICAL: For DELETE, return OLD. Returning NULL cancels the delete!
    if tg_op = 'DELETE' then
        return old;
    end if;

    -- For INSERT/UPDATE: set auto-maintained fields
    new.last_activity_date := case
        when new.opens > 0 or new.clicks > 0 then coalesce(new.last_activity_date, now())
        else null
    end;
    new.engagement_score := case
        when new.clicks > 0 then 'HOT'
        when new.opens  > 0 then 'WARM'
        else 'COLD'
    end;
    new.updated_at := now();
    -- Normalize tags: lowercase + dedupe + SORT
    if new.tags is null then
        new.tags := '{}';
    elsif array_length(new.tags, 1) > 0 then
        select coalesce(array_agg(distinct lower(trim(t))) order by lower(trim(t)), '{}')
        into new.tags
        from unnest(new.tags) as t
        where trim(t) <> '';
    else
        new.tags := '{}';
    end if;
    return new;
end;
$$;

-- 3. Re-create the BEFORE trigger: INSERT + UPDATE only (NOT DELETE)
--    (DELETE doesn't need BEFORE trigger — let it pass through untouched)
create trigger trg_contacts_rollup
    before insert or update on public.contacts
    for each row execute function public.contacts_before_trigger();

-- 4. Make sure the AFTER trigger exists (fires on DELETE to recompute mailer counters)
create or replace function public.contacts_after_trigger()
returns trigger
language plpgsql
as $$
declare
    v_old_mailer text;
    v_new_mailer text;
begin
    v_old_mailer := case when tg_op = 'DELETE' or tg_op = 'UPDATE' then old.mailer_id else null end;
    v_new_mailer := case when tg_op = 'INSERT' or tg_op = 'UPDATE' then new.mailer_id else null end;

    if v_old_mailer is not null and v_old_mailer <> v_new_mailer then
        perform public.recompute_mailer_counters(v_old_mailer);
    end if;
    if v_new_mailer is not null then
        perform public.recompute_mailer_counters(v_new_mailer);
    end if;

    if tg_op = 'DELETE' then
        return old;
    end if;
    return new;
end;
$$;

drop trigger if exists trg_contacts_after on public.contacts;
create trigger trg_contacts_after
    after insert or update or delete on public.contacts
    for each row execute function public.contacts_after_trigger();

-- DONE. DELETE on contacts now works. Verify:
--   SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid = 'public.contacts'::regclass;
-- Expected:
--   trg_contacts_after  AFTER INSERT OR DELETE OR UPDATE  (correct — recompute on all ops)
--   trg_contacts_rollup BEFORE INSERT OR UPDATE            (correct — NO DELETE)
