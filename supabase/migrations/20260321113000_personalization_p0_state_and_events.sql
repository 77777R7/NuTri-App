create table if not exists public.user_personalization_state (
  user_id uuid primary key references public.users (id) on delete cascade,
  feedback_state jsonb not null default '{}'::jsonb,
  preference_vector jsonb,
  support_state text check (
    support_state in ('explore', 'choose', 'install', 'stabilize', 'optimize')
  ),
  last_snapshot_id text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists user_personalization_state_set_updated_at on public.user_personalization_state;

create trigger user_personalization_state_set_updated_at
before update on public.user_personalization_state
for each row execute function public.set_current_timestamp_updated_at();

create table if not exists public.user_personalization_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  event_name text not null,
  surface text,
  snapshot_id text,
  rules_version text,
  support_state text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists user_personalization_events_user_created_idx
  on public.user_personalization_events (user_id, created_at desc);

create index if not exists user_personalization_events_name_created_idx
  on public.user_personalization_events (event_name, created_at desc);

alter table public.user_personalization_state enable row level security;
alter table public.user_personalization_events enable row level security;

drop policy if exists user_personalization_state_select_own on public.user_personalization_state;
create policy user_personalization_state_select_own on public.user_personalization_state
  for select
  using (auth.uid() = user_id);

drop policy if exists user_personalization_state_insert_own on public.user_personalization_state;
create policy user_personalization_state_insert_own on public.user_personalization_state
  for insert
  with check (auth.uid() = user_id or auth.role() = 'service_role');

drop policy if exists user_personalization_state_update_own on public.user_personalization_state;
create policy user_personalization_state_update_own on public.user_personalization_state
  for update
  using (auth.uid() = user_id or auth.role() = 'service_role')
  with check (auth.uid() = user_id or auth.role() = 'service_role');

drop policy if exists user_personalization_events_select_own on public.user_personalization_events;
create policy user_personalization_events_select_own on public.user_personalization_events
  for select
  using (auth.uid() = user_id);

drop policy if exists user_personalization_events_insert_own on public.user_personalization_events;
create policy user_personalization_events_insert_own on public.user_personalization_events
  for insert
  with check (auth.uid() = user_id or auth.role() = 'service_role');
