-- =====================================================================
--  Email Campaign Tracker - Schema v2.2
--  Target: gdmztlzpsobyjousvvyp.supabase.co  (NEW project)
--  Run in: Supabase Dashboard -> SQL Editor -> New query
-- =====================================================================
--
--  DESIGN v2.2:
--
--  contacts  (master contact list, one row per person)
--    - email (PK)
--    - name, company, designation, phone, city, sector
--    - optin_status (Subscribed / Hard Bounced / Unsubscribed)
--    - mailer_id   (FK -> mailers.mailer_id, nullable)
--    - opens, clicks (int, manual)
--    - tags        (text[], manual - categorize contacts)
--    - last_activity_date, engagement_score (auto)
--
--  mailers  (campaign library)
--    - mailer_id (PK), subject_line, template_name, sent_date
--    - total_sent, unique_opens, total_opens, unique_clicks, total_clicks (auto)
--    - unsubscribed_count  (auto: optin_status='Unsubscribed')
--    - hardbounced_count   (auto: optin_status='Hard Bounced')  [NEW in v2.2]
--    - open_rate, click_rate, unsubscribe_rate, hardbounce_rate (GENERATED)
--
--  Auto-rollup: AFTER INSERT/UPDATE/DELETE on contacts, recompute affected mailer(s).
--
--  v2.2 changes from v2.1:
--    - contacts: + tags text[] column (for categorization)
--    - mailers: + hardbounced_count (auto, from optin_status='Hard Bounced')
--    - mailers: + hardbounce_rate (GENERATED ALWAYS column)
--
--  Safe to re-run: each block uses DROP IF EXISTS / CREATE IF NOT EXISTS.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. Extensions
-- ---------------------------------------------------------------------
create extension if not exists "pgcrypto";
-- pg_trgm for fuzzy matching on tags (optional, used by /api/tags)
create extension if not exists "pg_trgm";


-- ---------------------------------------------------------------------
-- 1. Drop old objects (clean slate)
-- ---------------------------------------------------------------------
drop trigger if exists trg_contacts_rollup   on public.contacts;
drop trigger if exists trg_contacts_after    on public.contacts;
drop trigger if exists trg_mailers_touch     on public.mailers;
drop function if exists public.recompute_mailer_counters(text);
drop function if exists public.contacts_rollup_trigger();
drop function if exists public.contacts_before_trigger();
drop function if exists public.contacts_after_trigger();
drop function if exists public.touch_updated_at();

drop table if exists public.email_journey cascade;
drop table if exists public.contacts      cascade;
drop table if exists public.mailers       cascade;


-- ---------------------------------------------------------------------
-- 2. mailers  (created first because contacts references it)
-- ---------------------------------------------------------------------
create table public.mailers (
    mailer_id           text        primary key,
    subject_line        text        not null,
    template_name       text,
    sent_date           timestamptz,
    -- auto-maintained counters:
    total_sent          integer     default 0,
    unique_opens        integer     default 0,
    total_opens         integer     default 0,
    unique_clicks       integer     default 0,
    total_clicks        integer     default 0,
    unsubscribed_count  integer     default 0,
    hardbounced_count   integer     default 0,                       -- NEW v2.2
    -- generated percentage columns:
    open_rate           numeric(5,2) generated always as
                            (case when total_sent > 0
                                  then round((unique_opens::numeric  / total_sent) * 100, 2)
                                  else 0 end) stored,
    click_rate          numeric(5,2) generated always as
                            (case when total_sent > 0
                                  then round((unique_clicks::numeric / total_sent) * 100, 2)
                                  else 0 end) stored,
    unsubscribe_rate    numeric(5,2) generated always as
                            (case when total_sent > 0
                                  then round((unsubscribed_count::numeric / total_sent) * 100, 2)
                                  else 0 end) stored,
    hardbounce_rate     numeric(5,2) generated always as             -- NEW v2.2
                            (case when total_sent > 0
                                  then round((hardbounced_count::numeric / total_sent) * 100, 2)
                                  else 0 end) stored,
    created_at          timestamptz default now(),
    updated_at          timestamptz default now()
);

comment on table  public.mailers is 'Campaign library. All counters are auto-maintained by a trigger on contacts.';
comment on column public.mailers.unsubscribed_count is 'Auto: count of contacts with this mailer_id AND optin_status = Unsubscribed.';
comment on column public.mailers.hardbounced_count  is 'Auto: count of contacts with this mailer_id AND optin_status = Hard Bounced.';
comment on column public.mailers.hardbounce_rate    is 'GENERATED: hardbounced_count / total_sent * 100.';

