-- Paywall scaffold: data model only. PAYWALL_ENABLED=false in the web app,
-- so no user is affected until the flag is flipped.

create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade unique,
  plan text not null default 'free', -- 'free' | 'pro'
  period_start timestamptz not null default date_trunc('month', now()),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table subscriptions enable row level security;

create policy "Users can read their own subscription"
on subscriptions for select using (auth.uid() = user_id);

-- Auto-create a subscription row on signup
create or replace function public.handle_new_subscription()
returns trigger as $$
begin
  insert into public.subscriptions (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_subscription on auth.users;
create trigger on_auth_user_subscription
  after insert on auth.users
  for each row execute procedure public.handle_new_subscription();

-- Backfill existing users
insert into public.subscriptions (user_id)
select id from auth.users
on conflict (user_id) do nothing;
