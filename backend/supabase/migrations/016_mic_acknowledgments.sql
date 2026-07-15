-- Migration 016: mic_acknowledgments, tracking per-user, per-subject mic gate acknowledgments
-- Users must acknowledge that mic sessions don't save transcripts before recording starts.
-- Keyed per subject so the gate reappears if a student starts using a new module.
-- NOTE: This migration was originally run via the Supabase SQL editor (mic gate feature).

CREATE TABLE IF NOT EXISTS public.mic_acknowledgments (
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject       text NOT NULL DEFAULT '',
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, subject)
);

ALTER TABLE mic_acknowledgments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their own mic acknowledgments" ON mic_acknowledgments;
CREATE POLICY "Users manage their own mic acknowledgments"
  ON mic_acknowledgments FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

REVOKE ALL ON mic_acknowledgments FROM anon;
GRANT SELECT, INSERT, DELETE ON mic_acknowledgments TO authenticated;
