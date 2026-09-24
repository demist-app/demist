-- One row per Pro expiry email sent (web/app/api/cron/pro-expiry/route.ts).
--
-- The row is written BEFORE the email is sent, and the unique constraint is
-- what makes a send happen at most once: two overlapping cron runs, or a
-- retry after a timeout, both hit the constraint instead of emailing someone
-- twice. If Resend then rejects the send, the route deletes its own row so
-- the next daily run tries again.
--
-- period_end is part of the key so a user whose Pro ends twice (a comped
-- month, later a lapsed trial or a second comp) is told about each ending.
create table if not exists public.pro_expiry_emails (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  stage       text not null check (stage in ('minus7', 'minus1', 'day0')),
  source      text not null check (source in ('comped', 'trial')),
  period_end  timestamptz not null,
  sent_at     timestamptz not null default now(),
  resend_id   text,
  unique (user_id, stage, period_end)
);

-- Server only. RLS on with no policies: no browser can read or write it.
alter table public.pro_expiry_emails enable row level security;

-- service_role has no table grants by default in this schema (migrations
-- 027/028/029). Without this, every insert fails with 42501; the route stops
-- the run and returns 500 on any claim error other than a duplicate.
grant select, insert, update, delete on public.pro_expiry_emails to service_role;
