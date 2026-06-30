ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false;

DROP FUNCTION IF EXISTS public.get_public_profile_stats(uuid);

CREATE FUNCTION public.get_public_profile_stats(target_user_id uuid)
RETURNS TABLE (
  display_name  text,
  course        text,
  year_of_study integer,
  total_terms   bigint,
  terms_this_week bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = target_user_id AND is_public = true
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.display_name,
    p.course,
    p.year_of_study,
    COUNT(DISTINCT t.id)::bigint AS total_terms,
    COUNT(DISTINCT CASE WHEN t.created_at >= now() - interval '7 days' THEN t.id END)::bigint AS terms_this_week
  FROM public.profiles p
  LEFT JOIN public.terms t ON t.user_id = p.id
  WHERE p.id = target_user_id
  GROUP BY p.display_name, p.course, p.year_of_study;
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_profile_stats(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_public_profile_stats(uuid) TO anon, authenticated;