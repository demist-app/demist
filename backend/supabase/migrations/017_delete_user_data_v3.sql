-- Migration 017: extend delete_user_data to cover mic_acknowledgments
-- Run AFTER 016.
-- NOTE: This migration was originally run via the Supabase SQL editor (mic gate feature).

CREATE OR REPLACE FUNCTION public.delete_user_data()
RETURNS void AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  DELETE FROM public.terms WHERE user_id = uid;
  DELETE FROM public.transcript_chunks WHERE user_id = uid;
  DELETE FROM public.sessions WHERE user_id = uid;
  BEGIN DELETE FROM public.lecturer_consents WHERE user_id = uid; EXCEPTION WHEN undefined_table THEN NULL; END;
  BEGIN DELETE FROM public.definition_reports WHERE user_id = uid; EXCEPTION WHEN undefined_table THEN NULL; END;
  BEGIN DELETE FROM public.mic_acknowledgments WHERE user_id = uid; EXCEPTION WHEN undefined_table THEN NULL; END;
  BEGIN DELETE FROM public.integrations WHERE user_id = uid; EXCEPTION WHEN undefined_table THEN NULL; END;
  DELETE FROM public.profiles WHERE id = uid;
  DELETE FROM auth.users WHERE id = uid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.delete_user_data() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.delete_user_data() TO authenticated;
