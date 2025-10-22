-- Row Level Security configuration and policies.

alter table public.users enable row level security;
alter table public.user_profiles enable row level security;
alter table public.brands enable row level security;
alter table public.supplements enable row level security;
alter table public.ingredients enable row level security;
alter table public.supplement_ingredients enable row level security;
alter table public.user_supplements enable row level security;
alter table public.scans enable row level security;
alter table public.ai_analyses enable row level security;
alter table public.user_streak enable row level security;

-- Users
create policy users_select_self on public.users
  for select
  using (auth.uid() = id);

create policy users_insert_self on public.users
  for insert
  with check (auth.uid() = id or auth.role() = 'service_role');

create policy users_update_self on public.users
  for update
  using (auth.uid() = id or auth.role() = 'service_role')
  with check (auth.uid() = id or auth.role() = 'service_role');

-- User profiles
create policy user_profiles_select_self on public.user_profiles
  for select
  using (auth.uid() = user_id);

create policy user_profiles_insert_self on public.user_profiles
  for insert
  with check (auth.uid() = user_id or auth.role() = 'service_role');

create policy user_profiles_update_self on public.user_profiles
  for update
  using (auth.uid() = user_id or auth.role() = 'service_role')
  with check (auth.uid() = user_id or auth.role() = 'service_role');

-- Brands (read for everyone, write restricted to service role)
create policy brands_select_all on public.brands
  for select
  using (true);

create policy brands_write_service_role on public.brands
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Supplements
create policy supplements_select_all on public.supplements
  for select
  using (true);

create policy supplements_write_service_role on public.supplements
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Ingredients
create policy ingredients_select_all on public.ingredients
  for select
  using (true);

create policy ingredients_write_service_role on public.ingredients
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Supplement ingredients linking table
create policy supplement_ingredients_select_all on public.supplement_ingredients
  for select
  using (true);

create policy supplement_ingredients_write_service_role on public.supplement_ingredients
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- User supplements
create policy user_supplements_select_own on public.user_supplements
  for select
  using (auth.uid() = user_id);

create policy user_supplements_write_own on public.user_supplements
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Scans
create policy scans_select_own on public.scans
  for select
  using (auth.uid() = user_id);

create policy scans_write_own on public.scans
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- AI analyses
create policy ai_analyses_select_accessible on public.ai_analyses
  for select
  using (
    user_id is null
    or auth.uid() = user_id
  );

create policy ai_analyses_insert_authenticated on public.ai_analyses
  for insert
  with check (auth.uid() = user_id or user_id is null or auth.role() = 'service_role');

create policy ai_analyses_update_owner on public.ai_analyses
  for update
  using (auth.uid() = user_id or auth.role() = 'service_role')
  with check (auth.uid() = user_id or auth.role() = 'service_role');

-- User streak
create policy user_streak_select_self on public.user_streak
  for select
  using (auth.uid() = user_id);

create policy user_streak_upsert_self on public.user_streak
  for all
  using (auth.uid() = user_id or auth.role() = 'service_role')
  with check (auth.uid() = user_id or auth.role() = 'service_role');
