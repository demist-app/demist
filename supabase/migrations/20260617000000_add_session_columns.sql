-- Add columns needed by import functions (text upload + audio import)
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS transcript TEXT,
  ADD COLUMN IF NOT EXISTS synopsis TEXT;
