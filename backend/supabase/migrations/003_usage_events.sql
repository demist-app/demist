-- Usage tracking: logs every AI API call for cost dashboards, abuse detection,
-- and future per-user billing. Inserted by edge functions with the user's JWT.

create table if not exists usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade,
  event_type text not null, -- 'transcribe' | 'detect_terms' | 'summarize' | 'transcribe_audio' | 'process_text'
  provider text,            -- 'groq' | 'openai'
  tokens_used integer,
  cost_usd numeric(10, 6),
  session_id uuid,
  created_at timestamptz default now()
);

alter table usage_events enable row level security;

create policy "Users can read their own usage"
on usage_events for select using (auth.uid() = user_id);

-- Edge functions call with the user's JWT, so inserts are user-scoped
create policy "Users can insert their own usage"
on usage_events for insert with check (auth.uid() = user_id);

create index if not exists usage_events_user_id_idx on usage_events(user_id);
create index if not exists usage_events_created_at_idx on usage_events(created_at);
