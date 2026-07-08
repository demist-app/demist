-- Migration 023: persisted session translation
-- Stores the translated transcript for eligible-save sessions so the bilingual
-- view works in history, not just live. Run in the Supabase SQL editor.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS transcript_translation text,
  ADD COLUMN IF NOT EXISTS translation_lang text
    CHECK (translation_lang IN ('zh', 'ar', 'hi', 'es', 'fr'));
