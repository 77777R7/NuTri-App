create or replace function public.compute_waitlist_referral_milestone(referral_count integer)
returns integer
language sql
immutable
as $$
  select case
    when coalesce(referral_count, 0) >= 3 then 3
    when coalesce(referral_count, 0) = 2 then 2
    when coalesce(referral_count, 0) = 1 then 1
    else 0
  end;
$$;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create table if not exists public.waitlist_signups (
  email text primary key,
  referral_code text not null unique,
  referred_by_code text,
  beehiiv_subscription_id text,
  beehiiv_status text,
  signup_status text not null default 'active'
    check (signup_status in ('active', 'duplicate', 'pending_email_sync', 'email_sync_failed')),
  utm jsonb not null default '{}'::jsonb,
  referring_site text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint waitlist_signups_email_lowercase check (email = lower(email)),
  constraint waitlist_signups_referral_code_format check (referral_code ~ '^[a-f0-9]{12}$'),
  constraint waitlist_signups_referred_by_code_format
    check (referred_by_code is null or referred_by_code ~ '^[a-f0-9]{12}$'),
  constraint waitlist_signups_not_self_referred
    check (referred_by_code is null or referred_by_code <> referral_code)
);

create index if not exists waitlist_signups_referral_code_idx
  on public.waitlist_signups(referral_code);

create index if not exists waitlist_signups_referred_by_code_idx
  on public.waitlist_signups(referred_by_code)
  where referred_by_code is not null;

drop trigger if exists waitlist_signups_set_updated_at on public.waitlist_signups;
create trigger waitlist_signups_set_updated_at
  before update on public.waitlist_signups
  for each row
  execute function public.set_current_timestamp_updated_at();

alter table public.waitlist_signups enable row level security;

drop policy if exists waitlist_signups_select_own_email on public.waitlist_signups;
create policy waitlist_signups_select_own_email
  on public.waitlist_signups
  for select
  to authenticated
  using (email = lower(coalesce(auth.jwt() ->> 'email', '')));

create table if not exists public.waitlist_referrals (
  id uuid primary key default gen_random_uuid(),
  inviter_code text not null,
  inviter_email text not null references public.waitlist_signups(email) on update cascade on delete cascade,
  referred_email text not null references public.waitlist_signups(email) on update cascade on delete cascade,
  status text not null default 'confirmed' check (status in ('confirmed', 'ignored')),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint waitlist_referrals_inviter_code_format check (inviter_code ~ '^[a-f0-9]{12}$'),
  constraint waitlist_referrals_no_self_referral check (inviter_email <> referred_email)
);

create unique index if not exists waitlist_referrals_inviter_referred_uidx
  on public.waitlist_referrals(inviter_email, referred_email);

create unique index if not exists waitlist_referrals_referred_confirmed_uidx
  on public.waitlist_referrals(referred_email)
  where status = 'confirmed';

create index if not exists waitlist_referrals_inviter_status_idx
  on public.waitlist_referrals(inviter_email, status, created_at);

drop trigger if exists waitlist_referrals_set_updated_at on public.waitlist_referrals;
create trigger waitlist_referrals_set_updated_at
  before update on public.waitlist_referrals
  for each row
  execute function public.set_current_timestamp_updated_at();

alter table public.waitlist_referrals enable row level security;

drop policy if exists waitlist_referrals_select_inviter on public.waitlist_referrals;
create policy waitlist_referrals_select_inviter
  on public.waitlist_referrals
  for select
  to authenticated
  using (inviter_email = lower(coalesce(auth.jwt() ->> 'email', '')));

create table if not exists public.waitlist_referral_milestone_events (
  id uuid primary key default gen_random_uuid(),
  inviter_email text not null references public.waitlist_signups(email) on update cascade on delete cascade,
  milestone_friends integer not null check (milestone_friends in (1, 2, 3)),
  referred_count integer not null check (referred_count >= 0),
  bonus_days integer not null check (bonus_days in (1, 2, 4)),
  total_trial_days integer not null check (total_trial_days in (4, 5, 7)),
  event_status text not null default 'pending' check (event_status in ('pending', 'sent', 'failed', 'skipped')),
  beehiiv_response jsonb,
  created_at timestamp with time zone not null default now(),
  sent_at timestamp with time zone,
  updated_at timestamp with time zone not null default now(),
  unique (inviter_email, milestone_friends)
);

