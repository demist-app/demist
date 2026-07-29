-- Migration 025: let a logged-out visitor join the Pro waitlist.
-- Run AFTER 024, in the Supabase SQL editor.
--
-- As created in 020 the waitlist could only ever be joined by someone who was
-- already signed in: user_id is NOT NULL DEFAULT auth.uid(), and anon has no
-- grants at all. Its only entry point was PaywallModal, which is itself behind
-- PAYWALL_ENABLED (currently false) - so in practice nothing could reach it.
-- A "Join the Pro waitlist" button on the public landing page is exactly the
-- case that could not work: the visitor has no account, and asking them to
-- make one first defeats the point of measuring interest.
--
-- So: user_id becomes optional (NULL = someone who was not signed in), anon
-- gets INSERT and nothing else, and email carries the uniqueness that user_id
-- used to. anon deliberately gets NO SELECT, so the endpoint can be written to
-- but the list can never be read back out - it is not an email harvester.

ALTER TABLE pro_waitlist ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE pro_waitlist ALTER COLUMN user_id DROP DEFAULT;

-- user_id was UNIQUE, which is wrong once it can be NULL for everyone who
-- signed up logged-out. Dedupe on the thing that actually identifies a person
-- here. Case-insensitive, because Foo@x.com and foo@x.com are one person.
--
-- The CONSTRAINT goes first and the index second, not the other way round.
-- UNIQUE(user_id) in 020's CREATE TABLE is a constraint that OWNS its backing
-- index, so DROP INDEX on it fails outright:
--   2BP01: cannot drop index pro_waitlist_user_id_key because constraint
--          pro_waitlist_user_id_key on table pro_waitlist requires it
-- Dropping the constraint takes its index with it; the DROP INDEX afterwards
-- is only there to catch a hand-made index of the same name on a database
-- where it was never a constraint.
ALTER TABLE pro_waitlist DROP CONSTRAINT IF EXISTS pro_waitlist_user_id_key;
DROP INDEX IF EXISTS pro_waitlist_user_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS pro_waitlist_email_key
  ON pro_waitlist (lower(email));
-- Kept so a signed-in user still cannot create two rows.
CREATE UNIQUE INDEX IF NOT EXISTS pro_waitlist_user_id_uniq
  ON pro_waitlist (user_id) WHERE user_id IS NOT NULL;

-- A signed-out visitor may add themselves and do nothing else. WITH CHECK
-- pins user_id to NULL so this policy cannot be used to write a row
-- attributed to somebody else's account.
DROP POLICY IF EXISTS "Anyone may join the waitlist" ON pro_waitlist;
CREATE POLICY "Anyone may join the waitlist"
  ON pro_waitlist FOR INSERT TO anon
  WITH CHECK (user_id IS NULL);

GRANT INSERT ON pro_waitlist TO anon;

-- Signed-in users keep full control of their own row (PaywallModal reads it
-- back to show "you're already on the list").
DROP POLICY IF EXISTS "Users manage own waitlist row" ON pro_waitlist;
CREATE POLICY "Users manage own waitlist row"
  ON pro_waitlist FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ...and may also join while signed in without claiming a user_id, which is
-- what the landing page does when it does not care who they are.
DROP POLICY IF EXISTS "Signed-in users may join anonymously" ON pro_waitlist;
CREATE POLICY "Signed-in users may join anonymously"
  ON pro_waitlist FOR INSERT TO authenticated
  WITH CHECK (user_id IS NULL OR auth.uid() = user_id);
