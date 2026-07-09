-- Migration 024: fix missing grant on subscriptions
-- Migration 004 created the table with an RLS policy but never an explicit
-- GRANT. Postgres checks table-level privileges before RLS, so without this
-- the entitlements check (folder 01) gets a 403 for every user. Run in the
-- Supabase SQL editor.

GRANT SELECT ON public.subscriptions TO authenticated;
