do $$
begin
  if not exists (
    select 1
    from pg_namespace n
    join pg_class c on c.relnamespace = n.oid
    where n.nspname = 'storage'
      and c.relname = 'buckets'
  ) then
    raise notice 'storage.buckets table not found; skipping personalization-artifacts bucket fallback';
    return;
  end if;

  if not exists (
    select 1
    from storage.buckets
    where id = 'personalization-artifacts'
  ) then
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'storage'
        and table_name = 'buckets'
        and column_name = 'public'
    ) then
      execute format(
        'insert into storage.buckets (id, name, public) values (%L, %L, %L) on conflict (id) do nothing',
        'personalization-artifacts',
        'personalization-artifacts',
        false
      );
    else
      execute format(
        'insert into storage.buckets (id, name) values (%L, %L) on conflict (id) do nothing',
        'personalization-artifacts',
        'personalization-artifacts'
      );
    end if;
  end if;
end;
$$;
