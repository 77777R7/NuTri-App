-- SQL-native allergy normalization and backfill helpers.
-- This lets us backfill product_allergen_flags directly through Supabase MCP
-- without depending on local service-role env vars.

create or replace function public.append_unique_text(existing_values text[], next_value text)
returns text[]
language sql
immutable
set search_path = public
as $$
  select case
    when next_value is null or btrim(next_value) = '' then coalesce(existing_values, '{}'::text[])
    when next_value = any(coalesce(existing_values, '{}'::text[])) then coalesce(existing_values, '{}'::text[])
    else coalesce(existing_values, '{}'::text[]) || next_value
  end;
$$;

create or replace function public.normalize_allergy_text(raw_text text)
returns text
language sql
immutable
set search_path = public
as $$
  select trim(regexp_replace(lower(coalesce(raw_text, '')), '\s+', ' ', 'g'));
$$;

create or replace function public.allergy_text_matches(
  corpus text,
  positive_patterns text[],
  negative_patterns text[] default '{}'::text[],
  exclusion_patterns text[] default '{}'::text[]
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select
    coalesce(corpus, '') <> ''
    and exists (
      select 1
      from unnest(coalesce(positive_patterns, '{}'::text[])) as pattern
      where coalesce(corpus, '') ~* replace(pattern, E'\\b', E'\\y')
    )
    and not exists (
      select 1
      from unnest(coalesce(negative_patterns, '{}'::text[])) as pattern
      where coalesce(corpus, '') ~* replace(pattern, E'\\b', E'\\y')
    )
    and not exists (
      select 1
      from unnest(coalesce(exclusion_patterns, '{}'::text[])) as pattern
      where coalesce(corpus, '') ~* replace(pattern, E'\\b', E'\\y')
    );
$$;

create or replace function public.product_allergy_match_details_for_corpus(
  flag_name text,
  active_text text,
  inactive_text text,
  disclosure_text text,
  warning_text text,
  positive_patterns text[],
  negative_patterns text[] default '{}'::text[],
  exclusion_patterns text[] default '{}'::text[]
)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  details jsonb := '[]'::jsonb;
  active_normalized text := public.normalize_allergy_text(active_text);
  inactive_normalized text := public.normalize_allergy_text(inactive_text);
  disclosure_normalized text := public.normalize_allergy_text(disclosure_text);
  warning_normalized text := public.normalize_allergy_text(warning_text);
begin
  if public.allergy_text_matches(active_normalized, positive_patterns, negative_patterns, exclusion_patterns) then
    details := details || jsonb_build_array(jsonb_build_object(
      'flag', flag_name,
      'source', 'active_ingredient',
      'matchedText', left(trim(regexp_replace(coalesce(active_text, ''), '\s+', ' ', 'g')), 240),
      'confidence', 'high'
    ));
  end if;

  if public.allergy_text_matches(inactive_normalized, positive_patterns, negative_patterns, exclusion_patterns) then
    details := details || jsonb_build_array(jsonb_build_object(
      'flag', flag_name,
      'source', 'inactive_ingredient',
      'matchedText', left(trim(regexp_replace(coalesce(inactive_text, ''), '\s+', ' ', 'g')), 240),
      'confidence', 'high'
    ));
  end if;

  if public.allergy_text_matches(disclosure_normalized, positive_patterns, negative_patterns, exclusion_patterns) then
    details := details || jsonb_build_array(jsonb_build_object(
      'flag', flag_name,
      'source', 'label_disclosure',
      'matchedText', left(trim(regexp_replace(coalesce(disclosure_text, ''), '\s+', ' ', 'g')), 240),
      'confidence', 'medium'
    ));
  end if;

  if public.allergy_text_matches(warning_normalized, positive_patterns, negative_patterns, exclusion_patterns) then
    details := details || jsonb_build_array(jsonb_build_object(
      'flag', flag_name,
      'source', 'warning',
      'matchedText', left(trim(regexp_replace(coalesce(warning_text, ''), '\s+', ' ', 'g')), 240),
      'confidence', 'low'
    ));
  end if;

  return details;
end;
$$;

create or replace function public.compute_product_allergen_flags(
  active_text text,
  inactive_text text,
  disclosure_text text default null,
  warning_text text default null
)
returns table (
  allergy_flags text[],
  ingredient_restrictions text[],
  coverage_status text,
  match_evidence jsonb
)
language plpgsql
immutable
set search_path = public
as $$
declare
  rule jsonb;
  rule_flag text;
  rule_kind text;
  positive_patterns text[];
  negative_patterns text[];
  exclusion_patterns text[];
  rule_details jsonb;
  details_payload jsonb := '{}'::jsonb;
  active_normalized text := public.normalize_allergy_text(active_text);
  inactive_normalized text := public.normalize_allergy_text(inactive_text);
  disclosure_normalized text := public.normalize_allergy_text(disclosure_text);
  warning_normalized text := public.normalize_allergy_text(warning_text);
  rules jsonb := jsonb_build_array(
    jsonb_build_object(
      'flag', 'milk',
      'kind', 'allergy',
      'positives', jsonb_build_array(E'\\bmilk\\b', E'\\bdairy\\b', E'\\bwhey\\b', E'\\bcasein(?:ate)?\\b', E'\\blactose\\b', E'\\bmilk protein\\b', E'\\bcolostrum\\b'),
      'negatives', jsonb_build_array(E'\\b(?:milk|dairy)[-\\s]?free\\b', E'\\bfree (?:of|from) (?:milk|dairy)\\b', E'\\bwithout (?:milk|dairy)\\b', E'\\bno (?:milk|dairy)\\b'),
      'exclusions', jsonb_build_array(E'\\bmilk thistle\\b')
    ),
    jsonb_build_object(
      'flag', 'egg',
      'kind', 'allergy',
      'positives', jsonb_build_array(E'\\begg\\b', E'\\begg white\\b', E'\\begg yolk\\b', E'\\balbumen\\b', E'\\bovalbumin\\b'),
      'negatives', jsonb_build_array(E'\\begg[-\\s]?free\\b', E'\\bfree (?:of|from) egg\\b', E'\\bwithout egg\\b', E'\\bno egg\\b'),
      'exclusions', '[]'::jsonb
    ),
    jsonb_build_object(
      'flag', 'fish',
      'kind', 'allergy',
      'positives', jsonb_build_array(E'\\bfish\\b', E'\\bfish oil\\b', E'\\bcod liver oil\\b', E'\\banchovy\\b', E'\\bsalmon\\b', E'\\bsardine\\b', E'\\bmackerel\\b', E'\\btuna\\b', E'\\bmenhaden\\b', E'\\bpollock\\b', E'\\btrout\\b'),
      'negatives', jsonb_build_array(E'\\bfish[-\\s]?free\\b', E'\\bfree (?:of|from) fish\\b', E'\\bwithout fish\\b', E'\\bno fish\\b'),
      'exclusions', '[]'::jsonb
    ),
    jsonb_build_object(
      'flag', 'shellfish',
      'kind', 'allergy',
      'positives', jsonb_build_array(E'\\bshellfish\\b', E'\\bshrimp\\b', E'\\bprawn\\b', E'\\bkrill\\b', E'\\blobster\\b', E'\\bcrab\\b', E'\\bcrayfish\\b', E'\\bclam\\b', E'\\bmussel\\b', E'\\boyster\\b', E'\\bscallop\\b'),
      'negatives', jsonb_build_array(E'\\bshellfish[-\\s]?free\\b', E'\\bfree (?:of|from) shellfish\\b', E'\\bwithout shellfish\\b', E'\\bno shellfish\\b'),
      'exclusions', '[]'::jsonb
    ),
    jsonb_build_object(
      'flag', 'tree_nuts',
      'kind', 'allergy',
      'positives', jsonb_build_array(E'\\btree nuts?\\b', E'\\balmond\\b', E'\\bcashew\\b', E'\\bwalnut\\b', E'\\bpecan\\b', E'\\bpistachio\\b', E'\\bmacadamia\\b', E'\\bhazelnut\\b', E'\\bbrazil nut\\b'),
      'negatives', jsonb_build_array(E'\\btree nut[-\\s]?free\\b', E'\\bnut[-\\s]?free\\b', E'\\bfree (?:of|from) tree nuts?\\b', E'\\bwithout tree nuts?\\b', E'\\bno tree nuts?\\b'),
      'exclusions', '[]'::jsonb
    ),
    jsonb_build_object(
      'flag', 'peanuts',
      'kind', 'allergy',
      'positives', jsonb_build_array(E'\\bpeanut(?:s)?\\b', E'\\bgroundnut\\b', E'\\barachis\\b'),
      'negatives', jsonb_build_array(E'\\bpeanut[-\\s]?free\\b', E'\\bfree (?:of|from) peanuts?\\b', E'\\bwithout peanuts?\\b', E'\\bno peanuts?\\b'),
      'exclusions', '[]'::jsonb
    ),
    jsonb_build_object(
      'flag', 'wheat',
      'kind', 'allergy',
      'positives', jsonb_build_array(E'\\bwheat(?:grass| germ| bran| flour)?\\b'),
      'negatives', jsonb_build_array(E'\\bwheat[-\\s]?free\\b', E'\\bfree (?:of|from) wheat\\b', E'\\bwithout wheat\\b', E'\\bno wheat\\b'),
      'exclusions', '[]'::jsonb
    ),
    jsonb_build_object(
      'flag', 'soy',
      'kind', 'allergy',
      'positives', jsonb_build_array(E'\\bsoy\\b', E'\\bsoya\\b', E'\\bsoybean\\b', E'\\bsoy lecithin\\b', E'\\bsoy protein\\b'),
      'negatives', jsonb_build_array(E'\\bsoy[-\\s]?free\\b', E'\\bsoya[-\\s]?free\\b', E'\\bfree (?:of|from) soy\\b', E'\\bwithout soy\\b', E'\\bno soy\\b'),
      'exclusions', '[]'::jsonb
    ),
    jsonb_build_object(
      'flag', 'sesame',
      'kind', 'allergy',
      'positives', jsonb_build_array(E'\\bsesame\\b', E'\\btahini\\b', E'\\bsesamum\\b'),
      'negatives', jsonb_build_array(E'\\bsesame[-\\s]?free\\b', E'\\bfree (?:of|from) sesame\\b', E'\\bwithout sesame\\b', E'\\bno sesame\\b'),
      'exclusions', '[]'::jsonb
    ),
    jsonb_build_object(
      'flag', 'gluten',
      'kind', 'restriction',
      'positives', jsonb_build_array(E'\\bgluten\\b', E'\\bbarley\\b', E'\\brye\\b', E'\\btriticale\\b', E'\\bmalt\\b(?!odextrin)'),
      'negatives', jsonb_build_array(E'\\bgluten[-\\s]?free\\b', E'\\bfree (?:of|from) gluten\\b', E'\\bwithout gluten\\b', E'\\bno gluten\\b'),
      'exclusions', '[]'::jsonb
    ),
    jsonb_build_object(
      'flag', 'gelatin_animal_based',
      'kind', 'restriction',
      'positives', jsonb_build_array(E'\\bgelatin\\b', E'\\bgelatine\\b', E'\\bcapsule shell\\b', E'\\bsoftgel\\b'),
      'negatives', jsonb_build_array(E'\\bgelatin[-\\s]?free\\b', E'\\bvegan capsule\\b', E'\\bvegetarian capsule\\b', E'\\bplant capsule\\b'),
      'exclusions', '[]'::jsonb
    )
  );
begin
  allergy_flags := '{}'::text[];
  ingredient_restrictions := '{}'::text[];

  coverage_status := case
    when active_normalized <> '' or inactive_normalized <> '' then 'resolved'
    when disclosure_normalized <> '' or warning_normalized <> '' then 'partial'
    else 'insufficient'
  end;

  for rule in
    select value
    from jsonb_array_elements(rules)
  loop
    rule_flag := rule ->> 'flag';
    rule_kind := rule ->> 'kind';
    positive_patterns := array(select jsonb_array_elements_text(coalesce(rule -> 'positives', '[]'::jsonb)));
    negative_patterns := array(select jsonb_array_elements_text(coalesce(rule -> 'negatives', '[]'::jsonb)));
    exclusion_patterns := array(select jsonb_array_elements_text(coalesce(rule -> 'exclusions', '[]'::jsonb)));

    rule_details := public.product_allergy_match_details_for_corpus(
      rule_flag,
      active_text,
      inactive_text,
      disclosure_text,
      warning_text,
      positive_patterns,
      negative_patterns,
      exclusion_patterns
    );

    if jsonb_typeof(rule_details) = 'array' and jsonb_array_length(rule_details) > 0 then
      if rule_kind = 'allergy' then
        allergy_flags := public.append_unique_text(allergy_flags, rule_flag);
      else
        ingredient_restrictions := public.append_unique_text(ingredient_restrictions, rule_flag);
      end if;
      details_payload := jsonb_set(details_payload, array[rule_flag], rule_details, true);
    end if;
  end loop;

  match_evidence := jsonb_build_object('flags', details_payload);
  return next;
end;
$$;

create or replace function public.backfill_product_allergen_flags(
  p_source text default 'all',
  p_limit integer default null
)
returns table (
  backfill_source text,
  upserted_count bigint
)
language plpgsql
set search_path = public
as $$
declare
  affected_rows bigint;
begin
  if p_source not in ('all', 'dsld', 'lnhpd', 'iherb_overlay') then
    raise exception 'Unsupported source %', p_source;
  end if;

  if p_source in ('all', 'dsld') then
    insert into public.product_allergen_flags (
      source,
      source_id,
      canonical_source_id,
      allergy_flags,
      ingredient_restrictions,
      coverage_status,
      match_evidence,
      normalization_version,
      computed_at,
      created_at,
      updated_at
    )
    select
      'dsld'::text as source,
      dsld_source.dsld_label_id::text as source_id,
      coalesce(
        nullif(dsld_source.barcode_normalized_gtin14, ''),
        case
          when dsld_source.canonical_dsld_label_id is not null then dsld_source.canonical_dsld_label_id::text
          else null
        end
      ) as canonical_source_id,
      computed.allergy_flags,
      computed.ingredient_restrictions,
      computed.coverage_status,
      computed.match_evidence,
      'allergen_norm_sql_v1'::text as normalization_version,
      timezone('utc', now()) as computed_at,
      timezone('utc', now()) as created_at,
      timezone('utc', now()) as updated_at
    from (
      select
        meta.dsld_label_id,
        meta.barcode_normalized_gtin14,
        meta.canonical_dsld_label_id,
        meta.active_ingredients_summary,
        meta.inactive_ingredients,
        null::text as disclosure_text
      from public.dsld_labels_meta as meta
      order by meta.dsld_label_id
      limit coalesce(p_limit, 2147483647)
    ) as dsld_source
    cross join lateral public.compute_product_allergen_flags(
      dsld_source.active_ingredients_summary,
      dsld_source.inactive_ingredients,
      dsld_source.disclosure_text,
      null
    ) as computed
    on conflict (source, source_id) do update
      set canonical_source_id = excluded.canonical_source_id,
          allergy_flags = excluded.allergy_flags,
          ingredient_restrictions = excluded.ingredient_restrictions,
          coverage_status = excluded.coverage_status,
          match_evidence = excluded.match_evidence,
          normalization_version = excluded.normalization_version,
          computed_at = excluded.computed_at,
          updated_at = timezone('utc', now());

    get diagnostics affected_rows = row_count;
    backfill_source := 'dsld';
    upserted_count := affected_rows;
    return next;
  end if;

  if p_source in ('all', 'lnhpd') then
    insert into public.product_allergen_flags (
      source,
      source_id,
      canonical_source_id,
      allergy_flags,
      ingredient_restrictions,
      coverage_status,
      match_evidence,
      normalization_version,
      computed_at,
      created_at,
      updated_at
    )
    select
      'lnhpd'::text as source,
      lnhpd_source.lnhpd_id::text as source_id,
      nullif(lnhpd_source.npn, '') as canonical_source_id,
      computed.allergy_flags,
      computed.ingredient_restrictions,
      computed.coverage_status,
      computed.match_evidence,
      'allergen_norm_sql_v1'::text as normalization_version,
      timezone('utc', now()) as computed_at,
      timezone('utc', now()) as created_at,
      timezone('utc', now()) as updated_at
    from (
      select
        facts.lnhpd_id,
        facts.npn,
        coalesce((
          select string_agg(
            coalesce(
              item ->> 'ingredient_name',
              item ->> 'ingredientName',
              item ->> 'proper_name',
              item ->> 'properName',
              item ->> 'name'
            ),
            ', '
          )
          from jsonb_array_elements(
            coalesce(
              facts.facts_json -> 'medicinalIngredients',
              facts.facts_json -> 'medicinal_ingredients',
              '[]'::jsonb
            )
          ) as item
        ), '') as medicinal_text,
        coalesce((
          select string_agg(
            coalesce(
              item ->> 'nonmedicinal_ingredient_name',
              item ->> 'nonMedicinalIngredientName',
              item ->> 'ingredient_name',
              item ->> 'ingredientName',
              item ->> 'name'
            ),
            ', '
          )
          from jsonb_array_elements(
            coalesce(
              facts.facts_json -> 'nonMedicinalIngredients',
              facts.facts_json -> 'non_medicinal_ingredients',
              '[]'::jsonb
            )
          ) as item
        ), '') as non_medicinal_text
      from public.lnhpd_facts as facts
      where coalesce(facts.is_on_market, true)
      order by facts.lnhpd_id
      limit coalesce(p_limit, 2147483647)
    ) as lnhpd_source
    cross join lateral public.compute_product_allergen_flags(
      nullif(lnhpd_source.medicinal_text, ''),
      nullif(lnhpd_source.non_medicinal_text, ''),
      null,
      null
    ) as computed
    on conflict (source, source_id) do update
      set canonical_source_id = excluded.canonical_source_id,
          allergy_flags = excluded.allergy_flags,
          ingredient_restrictions = excluded.ingredient_restrictions,
          coverage_status = excluded.coverage_status,
          match_evidence = excluded.match_evidence,
          normalization_version = excluded.normalization_version,
          computed_at = excluded.computed_at,
          updated_at = timezone('utc', now());

    get diagnostics affected_rows = row_count;
    backfill_source := 'lnhpd';
    upserted_count := affected_rows;
    return next;
  end if;

  if p_source in ('all', 'iherb_overlay') then
    insert into public.product_allergen_flags (
      source,
      source_id,
      canonical_source_id,
      allergy_flags,
      ingredient_restrictions,
      coverage_status,
      match_evidence,
      normalization_version,
      computed_at,
      created_at,
      updated_at
    )
    select
      'iherb_overlay'::text as source,
      iherb_source.product_id as source_id,
      nullif(iherb_source.barcode_gtin14, '') as canonical_source_id,
      computed.allergy_flags,
      computed.ingredient_restrictions,
      computed.coverage_status,
      computed.match_evidence,
      'allergen_norm_sql_v1'::text as normalization_version,
      timezone('utc', now()) as computed_at,
      timezone('utc', now()) as created_at,
      timezone('utc', now()) as updated_at
    from (
      select
        overlay.product_id,
        overlay.barcode_gtin14,
        overlay.supplement_facts::text as active_text,
        coalesce(
          overlay.description_sections ->> 'Other ingredients',
          overlay.description_sections ->> 'Other Ingredients',
          overlay.description_sections ->> 'other ingredients'
        ) as inactive_text,
        overlay.description_sections::text as disclosure_text,
        coalesce(
          overlay.description_sections ->> 'Warnings',
          overlay.description_sections ->> 'Warning',
          overlay.description_sections ->> 'warnings',
          overlay.description_sections ->> 'warning'
        ) as warning_text
      from public.iherb_overlay_products as overlay
      order by overlay.id
      limit coalesce(p_limit, 2147483647)
    ) as iherb_source
    cross join lateral public.compute_product_allergen_flags(
      iherb_source.active_text,
      iherb_source.inactive_text,
      iherb_source.disclosure_text,
      iherb_source.warning_text
    ) as computed
    on conflict (source, source_id) do update
      set canonical_source_id = excluded.canonical_source_id,
          allergy_flags = excluded.allergy_flags,
          ingredient_restrictions = excluded.ingredient_restrictions,
          coverage_status = excluded.coverage_status,
          match_evidence = excluded.match_evidence,
          normalization_version = excluded.normalization_version,
          computed_at = excluded.computed_at,
          updated_at = timezone('utc', now());

    get diagnostics affected_rows = row_count;
    backfill_source := 'iherb_overlay';
    upserted_count := affected_rows;
    return next;
  end if;

  return;
end;
$$;

comment on function public.backfill_product_allergen_flags(text, integer) is
  'SQL-native normalized allergen backfill for dsld, lnhpd, and iherb_overlay sources. Run with select * from public.backfill_product_allergen_flags(''all'');';

create or replace function public.backfill_product_allergen_flags_batch(
  p_source text,
  p_after_id bigint default 0,
  p_limit integer default 10000
)
returns table (
  backfill_source text,
  requested_after_id bigint,
  last_processed_id bigint,
  upserted_count bigint
)
language plpgsql
set search_path = public
as $$
declare
  affected_rows bigint := 0;
  max_processed_id bigint := p_after_id;
begin
  if p_source not in ('dsld', 'lnhpd', 'iherb_overlay') then
    raise exception 'Unsupported batch source %', p_source;
  end if;

  if p_source = 'dsld' then
    with dsld_source as (
      select
        meta.dsld_label_id,
        meta.barcode_normalized_gtin14,
        meta.canonical_dsld_label_id,
        meta.active_ingredients_summary,
        meta.inactive_ingredients,
        null::text as disclosure_text
      from public.dsld_labels_meta as meta
      where meta.dsld_label_id > p_after_id
      order by meta.dsld_label_id
      limit greatest(1, coalesce(p_limit, 10000))
    ), upserted as (
      insert into public.product_allergen_flags (
        source,
        source_id,
        canonical_source_id,
        allergy_flags,
        ingredient_restrictions,
        coverage_status,
        match_evidence,
        normalization_version,
        computed_at,
        created_at,
        updated_at
      )
      select
        'dsld'::text,
        dsld_source.dsld_label_id::text,
        coalesce(
          nullif(dsld_source.barcode_normalized_gtin14, ''),
          case
            when dsld_source.canonical_dsld_label_id is not null then dsld_source.canonical_dsld_label_id::text
            else null
          end
        ),
        computed.allergy_flags,
        computed.ingredient_restrictions,
        computed.coverage_status,
        computed.match_evidence,
        'allergen_norm_sql_v1'::text,
        timezone('utc', now()),
        timezone('utc', now()),
        timezone('utc', now())
      from dsld_source
      cross join lateral public.compute_product_allergen_flags(
        dsld_source.active_ingredients_summary,
        dsld_source.inactive_ingredients,
        dsld_source.disclosure_text,
        null
      ) as computed
      on conflict (source, source_id) do update
        set canonical_source_id = excluded.canonical_source_id,
            allergy_flags = excluded.allergy_flags,
            ingredient_restrictions = excluded.ingredient_restrictions,
            coverage_status = excluded.coverage_status,
            match_evidence = excluded.match_evidence,
            normalization_version = excluded.normalization_version,
            computed_at = excluded.computed_at,
            updated_at = timezone('utc', now())
      returning 1
    )
    select coalesce(max(dsld_label_id), p_after_id), count(*)::bigint
    into max_processed_id, affected_rows
    from dsld_source;
  elsif p_source = 'lnhpd' then
    with lnhpd_source as (
      select
        facts.lnhpd_id,
        facts.npn,
        coalesce((
          select string_agg(
            coalesce(
              item ->> 'ingredient_name',
              item ->> 'ingredientName',
              item ->> 'proper_name',
              item ->> 'properName',
              item ->> 'name'
            ),
            ', '
          )
          from jsonb_array_elements(
            coalesce(
              facts.facts_json -> 'medicinalIngredients',
              facts.facts_json -> 'medicinal_ingredients',
              '[]'::jsonb
            )
          ) as item
        ), '') as medicinal_text,
        coalesce((
          select string_agg(
            coalesce(
              item ->> 'nonmedicinal_ingredient_name',
              item ->> 'nonMedicinalIngredientName',
              item ->> 'ingredient_name',
              item ->> 'ingredientName',
              item ->> 'name'
            ),
            ', '
          )
          from jsonb_array_elements(
            coalesce(
              facts.facts_json -> 'nonMedicinalIngredients',
              facts.facts_json -> 'non_medicinal_ingredients',
              '[]'::jsonb
            )
          ) as item
        ), '') as non_medicinal_text
      from public.lnhpd_facts as facts
      where coalesce(facts.is_on_market, true)
        and facts.lnhpd_id > p_after_id
      order by facts.lnhpd_id
      limit greatest(1, coalesce(p_limit, 10000))
    ), upserted as (
      insert into public.product_allergen_flags (
        source,
        source_id,
        canonical_source_id,
        allergy_flags,
        ingredient_restrictions,
        coverage_status,
        match_evidence,
        normalization_version,
        computed_at,
        created_at,
        updated_at
      )
      select
        'lnhpd'::text,
        lnhpd_source.lnhpd_id::text,
        nullif(lnhpd_source.npn, ''),
        computed.allergy_flags,
        computed.ingredient_restrictions,
        computed.coverage_status,
        computed.match_evidence,
        'allergen_norm_sql_v1'::text,
        timezone('utc', now()),
        timezone('utc', now()),
        timezone('utc', now())
      from lnhpd_source
      cross join lateral public.compute_product_allergen_flags(
        nullif(lnhpd_source.medicinal_text, ''),
        nullif(lnhpd_source.non_medicinal_text, ''),
        null,
        null
      ) as computed
      on conflict (source, source_id) do update
        set canonical_source_id = excluded.canonical_source_id,
            allergy_flags = excluded.allergy_flags,
            ingredient_restrictions = excluded.ingredient_restrictions,
            coverage_status = excluded.coverage_status,
            match_evidence = excluded.match_evidence,
            normalization_version = excluded.normalization_version,
            computed_at = excluded.computed_at,
            updated_at = timezone('utc', now())
      returning 1
    )
    select coalesce(max(lnhpd_id), p_after_id), count(*)::bigint
    into max_processed_id, affected_rows
    from lnhpd_source;
  else
    with iherb_source as (
      select
        overlay.id,
        overlay.product_id,
        overlay.barcode_gtin14,
        overlay.supplement_facts::text as active_text,
        coalesce(
          overlay.description_sections ->> 'Other ingredients',
          overlay.description_sections ->> 'Other Ingredients',
          overlay.description_sections ->> 'other ingredients'
        ) as inactive_text,
        overlay.description_sections::text as disclosure_text,
        coalesce(
          overlay.description_sections ->> 'Warnings',
          overlay.description_sections ->> 'Warning',
          overlay.description_sections ->> 'warnings',
          overlay.description_sections ->> 'warning'
        ) as warning_text
      from public.iherb_overlay_products as overlay
      where overlay.id > p_after_id
      order by overlay.id
      limit greatest(1, coalesce(p_limit, 10000))
    ), upserted as (
      insert into public.product_allergen_flags (
        source,
        source_id,
        canonical_source_id,
        allergy_flags,
        ingredient_restrictions,
        coverage_status,
        match_evidence,
        normalization_version,
        computed_at,
        created_at,
        updated_at
      )
      select
        'iherb_overlay'::text,
        iherb_source.product_id,
        nullif(iherb_source.barcode_gtin14, ''),
        computed.allergy_flags,
        computed.ingredient_restrictions,
        computed.coverage_status,
        computed.match_evidence,
        'allergen_norm_sql_v1'::text,
        timezone('utc', now()),
        timezone('utc', now()),
        timezone('utc', now())
      from iherb_source
      cross join lateral public.compute_product_allergen_flags(
        iherb_source.active_text,
        iherb_source.inactive_text,
        iherb_source.disclosure_text,
        iherb_source.warning_text
      ) as computed
      on conflict (source, source_id) do update
        set canonical_source_id = excluded.canonical_source_id,
            allergy_flags = excluded.allergy_flags,
            ingredient_restrictions = excluded.ingredient_restrictions,
            coverage_status = excluded.coverage_status,
            match_evidence = excluded.match_evidence,
            normalization_version = excluded.normalization_version,
            computed_at = excluded.computed_at,
            updated_at = timezone('utc', now())
      returning 1
    )
    select coalesce(max(id), p_after_id), count(*)::bigint
    into max_processed_id, affected_rows
    from iherb_source;
  end if;

  backfill_source := p_source;
  requested_after_id := p_after_id;
  last_processed_id := max_processed_id;
  upserted_count := affected_rows;
  return next;
end;
$$;

comment on function public.backfill_product_allergen_flags_batch(text, bigint, integer) is
  'Batch-oriented SQL allergen backfill for MCP execution. Use repeated calls with the returned last_processed_id cursor.';
