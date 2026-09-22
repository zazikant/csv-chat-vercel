-- =====================================================================
--  Email Campaign Tracker - Schema Migration
--  Target: gdmztlzpsobyjousvvyp.supabase.co  (NEW project)
--  Run in: Supabase Dashboard -> SQL Editor -> New query
-- =====================================================================
--
--  This script creates the full 3-table schema described in the App
--  Structure document:
--    1. contacts         (master contact list, 1 row per person)
--    2. mailers          (campaign library, 1 row per mailer blast)
--    3. email_journey    (event log, many rows per email / per mailer)
--
--  It also installs a trigger that keeps the cumulative counters on
--  `contacts` and `mailers` in sync with `email_journey` inserts, so
--  the app never has to compute totals itself.
--
--  Safe to re-run: each block uses DROP IF EXISTS / CREATE IF NOT EXISTS.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. Extensions
-- ---------------------------------------------------------------------
create extension if not exists "pgcrypto";   -- for gen_random_uuid()


-- ---------------------------------------------------------------------
-- 1. contacts  (master contact list)
-- ---------------------------------------------------------------------
drop table if exists public.email_journey cascade;
drop table if exists public.mailers      cascade;
drop table if exists public.contacts      cascade;

create table public.contacts (
    email              text        primary key,
    name               text,
    company            text,
    designation        text,
    phone              text,
    city               text,
    sector             text,
    customer_type      text        default 'New',          -- Existing / New
    optin_status       text        default 'Subscribed',    -- Subscribed / Unsubscribed / Bounced
    total_sent         integer     default 0,
    total_opens        integer     default 0,
    total_clicks       integer     default 0,
    last_activity_date timestamptz,
    engagement_score   text        default 'COLD',          -- HOT / WARM / COLD
    -- migration traceability (NOT in app spec; safe extra column):
    legacy_id          integer,
    legacy_remarks     text,
    created_at         timestamptz default now(),
    updated_at         timestamptz default now()
);

comment on table  public.contacts is 'Master contact list. One row per person.';
comment on column public.contacts.email is 'Primary key. Must be a valid, unique email address.';
comment on column public.contacts.engagement_score is 'HOT / WARM / COLD - derived from opens and clicks.';

create index if not exists contacts_company_idx        on public.contacts (company);
create index if not exists contacts_name_idx           on public.contacts (name);
create index if not exists contacts_engagement_idx     on public.contacts (engagement_score);
create index if not exists contacts_optin_idx          on public.contacts (optin_status);
create index if not exists contacts_legacy_id_idx      on public.contacts (legacy_id);


-- ---------------------------------------------------------------------
-- 2. mailers  (campaign library)
-- ---------------------------------------------------------------------
create table public.mailers (
    mailer_id        text        primary key,           -- e.g. M001, M002
    subject_line     text        not null,
    template_name    text,
    sent_date        timestamptz,
    total_sent       integer     default 0,
    delivered        integer     default 0,
    unique_opens     integer     default 0,
    total_opens      integer     default 0,
    unique_clicks    integer     default 0,
    total_clicks     integer     default 0,
    bounced          integer     default 0,
    unsubscribed     integer     default 0,
    open_rate        numeric(5,2) generated always as
                        (case when delivered > 0
                              then round((unique_opens::numeric  / delivered) * 100, 2)
                              else 0 end) stored,
    click_rate       numeric(5,2) generated always as
                        (case when delivered > 0
                              then round((unique_clicks::numeric / delivered) * 100, 2)
                              else 0 end) stored,
    created_at       timestamptz default now(),
    updated_at       timestamptz default now()
);

comment on table  public.mailers is 'Campaign library. One row per mailer blast.';
comment on column public.mailers.subject_line is 'The main field - the subject line of the mailer.';
comment on column public.mailers.open_rate    is 'unique_opens  / delivered (auto-computed).';
comment on column public.mailers.click_rate   is 'unique_clicks / delivered (auto-computed).';

create index if not exists mailers_sent_date_idx   on public.mailers (sent_date desc);
create index if not exists mailers_open_rate_idx   on public.mailers (open_rate desc);
create index if not exists mailers_click_rate_idx  on public.mailers (click_rate desc);


-- ---------------------------------------------------------------------
-- 3. email_journey  (event log - the timeline table)
-- ---------------------------------------------------------------------
create table public.email_journey (
    id              bigserial   primary key,
    email           text        not null references public.contacts (email) on delete cascade,
    mailer_id       text        not null references public.mailers (mailer_id) on delete cascade,
    subject_line    text,
    event_type      text        not null check (event_type in
                                  ('SENT','DELIVERED','OPENED','CLICKED','BOUNCED','UNSUBSCRIBED')),
    timestamp       timestamptz default now(),
    link_clicked    text,
    device_info     text
);

