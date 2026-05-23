-- Enable pgvector
create extension if not exists vector;

-- Sessions table
create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade,
  subject text,
  year_of_study integer,
  started_at timestamptz default now(),
  ended_at timestamptz,
  terms_count integer default 0,
  summary text
);

-- Terms table
create table terms (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade,
  session_id uuid references sessions on delete cascade,
  term text not null,
  definition text not null,
  subject text,
  times_seen integer default 1,
  dismissed boolean default false,
  created_at timestamptz default now()
);

-- User profiles table
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  university text,
  course text,
  year_of_study integer,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Enable RLS on all tables
alter table sessions enable row level security;
alter table terms enable row level security;
alter table profiles enable row level security;

-- RLS Policies
create policy "Users can manage their own sessions"
on sessions for all using (auth.uid() = user_id);

create policy "Users can manage their own terms"
on terms for all using (auth.uid() = user_id);

create policy "Users can manage their own profile"
on profiles for all using (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id)
  values (new.id);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
