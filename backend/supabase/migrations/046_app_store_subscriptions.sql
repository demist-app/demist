-- Pro bought in the iPhone app (2026-11-28), through Apple in-app purchase
-- and RevenueCat. The revenuecat-webhook edge function writes these columns;
-- a row with store_transaction_id is a paying customer, exactly like one with
-- stripe_subscription_id (resolveEntitlement in web/lib/entitlementRules.ts).
--
-- One subscriptions row per user holds one period. The webhook only ever
-- moves current_period_end LATER (greatest of the stored end and Apple's),
-- except on a refund, so Apple can never shorten Pro a student already had
-- from a university offer, a referral or Stripe.

ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS store text CHECK (store IN ('app_store', 'play_store'));
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS store_transaction_id text;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS store_product_id text;
CREATE INDEX IF NOT EXISTS subscriptions_store_tx_idx ON public.subscriptions(store_transaction_id) WHERE store_transaction_id IS NOT NULL;
