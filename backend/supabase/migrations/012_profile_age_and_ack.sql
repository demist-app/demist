-- Migration 012: add date_of_birth and AI-disclaimer acknowledgement to profiles
-- Run this in the Supabase SQL editor BEFORE deploying any code.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS date_of_birth date,
  ADD COLUMN IF NOT EXISTS ai_disclaimer_ack_at timestamptz;
