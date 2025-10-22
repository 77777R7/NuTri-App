-- Initial schema for NuTri Supabase project
-- Creates core tables, relationships, and helper triggers.

create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";

create or replace function public.set_current_timestamp_updated_at()
returns trigger as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$ language plpgsql;

create table if not exists public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text unique not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger users_set_updated_at
before update on public.users
for each row execute function public.set_current_timestamp_updated_at();

create table if not exists public.user_profiles (
  user_id uuid primary key references public.users (id) on delete cascade,
  height numeric(5,2),
  weight numeric(5,2),
  age integer check (age >= 0),
  gender text check (
    gender in ('male', 'female', 'non-binary', 'other', 'prefer_not_to_say')
  ),
  dietary_preference text,
  activity_level text check (
    activity_level in ('sedentary', 'light', 'moderate', 'active', 'very_active')
  ),
  location text,
  timezone text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger user_profiles_set_updated_at
before update on public.user_profiles
for each row execute function public.set_current_timestamp_updated_at();

create table if not exists public.brands (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  country text,
  website text,
  logo_url text,
  verified boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger brands_set_updated_at
before update on public.brands
for each row execute function public.set_current_timestamp_updated_at();

create table if not exists public.supplements (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands (id) on delete cascade,
  name text not null,
  barcode text,
  category text,
  image_url text,
  description text,
  verified boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index supplements_brand_name_unique on public.supplements (brand_id, name);

create trigger supplements_set_updated_at
before update on public.supplements
for each row execute function public.set_current_timestamp_updated_at();

create table if not exists public.ingredients (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  scientific_name text,
  rda_adult numeric(10,2),
  ul_adult numeric(10,2),
  unit text,
  benefits text,
  risks text,
  dietary_sources text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger ingredients_set_updated_at
before update on public.ingredients
for each row execute function public.set_current_timestamp_updated_at();

create table if not exists public.supplement_ingredients (
  supplement_id uuid not null references public.supplements (id) on delete cascade,
  ingredient_id uuid not null references public.ingredients (id) on delete cascade,
  amount numeric(10,2),
  unit text not null,
  daily_value_percentage numeric(5,2),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (supplement_id, ingredient_id)
);

create trigger supplement_ingredients_set_updated_at
before update on public.supplement_ingredients
for each row execute function public.set_current_timestamp_updated_at();

create table if not exists public.user_supplements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  supplement_id uuid not null references public.supplements (id) on delete cascade,
  saved_at timestamptz not null default timezone('utc', now()),
  reminder_enabled boolean not null default false,
  reminder_time time,
  reminder_frequency text,
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger user_supplements_set_updated_at
before update on public.user_supplements
for each row execute function public.set_current_timestamp_updated_at();

create table if not exists public.scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  scan_type text not null,
  barcode text,
  ocr_data jsonb,
  supplement_id uuid references public.supplements (id) on delete set null,
  confidence_score numeric(5,2),
  timestamp timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger scans_set_updated_at
before update on public.scans
for each row execute function public.set_current_timestamp_updated_at();

create table if not exists public.ai_analyses (
  id uuid primary key default gen_random_uuid(),
  supplement_id uuid references public.supplements (id) on delete set null,
  user_id uuid references public.users (id) on delete set null,
  analysis_data jsonb not null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.user_streak (
  user_id uuid primary key references public.users (id) on delete cascade,
  current_streak integer not null default 0 check (current_streak >= 0),
  longest_streak integer not null default 0 check (longest_streak >= 0),
  last_check_in date,
  total_check_ins integer not null default 0 check (total_check_ins >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger user_streak_set_updated_at
before update on public.user_streak
for each row execute function public.set_current_timestamp_updated_at();
