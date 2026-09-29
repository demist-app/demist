-- sessions.ended_at comes from the server's clock, not the device's.
--
-- WHY. started_at defaults to now() on the server, but ended_at was written
-- from the browser's clock (new Date().toISOString() in stopRecording). A
-- device whose clock is an hour out produced sessions that end before they
-- start: two such rows on 2026-09-24, at -56 and -60 minutes, which breaks
-- every duration calculation downstream (session length, time recorded,
-- anything averaged over lectures).
--
-- The trigger only replaces a NEW ended_at written by a signed-in user; the
-- service role and the dashboard are left alone so data can still be fixed
-- by hand. It never lets an end precede its start. Existing negative rows are
-- left as they are: their true end time is unknown, and guessing one would be
-- inventing data.
create or replace function public.stamp_session_end()
returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon')
     and new.ended_at is not null
     and new.ended_at is distinct from old.ended_at then
    new.ended_at := greatest(now(), new.started_at);
  end if;
  return new;
end $$;

drop trigger if exists sessions_stamp_end on public.sessions;
create trigger sessions_stamp_end
  before update of ended_at on public.sessions
  for each row execute function public.stamp_session_end();