create index if not exists waitlist_referral_milestone_events_status_idx
  on public.waitlist_referral_milestone_events(event_status, created_at);

drop trigger if exists waitlist_referral_milestone_events_set_updated_at on public.waitlist_referral_milestone_events;
create trigger waitlist_referral_milestone_events_set_updated_at
  before update on public.waitlist_referral_milestone_events
  for each row
  execute function public.set_current_timestamp_updated_at();

alter table public.waitlist_referral_milestone_events enable row level security;

create or replace function private.register_waitlist_signup_impl(
  p_email text,
  p_referral_code text,
  p_referred_by_code text default null,
  p_utm jsonb default '{}'::jsonb,
  p_beehiiv_subscription_id text default null,
  p_beehiiv_status text default null,
  p_signup_status text default 'active',
  p_referring_site text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  email text,
  referral_code text,
  referred_by_code text,
  referred_count integer,
  bonus_days integer,
  total_trial_days integer,
  milestone_events jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_email text := lower(trim(coalesce(p_email, '')));
  normalized_referral_code text := lower(trim(coalesce(p_referral_code, '')));
  normalized_referred_by_code text := nullif(lower(trim(coalesce(p_referred_by_code, ''))), '');
  normalized_status text := coalesce(nullif(trim(p_signup_status), ''), 'active');
  was_new_signup boolean := false;
  inviter record;
  referral_rows integer := 0;
  old_referral_count integer := 0;
  new_referral_count integer := 0;
  old_milestone integer := 0;
  new_milestone integer := 0;
  milestone integer := 0;
  inserted_event_id uuid;
  inserted_event_inviter_email text;
  inserted_event_milestone_friends integer;
  inserted_event_referred_count integer;
  inserted_event_bonus_days integer;
  inserted_event_total_trial_days integer;
  created_events jsonb := '[]'::jsonb;
begin
  if normalized_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Invalid waitlist email' using errcode = '22023';
  end if;

  if normalized_referral_code !~ '^[a-f0-9]{12}$' then
    raise exception 'Invalid waitlist referral code' using errcode = '22023';
  end if;

  if normalized_referred_by_code is not null and normalized_referred_by_code !~ '^[a-f0-9]{12}$' then
    normalized_referred_by_code := null;
  end if;

  if normalized_referred_by_code = normalized_referral_code then
    normalized_referred_by_code := null;
  end if;

  if normalized_status not in ('active', 'duplicate', 'pending_email_sync', 'email_sync_failed') then
    normalized_status := 'active';
  end if;

  select not exists (
    select 1 from public.waitlist_signups signup where signup.email = normalized_email
  )
  into was_new_signup;

  insert into public.waitlist_signups (
    email,
    referral_code,
    referred_by_code,
    beehiiv_subscription_id,
    beehiiv_status,
    signup_status,
    utm,
    referring_site,
    metadata
  )
  values (
    normalized_email,
    normalized_referral_code,
    normalized_referred_by_code,
    p_beehiiv_subscription_id,
    p_beehiiv_status,
    normalized_status,
    coalesce(p_utm, '{}'::jsonb),
    nullif(trim(coalesce(p_referring_site, '')), ''),
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict on constraint waitlist_signups_pkey do update
    set beehiiv_subscription_id = coalesce(excluded.beehiiv_subscription_id, public.waitlist_signups.beehiiv_subscription_id),
        beehiiv_status = coalesce(excluded.beehiiv_status, public.waitlist_signups.beehiiv_status),
        signup_status = excluded.signup_status,
        utm = case
          when excluded.utm = '{}'::jsonb then public.waitlist_signups.utm
          else public.waitlist_signups.utm || excluded.utm
        end,
        referring_site = coalesce(excluded.referring_site, public.waitlist_signups.referring_site),
        metadata = public.waitlist_signups.metadata || excluded.metadata,
        updated_at = now();

  insert into public.waitlist_trial_bonuses (
    email,
    referral_code,
    referred_count,
    bonus_days,
    starting_trial_days,
    trial_status,
    source,
    synced_at
  )
  values (
    normalized_email,
    normalized_referral_code,
    0,
    0,
    3,
    'eligible',
    'waitlist_signup',
    now()
  )
  on conflict on constraint waitlist_trial_bonuses_pkey do update
    set referral_code = coalesce(public.waitlist_trial_bonuses.referral_code, excluded.referral_code),
        bonus_days = public.compute_waitlist_bonus_days(public.waitlist_trial_bonuses.referred_count),
        source = case
          when public.waitlist_trial_bonuses.source = 'app_default' then 'waitlist_signup'
          else public.waitlist_trial_bonuses.source
        end,
        synced_at = now(),
        updated_at = now();

  if was_new_signup and normalized_referred_by_code is not null then
    select signup.email, signup.referral_code
    into inviter
    from public.waitlist_signups signup
    where signup.referral_code = normalized_referred_by_code
    limit 1;

    if found and inviter.email <> normalized_email then
      insert into public.waitlist_trial_bonuses (
        email,
        referral_code,
        referred_count,
        bonus_days,
        starting_trial_days,
        trial_status,
        source,
        synced_at
      )
      values (
        inviter.email,
        inviter.referral_code,
        0,
        0,
        3,
        'eligible',
        'waitlist_signup',
        now()
      )
      on conflict on constraint waitlist_trial_bonuses_pkey do nothing;

      select coalesce(bonus.referred_count, 0)
      into old_referral_count
      from public.waitlist_trial_bonuses bonus
      where bonus.email = inviter.email
      for update;

      insert into public.waitlist_referrals (
        inviter_code,
        inviter_email,
        referred_email,
        status
      )
      values (
        normalized_referred_by_code,
        inviter.email,
        normalized_email,
        'confirmed'
      )
      on conflict do nothing;

      get diagnostics referral_rows = row_count;

      if referral_rows > 0 then
        update public.waitlist_signups signup
        set referred_by_code = normalized_referred_by_code,
            updated_at = now()
        where signup.email = normalized_email
          and signup.referred_by_code is null;
      end if;

      select count(*)::integer
      into new_referral_count
      from public.waitlist_referrals referral
      where referral.inviter_email = inviter.email
        and referral.status = 'confirmed';

      update public.waitlist_trial_bonuses bonus
      set referred_count = new_referral_count,
          bonus_days = public.compute_waitlist_bonus_days(new_referral_count),
          trial_status = case
            when bonus.trial_status = 'active'
              and greatest(
                coalesce(bonus.trial_expires_at, '-infinity'::timestamp with time zone),
                coalesce(bonus.trial_started_at, now())
                  + ((bonus.starting_trial_days + public.compute_waitlist_bonus_days(new_referral_count))::text || ' days')::interval
              ) <= now()
              then 'expired'
            else bonus.trial_status
          end,
          trial_expires_at = case
            when bonus.trial_status = 'active'
              then greatest(
                coalesce(bonus.trial_expires_at, '-infinity'::timestamp with time zone),
                coalesce(bonus.trial_started_at, now())
                  + ((bonus.starting_trial_days + public.compute_waitlist_bonus_days(new_referral_count))::text || ' days')::interval
              )
            else bonus.trial_expires_at
          end,
          synced_at = now(),
          updated_at = now()
      where bonus.email = inviter.email;

      old_milestone := public.compute_waitlist_referral_milestone(old_referral_count);
      new_milestone := public.compute_waitlist_referral_milestone(new_referral_count);

      if new_milestone > old_milestone then
        for milestone in (old_milestone + 1)..new_milestone loop
          inserted_event_id := null;
          inserted_event_inviter_email := null;
          inserted_event_milestone_friends := null;
          inserted_event_referred_count := null;
          inserted_event_bonus_days := null;
          inserted_event_total_trial_days := null;

          insert into public.waitlist_referral_milestone_events (
            inviter_email,
            milestone_friends,
            referred_count,
            bonus_days,
            total_trial_days
          )
          values (
            inviter.email,
            milestone,
            new_referral_count,
            public.compute_waitlist_bonus_days(milestone),
            3 + public.compute_waitlist_bonus_days(milestone)
          )
          on conflict (inviter_email, milestone_friends) do nothing
          returning
            waitlist_referral_milestone_events.id,
            waitlist_referral_milestone_events.inviter_email,
            waitlist_referral_milestone_events.milestone_friends,
            waitlist_referral_milestone_events.referred_count,
            waitlist_referral_milestone_events.bonus_days,
            waitlist_referral_milestone_events.total_trial_days
          into
            inserted_event_id,
            inserted_event_inviter_email,
            inserted_event_milestone_friends,
            inserted_event_referred_count,
            inserted_event_bonus_days,
            inserted_event_total_trial_days;

          if inserted_event_id is not null then
            created_events := created_events || jsonb_build_array(jsonb_build_object(
              'event_id', inserted_event_id,
              'inviter_email', inserted_event_inviter_email,
              'milestone_friends', inserted_event_milestone_friends,
              'referred_count', inserted_event_referred_count,
              'bonus_days', inserted_event_bonus_days,
              'total_trial_days', inserted_event_total_trial_days
            ));
          end if;
        end loop;
      end if;
    end if;
  end if;

  return query
  select
    bonus.email,
    bonus.referral_code,
    signup.referred_by_code,
    bonus.referred_count,
    bonus.bonus_days,
    bonus.total_trial_days,
    created_events
  from public.waitlist_trial_bonuses bonus
  left join public.waitlist_signups signup on signup.email = bonus.email
  where bonus.email = normalized_email;
end;
$$;

create or replace function public.register_waitlist_signup(
  p_email text,
  p_referral_code text,
  p_referred_by_code text default null,
  p_utm jsonb default '{}'::jsonb,
  p_beehiiv_subscription_id text default null,
  p_beehiiv_status text default null,
  p_signup_status text default 'active',
  p_referring_site text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  email text,
  referral_code text,
  referred_by_code text,
  referred_count integer,
  bonus_days integer,
  total_trial_days integer,
  milestone_events jsonb
)
language sql
set search_path = public, private
as $$
  select * from private.register_waitlist_signup_impl(
    p_email,
    p_referral_code,
    p_referred_by_code,
    p_utm,
    p_beehiiv_subscription_id,
    p_beehiiv_status,
    p_signup_status,
    p_referring_site,
    p_metadata
  );
$$;

create or replace function private.get_waitlist_trial_bonus_preview_impl()
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
  on conflict on constraint waitlist_trial_bonuses_pkey do update
    set bonus_days = public.compute_waitlist_bonus_days(public.waitlist_trial_bonuses.referred_count),
        trial_status = case
          when public.waitlist_trial_bonuses.trial_status = 'active'
            and public.waitlist_trial_bonuses.trial_expires_at <= now()
            then 'expired'
          else public.waitlist_trial_bonuses.trial_status
        end,
        synced_at = now(),
        updated_at = now();

  return query
  update public.waitlist_trial_bonuses bonus
    set bonus_days = public.compute_waitlist_bonus_days(bonus.referred_count),
        trial_status = case
          when bonus.trial_status = 'active' and bonus.trial_expires_at <= now() then 'expired'
          else bonus.trial_status
        end,
        updated_at = now()
    where bonus.email = current_email
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

create or replace function public.get_waitlist_trial_bonus_preview()
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
  select * from private.get_waitlist_trial_bonus_preview_impl();
$$;

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

  perform *
  from private.get_waitlist_trial_bonus_preview_impl();

  return query
  with computed as (
    select
      bonus.email,
      public.compute_waitlist_bonus_days(bonus.referred_count) as computed_bonus_days,
      case
        when bonus.trial_started_at is null or bonus.trial_status = 'eligible' then now()
        else bonus.trial_started_at
      end as effective_started_at
    from public.waitlist_trial_bonuses bonus
    where bonus.email = current_email
      and bonus.trial_status in ('eligible', 'active')
  ),
  updated as (
    update public.waitlist_trial_bonuses bonus
      set bonus_days = computed.computed_bonus_days,
          trial_status = case
            when computed.effective_started_at
              + ((bonus.starting_trial_days + computed.computed_bonus_days)::text || ' days')::interval > now()
              then 'active'
            else 'expired'
          end,
          trial_started_at = computed.effective_started_at,
          trial_expires_at = greatest(
            coalesce(bonus.trial_expires_at, '-infinity'::timestamp with time zone),
            computed.effective_started_at
              + ((bonus.starting_trial_days + computed.computed_bonus_days)::text || ' days')::interval
          ),
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
        bonus.trial_expires_at
  )
  select * from updated
  union all
  select
    bonus.email,
    bonus.referral_code,
    bonus.referred_count,
    bonus.starting_trial_days,
    bonus.bonus_days,
    bonus.total_trial_days,
    bonus.trial_status,
    bonus.trial_started_at,
    bonus.trial_expires_at
  from public.waitlist_trial_bonuses bonus
  where bonus.email = current_email
    and bonus.trial_status = 'expired'
    and not exists (select 1 from updated);
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

create or replace function private.mark_waitlist_referral_milestone_sent_impl(
  p_event_id uuid,
  p_event_status text default 'sent',
  p_beehiiv_response jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_status text := coalesce(nullif(trim(p_event_status), ''), 'sent');
begin
  if normalized_status not in ('sent', 'failed', 'skipped') then
    normalized_status := 'failed';
  end if;

  update public.waitlist_referral_milestone_events event
  set event_status = normalized_status,
      beehiiv_response = coalesce(p_beehiiv_response, '{}'::jsonb),
      sent_at = case when normalized_status = 'sent' then now() else event.sent_at end,
      updated_at = now()
  where event.id = p_event_id;
end;
$$;

create or replace function public.mark_waitlist_referral_milestone_sent(
  p_event_id uuid,
  p_event_status text default 'sent',
  p_beehiiv_response jsonb default '{}'::jsonb
)
returns void
language sql
set search_path = public, private
as $$
  select private.mark_waitlist_referral_milestone_sent_impl(
    p_event_id,
    p_event_status,
    p_beehiiv_response
  );
$$;

revoke all on function private.register_waitlist_signup_impl(text, text, text, jsonb, text, text, text, text, jsonb) from public;
revoke all on function public.register_waitlist_signup(text, text, text, jsonb, text, text, text, text, jsonb) from public;
grant execute on function private.register_waitlist_signup_impl(text, text, text, jsonb, text, text, text, text, jsonb) to service_role;
grant execute on function public.register_waitlist_signup(text, text, text, jsonb, text, text, text, text, jsonb) to service_role;

revoke all on function private.get_waitlist_trial_bonus_preview_impl() from public;
revoke all on function public.get_waitlist_trial_bonus_preview() from public;
grant execute on function private.get_waitlist_trial_bonus_preview_impl() to authenticated;
grant execute on function public.get_waitlist_trial_bonus_preview() to authenticated;

revoke all on function private.activate_waitlist_trial_bonus_impl() from public;
revoke all on function public.activate_waitlist_trial_bonus() from public;
grant execute on function private.activate_waitlist_trial_bonus_impl() to authenticated;
grant execute on function public.activate_waitlist_trial_bonus() to authenticated;

revoke all on function private.mark_waitlist_referral_milestone_sent_impl(uuid, text, jsonb) from public;
revoke all on function public.mark_waitlist_referral_milestone_sent(uuid, text, jsonb) from public;
grant execute on function private.mark_waitlist_referral_milestone_sent_impl(uuid, text, jsonb) to service_role;
grant execute on function public.mark_waitlist_referral_milestone_sent(uuid, text, jsonb) to service_role;

comment on table public.waitlist_signups is
  'Waitlist signup ledger keyed by email. Supabase is the source of truth; beehiiv IDs are stored as email-provider metadata.';

comment on table public.waitlist_referrals is
  'Confirmed waitlist referrals. Unique constraints prevent self-referrals and duplicate credited referrals.';

comment on table public.waitlist_trial_bonuses is
  'Launch waitlist trial bonuses keyed by email. Preview reads never start the trial; activation is explicit from the paywall.';

comment on function public.register_waitlist_signup(text, text, text, jsonb, text, text, text, text, jsonb) is
  'Server-side waitlist signup RPC used by the website API. Writes the Supabase ledger and returns newly-created referral milestone events.';

comment on function public.get_waitlist_trial_bonus_preview() is
  'Returns the authenticated user waitlist trial preview without starting the trial.';

comment on function public.activate_waitlist_trial_bonus() is
  'Starts the authenticated user waitlist trial only when the paywall activation button is pressed.';
