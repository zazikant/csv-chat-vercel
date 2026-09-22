-- =============================================================================
--  SCHEMA V4: Split contacts into 2 tables (Main Database + Contacts)
--
--  Design:
--    main_contacts (1 row per email) — identity data only:
--      email (PK), name, company, designation, phone, city, sector, tags
--
--    contacts (multiple rows per email) — engagement data only:
--      id (PK), email (FK -> main_contacts.email), mailer_id, opens, clicks,
--      optin_status, last_activity_date, engagement_score
--
--  This saves disk space: if you email the same person 100 times, their
--  name/company/designation/phone are stored ONCE in main_contacts, not 100
--  times in contacts.
--
--  Run in Supabase SQL Editor. Safe to re-run (DROP IF EXISTS).
-- =============================================================================


-- ---------------------------------------------------------------------
-- 0. Extensions
-- ---------------------------------------------------------------------
create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";


-- ---------------------------------------------------------------------
-- 1. Drop old objects
-- ---------------------------------------------------------------------
drop trigger if exists trg_contacts_rollup   on public.contacts;
drop trigger if exists trg_contacts_after    on public.contacts;
drop trigger if exists trg_mailers_touch     on public.mailers;
drop function if exists public.recompute_mailer_counters(text);
drop function if exists public.contacts_before_trigger();
drop function if exists public.contacts_after_trigger();
drop function if exists public.touch_updated_at();
drop function if exists public.cleanup_old_data();
drop function if exists public.get_tag_counts();
drop function if exists public.run_select_query(text);

drop table if exists public.email_journey cascade;
drop table if exists public.contacts      cascade;
drop table if exists public.mailers       cascade;
drop table if exists public.main_contacts cascade;
drop table if exists public.conversation_history cascade;


-- ---------------------------------------------------------------------
-- 2. mailers (campaign library)
-- ---------------------------------------------------------------------
create table public.mailers (
    mailer_id           text        primary key,
    subject_line        text        not null,
    template_name       text,
    sent_date           timestamptz,
    total_sent          integer     default 0,
    unique_opens        integer     default 0,
    total_opens         integer     default 0,
    unique_clicks       integer     default 0,
    total_clicks        integer     default 0,
    unsubscribed_count  integer     default 0,
    hardbounced_count   integer     default 0,
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
    hardbounce_rate     numeric(5,2) generated always as
                            (case when total_sent > 0
                                  then round((hardbounced_count::numeric / total_sent) * 100, 2)
                                  else 0 end) stored,
    created_at          timestamptz default now(),
    updated_at          timestamptz default now()
);

create index if not exists mailers_sent_date_idx   on public.mailers (sent_date desc);
create index if not exists mailers_open_rate_idx    on public.mailers (open_rate desc);


-- ---------------------------------------------------------------------
-- 3. main_contacts (1 row per email — identity data only)
-- ---------------------------------------------------------------------
create table public.main_contacts (
    email              text        primary key,
    name               text,
    company            text,
    designation        text,
    phone              text,
    city               text,
    sector             text,
    tags               text[]      default '{}',
    created_at         timestamptz default now(),
    updated_at         timestamptz default now()
);

comment on table  public.main_contacts is 'Master contact list. 1 row per email. Identity data only (name/company/designation/phone/city/sector/tags). Engagement data lives in contacts table.';
comment on column public.main_contacts.email is 'Primary key. Lowercase. The same email appears once here regardless of how many mailers they received.';

create index if not exists main_contacts_company_idx    on public.main_contacts (company);
create index if not exists main_contacts_name_idx       on public.main_contacts (name);
create index if not exists main_contacts_tags_gin_idx   on public.main_contacts using gin (tags);


-- ---------------------------------------------------------------------
-- 4. contacts (multiple rows per email — engagement data only)
-- ---------------------------------------------------------------------
create table public.contacts (
    id                 bigserial   primary key,
    email              text        not null references public.main_contacts (email) on delete cascade,
    mailer_id          text        references public.mailers (mailer_id) on delete set null,
    opens              integer     default 0,
    clicks             integer     default 0,
    optin_status       text        default 'Subscribed',
    last_activity_date timestamptz,
    engagement_score   text        default 'COLD',
    created_at         timestamptz default now(),
    updated_at         timestamptz default now(),
    constraint contacts_email_mailer_unique unique (email, mailer_id)
);

