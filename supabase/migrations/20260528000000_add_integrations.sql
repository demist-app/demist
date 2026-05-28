-- Integrations table for third-party OAuth connections (Notion, etc.)
create table if not exists public.integrations (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  provider     text not null,
  access_token text not null,
  workspace_id   text,
  workspace_name text,
  bot_id         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, provider)
);

alter table public.integrations enable row level security;

create policy "Users manage own integrations"
  on public.integrations
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Track how a session was created
alter table public.sessions
  add column if not exists source text not null default 'live';
