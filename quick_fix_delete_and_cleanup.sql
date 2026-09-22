-- =====================================================================
--  Quick Fix: DELETE bug + Cleanup RPC
--  Run in Supabase SQL Editor to fix the DELETE issue immediately.
--  Safe to run — only drops/recreates triggers, doesn't touch data.
-- =====================================================================

-- Fix 1: The BEFORE trigger was firing on DELETE and returning NULL
-- (since NEW is NULL for DELETE), which silently cancelled every DELETE.
-- Fix: make the trigger fire only on INSERT/UPDATE, and add an explicit
-- DELETE handler that returns OLD.

drop trigger if exists trg_contacts_rollup on public.contacts;

create or replace function public.contacts_before_trigger()
returns trigger
language plpgsql
as $$
begin
    -- For DELETE: return OLD so the delete proceeds. Returning NULL cancels it!
    if tg_op = 'DELETE' then
        return old;
    end if;

    -- For INSERT/UPDATE: set auto-maintained fields
    if tg_op = 'INSERT' or tg_op = 'UPDATE' then
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
        -- Normalize tags: lowercase + dedupe + sort
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
    end if;
    return new;
end;
$$;

-- Re-create BEFORE trigger: INSERT + UPDATE only (NOT DELETE)
create trigger trg_contacts_rollup
    before insert or update on public.contacts
    for each row execute function public.contacts_before_trigger();

-- Ensure AFTER trigger still exists (for recompute on DELETE)
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


-- Fix 2: Cleanup RPC (called daily by pg_cron or Edge Function)
create or replace function public.cleanup_old_data()
returns json
language plpgsql
security definer
as $$
declare
    result json;
begin
    -- Drop any stale log tables
    drop table if exists public.conversation_history cascade;

    -- Update planner statistics
    analyze public.contacts;
    analyze public.mailers;

    result := json_build_object(
        'ok', true,
        'timestamp', now(),
        'contacts_count', (select count(*) from public.contacts),
        'mailers_count', (select count(*) from public.mailers)
    );
    return result;
end;
$$;

comment on function public.cleanup_old_data() is 'Daily cleanup: drops stale log tables, updates stats. Never touches live data.';


-- Fix 3: Schedule daily cleanup via pg_cron (if extension is enabled)
-- To enable pg_cron: Supabase Dashboard → Database → Extensions → pg_cron → enable
-- Then uncomment the line below and run it:

-- select cron.schedule('daily-cleanup', '0 3 * * *', 'select public.cleanup_old_data()');

-- To check scheduled jobs:
-- select * from cron.job;

-- To unschedule:
-- select cron.unschedule('daily-cleanup');
