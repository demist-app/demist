-- Migration 033: a consent row that was silently not protecting anyone.
--
-- Found on live data: one lecturer_consents row held "Medicine " with a
-- trailing space. The purge cron tests consent with
--   lc.module_name ILIKE COALESCE(s.subject, '')
-- so 'Medicine ' ILIKE 'Medicine' is FALSE, the consent never matched, and
-- that user's mic transcripts were purged every 10 minutes exactly as if
-- they had never consented. They have 25 microphone sessions and
-- support_need = 'none', so this row was the only thing standing between
-- them and deletion. They asked for their transcripts to be kept and the
-- system quietly deleted them.
--
-- Migration 031 fixed the case-sensitivity half of this comparison but not
-- the whitespace half. ConsentUnlock.tsx already does module.trim() on
-- write, so no NEW bad rows can appear - this is one legacy row from before
-- that trim existed, plus the cron being stricter than the app it is meant
-- to agree with.

-- 1. service_role could read lecturer_consents (migration 028) but never
--    write it, so this could not be repaired from the application side at
--    all. Same read-granted/write-forgotten shape as migrations 029 and 031.
GRANT UPDATE ON lecturer_consents TO service_role;

-- 2. Repair the stranded row(s). Written as a general predicate rather than
--    a hardcoded id so it also catches anything similar that predates the
--    trim-on-write.
UPDATE lecturer_consents
SET module_name = btrim(module_name)
WHERE module_name <> btrim(module_name);

-- 3. Stop the comparison being able to strand a consent again. btrim on
--    BOTH sides, so neither a padded consent nor a padded session subject
--    can produce a false negative. The support_need exemption and the
--    case-insensitive ILIKE from migration 031 are preserved exactly.
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
        AND btrim(lc.module_name) ILIKE btrim(COALESCE(s.subject, ''))
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = s.user_id
        AND p.support_need IS NOT NULL
        AND p.support_need <> 'none'
    )
  $$
);