comment on table  public.contacts is 'Engagement data. Multiple rows per email (one per mailer). Identity fields (name/company/etc) are NOT stored here — they live in main_contacts to save disk space.';
comment on column public.contacts.email is 'FK to main_contacts.email. NOT unique — same email can appear multiple times (one per mailer).';
comment on column public.contacts.opens is 'How many times this contact opened the assigned mailer (manually entered).';
comment on column public.contacts.clicks is 'How many times this contact clicked links in the assigned mailer (manually entered).';
comment on column public.contacts.optin_status is 'Subscribed / Hard Bounced / Unsubscribed.';

create index if not exists contacts_email_idx         on public.contacts (email);
create index if not exists contacts_mailer_id_idx     on public.contacts (mailer_id);
create index if not exists contacts_engagement_idx    on public.contacts (engagement_score);
create index if not exists contacts_optin_idx        on public.contacts (optin_status);


-- ---------------------------------------------------------------------
-- 5. Triggers
-- ---------------------------------------------------------------------

-- Recompute mailer counters from contacts
create or replace function public.recompute_mailer_counters(p_mailer_id text)
returns void
language plpgsql
as $$
begin
    if p_mailer_id is null then return; end if;
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

-- BEFORE INSERT/UPDATE on contacts: set auto fields
create or replace function public.contacts_before_trigger()
returns trigger
language plpgsql
as $$
begin
    if tg_op = 'DELETE' then return old; end if;
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
    return new;
end;
$$;

drop trigger if exists trg_contacts_rollup on public.contacts;
create trigger trg_contacts_rollup
    before insert or update on public.contacts
    for each row execute function public.contacts_before_trigger();

-- AFTER INSERT/UPDATE/DELETE on contacts: recompute mailer
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
    if v_old_mailer is not null and (v_new_mailer is null or v_old_mailer <> v_new_mailer) then
        perform public.recompute_mailer_counters(v_old_mailer);
    end if;
    if v_new_mailer is not null then
        perform public.recompute_mailer_counters(v_new_mailer);
    end if;
    if tg_op = 'DELETE' then return old; end if;
    return new;
end;
$$;

drop trigger if exists trg_contacts_after on public.contacts;
create trigger trg_contacts_after
    after insert or update or delete on public.contacts
    for each row execute function public.contacts_after_trigger();

-- Mailers touch trigger
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin new.updated_at := now(); return new; end;
$$;

drop trigger if exists trg_mailers_touch on public.mailers;
create trigger trg_mailers_touch
    before update on public.mailers
    for each row execute function public.touch_updated_at();

-- Main contacts touch trigger
drop trigger if exists trg_main_contacts_touch on public.main_contacts;
create trigger trg_main_contacts_touch
    before update on public.main_contacts
    for each row execute function public.touch_updated_at();


-- ---------------------------------------------------------------------
-- 6. RLS disabled (service_role key bypasses)
-- ---------------------------------------------------------------------
alter table public.main_contacts disable row level security;
alter table public.contacts      disable row level security;
alter table public.mailers       disable row level security;


-- ---------------------------------------------------------------------
-- 7. RPCs
-- ---------------------------------------------------------------------
drop function if exists public.run_select_query(text);
create or replace function public.run_select_query(query_text text)
returns json
language plpgsql
security definer
as $$
declare result json; normalised text := lower(trim(query_text));
begin
    if normalised !~ '^select' then raise exception 'Only SELECT queries are allowed'; end if;
    execute 'select coalesce(json_agg(row_to_json(t)), ''[]''::json) from (' || query_text || ') t' into result;
    return result;
end;
$$;

drop function if exists public.get_tag_counts();
create or replace function public.get_tag_counts()
returns table(tag text, count bigint)
language sql
security definer
as $$
    select t.tag, count(*)::bigint
    from public.main_contacts c, unnest(c.tags) as t(tag)
    where c.tags is not null and array_length(c.tags, 1) > 0
    group by t.tag
    order by count desc, t.tag asc;
$$;

drop function if exists public.cleanup_old_data();
create or replace function public.cleanup_old_data()
returns json
language plpgsql
security definer
as $$
declare result json;
begin
    drop table if exists public.conversation_history cascade;
    analyze public.main_contacts;
    analyze public.contacts;
    analyze public.mailers;
    result := json_build_object('ok', true, 'timestamp', now(),
        'main_contacts_count', (select count(*) from public.main_contacts),
        'contacts_count', (select count(*) from public.contacts),
        'mailers_count', (select count(*) from public.mailers));
    return result;
end;
$$;

-- pg_cron (uncomment after enabling the extension):
-- select cron.schedule('daily-cleanup', '0 3 * * *', 'select public.cleanup_old_data()');
