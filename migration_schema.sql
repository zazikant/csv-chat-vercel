-- =====================================================================
--  Email Campaign Tracker - Schema v2.1
--  Target: gdmztlzpsobyjousvvyp.supabase.co  (NEW project)
--  Run in: Supabase Dashboard -> SQL Editor -> New query
-- =====================================================================
--
--  DESIGN v2.1:
--
--  contacts  (master contact list, one row per person)
--    - email (PK)
--    - name, company, designation, phone, city, sector
--    - optin_status (Subscribed / Hard Bounced / Unsubscribed) - dropdown
--    - mailer_id   (FK -> mailers.mailer_id, nullable)
--    - opens       (int, manually entered)
--    - clicks      (int, manually entered)
--    - last_activity_date  (auto-touched on opens/clicks change)
--    - engagement_score    (auto: HOT if clicks>0 / WARM if opens>0 / COLD)
--
--  mailers  (campaign library, one row per mailer blast)
--    - mailer_id (PK)
--    - subject_line, template_name, sent_date
--    - total_sent         (auto: count of contacts with this mailer_id)
--    - unique_opens      (auto: count of contacts with this mailer_id AND opens>0)
--    - total_opens       (auto: sum of opens across those contacts)
--    - unique_clicks     (auto: count of contacts with this mailer_id AND clicks>0)
--    - total_clicks      (auto: sum of clicks across those contacts)
--    - unsubscribed_count (auto: count of contacts with this mailer_id AND optin_status='Unsubscribed')
--    - open_rate         (GENERATED: unique_opens / total_sent * 100)
--    - click_rate        (GENERATED: unique_clicks / total_sent * 100)
--    - unsubscribe_rate  (GENERATED: unsubscribed_count / total_sent * 100)
--
--  v2.1 change: removed contacts.unsubscribed boolean column. The
--  optin_status dropdown (Subscribed / Hard Bounced / Unsubscribed)
--  covers unsubscribe state. mailers.unsubscribed_count is now computed
--  from contacts.optin_status = 'Unsubscribed'.
--
--  email_journey table is REMOVED — the app does not send auto mailers.
--
--  Safe to re-run: each block uses DROP IF EXISTS / CREATE IF NOT EXISTS.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. Extensions
-- ---------------------------------------------------------------------
create extension if not exists "pgcrypto";


-- ---------------------------------------------------------------------
-- 1. Drop old objects (clean slate)
-- ---------------------------------------------------------------------
drop trigger if exists trg_contacts_rollup   on public.contacts;
drop trigger if exists trg_mailers_touch     on public.mailers;
drop function if exists public.recompute_mailer_counters(text);
drop function if exists public.contacts_rollup_trigger();
drop function if exists public.touch_updated_at();

drop table if exists public.email_journey cascade;
drop table if exists public.contacts      cascade;
drop table if exists public.mailers       cascade;


-- ---------------------------------------------------------------------
-- 2. mailers  (created first because contacts references it)
-- ---------------------------------------------------------------------
create table public.mailers (
    mailer_id           text        primary key,           -- e.g. M001, M002
    subject_line        text        not null,
    template_name       text,
    sent_date           timestamptz,
    -- auto-maintained counters (updated by trigger on contacts):
    total_sent          integer     default 0,
    unique_opens        integer     default 0,
    total_opens         integer     default 0,
    unique_clicks       integer     default 0,
    total_clicks        integer     default 0,
    unsubscribed_count  integer     default 0,
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
    created_at          timestamptz default now(),
    updated_at          timestamptz default now()
);

comment on table  public.mailers is 'Campaign library. One row per mailer blast. All counters are auto-maintained by a trigger on contacts.';
comment on column public.mailers.subject_line is 'The main field — the subject line of the mailer.';
comment on column public.mailers.total_sent is 'Auto: count of contacts with this mailer_id assigned.';
comment on column public.mailers.unique_opens is 'Auto: count of contacts with this mailer_id AND opens > 0.';
comment on column public.mailers.total_opens is 'Auto: sum of opens across all contacts with this mailer_id.';
comment on column public.mailers.unique_clicks is 'Auto: count of contacts with this mailer_id AND clicks > 0.';
comment on column public.mailers.total_clicks is 'Auto: sum of clicks across all contacts with this mailer_id.';
comment on column public.mailers.unsubscribed_count is 'Auto: count of contacts with this mailer_id AND optin_status = Unsubscribed.';
comment on column public.mailers.open_rate is 'GENERATED: unique_opens  / total_sent * 100 (auto-computed).';
comment on column public.mailers.click_rate is 'GENERATED: unique_clicks / total_sent * 100 (auto-computed).';
comment on column public.mailers.unsubscribe_rate is 'GENERATED: unsubscribed_count / total_sent * 100 (auto-computed).';

