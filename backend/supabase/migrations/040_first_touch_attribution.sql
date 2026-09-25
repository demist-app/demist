-- First-touch attribution and a richer "how did you find us" answer.
--
-- WHY. As of 2026-09-25, 105 of 119 non-internal accounts have no recorded
-- source, so there is no way to tell which channel produces users. Referrer
-- data suggests AI assistants and search send the visitors who sign up, but
-- that is 14 answers deep. These columns hold what the browser saw on the
-- visitor's FIRST page view (web/lib/firstTouch.ts), copied here once, when
-- onboarding completes.
--
-- Raw values, not buckets: ChatGPT traffic arrives as utm_source=chatgpt.com,
-- as a referrer, or as nothing at all, and bucketing early loses which.

alter table public.profiles
  add column if not exists first_touch_source        text,
  add column if not exists first_touch_medium        text,
  add column if not exists first_touch_campaign      text,
  add column if not exists first_touch_content       text,
  add column if not exists first_touch_referrer      text,
  add column if not exists first_touch_landing_path  text,
  add column if not exists first_touch_at            timestamptz,
  -- Free text for heard_from = 'other'. Capped, and never shown to anyone
  -- but us.
  add column if not exists heard_from_detail         text check (char_length(heard_from_detail) <= 200);

-- heard_from was added outside the migrations folder, so whether it carries a
-- CHECK constraint is unknown from here. The onboarding question now writes
-- new values (google, bing, reddit, youtube, linkedin, lecturer); an old
-- constraint listing only the previous set would reject them, and that
-- rejection would only ever surface as a write_failed event. Drop any CHECK
-- that mentions the column; the app owns the list of values.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.profiles'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%heard_from%'
      and pg_get_constraintdef(oid) not ilike '%heard_from_detail%'
  loop
    execute format('alter table public.profiles drop constraint %I', c.conname);
  end loop;
end $$;

-- Users must not be able to rewrite their own attribution. profiles grants
-- table-level UPDATE to authenticated (users edit their course, year and so
-- on), so a column REVOKE would not bite; a trigger does. It rejects any
-- change to the first_touch_* columns made directly by a signed-in or
-- anonymous role. record_first_touch below runs as its owner, so it passes.
create or replace function public.guard_first_touch()
returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') and (
       new.first_touch_source       is distinct from old.first_touch_source
    or new.first_touch_medium       is distinct from old.first_touch_medium
    or new.first_touch_campaign     is distinct from old.first_touch_campaign
    or new.first_touch_content      is distinct from old.first_touch_content
    or new.first_touch_referrer     is distinct from old.first_touch_referrer
    or new.first_touch_landing_path is distinct from old.first_touch_landing_path
    or new.first_touch_at           is distinct from old.first_touch_at
  ) then
    raise exception 'first_touch columns are write-once and server-set' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard_first_touch on public.profiles;
create trigger profiles_guard_first_touch
  before update on public.profiles
  for each row execute function public.guard_first_touch();

-- The only way in. Write-once: does nothing if first_touch_at is already set,
-- so a second device, a re-shown onboarding or a replayed call cannot
-- overwrite the original. Every value is trimmed and capped; an empty string
-- is stored as NULL so "not present" never masquerades as a value.
create or replace function public.record_first_touch(p jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  if auth.uid() is null then return false; end if;
  update public.profiles set
    first_touch_source       = nullif(left(trim(p->>'source'), 200), ''),
    first_touch_medium       = nullif(left(trim(p->>'medium'), 200), ''),
    first_touch_campaign     = nullif(left(trim(p->>'campaign'), 200), ''),
    first_touch_content      = nullif(left(trim(p->>'content'), 200), ''),
    first_touch_referrer     = nullif(left(trim(p->>'referrer'), 200), ''),
    first_touch_landing_path = nullif(left(trim(p->>'landing_path'), 300), ''),
    first_touch_at           = coalesce((p->>'at')::timestamptz, now())
  where id = auth.uid() and first_touch_at is null;
  get diagnostics n = row_count;
  return n > 0;
end $$;

revoke all on function public.record_first_touch(jsonb) from public, anon;
grant execute on function public.record_first_touch(jsonb) to authenticated;
