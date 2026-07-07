-- Migration 022: per-term translation preference
-- translate_to is the student's chosen definition-translation language. Null means
-- no translation (English only). Term-level translations are session-only, not
-- persisted, so no column is added to terms.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS translate_to text
    CHECK (translate_to IN ('zh', 'ar', 'hi', 'es', 'fr'));
