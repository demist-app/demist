-- Answers to in-app surveys, one row per question. First use: the Sean Ellis
-- "how would you feel if you could no longer use Demist" survey
-- (web/components/SurveyModal.tsx), shown once to people with 3+ lectures.
--
-- In our own database rather than PostHog: two of the four questions are
-- free text, and free text typed into the desktop app must not go to a third
-- party. PostHog gets only the multiple-choice answers.
create table if not exists public.survey_responses (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  survey        text not null,
  question_key  text not null,
  answer        text not null check (char_length(answer) between 1 and 2000),
  created_at    timestamptz not null default now(),
  -- Once per person per question: a double-submit cannot count someone twice.
  unique (user_id, survey, question_key)
);

alter table public.survey_responses enable row level security;

create policy "survey_responses: insert own"
  on public.survey_responses for insert to authenticated
  with check (user_id = auth.uid());

create policy "survey_responses: read own"
  on public.survey_responses for select to authenticated
  using (user_id = auth.uid());

-- No update or delete for users: an answer is a record of what they said.
grant select, insert on public.survey_responses to authenticated;
-- service_role has no default grants in this schema (027/028/029).
grant select on public.survey_responses to service_role;
