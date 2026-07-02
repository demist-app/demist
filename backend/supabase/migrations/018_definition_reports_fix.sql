-- Migration 018: fix definition_reports inserts
-- The client inserts {term, definition} without user_id; the RLS policy
-- requires auth.uid() = user_id, so every report has been silently rejected.
-- Defaulting user_id to auth.uid() fixes all existing call sites with no client change.
-- Run in the Supabase SQL editor.

ALTER TABLE definition_reports
  ALTER COLUMN user_id SET DEFAULT auth.uid();
