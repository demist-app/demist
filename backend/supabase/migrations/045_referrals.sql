-- Referrals (2026-11-27): "give a month, get a month".
--
-- A student shares demist.app/r/<code>. A friend who signs up through it gets
-- Pro for their first 30 days (instead of the usual 14-day trial). The student
-- who invited them gets 30 more days of Pro once the friend records a lecture
-- of 10 minutes or more, at most 12 times.
--
-- WHY THE REWARD IS A LECTURE, NOT A PAYMENT. About 1 in 100 sign-ups pays, so
-- a reward on payment would almost never arrive and nobody would bother to
-- share. A real lecture is the thing that actually predicts someone staying,
-- and it costs us almost nothing: Pro is cheap to give on the desktop app.
--
-- Everything that grants Pro happens here, in SECURITY DEFINER functions, so
-- no client can award itself months. Rewards for someone already PAYING are
-- recorded (reward_note) but not applied, because their period belongs to
-- Stripe; those are handled by hand.

CREATE TABLE IF NOT EXISTS public.referral_codes (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  code       text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9]{6,12}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.referrals (
  referred_id  uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  referrer_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  rewarded_at  timestamptz,
  reward_note  text
);
CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON public.referrals(referrer_id);

ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
-- Students read only their own code and the friends they invited (no names:
-- the app shows counts). Writes go through the functions below.
DROP POLICY IF EXISTS referral_codes_own ON public.referral_codes;
CREATE POLICY referral_codes_own ON public.referral_codes FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS referrals_own ON public.referrals;
CREATE POLICY referrals_own ON public.referrals FOR SELECT TO authenticated USING (referrer_id = auth.uid());
GRANT SELECT ON public.referral_codes, public.referrals TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.referral_codes, public.referrals TO service_role;

-- When an account's Pro currently ends, counting the reverse trial (mirrors
-- trialDaysFor in web/lib/entitlementRules.ts: 30 days for accounts from
-- 2026-09-23, 14 from 2026-11-19). Extensions start from here so a reward
-- never eats into time someone already had.
CREATE OR REPLACE FUNCTION public.referral_pro_base(p_user uuid)
RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT greatest(
    now(),
    coalesce((SELECT s.current_period_end FROM subscriptions s WHERE s.user_id = p_user AND s.plan = 'pro'), now()),
    coalesce((SELECT u.created_at + CASE WHEN u.created_at >= '2026-11-19' THEN interval '14 days'
                                         WHEN u.created_at >= '2026-09-23' THEN interval '30 days'
                                         ELSE interval '0 days' END
              FROM auth.users u WHERE u.id = p_user), now())
  )
$$;

-- The caller's code, created on first ask.
CREATE OR REPLACE FUNCTION public.my_referral_code()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'signed out'; END IF;
  SELECT code INTO c FROM referral_codes WHERE user_id = auth.uid();
  IF c IS NOT NULL THEN RETURN c; END IF;
  LOOP
    c := substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
    BEGIN
      INSERT INTO referral_codes(user_id, code) VALUES (auth.uid(), c);
      RETURN c;
    EXCEPTION WHEN unique_violation THEN
      -- A code collision retries; a second row for the same user returns it.
      SELECT code INTO c FROM referral_codes WHERE user_id = auth.uid();
      IF c IS NOT NULL THEN RETURN c; END IF;
    END;
  END LOOP;
END $$;

-- A new account claims the code it arrived with. Returns a short status.
CREATE OR REPLACE FUNCTION public.claim_referral(p_code text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid(); ref uuid; made timestamptz; paid boolean;
BEGIN
  IF me IS NULL THEN RETURN 'signed_out'; END IF;
  SELECT user_id INTO ref FROM referral_codes WHERE code = lower(trim(p_code));
  IF ref IS NULL THEN RETURN 'unknown_code'; END IF;
  IF ref = me THEN RETURN 'own_code'; END IF;
  IF EXISTS (SELECT 1 FROM referrals WHERE referred_id = me) THEN RETURN 'already'; END IF;
  SELECT created_at INTO made FROM auth.users WHERE id = me;
  -- Only for new accounts: an old account cannot be "referred" after the fact.
  IF made < now() - interval '7 days' THEN RETURN 'too_old'; END IF;
  INSERT INTO referrals(referred_id, referrer_id) VALUES (me, ref);
  SELECT stripe_subscription_id IS NOT NULL INTO paid FROM subscriptions WHERE user_id = me;
  IF NOT coalesce(paid, false) THEN
    UPDATE subscriptions
       SET plan = 'pro', current_period_end = greatest(referral_pro_base(me), made + interval '30 days')
     WHERE user_id = me;
  END IF;
  RETURN 'ok';
END $$;

-- The reward: the first lecture of 10+ minutes by a referred friend.
CREATE OR REPLACE FUNCTION public.reward_referrer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r referrals%ROWTYPE; earned int; paid boolean;
BEGIN
  IF new.ended_at IS NULL OR new.ended_at - new.started_at < interval '10 minutes' THEN RETURN new; END IF;
  SELECT * INTO r FROM referrals WHERE referred_id = new.user_id AND rewarded_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN new; END IF;
  SELECT count(*) INTO earned FROM referrals WHERE referrer_id = r.referrer_id AND rewarded_at IS NOT NULL AND reward_note IS NULL;
  IF earned >= 12 THEN
    UPDATE referrals SET rewarded_at = now(), reward_note = 'cap reached' WHERE referred_id = r.referred_id;
    RETURN new;
  END IF;
  SELECT stripe_subscription_id IS NOT NULL AND plan = 'pro' AND (current_period_end IS NULL OR current_period_end > now())
    INTO paid FROM subscriptions WHERE user_id = r.referrer_id;
  IF coalesce(paid, false) THEN
    UPDATE referrals SET rewarded_at = now(), reward_note = 'referrer pays: apply by hand' WHERE referred_id = r.referred_id;
  ELSE
    UPDATE subscriptions SET plan = 'pro', current_period_end = referral_pro_base(r.referrer_id) + interval '30 days'
     WHERE user_id = r.referrer_id;
    UPDATE referrals SET rewarded_at = now() WHERE referred_id = r.referred_id;
  END IF;
  RETURN new;
END $$;

DROP TRIGGER IF EXISTS sessions_reward_referrer ON public.sessions;
CREATE TRIGGER sessions_reward_referrer
  AFTER UPDATE OF ended_at ON public.sessions
  FOR EACH ROW WHEN (new.ended_at IS NOT NULL AND old.ended_at IS NULL)
  EXECUTE FUNCTION public.reward_referrer();

REVOKE ALL ON FUNCTION public.my_referral_code(), public.claim_referral(text), public.referral_pro_base(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.my_referral_code(), public.claim_referral(text) TO authenticated;
