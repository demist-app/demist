-- Migration 027: give service_role table access to pro_waitlist, and clear out
-- the rows 026's test script could not delete because it did not have it.
-- Run in the Supabase SQL editor, after 026.
--
-- 020 granted the table to `authenticated` and revoked it from `anon`, but
-- never mentioned `service_role`, and Supabase's default privileges did not
-- cover this table either. That went unnoticed for as long as every code path
-- went through anon: the landing page INSERT (025) and PaywallModal both used
-- the public key.
--
-- 026 changed that. The endpoints work regardless, because they only ever call
-- waitlist_join/waitlist_verify and those are SECURITY DEFINER - they run as
-- the function owner, so the caller's own table rights never come into it.
-- What broke is everything that reads the table directly with the service key:
--
--   scripts/send-waitlist-verifications.mjs  -> permission denied for table
--   the cleanup at the end of test-waitlist.mjs (silently, it was unchecked)
--
-- service_role is the trusted server identity and its key never reaches a
-- browser. It already reaches every row through the SECURITY DEFINER functions
-- above, so granting the table directly concedes nothing that was not already
-- reachable - it just stops server-side scripts having to route every query
-- through a bespoke RPC.
GRANT SELECT, INSERT, UPDATE, DELETE ON pro_waitlist TO service_role;

-- Left behind by test-waitlist.mjs, whose DELETE was denied by the very gap
-- this migration closes. These matter: the `-old` row is unverified with an
-- expired token, so the backfill would have picked it up and mailed a reserved
-- .invalid address - a guaranteed hard bounce, on a domain with no sending
-- history, which is the one thing worth avoiding right now.
DELETE FROM pro_waitlist WHERE email LIKE 'demist-selftest%@example.invalid';

-- What the list actually looks like afterwards. verified_at IS NOT NULL is the
-- list; everything else is an address nobody has proven.
SELECT count(*) FILTER (WHERE verified_at IS NOT NULL) AS confirmed,
       count(*) FILTER (WHERE verified_at IS NULL)     AS unconfirmed,
       count(*)                                        AS total
FROM pro_waitlist;
