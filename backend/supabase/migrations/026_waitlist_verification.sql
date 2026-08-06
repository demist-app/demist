-- Migration 026: double opt-in for the Pro waitlist.
--
-- ORDER MATTERS. Deploy the web code FIRST, then run this. The last statement
-- revokes anon's INSERT grant, and until /api/waitlist/join is live that grant
-- is the only way anyone can join - pull it early and the landing page form
-- fails for every visitor in between.
--
-- Until now, joining was a direct client-side INSERT with the public anon key
-- (migration 025). That is fine for counting interest but it cannot support
-- verification: a confirmation token has to be generated somewhere the visitor
-- cannot see it, and the email has to be sent with a key that cannot ship to a
-- browser. So all writes move behind a server route holding the service role
-- key, and the two operations it performs become RPCs here - not because an
-- RPC is tidier, but because both are read-then-write and would otherwise race
-- against a double-clicked button.

ALTER TABLE pro_waitlist
  ADD COLUMN IF NOT EXISTS verified_at      timestamptz,
  ADD COLUMN IF NOT EXISTS token_hash       text,
  ADD COLUMN IF NOT EXISTS token_sent_at    timestamptz,
  ADD COLUMN IF NOT EXISTS token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS welcomed_at      timestamptz,
  ADD COLUMN IF NOT EXISTS verify_sends     integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN pro_waitlist.verified_at IS
  'Set when the address was proven to belong to whoever typed it. NULL = unconfirmed; do not mail marketing to these.';
COMMENT ON COLUMN pro_waitlist.token_hash IS
  'SHA-256 of the confirmation token. The raw token only ever exists in the email - a leak of this table does not let anyone confirm on someone else''s behalf.';
COMMENT ON COLUMN pro_waitlist.welcomed_at IS
  'Set when the "you are in" email went out, so a link opened twice cannot send it twice.';

-- Partial: rows that have never been mailed all share a NULL token_hash, and
-- NULLs are not equal to each other in a unique index anyway - the WHERE is
-- there to keep the index small, not to permit them.
CREATE UNIQUE INDEX IF NOT EXISTS pro_waitlist_token_hash_key
  ON pro_waitlist (token_hash) WHERE token_hash IS NOT NULL;

-- Lets the backfill script page through "who still needs a confirmation email"
-- without a sequential scan once the list is large.
CREATE INDEX IF NOT EXISTS pro_waitlist_unverified_idx
  ON pro_waitlist (created_at) WHERE verified_at IS NULL;


