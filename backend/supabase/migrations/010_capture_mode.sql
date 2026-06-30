-- Migration 010: add capture_mode to sessions
-- Run this in the Supabase SQL editor BEFORE deploying any code.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS capture_mode text NOT NULL DEFAULT 'microphone'
  CHECK (capture_mode IN ('microphone', 'tab', 'upload'));

CREATE INDEX IF NOT EXISTS sessions_capture_mode_idx ON sessions(capture_mode);
