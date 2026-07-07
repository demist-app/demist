-- Migration 020: pro waitlist
-- Captures interest in the paid tier before any payment vendor exists.
-- Run in the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS pro_waitlist (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  email      text NOT NULL,
  source     text,                -- which gate triggered it, e.g. 'anki_export'
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE pro_waitlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own waitlist row" ON pro_waitlist;
CREATE POLICY "Users manage own waitlist row"
  ON pro_waitlist FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

REVOKE ALL ON pro_waitlist FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON pro_waitlist TO authenticated;
