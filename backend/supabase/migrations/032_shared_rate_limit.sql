-- Migration 032: a rate limiter every edge function instance actually shares.
--
-- Every AI edge function (transcribe, detect-terms, process-text-upload,
-- summarize-session, transcribe-audio) rate-limited callers with an
-- in-process `Map<string, number[]>`. That resets on cold start and, more to
-- the point, is NOT shared across the multiple concurrent isolates Supabase
-- can run for the same function - so the real ceiling on OpenAI/Groq/Whisper
-- spend was "the stated limit, times however many instances happen to be
-- warm", not the stated limit. A fixed-window counter backed by Postgres is
-- shared by construction: every instance hits the same row.
--
-- Fixed window, not a sliding one: a single atomic upsert is enough to be
-- race-free under real concurrency (two requests landing in the same
-- millisecond both increment the same row correctly, Postgres serializes
-- it), where a sliding log needs a second query to prune old hits and a
-- window boundary can be gamed for at most 2x the limit in a burst - an
-- accepted, standard trade-off for the complexity it avoids.
create table if not exists rate_limit_hits (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);

-- No direct grants to authenticated/anon: this table has no RLS policies
-- and is only ever touched through check_rate_limit() below, which runs
-- as its owner (SECURITY DEFINER) - the same reason a user can't rewrite
-- their own stripe_customer_id directly (migration 030's comment). A key
-- is just a rate-limit bucket id, not sensitive, but there is no reason for
-- a client to be able to write to this table at all, let alone under
-- someone else's key.
create or replace function public.check_rate_limit(p_key text, p_max integer, p_window_minutes integer default 60)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_secs integer := p_window_minutes * 60;
  -- Epoch-aligned bucketing, not date_trunc('hour')/('minute'): a window
  -- has to be a fixed multiple of seconds since a stable reference point
  -- regardless of what hour or day it falls in, or two buckets in
  -- different hours that happen to share a minute-of-hour would collide.
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / v_window_secs) * v_window_secs);
  v_count integer;
begin
  insert into public.rate_limit_hits (key, window_start, count)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set count = rate_limit_hits.count + 1
  returning count into v_count;
  return v_count <= p_max;
end;
$$;

grant execute on function public.check_rate_limit(text, integer, integer) to authenticated, service_role;

-- Otherwise this grows forever: one row per (key, window) that's ever been
-- hit, across every user, forever. 25 hours comfortably outlives every
-- window this project uses today (all 60 minutes) with room to spare.
create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('purge_rate_limit_hits');
exception when others then null;
end $$;

select cron.schedule(
  'purge_rate_limit_hits',
  '0 * * * *',
  $$ delete from public.rate_limit_hits where window_start < now() - interval '25 hours' $$
);