comment on table  public.email_journey is 'Detailed event history. One row per email event.';
comment on column public.email_journey.event_type is 'SENT / DELIVERED / OPENED / CLICKED / BOUNCED / UNSUBSCRIBED';

create index if not exists journey_email_idx       on public.email_journey (email,        timestamp desc);
create index if not exists journey_mailer_idx      on public.email_journey (mailer_id,    timestamp desc);
create index if not exists journey_event_type_idx  on public.email_journey (event_type);
create index if not exists journey_timestamp_idx   on public.email_journey (timestamp desc);


-- ---------------------------------------------------------------------
-- 4. Auto-rollup function + trigger
--    Whenever a new email_journey row is inserted, recompute the
--    relevant counters on contacts and mailers from scratch. This is
--    O(journey rows per email/mailer) per insert, which is fine for
--    a tracker app at this scale.
-- ---------------------------------------------------------------------
create or replace function public.recompute_rollups()
returns trigger
language plpgsql
as $$
declare
    v_email     text  := new.email;
    v_mailer_id text  := new.mailer_id;
begin
    -- Update contacts counters
    update public.contacts c
    set
        total_sent  = (select count(*) from public.email_journey j where j.email = c.email and j.event_type = 'SENT'),
        total_opens = (select count(*) from public.email_journey j where j.email = c.email and j.event_type = 'OPENED'),
        total_clicks= (select count(*) from public.email_journey j where j.email = c.email and j.event_type = 'CLICKED'),
        last_activity_date = (
            select max(j.timestamp)
            from public.email_journey j
            where j.email = c.email and j.event_type in ('OPENED','CLICKED')
        ),
        engagement_score = case
            when (select count(*) from public.email_journey j
                  where j.email = c.email and j.event_type = 'CLICKED') > 0 then 'HOT'
            when (select count(*) from public.email_journey j
                  where j.email = c.email and j.event_type = 'OPENED') > 0 then 'WARM'
            else 'COLD'
        end,
        updated_at = now()
    where c.email = v_email;

    -- Update mailers counters (cumulative totals + unique counts)
    update public.mailers m
    set
        total_sent     = (select count(*) from public.email_journey j where j.mailer_id = m.mailer_id and j.event_type = 'SENT'),
        delivered      = (select count(*) from public.email_journey j where j.mailer_id = m.mailer_id and j.event_type = 'DELIVERED'),
        total_opens    = (select count(*) from public.email_journey j where j.mailer_id = m.mailer_id and j.event_type = 'OPENED'),
        total_clicks   = (select count(*) from public.email_journey j where j.mailer_id = m.mailer_id and j.event_type = 'CLICKED'),
        bounced        = (select count(*) from public.email_journey j where j.mailer_id = m.mailer_id and j.event_type = 'BOUNCED'),
        unsubscribed   = (select count(*) from public.email_journey j where j.mailer_id = m.mailer_id and j.event_type = 'UNSUBSCRIBED'),
        unique_opens   = (select count(distinct j.email) from public.email_journey j where j.mailer_id = m.mailer_id and j.event_type = 'OPENED'),
        unique_clicks  = (select count(distinct j.email) from public.email_journey j where j.mailer_id = m.mailer_id and j.event_type = 'CLICKED'),
        updated_at     = now()
    where m.mailer_id = v_mailer_id;

    return new;
end;
$$;

drop trigger if exists trg_email_journey_rollup on public.email_journey;
create trigger trg_email_journey_rollup
    after insert on public.email_journey
    for each row execute function public.recompute_rollups();


-- ---------------------------------------------------------------------
-- 5. updated_at auto-touch trigger (keep updated_at fresh on updates)
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

drop trigger if exists trg_contacts_touch on public.contacts;
create trigger trg_contacts_touch
    before update on public.contacts
    for each row execute function public.touch_updated_at();

drop trigger if exists trg_mailers_touch on public.mailers;
create trigger trg_mailers_touch
    before update on public.mailers
    for each row execute function public.touch_updated_at();


-- ---------------------------------------------------------------------
-- 6. Row-Level Security
--    Disabled for now: the app uses the service_role key (bypasses RLS).
--    Enable later when you add anon/user auth.
-- ---------------------------------------------------------------------
alter table public.contacts      disable row level security;
alter table public.mailers       disable row level security;
alter table public.email_journey disable row level security;


-- ---------------------------------------------------------------------
-- 7. PostgREST exposure
--    Make sure the API schema cache picks up the new tables.
--    (Supabase auto-refreshes on DDL; if not, run this manually.)
-- ---------------------------------------------------------------------
-- notifys the PostgREST to reload schema cache:
-- (no-op in plain SQL; Supabase handles this automatically)
