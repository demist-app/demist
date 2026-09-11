-- Migration 030: real Stripe-backed Pro subscriptions.
--
-- subscriptions.plan already existed ('free' | 'pro') from migration 004,
-- but nothing has ever set it to 'pro' - Pro was a waitlist, not a real
-- product. These columns are what the new stripe-checkout/stripe-webhook
-- edge functions need to actually manage a real subscription: which Stripe
-- customer/subscription this row corresponds to, and when the current
-- paid (or granted-free) period actually ends.
--
-- current_period_end is deliberately the SOURCE OF TRUTH for whether 'pro'
-- is still in effect, not a separate boolean - a subscription that's past
-- its period end reverts to free automatically the moment anything checks
-- it (see web/lib/entitlements.ts), with no cron job needed to "expire" it
-- and no risk of that job silently not running. This is also what makes
-- the waitlist's promised free month work without touching Stripe at all
-- for those users: set current_period_end to one month out, no
-- stripe_subscription_id, and it behaves exactly like a real subscription
-- until it lapses.
alter table public.subscriptions
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text unique,
  add column if not exists current_period_end timestamptz,
  add column if not exists price_interval text; -- 'month' | 'year' | null (free, or a granted period with no Stripe price behind it)

create index if not exists subscriptions_stripe_customer_id_idx on public.subscriptions (stripe_customer_id);

-- service_role has no default table grants in this project (confirmed
-- repeatedly - see migration 028's own note), so the webhook handler
-- (which runs as service_role, since a Stripe webhook carries no Supabase
-- user JWT to act as) needs an explicit grant here or every plan update
-- from a real payment would fail identically to how profiles/usage_events
-- reads failed before migration 028.
GRANT UPDATE ON public.subscriptions TO service_role;

-- Grants the promised "one free month of Pro" (Terms of Service, "Beta
-- features and the Pro waitlist" section) the moment this migration runs,
-- to every waitlist signup that BOTH verified their email (double opt-in -
-- see the Waitlist Double Opt-In project history) AND has since created a
-- real account (user_id populated). Deliberately does NOT touch verified
-- rows with no user_id yet (someone who joined the waitlist but never
-- signed up) - there is no subscriptions row to grant against yet. Handling
-- that case (grant retroactively at signup time, matching by email) is a
-- separate, smaller follow-up, not blocking this migration.
insert into public.subscriptions (user_id, plan, current_period_end, price_interval)
select w.user_id, 'pro', now() + interval '1 month', null
from public.pro_waitlist w
where w.user_id is not null
  and w.verified_at is not null
on conflict (user_id) do update set
  plan = 'pro',
  current_period_end = greatest(
    coalesce(public.subscriptions.current_period_end, now()),
    now() + interval '1 month'
  ),
  price_interval = null
where public.subscriptions.plan != 'pro' or public.subscriptions.current_period_end is null;