create index if not exists mailers_sent_date_idx   on public.mailers (sent_date desc);
create index if not exists mailers_open_rate_idx    on public.mailers (open_rate desc);


-- ---------------------------------------------------------------------
-- 3. contacts  (master contact list)
-- ---------------------------------------------------------------------
create table public.contacts (
    email              text        primary key,
    name               text,
    company            text,
    designation        text,
    phone              text,
    city               text,
    sector             text,
    optin_status       text        default 'Subscribed',  -- Subscribed / Hard Bounced / Unsubscribed
    mailer_id          text        references public.mailers (mailer_id) on delete set null,
    opens              integer     default 0,
    clicks             integer     default 0,
    tags               text[]      default '{}',           -- NEW v2.2: categorize contacts
    last_activity_date timestamptz,
    engagement_score   text        default 'COLD',
    created_at         timestamptz default now(),
    updated_at         timestamptz default now()
);

comment on column public.contacts.tags is 'Free-form tags (text array) for categorizing contacts. e.g. {vip, mumbai, contractor}';

create index if not exists contacts_company_idx       on public.contacts (company);
create index if not exists contacts_name_idx         on public.contacts (name);
create index if not exists contacts_mailer_id_idx     on public.contacts (mailer_id);
create index if not exists contacts_engagement_idx    on public.contacts (engagement_score);
create index if not exists contacts_optin_idx        on public.contacts (optin_status);
-- GIN index for fast tag search
create index if not exists contacts_tags_gin_idx     on public.contacts using gin (tags);


-- ---------------------------------------------------------------------
-- 4. Auto-rollup function + triggers
-- ---------------------------------------------------------------------
create or replace function public.recompute_mailer_counters(p_mailer_id text)
returns void
language plpgsql
as $$
begin
    if p_mailer_id is null then
        return;
    end if;

    update public.mailers m
    set
        total_sent         = (select count(*)           from public.contacts c where c.mailer_id = m.mailer_id),
        unique_opens       = (select count(*)           from public.contacts c where c.mailer_id = m.mailer_id and c.opens   > 0),
        total_opens        = (select coalesce(sum(c.opens),  0) from public.contacts c where c.mailer_id = m.mailer_id),
        unique_clicks      = (select count(*)           from public.contacts c where c.mailer_id = m.mailer_id and c.clicks  > 0),
        total_clicks       = (select coalesce(sum(c.clicks), 0) from public.contacts c where c.mailer_id = m.mailer_id),
        unsubscribed_count = (select count(*)           from public.contacts c where c.mailer_id = m.mailer_id and c.optin_status = 'Unsubscribed'),
        hardbounced_count  = (select count(*)           from public.contacts c where c.mailer_id = m.mailer_id and c.optin_status = 'Hard Bounced'),
        updated_at         = now()
    where m.mailer_id = p_mailer_id;
end;
$$;

create or replace function public.contacts_before_trigger()
returns trigger
language plpgsql
as $$
begin
    -- Only set auto-maintained fields on INSERT/UPDATE.
    -- For DELETE, do nothing here — the AFTER trigger handles recompute.
    -- CRITICAL: For DELETE, we must return OLD (not NEW which is NULL).
    -- Returning NULL from a BEFORE DELETE trigger CANCELS the delete!
    if tg_op = 'DELETE' then
        return old;
    end if;

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
        -- Normalize tags: trim + lowercase + dedupe + SORT
        -- Sorting ensures {vip, mumbai} and {mumbai, vip} are stored identically,
        -- so re-ordering tags in a CSV upload doesn't trigger a spurious "update".
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

-- NOTE: This trigger only fires on INSERT OR UPDATE (NOT DELETE).
-- The BEFORE trigger was previously firing on DELETE too, and since the
-- function returned NEW (which is NULL for DELETE), PostgreSQL silently
-- cancelled every DELETE. Now DELETE goes straight through without the
-- BEFORE trigger interfering. The AFTER trigger still fires for recompute.
drop trigger if exists trg_contacts_rollup on public.contacts;
create trigger trg_contacts_rollup
    before insert or update on public.contacts
    for each row execute function public.contacts_before_trigger();

-- Per-row AFTER INSERT/UPDATE/DELETE trigger: recompute the affected mailer(s).
-- (Must be AFTER so the new/updated/deleted row is visible to the recompute query.)
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


