-- =============================================================================
-- SYNC_MAIN_OPTIN.sql
-- automatically mirror contacts.optin_status → main_contacts.optin_status
-- =============================================================================
-- Problem this solves
-- -------------------
-- The Contacts tab writes engagement rows (contacts table). The Main Contacts
-- view reads main_contacts.optin_status. Changing a contact's status to
-- "Hard Bounced" (or Unsubscribed) in the Contacts tab must be reflected
-- automatically in Main Contacts — for EVERY write path:
--   * POST / PUT /api/contacts (Add / Edit modal)
--   * POST /api/contacts/bulk  (CSV upload)
--   * SQL Query Box / chat agent / manual SQL
--
-- Semantics: "worst status wins" — the master record shows the most serious
-- known delivery problem across all of the email's engagement rows:
--     Hard Bounced  >  Unsubscribed  >  Subscribed
-- If an email has no rows left in contacts, its main_contacts status is left
-- untouched (the user may have set it manually on a main-only record).
--
-- Safe to run multiple times (idempotent). Also backfills existing rows.
-- =============================================================================

-- 1. Trigger function ---------------------------------------------------------
create or replace function public.sync_main_optin_from_contacts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email  text;
  v_status text;
begin
  v_email := coalesce(new.email, old.email);
  if v_email is null then
    return coalesce(new, old);
  end if;

  -- Worst status wins across all engagement rows for this email.
  select
    case
      when count(*) filter (where c.optin_status = 'Hard Bounced') > 0 then 'Hard Bounced'
      when count(*) filter (where c.optin_status = 'Unsubscribed') > 0 then 'Unsubscribed'
      when count(*) > 0                                                then 'Subscribed'
      else null  -- no engagement rows left: keep whatever main_contacts has
    end
  into v_status
  from public.contacts c
  where c.email = v_email;

  if v_status is not null then
    -- Row may already be gone (e.g. main_contacts delete cascading to
    -- contacts) — a zero-row UPDATE is not an error.
    update public.main_contacts m
       set optin_status = v_status
     where m.email = v_email;
  end if;

  return coalesce(new, old);
end;
$$;

-- 2. Trigger ------------------------------------------------------------------
drop trigger if exists trg_contacts_sync_main_optin on public.contacts;
create trigger trg_contacts_sync_main_optin
    after insert or update or delete on public.contacts
    for each row execute function public.sync_main_optin_from_contacts();

-- 3. One-time backfill of existing data (same worst-wins rule) ----------------
update public.main_contacts m
   set optin_status = derived.status
  from (
    select c.email,
           case
             when count(*) filter (where c.optin_status = 'Hard Bounced') > 0 then 'Hard Bounced'
             when count(*) filter (where c.optin_status = 'Unsubscribed') > 0 then 'Unsubscribed'
             else 'Subscribed'
           end as status
      from public.contacts c
     group by c.email
  ) derived
 where m.email = derived.email;

-- 4. Sanity check (run manually in the SQL editor if you like):
--    select count(*) from main_contacts m
--    where exists (select 1 from contacts c where c.email = m.email
--                    and c.optin_status = 'Hard Bounced')
--      and m.optin_status <> 'Hard Bounced';   -- must return 0
