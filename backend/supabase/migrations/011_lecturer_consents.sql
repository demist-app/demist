-- Migration 011: lecturer consent grants (per user, per module)
-- Run this in the Supabase SQL editor BEFORE deploying any code.

CREATE TABLE IF NOT EXISTS lecturer_consents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  module_name text NOT NULL,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  notes       text,
  UNIQUE(user_id, module_name)
);

ALTER TABLE lecturer_consents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their own consents" ON lecturer_consents;
CREATE POLICY "Users manage their own consents"
  ON lecturer_consents FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS lecturer_consents_user_idx ON lecturer_consents(user_id);

REVOKE ALL ON lecturer_consents FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON lecturer_consents TO authenticated;
