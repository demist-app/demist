-- Migration 031: closes several gaps found in a full-app audit (2026-09-12).
--
-- 1) display_name on profiles: referenced by migrations 009 and 015
--    (get_public_profile_stats) but never actually created by any migration
--    - it exists on the live database only because someone added it
--    out-of-band at some point. A fresh environment built from these
--    migrations alone (a new Supabase project, a local `supabase db reset`,
--    disaster recovery) would hit "column p.display_name does not exist" the
--    first time a public profile page loads. IF NOT EXISTS makes this a
--    no-op against the live database and a real fix everywhere else.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS display_name text;

-- 2) Same drift pattern as (1), but for grants instead of a column:
--    sessions/terms/profiles are the three original tables from migration
--    001, and every edge function that inserts a session or term
--    (transcribe, transcribe-audio, process-text-upload, summarize-session)
--    has always depended on `authenticated` being able to write to them -
--    but no migration ever grants that. It works today only because the
--    live database has an out-of-band grant, exactly like subscriptions/
--    usage_events/transcript_chunks did before migrations 027-029 fixed
--    those. Recorded here so a fresh environment doesn't silently 403 on
--    the app's single most basic action. service_role gets the same set for
--    completeness and consistency with every other table in this project,
--    even though nothing currently uses it to write these three - the
--    stripe functions are the only service_role writers so far, and the
--    same "should have worked" surprise already cost real debugging time
--    twice this project (subscriptions, transcript_chunks).
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions, terms, profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions, terms, profiles TO service_role;

-- 3) pro_waitlist: migration 026 replaced the RLS policy on this table with
--    a SELECT-only one for `authenticated`, but never revoked the UPDATE/
--    DELETE table-level grants migration 020 gave that role. RLS currently
--    blocks both regardless, so this has caused nothing yet - but it is
--    exactly the "grants outlive the policy that justified them" shape that
--    turns a later, unrelated policy change (e.g. a future FOR ALL policy
--    added without re-auditing grants) into a silent reopening of write
--    access to a table that exists specifically to hold email addresses.
REVOKE UPDATE, DELETE ON pro_waitlist FROM authenticated;

-- 4) The purge cron (migration 019) and summarize-session's own eligibility
--    check (backend/supabase/functions/summarize-session/index.ts) are
--    supposed to agree on which mic-mode sessions are exempt from the
--    20-minute chunk purge, and they didn't, in two ways:
--      - the cron's `lc.module_name = COALESCE(s.subject,'')` was an exact,
--        case-sensitive match, while the app's own check is `ilike`. A
--        lecturer_consents row saved as "Chemistry" against a session whose
--        subject is "chemistry" reads as eligible to summarize-session but
--        the cron purged its chunks 20 minutes later anyway.
--      - the cron never checked profiles.support_need at all, while
--        summarize-session treats ANY support_need other than 'none' as its
--        own, independent path to eligibility (accessibility grounds, not
--        lecturer consent). The cron was purging support-need users' chunks
--        regardless.
--    Both are corrected to match summarize-session's actual logic exactly,
--    since that function is the one whose behavior was already promised to
--    the user ("this one's part of Pro" aside - retention itself is free).
DO $$
BEGIN
  PERFORM cron.unschedule('purge_mic_chunks');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'purge_mic_chunks',
  '*/10 * * * *',
  $$
  DELETE FROM public.transcript_chunks tc
  USING public.sessions s
  WHERE tc.session_id = s.id
    AND s.capture_mode = 'microphone'
    AND tc.created_at < now() - interval '20 minutes'
    AND NOT EXISTS (
      SELECT 1 FROM public.lecturer_consents lc
      WHERE lc.user_id = s.user_id
        AND lc.module_name ILIKE COALESCE(s.subject, '')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = s.user_id
        AND p.support_need IS NOT NULL
        AND p.support_need <> 'none'
    )
  $$
);