create index if not exists mailers_sent_date_idx   on public.mailers (sent_date desc);
create index if not exists mailers_open_rate_idx    on public.mailers (open_rate desc);
create index if not exists mailers_click_rate_idx   on public.mailers (click_rate desc);


-- ---------------------------------------------------------------------
-- 3. contacts  (master contact list — one row per person)
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
    last_activity_date timestamptz,
    engagement_score   text        default 'COLD',         -- HOT / WARM / COLD (auto)
    created_at         timestamptz default now(),
    updated_at         timestamptz default now()
);

comment on table  public.contacts is 'Master contact list. One row per person. Each contact is assigned to at most one mailer at a time; opens/clicks are manually maintained per (contact, mailer). The optin_status dropdown covers unsubscribed/bounced state.';
comment on column public.contacts.mailer_id is 'Which mailer this contact received. NULL = not yet assigned.';
comment on column public.contacts.opens is 'How many times this contact opened the assigned mailer (manually entered).';
comment on column public.contacts.clicks is 'How many times this contact clicked links in the assigned mailer (manually entered).';
comment on column public.contacts.optin_status is 'Subscribed / Hard Bounced / Unsubscribed. The Mailers tab derives unsubscribed_count from this column.';
comment on column public.contacts.engagement_score is 'Auto: HOT if clicks>0 / WARM if opens>0 / COLD otherwise.';

create index if not exists contacts_company_idx       on public.contacts (company);
create index if not exists contacts_name_idx         on public.contacts (name);
create index if not exists contacts_mailer_id_idx     on public.contacts (mailer_id);
create index if not exists contacts_engagement_idx    on public.contacts (engagement_score);
create index if not exists contacts_optin_idx        on public.contacts (optin_status);


-- ---------------------------------------------------------------------
-- 4. Auto-rollup function + trigger
--    Whenever a contact is INSERTed / UPDATEd / DELETEd, recompute the
--    affected mailers' counters from scratch.
--    unsubscribed_count = count of contacts with this mailer_id AND optin_status='Unsubscribed'.
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
        updated_at         = now()
    where m.mailer_id = p_mailer_id;
end;
$$;

-- Per-row BEFORE INSERT/UPDATE trigger: touches last_activity_date and engagement_score
create or replace function public.contacts_rollup_trigger()
returns trigger
language plpgsql
as $$
declare
    v_old_mailer text;
    v_new_mailer text;
begin
    v_old_mailer := case when tg_op = 'DELETE' or tg_op = 'UPDATE' then old.mailer_id else null end;
    v_new_mailer := case when tg_op = 'INSERT' or tg_op = 'UPDATE' then new.mailer_id else null end;

    -- On INSERT/UPDATE: touch last_activity_date and engagement_score on the new row
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
    end if;

    -- AFTER part: recompute the affected mailer(s).
    -- We can't use AFTER trigger here because we already mutated new.* in BEFORE.
    -- Use a PERFORM in the same transaction.
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

drop trigger if exists trg_contacts_rollup on public.contacts;
create trigger trg_contacts_rollup
    before insert or update or delete on public.contacts
    for each row execute function public.contacts_rollup_trigger();


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

-- Note: contacts.updated_at is already set inside the rollup trigger above;
-- no separate touch trigger needed for contacts.


-- ---------------------------------------------------------------------
-- 6. Row-Level Security
--    Disabled: the app uses the service_role key (bypasses RLS).
--    Enable later when you add anon/user auth.
-- ---------------------------------------------------------------------
alter table public.contacts disable row level security;
alter table public.mailers  disable row level security;


-- ---------------------------------------------------------------------
-- 7. run_select_query RPC for the chat panel
--    (Drop + recreate so re-running this script is safe.)
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
