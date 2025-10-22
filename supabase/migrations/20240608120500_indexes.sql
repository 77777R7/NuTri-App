-- Performance indexes for frequently queried fields.

create unique index if not exists supplements_barcode_unique_idx
  on public.supplements (barcode)
  where barcode is not null;

create index if not exists supplements_name_search_idx
  on public.supplements
  using gin (to_tsvector('english', coalesce(name, '')));

create unique index if not exists user_supplements_user_supplement_unique_idx
  on public.user_supplements (user_id, supplement_id);
