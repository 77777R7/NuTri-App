create or replace function public.compute_waitlist_bonus_days(referral_count integer)
returns integer
language sql
immutable
as $$
  select case
    when coalesce(referral_count, 0) >= 3 then 4
    when coalesce(referral_count, 0) = 2 then 2
    when coalesce(referral_count, 0) = 1 then 1
    else 0
  end;
$$;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table if not exists public.waitlist_trial_bonuses (
  email text primary key,
  referral_code text unique,
  referred_count integer not null default 0 check (referred_count >= 0),
  starting_trial_days integer not null default 3 check (starting_trial_days = 3),
  bonus_days integer not null default 0 check (bonus_days in (0, 1, 2, 4)),
  total_trial_days integer generated always as (starting_trial_days + bonus_days) stored,
  trial_status text not null default 'eligible' check (trial_status in ('eligible', 'active', 'expired')),
  trial_started_at timestamp with time zone,
  trial_expires_at timestamp with time zone,
  activated_user_id uuid references auth.users(id) on delete set null,
  source text not null default 'beehiiv',
  synced_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint waitlist_trial_bonuses_email_lowercase check (email = lower(email))
);

create index if not exists waitlist_trial_bonuses_referral_code_idx
  on public.waitlist_trial_bonuses(referral_code)
  where referral_code is not null;

create index if not exists waitlist_trial_bonuses_trial_status_idx
  on public.waitlist_trial_bonuses(trial_status, trial_expires_at);

drop trigger if exists waitlist_trial_bonuses_set_updated_at on public.waitlist_trial_bonuses;
create trigger waitlist_trial_bonuses_set_updated_at
  before update on public.waitlist_trial_bonuses
  for each row
  execute function public.set_current_timestamp_updated_at();

alter table public.waitlist_trial_bonuses enable row level security;

drop policy if exists waitlist_trial_bonuses_select_own_email on public.waitlist_trial_bonuses;
create policy waitlist_trial_bonuses_select_own_email
  on public.waitlist_trial_bonuses
  for select
  to authenticated
  using (email = lower(coalesce(auth.jwt() ->> 'email', '')));

create or replace function private.activate_waitlist_trial_bonus_impl()
returns table (
  email text,
  referral_code text,
  referred_count integer,
  starting_trial_days integer,
  bonus_days integer,
  total_trial_days integer,
  trial_status text,
  trial_started_at timestamp with time zone,
  trial_expires_at timestamp with time zone
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null or current_email = '' then
    return;
  end if;

  insert into public.waitlist_trial_bonuses (
    email,
    referred_count,
    bonus_days,
    starting_trial_days,
    trial_status,
    source,
    synced_at
  )
  values (
    current_email,
    0,
    0,
    3,
    'eligible',
    'app_default',
    now()
  )
  on conflict (email) do update
    set bonus_days = public.compute_waitlist_bonus_days(public.waitlist_trial_bonuses.referred_count),
        updated_at = now();

  return query
  with computed as (
    select
      bonus.email,
      public.compute_waitlist_bonus_days(bonus.referred_count) as computed_bonus_days,
      coalesce(bonus.trial_started_at, now()) as effective_started_at,
      coalesce(bonus.trial_started_at, now())
        + ((bonus.starting_trial_days + public.compute_waitlist_bonus_days(bonus.referred_count))::text || ' days')::interval
        as computed_expires_at
    from public.waitlist_trial_bonuses bonus
    where bonus.email = current_email
  )
  update public.waitlist_trial_bonuses bonus
    set bonus_days = computed.computed_bonus_days,
        trial_status = case
          when greatest(coalesce(bonus.trial_expires_at, computed.computed_expires_at), computed.computed_expires_at) > now()
            then 'active'
          else 'expired'
        end,
        trial_started_at = computed.effective_started_at,
        trial_expires_at = greatest(coalesce(bonus.trial_expires_at, computed.computed_expires_at), computed.computed_expires_at),
        activated_user_id = coalesce(bonus.activated_user_id, current_user_id),
        updated_at = now()
    from computed
    where bonus.email = computed.email
    returning
      bonus.email,
      bonus.referral_code,
      bonus.referred_count,
      bonus.starting_trial_days,
      bonus.bonus_days,
      bonus.total_trial_days,
      bonus.trial_status,
      bonus.trial_started_at,
      bonus.trial_expires_at;
end;
$$;

create or replace function public.activate_waitlist_trial_bonus()
returns table (
  email text,
  referral_code text,
  referred_count integer,
  starting_trial_days integer,
  bonus_days integer,
  total_trial_days integer,
  trial_status text,
  trial_started_at timestamp with time zone,
  trial_expires_at timestamp with time zone
)
language sql
set search_path = public, private
as $$
  select * from private.activate_waitlist_trial_bonus_impl();
$$;

revoke all on function private.activate_waitlist_trial_bonus_impl() from public;
revoke all on function public.activate_waitlist_trial_bonus() from public;
grant execute on function private.activate_waitlist_trial_bonus_impl() to authenticated;
grant execute on function public.activate_waitlist_trial_bonus() to authenticated;

comment on table public.waitlist_trial_bonuses is
  'Launch waitlist trial bonuses keyed by email. Populated from beehiiv referral attribution and activated automatically when the matching app user signs in.';

comment on function public.activate_waitlist_trial_bonus() is
  'Activates the current authenticated user email for the waitlist trial entitlement. Creates the base 3-day trial row when no waitlist bonus exists.';

comment on function private.activate_waitlist_trial_bonus_impl() is
  'Private security-definer implementation for waitlist trial activation. Called through the public RPC wrapper.';
