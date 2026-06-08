-- Per-chunk transcript storage so the dashboard can stream a live transcript
-- via Supabase Realtime instead of waiting for the full session transcript.
create table if not exists public.transcript_chunks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.sessions on delete cascade,
  user_id uuid references auth.users on delete cascade,
  text text not null,
  chunk_index integer not null,
  created_at timestamptz default now()
);

alter table public.transcript_chunks enable row level security;

create policy "Users can manage their own transcript chunks"
  on public.transcript_chunks for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
