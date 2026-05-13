alter table public.waitlist_referral_milestone_events
  drop constraint if exists waitlist_referral_milestone_events_event_status_check;

alter table public.waitlist_referral_milestone_events
  add constraint waitlist_referral_milestone_events_event_status_check
  check (event_status in ('pending', 'processing', 'sent', 'failed', 'skipped'));

create or replace function private.claim_waitlist_referral_milestone_events_impl(
  p_limit integer default 25
)
returns table (
  event_id uuid,
  inviter_email text,
  milestone_friends integer,
  referred_count integer,
  bonus_days integer,
  total_trial_days integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
begin
  return query
  with claimed as (
    select event.id
    from public.waitlist_referral_milestone_events event
    where event.event_status = 'pending'
      or (
        event.event_status = 'processing'
        and event.updated_at < now() - interval '10 minutes'
      )
    order by event.created_at asc
    limit normalized_limit
    for update skip locked
  ),
  updated as (
    update public.waitlist_referral_milestone_events event
      set event_status = 'processing',
          updated_at = now()
      from claimed
      where event.id = claimed.id
      returning
        event.id,
        event.inviter_email,
        event.milestone_friends,
        event.referred_count,
        event.bonus_days,
        event.total_trial_days
  )
  select
    updated.id,
    updated.inviter_email,
    updated.milestone_friends,
    updated.referred_count,
    updated.bonus_days,
    updated.total_trial_days
  from updated;
end;
$$;

create or replace function public.claim_waitlist_referral_milestone_events(
  p_limit integer default 25
)
returns table (
  event_id uuid,
  inviter_email text,
  milestone_friends integer,
  referred_count integer,
  bonus_days integer,
  total_trial_days integer
)
language sql
set search_path = public, private
as $$
  select * from private.claim_waitlist_referral_milestone_events_impl(p_limit);
$$;

revoke all on function private.claim_waitlist_referral_milestone_events_impl(integer) from public;
revoke all on function public.claim_waitlist_referral_milestone_events(integer) from public;
grant execute on function private.claim_waitlist_referral_milestone_events_impl(integer) to service_role;
grant execute on function public.claim_waitlist_referral_milestone_events(integer) to service_role;

comment on function public.claim_waitlist_referral_milestone_events(integer) is
  'Service-role outbox claim used by the website API to send pending waitlist referral milestone emails through beehiiv.';
