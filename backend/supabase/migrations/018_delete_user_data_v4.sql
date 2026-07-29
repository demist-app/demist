-- Migration 018: delete_user_data was failing for EVERY user.
-- Run AFTER 017.
--
-- Found by running the real RPC against the real project
-- (web/scripts/test-anon-auth.mjs): it raises
--
--     column "user_id" does not exist
--
-- public.transcript_chunks is keyed by session_id, not user_id — verified
-- against the live schema, which has (id, session_id, chunk_index, text,
-- created_at) and no user_id at all. v3 deleted from it with
-- `WHERE user_id = uid`, and that line is one of the two that is NOT wrapped
-- in an exception handler. The handlers it does have only catch
-- undefined_table; a missing COLUMN raises undefined_column, so nothing
-- caught it and the whole function aborted.
--
-- Because the deletes run in order and this one sits second, the practical
-- effect was that "Delete my account" in Settings deleted `terms` and then
-- threw, leaving sessions, transcript chunks, the profile and the auth user
-- in place — while the UI reported failure and the user had no way to erase
-- their data. That is a right-to-erasure problem, not just a broken button.
--
-- Fixes here:
--   1. transcript_chunks is deleted through its session, BEFORE sessions go.
--   2. Course packs are deleted at all. They were never in any version of
--      this function: packs is keyed by owner_id (no user_id), so an account
--      deletion left the user's packs, their memberships and the pack terms
--      behind entirely.
--   3. Optional-table guards now catch undefined_column as well as
--      undefined_table, so a future schema change can only skip one table
--      rather than abandon the deletion half-done. The REQUIRED tables
--      (terms, transcript_chunks, sessions, profiles, auth.users) are
--      deliberately left unguarded: if one of those cannot be deleted, the
--      correct behaviour is to fail loudly, not to report success having
--      left personal data behind.

CREATE OR REPLACE FUNCTION public.delete_user_data()
RETURNS void AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Children before parents.
  DELETE FROM public.terms WHERE user_id = uid;

  -- transcript_chunks has no user_id: it hangs off sessions. This MUST run
  -- before the sessions delete below or the chunks are orphaned.
  DELETE FROM public.transcript_chunks
   WHERE session_id IN (SELECT id FROM public.sessions WHERE user_id = uid);

  DELETE FROM public.sessions WHERE user_id = uid;

  -- Course packs: owner_id, not user_id.
  BEGIN
    DELETE FROM public.pack_terms
     WHERE pack_id IN (SELECT id FROM public.packs WHERE owner_id = uid);
    DELETE FROM public.pack_members WHERE user_id = uid;
    DELETE FROM public.pack_members
     WHERE pack_id IN (SELECT id FROM public.packs WHERE owner_id = uid);
    DELETE FROM public.packs WHERE owner_id = uid;
  EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
  END;

  BEGIN DELETE FROM public.lecturer_consents   WHERE user_id = uid; EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;
  BEGIN DELETE FROM public.definition_reports  WHERE user_id = uid; EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;
  BEGIN DELETE FROM public.mic_acknowledgments WHERE user_id = uid; EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;
  BEGIN DELETE FROM public.integrations        WHERE user_id = uid; EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;
  BEGIN DELETE FROM public.usage_events        WHERE user_id = uid; EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;
  BEGIN DELETE FROM public.subscriptions       WHERE user_id = uid; EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;

  DELETE FROM public.profiles WHERE id = uid;
  DELETE FROM auth.users WHERE id = uid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.delete_user_data() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.delete_user_data() TO authenticated;
