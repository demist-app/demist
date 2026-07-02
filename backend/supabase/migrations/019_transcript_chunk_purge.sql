-- Migration 019: server-enforced purge of mic-mode transcript chunks
-- Makes the "nothing is kept" promise real instead of client-dependent.
-- Chunks for microphone sessions with no lecturer consent are deleted 20 minutes
-- after creation, regardless of what the client does. Live display is unaffected:
-- the dashboard consumes realtime INSERT events, already delivered by then.
-- Run in the Supabase SQL editor. pg_cron is available on all Supabase projects.

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Idempotent: drop any previous version of the job first
DO $$
BEGIN
  PERFORM cron.unschedule('purge_mic_chunks');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'purge_mic_chunks',
  '*/10 * * * *',  -- every 10 minutes
  $$
  DELETE FROM public.transcript_chunks tc
  USING public.sessions s
  WHERE tc.session_id = s.id
    AND s.capture_mode = 'microphone'
    AND tc.created_at < now() - interval '20 minutes'
    AND NOT EXISTS (
      SELECT 1 FROM public.lecturer_consents lc
      WHERE lc.user_id = s.user_id
        AND lc.module_name = COALESCE(s.subject, '')
    )
  $$
);

-- Verify it registered:
-- SELECT jobname, schedule FROM cron.job WHERE jobname = 'purge_mic_chunks';