-- ── join ────────────────────────────────────────────────────────────────────
-- Returns what the caller should do next, never a row: 'send' (mail the token
-- it just stored), 'throttled' (a token went out moments ago, stay quiet), or
-- 'already_verified' (nothing to do).
--
-- The cooldown is the real point of doing this in the database. Without it the
-- endpoint is a free mail cannon: anyone can POST a stranger's address in a
-- loop and we deliver every one of them. Per-IP limiting in the route is
-- best-effort at the edge; this is the limit that actually holds.
CREATE OR REPLACE FUNCTION waitlist_join(
  p_email      text,
  p_source     text,
  p_token_hash text,
  p_expires_at timestamptz,
  p_cooldown   interval DEFAULT interval '90 seconds'
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row pro_waitlist%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM pro_waitlist WHERE lower(email) = lower(p_email);

  IF NOT FOUND THEN
    INSERT INTO pro_waitlist (email, source, token_hash, token_sent_at, token_expires_at, verify_sends)
    VALUES (p_email, p_source, p_token_hash, now(), p_expires_at, 1);
    RETURN 'send';
  END IF;

  IF v_row.verified_at IS NOT NULL THEN
    RETURN 'already_verified';
  END IF;

  IF v_row.token_sent_at IS NOT NULL AND v_row.token_sent_at > now() - p_cooldown THEN
    RETURN 'throttled';
  END IF;

  -- Re-request: issue a fresh token and let the old one die with it. Someone
  -- who lost the first email must be able to ask again.
  UPDATE pro_waitlist
     SET token_hash       = p_token_hash,
         token_sent_at    = now(),
         token_expires_at = p_expires_at,
         verify_sends     = verify_sends + 1,
         source           = COALESCE(v_row.source, p_source)
   WHERE id = v_row.id;
  RETURN 'send';

EXCEPTION
  -- Two requests for the same new address at once: one INSERT wins, the other
  -- lands here. The loser is by definition inside the cooldown of the winner.
  WHEN unique_violation THEN
    RETURN 'throttled';
END;
$$;


-- ── verify ──────────────────────────────────────────────────────────────────
-- status: 'verified' | 'already' | 'expired' | 'invalid'
--
-- should_welcome is claimed here, in the same UPDATE that sets verified_at,
-- rather than being decided by the route afterwards. Mail clients that
-- pre-fetch links (Outlook Safe Links and friends) hit this before the human
-- does, so the "has the welcome gone out" check and the write that answers it
-- cannot be two round trips - the prefetch and the real click would both read
-- NULL and both send.
CREATE OR REPLACE FUNCTION waitlist_verify(p_token_hash text)
RETURNS TABLE (status text, email text, should_welcome boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row pro_waitlist%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM pro_waitlist WHERE token_hash = p_token_hash;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::text, false;
    RETURN;
  END IF;

  IF v_row.verified_at IS NOT NULL THEN
    -- Verified but never welcomed means an earlier send failed and released
    -- its claim (see waitlist_unclaim_welcome). Re-claim it so opening the
    -- link again retries the mail rather than leaving someone in limbo.
    IF v_row.welcomed_at IS NULL THEN
      UPDATE pro_waitlist SET welcomed_at = now() WHERE id = v_row.id;
      RETURN QUERY SELECT 'already'::text, v_row.email, true;
    ELSE
      RETURN QUERY SELECT 'already'::text, v_row.email, false;
    END IF;
    RETURN;
  END IF;

  -- Expiry is checked after the already-verified case on purpose: someone who
  -- confirmed weeks ago and re-opens the old mail is confirmed, not expired.
  IF v_row.token_expires_at IS NOT NULL AND v_row.token_expires_at < now() THEN
    RETURN QUERY SELECT 'expired'::text, v_row.email, false;
    RETURN;
  END IF;

  UPDATE pro_waitlist
     SET verified_at = now(),
         welcomed_at = now()
   WHERE id = v_row.id;

  RETURN QUERY SELECT 'verified'::text, v_row.email, true;
END;
$$;


-- Releases the welcome-email claim when the send itself failed, so the next
-- click retries it instead of leaving someone silently un-welcomed.
CREATE OR REPLACE FUNCTION waitlist_unclaim_welcome(p_email text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE pro_waitlist SET welcomed_at = NULL WHERE lower(email) = lower(p_email);
$$;


-- These run as the table owner, so who may call them is the entire access
-- control story. Only the service role - i.e. only server code - ever may.
REVOKE ALL ON FUNCTION waitlist_join(text, text, text, timestamptz, interval) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION waitlist_verify(text)                                  FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION waitlist_unclaim_welcome(text)                         FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION waitlist_join(text, text, text, timestamptz, interval) TO service_role;
GRANT EXECUTE ON FUNCTION waitlist_verify(text)                                  TO service_role;
GRANT EXECUTE ON FUNCTION waitlist_unclaim_welcome(text)                         TO service_role;


-- ── close the direct client write ───────────────────────────────────────────
-- Run this ONLY once the code calling /api/waitlist/join is deployed. A row
-- inserted straight from the browser can never be verified - there is no token
-- and no email - so leaving this open would quietly keep producing exactly the
-- unconfirmed rows this migration exists to stop creating.
DROP POLICY IF EXISTS "Anyone may join the waitlist" ON pro_waitlist;
DROP POLICY IF EXISTS "Signed-in users may join anonymously" ON pro_waitlist;
REVOKE INSERT ON pro_waitlist FROM anon;
REVOKE INSERT ON pro_waitlist FROM authenticated;

-- A signed-in user keeps read/update/delete over a row they own, which is what
-- PaywallModal's "you're already on the list" check reads. Joining, for them
-- too, now goes through the endpoint.
DROP POLICY IF EXISTS "Users manage own waitlist row" ON pro_waitlist;
CREATE POLICY "Users manage own waitlist row"
  ON pro_waitlist FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
