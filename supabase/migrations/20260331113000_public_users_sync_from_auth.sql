-- Keep public.users aligned with auth.users so downstream profile tables
-- referencing public.users can be written by authenticated clients.

create or replace function public.handle_auth_user_upsert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, email, created_at, updated_at)
  values (
    new.id,
    coalesce(new.email, new.id::text || '@supabase-user.local'),
    coalesce(new.created_at, timezone('utc', now())),
    timezone('utc', now())
  )
  on conflict (id) do update
    set email = excluded.email,
        updated_at = timezone('utc', now());

  return new;
end;
$$;

drop trigger if exists on_auth_user_upsert_public_users on auth.users;

create trigger on_auth_user_upsert_public_users
  after insert or update of email on auth.users
  for each row
  execute procedure public.handle_auth_user_upsert();

insert into public.users (id, email, created_at, updated_at)
select
  au.id,
  coalesce(au.email, au.id::text || '@supabase-user.local'),
  coalesce(au.created_at, timezone('utc', now())),
  timezone('utc', now())
from auth.users au
on conflict (id) do update
  set email = excluded.email,
      updated_at = timezone('utc', now());