-- ---------------------------------------------------------------------
-- 5. updated_at auto-touch trigger on mailers
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists trg_mailers_touch on public.mailers;
create trigger trg_mailers_touch
    before update on public.mailers
    for each row execute function public.touch_updated_at();


-- ---------------------------------------------------------------------
-- 6. Row-Level Security
--    Disabled: the app uses the service_role key (bypasses RLS).
-- ---------------------------------------------------------------------
alter table public.contacts disable row level security;
alter table public.mailers  disable row level security;


-- ---------------------------------------------------------------------
-- 7. run_select_query RPC for the chat panel
-- ---------------------------------------------------------------------
drop function if exists public.run_select_query(text);
create or replace function public.run_select_query(query_text text)
returns json
language plpgsql
security definer
as $$
declare
    result json;
    normalised text := lower(trim(query_text));
begin
    if normalised !~ '^select' then
        raise exception 'Only SELECT queries are allowed';
    end if;
    execute 'select coalesce(json_agg(row_to_json(t)), ''[]''::json) from (' || query_text || ') t' into result;
    return result;
end;
$$;

comment on function public.run_select_query(text) is 'Server-side SQL SELECT runner used by the LangGraph chat agent. SECURITY DEFINER so it can read the tables. Only accepts statements starting with SELECT.';


-- ---------------------------------------------------------------------
-- 8. get_tag_counts RPC for the /api/tags endpoint
--    Returns distinct tags across all contacts with usage counts.
-- ---------------------------------------------------------------------
drop function if exists public.get_tag_counts();
create or replace function public.get_tag_counts()
returns table(tag text, count bigint)
language sql
security definer
as $$
    select t.tag, count(*)::bigint
    from public.contacts c,
         unnest(c.tags) as t(tag)
    where c.tags is not null and array_length(c.tags, 1) > 0
    group by t.tag
    order by count desc, t.tag asc;
$$;

comment on function public.get_tag_counts() is 'Returns all distinct tags used across contacts with their usage counts. Used by the /api/tags endpoint for smart suggestions in the TagsInput component.';


-- ---------------------------------------------------------------------
-- 9. Drop conversation_history table (chat is now stateless)
--    Chat history is NOT persisted to Supabase. The conversation state
--    lives only in the browser (ChatPanel component's React state).
--    This keeps Supabase disk usage to the minimum (only contacts + mailers).
-- ---------------------------------------------------------------------
drop table if exists public.conversation_history cascade;


-- ---------------------------------------------------------------------
-- 10. Cleanup RPC — called daily by the pg_cron schedule (section 11)
--     or by the Supabase Edge Function (supabase/functions/cleanup).
--     Deletes any stale log/temp data and updates table statistics.
--     NEVER touches live data (contacts, mailers).
-- ---------------------------------------------------------------------
create or replace function public.cleanup_old_data()
returns json
language plpgsql
security definer
as $$
declare
    result json;
    deleted_history bigint := 0;
begin
    -- 1. Drop conversation_history if it somehow got recreated
    drop table if exists public.conversation_history cascade;
    deleted_history := 1;

    -- 2. Update planner statistics so queries stay fast
    analyze public.contacts;
    analyze public.mailers;

    -- 3. Return a summary
    result := json_build_object(
        'ok', true,
        'timestamp', now(),
        'deleted_conversation_history', deleted_history,
        'contacts_count', (select count(*) from public.contacts),
        'mailers_count', (select count(*) from public.mailers)
    );

    return result;
end;
$$;

comment on function public.cleanup_old_data() is 'Daily cleanup: drops any stale log tables, updates table statistics. Called by pg_cron or the Edge Function. Never touches live contacts/mailers data.';


-- ---------------------------------------------------------------------
-- 11. pg_cron — schedule daily cleanup at 3 AM UTC
--     Requires the pg_cron extension (enable in Supabase Dashboard →
--     Database → Extensions → enable pg_cron).
--
--     After enabling pg_cron, run:
--       select cron.schedule('daily-cleanup', '0 3 * * *', 'select public.cleanup_old_data()');
--     To unschedule:
--       select cron.unschedule('daily-cleanup');
-- ---------------------------------------------------------------------
-- Note: pg_cron extension must be enabled first. The SQL below is
-- commented out so the migration doesn't fail if pg_cron isn't enabled yet.
-- Uncomment after enabling the extension in the Supabase dashboard.

-- select cron.schedule('daily-cleanup', '0 3 * * *', 'select public.cleanup_old_data()');
