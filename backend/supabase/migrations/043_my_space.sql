-- My Space (2026-11-07): priorities, a calming toolbox and personal messages,
-- from a student's ideas sent through Graceful Minds. Free for everyone.
--
-- PRIVACY. Everything here is the student's own words, visible only to them.
-- How they feel is deliberately NOT stored: choosing "I'm feeling anxious"
-- only shows suggestions, because a stored record of someone's anxiety would
-- be health data. Nothing here is sent to analytics or read by staff, and it
-- all goes when the account does (ON DELETE CASCADE).
--
-- STARTER CONTENT. Students can edit, delete and add to every suggestion and
-- message, so the starters are copied into their own rows the first time they
-- open My Space (my_space_seed below) rather than living only in code. The
-- text itself lives in web/lib/mySpaceContent.ts.

-- Priorities. plan_date NULL means "later"; a date means that day, so
-- "tomorrow" becomes "today" by itself without a job moving anything. Nothing
-- ever moves a task on its own, deadlines least of all.
CREATE TABLE IF NOT EXISTS public.my_space_tasks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  title       text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  plan_date   date,
  deadline    boolean NOT NULL DEFAULT false,
  done_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS my_space_tasks_user_idx ON public.my_space_tasks(user_id);

-- The toolbox: what helps, grouped by the feeling it is for.
CREATE TABLE IF NOT EXISTS public.my_space_toolbox (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  feeling     text NOT NULL CHECK (feeling IN ('overwhelmed', 'anxious', 'alone', 'stuck')),
  text        text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 300),
  position    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS my_space_toolbox_user_idx ON public.my_space_toolbox(user_id);

-- Words for when it's hard.
CREATE TABLE IF NOT EXISTS public.my_space_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  topic       text NOT NULL CHECK (topic IN ('life', 'anxiety', 'family', 'relationships', 'overwhelm', 'education')),
  text        text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 300),
  favourite   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS my_space_messages_user_idx ON public.my_space_messages(user_id);

-- One row per student, once their starter content has been copied in.
CREATE TABLE IF NOT EXISTS public.my_space_prefs (
  user_id     uuid PRIMARY KEY DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  seeded_at   timestamptz NOT NULL DEFAULT now()
);

-- Owner-only, every operation.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['my_space_tasks', 'my_space_toolbox', 'my_space_messages', 'my_space_prefs'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "Owner only" ON public.%I', t);
    EXECUTE format('CREATE POLICY "Owner only" ON public.%I FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)', t);
    -- Grants: this schema gives roles nothing by default (see 027-029). No
    -- service_role grant: nothing server-side needs to read these.
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
END $$;

-- Copies the starter suggestions and messages into the caller's own rows,
-- once. Claiming the prefs row first makes it safe against two tabs opening
-- My Space at the same moment: only one of them gets to seed. Runs as the
-- caller (SECURITY INVOKER), so RLS applies to every insert.
CREATE OR REPLACE FUNCTION public.my_space_seed(toolbox jsonb, messages jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE claimed integer;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  IF jsonb_array_length(toolbox) > 100 OR jsonb_array_length(messages) > 150 THEN
    RAISE EXCEPTION 'too many starter items';
  END IF;
  INSERT INTO public.my_space_prefs (user_id) VALUES (auth.uid()) ON CONFLICT (user_id) DO NOTHING;
  GET DIAGNOSTICS claimed = ROW_COUNT;
  IF claimed = 0 THEN RETURN false; END IF;
  INSERT INTO public.my_space_toolbox (user_id, feeling, text, position)
    SELECT auth.uid(), x->>'feeling', x->>'text', (x->>'position')::integer FROM jsonb_array_elements(toolbox) AS x;
  INSERT INTO public.my_space_messages (user_id, topic, text)
    SELECT auth.uid(), x->>'topic', x->>'text' FROM jsonb_array_elements(messages) AS x;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.my_space_seed(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_space_seed(jsonb, jsonb) TO authenticated;
