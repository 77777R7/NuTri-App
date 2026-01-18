create table if not exists public.user_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  supplement_id uuid not null references public.supplements (id) on delete cascade,
  check_in_date date not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, supplement_id, check_in_date)
);

create index if not exists user_checkins_user_date_idx
  on public.user_checkins (user_id, check_in_date);

create trigger user_checkins_set_updated_at
before update on public.user_checkins
for each row execute function public.set_current_timestamp_updated_at();

alter table public.user_checkins enable row level security;

create policy user_checkins_select_own on public.user_checkins
  for select
  using (auth.uid() = user_id);

create policy user_checkins_write_own on public.user_checkins
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
