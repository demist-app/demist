-- Migration 021: DSA pivot support
-- eligibility marker unlocks full transcript/summary saving without any per-session
-- friction. terms.context stores the sentence a term appeared in, for hover-in-context.
-- Run in the Supabase SQL editor.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS support_need text
    CHECK (support_need IN ('hearing', 'dyslexia', 'attention', 'language', 'other', 'none'));

ALTER TABLE terms
  ADD COLUMN IF NOT EXISTS context text;

-- Backfill existing profiles so nothing is null-blocked downstream.
UPDATE profiles SET support_need = 'none' WHERE support_need IS NULL;
