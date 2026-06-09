-- Grant permissions on integrations table for authenticated users.
-- The table was created via migration without explicit GRANTs, which Supabase
-- requires in addition to RLS policies for the authenticated/anon roles.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.integrations TO authenticated;
GRANT SELECT ON public.integrations TO anon;
