-- ============================================================
-- REPLACES the kit's 006_course_packs.sql. Do NOT run the old one.
-- Fix: the original allowed any signed-in user to SELECT every pack,
-- exposing all join codes (anyone could enumerate and join any pack).
-- Now: packs are visible only to owners and members; joining happens
-- through a SECURITY DEFINER function that takes the code.
-- ============================================================

create table if not exists packs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  subject text,
  join_code text not null unique default upper(substring(md5(random()::text) from 1 for 6)),
  created_at timestamptz default now()
);

create table if not exists pack_terms (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid references packs on delete cascade,
  term text not null,
  definition text not null,
  added_by uuid references auth.users on delete set null,
  created_at timestamptz default now(),
  unique (pack_id, term)
);

create table if not exists pack_members (
  pack_id uuid references packs on delete cascade,
  user_id uuid references auth.users on delete cascade,
  joined_at timestamptz default now(),
  primary key (pack_id, user_id)
);

alter table packs enable row level security;
alter table pack_terms enable row level security;
alter table pack_members enable row level security;

drop policy if exists "Authenticated can read packs" on packs;
create policy "Owners and members read packs" on packs for select using (
  auth.uid() = owner_id
  or exists (select 1 from pack_members m where m.pack_id = packs.id and m.user_id = auth.uid())
);
create policy "Owners manage their packs" on packs for all
using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "Members read pack terms" on pack_terms for select using (
  exists (select 1 from pack_members m where m.pack_id = pack_terms.pack_id and m.user_id = auth.uid())
  or exists (select 1 from packs p where p.id = pack_terms.pack_id and p.owner_id = auth.uid())
);
create policy "Members add pack terms" on pack_terms for insert with check (
  auth.uid() = added_by and (
    exists (select 1 from pack_members m where m.pack_id = pack_terms.pack_id and m.user_id = auth.uid())
    or exists (select 1 from packs p where p.id = pack_terms.pack_id and p.owner_id = auth.uid())
  )
);

create policy "Users manage own membership" on pack_members for all
using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Owners see members" on pack_members for select using (
  exists (select 1 from packs p where p.id = pack_members.pack_id and p.owner_id = auth.uid())
);

-- Join by code without exposing the packs table. Adds the caller as a member
-- and returns the pack id + name. Rate limiting is the caller's concern.
create or replace function public.join_pack_by_code(code text)
returns table (pack_id uuid, pack_name text) as $$
declare
  p record;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select id, name into p from public.packs where join_code = upper(trim(code));
  if p.id is null then return; end if;
  insert into public.pack_members (pack_id, user_id) values (p.id, auth.uid())
  on conflict do nothing;
  return query select p.id, p.name;
end;
$$ language plpgsql security definer set search_path = public;

revoke all on function public.join_pack_by_code(text) from anon, public;
grant execute on function public.join_pack_by_code(text) to authenticated;

create index if not exists pack_terms_pack_idx on pack_terms(pack_id);
create index if not exists pack_members_user_idx on pack_members(user_id);
