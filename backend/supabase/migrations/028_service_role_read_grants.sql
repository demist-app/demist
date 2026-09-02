-- Migration 028: give service_role SELECT on every application table.
-- Run in the Supabase SQL editor. Read-only, additive, nothing to undo if it
-- turns out unneeded.
--
-- Found while investigating stale-test-account cleanup: querying `profiles`
-- with the service role key returned `permission denied for table profiles`.
-- Checked every application table (see migration 027's note - the same gap
-- was already found and fixed there for pro_waitlist alone) and NONE of them
-- grant service_role anything. Every migration since 001 only ever granted
-- `authenticated` and revoked `anon`; service_role was never mentioned once.
-- That is not a security hole - RLS still applies to `authenticated`/`anon`,
-- and service_role bypasses RLS by Postgres role membership regardless of
-- table grants for THIS project's setup - but table-level grants are a
-- SEPARATE gate from RLS, and PostgREST enforces both. So the service role
-- key, the one meant for exactly this kind of backend/admin work, could not
-- read a single application table through the API.
--
-- Consequence found in practice: a service-role script auditing accounts
-- could not tell a real user's profile from an empty one, because every
-- lookup errored out identically regardless of the user.
--
-- SELECT only. Deleting a user account still goes through
-- supabase.auth.admin.deleteUser(), which cascades via the ON DELETE CASCADE
-- foreign keys already in place (001_initial.sql, 011, 016, 020) - that
-- cascade happens inside Postgres when auth.users is written to, independent
-- of the caller's grants on the child tables, so this migration does not
-- change how deletion works. It exists so a read/audit script does not have
-- to guess.
GRANT SELECT ON
  profiles, sessions, terms, transcript_chunks,
  packs, pack_terms, pack_members,
  lecturer_consents, definition_reports, mic_acknowledgments,
  integrations, usage_events, subscriptions
TO service_role;
