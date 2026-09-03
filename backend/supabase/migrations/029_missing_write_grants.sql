-- Migration 029: several tables have RLS policies but were never granted the
-- base table privilege those policies presuppose - so every read/write against
-- them has been silently denied since the day each was created, regardless of
-- what the policy says. Grants and RLS are two independent gates in Postgres;
-- a policy permitting a row is moot if the role has no privilege on the table
-- at all. Found while explaining "why are some tables empty" - three of these
-- are live features that have been failing silently, not unused ones. All
-- three insert/delete call sites use `.then(({ error }) => console.error(...))`
-- fire-and-forget, so the failure was never once surfaced to a user or caught
-- by anything that would have made it visible.
--
-- Applied directly to the live project 2026-09-02 via the Supabase MCP
-- connector (not the usual SQL-editor-paste workflow) - recorded here so the
-- repo's migration history doesn't drift from what the database actually has.

-- review_log: every flashcard grading in web/app/(app)/flashcards/page.tsx
-- has been trying to log itself here and failing. The table isn't even
-- created by a committed migration - it exists live but nothing in this
-- repo defines it, which is its own gap; the code already anticipated this
-- ("ignore errors if migration hasn't run yet"), just not this exact cause.
GRANT SELECT, INSERT, UPDATE, DELETE ON review_log TO authenticated;
REVOKE ALL ON review_log FROM anon;

-- usage_events: every cloud transcribe/detect-terms/summarize-session edge
-- function call has been trying to log its own usage and failing. SELECT and
-- INSERT only, matching migration 003's two policies exactly - an audit trail
-- an authenticated user could quietly rewrite or delete stops being an audit
-- trail, so there is no UPDATE/DELETE policy to grant against.
GRANT SELECT, INSERT ON usage_events TO authenticated;
REVOKE ALL ON usage_events FROM anon;

-- transcript_chunks: worse than the other two, and NOT purely a grants issue.
-- It had only a SELECT policy - there was never an INSERT or DELETE policy at
-- all, so even a correct grant would still have been blocked by RLS. And the
-- table has NO user_id column (id, session_id, chunk_index, text, created_at
-- only - confirmed against the live schema) - ownership is via session_id, so
-- the policies below join to sessions.user_id, matching the existing SELECT
-- policy's own pattern exactly, rather than a column that does not exist.
--
-- Two real call sites needed these:
--   - backend/supabase/functions/transcribe/index.ts inserts each live chunk
--     as the calling user (anon key + forwarded JWT, not service role), so it
--     is genuinely subject to these policies, not bypassing them. Its insert
--     ALSO sent a `user_id` field the table has never had, which alone made
--     every attempt fail with a schema error regardless of RLS - fixed in the
--     same pass and redeployed (version 14).
--   - web/lib/recordingSession.tsx deletes a session's chunks client-side the
--     moment it turns out to be ineligible (no support need, no lecturer
--     consent) - the FIRST purge, ahead of migration 019's cron backstop.
-- Both failed silently for as long as this table has existed. The chunks
-- Realtime-feed the live transcript view during a browser/PWA microphone
-- recording specifically (the desktop app's on-device path never touches this
-- table), so this is the one with a real, currently-live user-facing symptom:
-- anyone recording live in the browser rather than the Windows app has had no
-- live transcript text appear during the session.
CREATE POLICY "Users insert own chunks" ON transcript_chunks
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM sessions WHERE sessions.id = transcript_chunks.session_id AND sessions.user_id = auth.uid())
  );
CREATE POLICY "Users delete own chunks" ON transcript_chunks
  FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM sessions WHERE sessions.id = transcript_chunks.session_id AND sessions.user_id = auth.uid())
  );
GRANT SELECT, INSERT, DELETE ON transcript_chunks TO authenticated;
REVOKE ALL ON transcript_chunks FROM anon;

-- packs / pack_terms / pack_members (Course Packs): DIFFERENT situation, not
-- a live bug - grep across web/ finds no reference to any of the three table
-- names anywhere, so nothing has ever tried to use them; that is a shipped-in-
-- schema, never-built-on-the-frontend feature, not a broken one. Their RLS
-- policies are already fully correct and complete. Grants closed here anyway,
-- purely so the exact same silent-failure trap in this migration's other
-- three tables cannot also be waiting for whoever eventually builds this
-- feature's UI. Scoped to match each table's existing policies precisely:
-- pack_terms has no UPDATE/DELETE policy (append-only once added), so none is
-- granted for it.
GRANT SELECT, INSERT, UPDATE, DELETE ON packs        TO authenticated;
GRANT SELECT, INSERT              ON pack_terms   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON pack_members TO authenticated;
REVOKE ALL ON packs        FROM anon;
REVOKE ALL ON pack_terms   FROM anon;
REVOKE ALL ON pack_members FROM anon;

-- Verified end to end as the real `authenticated` role (not service_role),
-- via a minted session for a real account, against a real session_id: insert,
-- select, and delete all succeeded on transcript_chunks; insert succeeded on
-- review_log and usage_events. All verification rows were removed afterward.
