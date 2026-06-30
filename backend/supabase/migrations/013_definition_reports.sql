-- Migration 013: definition_reports (user-flagged wrong/misleading AI definitions)

CREATE TABLE IF NOT EXISTS definition_reports (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  term       text NOT NULL,
  definition text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE definition_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users insert their own reports" ON definition_reports;
CREATE POLICY "Users insert their own reports"
  ON definition_reports FOR INSERT
  WITH CHECK (auth.uid() = user_id);

REVOKE ALL ON definition_reports FROM anon;
GRANT INSERT ON definition_reports TO authenticated;
