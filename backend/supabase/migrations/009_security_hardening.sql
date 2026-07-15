-- ============================================================
-- 009 SECURITY HARDENING: run in Supabase SQL editor.
-- Brings dashboard-created tables under versioned, owner-only RLS
-- and locks down storage. Idempotent; safe to run twice.
-- ============================================================

-- 1. integrations (holds Notion ACCESS TOKENS, highest sensitivity)
alter table if exists public.integrations enable row level security;
drop policy if exists "Users manage their own integrations" on public.integrations;
create policy "Users manage their own integrations"
on public.integrations for all
using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Replace the previously suggested broad GRANT. anon must NEVER read a token table.
revoke all on public.integrations from anon;
grant select, insert, update, delete on public.integrations to authenticated;

-- 2. transcript_chunks (no user_id; access gated through sessions)
alter table if exists public.transcript_chunks enable row level security;
drop policy if exists "Users manage their own transcript chunks" on public.transcript_chunks;
create policy "Users manage their own transcript chunks"
on public.transcript_chunks for all
using (
  exists (
    select 1 from public.sessions s
    where s.id = transcript_chunks.session_id
      and s.user_id = auth.uid()
  )
);
revoke all on public.transcript_chunks from anon;

-- 3. Storage: recordings bucket scoped to the uploader's folder.
-- Path convention is {user_id}/{timestamp}.{ext}; enforce it.
drop policy if exists "Users upload to own folder" on storage.objects;
create policy "Users upload to own folder"
on storage.objects for insert to authenticated
with check (bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users read own recordings" on storage.objects;
create policy "Users read own recordings"
on storage.objects for select to authenticated
using (bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users delete own recordings" on storage.objects;
create policy "Users delete own recordings"
on storage.objects for delete to authenticated
using (bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text);

-- 4. Canonical public-profile RPC: returns stats ONLY when the profile
-- has opted in via is_public. Recreating it here makes the gate versioned.
create or replace function public.get_public_profile_stats(target_user_id uuid)
returns table (
  display_name text,
  course text,
  total_terms bigint,
  terms_this_week bigint
) as $$
  select
    p.display_name,
    p.course,
    (select count(*) from public.terms t where t.user_id = p.id) as total_terms,
    (select count(*) from public.terms t where t.user_id = p.id
       and t.created_at >= now() - interval '7 days') as terms_this_week
  from public.profiles p
  where p.id = target_user_id
    and p.is_public = true
$$ language sql stable security definer set search_path = public;

revoke all on function public.get_public_profile_stats(uuid) from public;
grant execute on function public.get_public_profile_stats(uuid) to anon, authenticated;

-- 5. Belt-and-braces: confirm RLS is on for every app table
alter table if exists public.sessions enable row level security;
alter table if exists public.terms enable row level security;
alter table if exists public.profiles enable row level security;
alter table if exists public.usage_events enable row level security;
alter table if exists public.subscriptions enable row level security;
alter table if exists public.quiz_attempts enable row level security;
alter table if exists public.syllabi enable row level security;
