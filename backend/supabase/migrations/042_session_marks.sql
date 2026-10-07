-- "I'm lost" marks (2026-10-07). A student presses the button during a lecture,
-- as many times as they like, to mark a moment they want to come back to.
--
-- No text is stored here. at_ms is the time since the recording started and
-- transcript_offset is how much transcript existed at that instant, so the
-- moment can be found again in sessions.transcript. That transcript is only
-- saved where recording consent allows, and a mark must not become a way of
-- storing lecture text around that rule.

CREATE TABLE IF NOT EXISTS public.session_marks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  at_ms             integer NOT NULL CHECK (at_ms >= 0),
  transcript_offset integer NOT NULL DEFAULT 0 CHECK (transcript_offset >= 0),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS session_marks_session_idx ON public.session_marks(session_id);

ALTER TABLE public.session_marks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read their own marks" ON public.session_marks;
CREATE POLICY "Users read their own marks" ON public.session_marks
  FOR SELECT USING (auth.uid() = user_id);

-- Insert only onto a session the user owns, so a mark cannot be attached to
-- someone else's lecture by guessing its id.
DROP POLICY IF EXISTS "Users mark their own sessions" ON public.session_marks;
CREATE POLICY "Users mark their own sessions" ON public.session_marks
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (SELECT 1 FROM public.sessions s WHERE s.id = session_id AND s.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users delete their own marks" ON public.session_marks;
CREATE POLICY "Users delete their own marks" ON public.session_marks
  FOR DELETE USING (auth.uid() = user_id);

-- Grants: this schema gives roles nothing by default (see 027-029).
REVOKE ALL ON public.session_marks FROM anon;
GRANT SELECT, INSERT, DELETE ON public.session_marks TO authenticated;
GRANT SELECT ON public.session_marks TO service_role;
