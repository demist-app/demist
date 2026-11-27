-- University offers (2026-11-27). A disability office shares one link
-- (demist.app/uni/<code>) and its students get Pro free until pro_until.
-- Why: distribution. Universities list tools on their accessibility pages,
-- which send a steady stream of students and are what assistants cite. On the
-- desktop app Pro costs almost nothing per student (it runs on their own
-- computer), so the offer is cheap; the browser cap stays on for these
-- students because browser recording bills per lecture-hour (see
-- LIMITS.webRecordingUnlimited in web/lib/entitlementRules.ts).
--
-- A claim writes an ordinary comped subscriptions row (plan 'pro', no Stripe
-- id, current_period_end = pro_until) tagged with org_code, so every existing
-- rule (entitlements, expiry emails) already handles it. Only the web route
-- with the service role writes here; students never read these tables.

CREATE TABLE IF NOT EXISTS public.uni_offers (
  code        text PRIMARY KEY CHECK (code ~ '^[a-z0-9-]{3,40}$'),
  org_name    text NOT NULL CHECK (char_length(org_name) BETWEEN 2 AND 200),
  domain      text,
  pro_until   timestamptz NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.uni_offer_claims (
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  code        text NOT NULL REFERENCES public.uni_offers(code),
  claimed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS uni_offer_claims_code_idx ON public.uni_offer_claims(code);

ALTER TABLE public.uni_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.uni_offer_claims ENABLE ROW LEVEL SECURITY;
-- No policies: anon and authenticated cannot read or write. service_role has
-- no table grants by default in this schema (see migrations 027/028).
GRANT SELECT, INSERT, UPDATE ON public.uni_offers TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.uni_offer_claims TO service_role;

-- Which offer a comped row came from. NULL for paid and hand-comped rows.
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS org_code text REFERENCES public.uni_offers(code);
