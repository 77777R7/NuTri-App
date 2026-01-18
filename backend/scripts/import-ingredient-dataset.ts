import { readFile } from 'node:fs/promises';

import { supabase } from '../src/supabase.js';

type IngredientFormRecord = {
  form_key: string;
  form_display?: string;
  form_label?: string;
  relative_factor?: number | string | null;
  confidence?: number | string | null;
  evidence_grade?: string | null;
  audit_status?: string | null;
  reference_ids?: string[];
};

type EvidenceRecord = {
  goal: string;
  min_effective_dose?: number | string | null;
  optimal_range?: { min?: number | string | null; max?: number | string | null } | null;
  evidence_grade?: string | null;
  audit_status?: string | null;
  reference_ids?: string[];
};

type IngredientRecord = {
  ingredient_id: string;
  ingredient: string;
  category?: string | null;
  base_unit?: string | null;
  synonyms?: string[];
  goals?: string[];
  forms?: IngredientFormRecord[];
  evidence_by_goal?: EvidenceRecord[];
};

type CitationRecord = {
  id: string;
  type: string;
  identifier?: string | null;
  source?: string | null;
  title?: string | null;
  year?: number | string | null;
  url?: string | null;
  audit_status?: string | null;
  accessed_at?: string | null;
};

type FormAliasRecord = {
  alias_text: string;
  form_key: string;
  ingredient_id?: string | null;
  confidence?: number | string | null;
  audit_status?: string | null;
  source?: string | null;
};

type DatasetPackage = {
  version?: string;
  generated_at?: string | null;
  ingredients?: IngredientRecord[];
  citations?: CitationRecord[];
  goals?: string[];
  form_aliases?: FormAliasRecord[];
  meta?: { version?: string | null } | null;
  sheets?: Record<string, Record<string, unknown>[]> | null;
};

type NormalizationRuleRecord = {
  rule_id: string;
  pattern: string;
  replacement: string;
  description?: string | null;
};

type TokenAliasRecord = {
  token_raw: string;
  token_normalized?: string | null;
  alias_confidence?: number | string | null;
  notes?: string | null;
  applies_to_ingredient_id?: string | null;
};

type GenericFormTokenRecord = {
  token_raw: string;
  token_normalized?: string | null;
  alias_confidence?: number | string | null;
  notes?: string | null;
};

type InteractionRecord = {
  interaction_id: string;
  interaction_type?: string | null;
  ingredient_a_id?: string | null;
  ingredient_b_id?: string | null;
  ingredient_a?: string | null;
  ingredient_b?: string | null;
  direction?: string | null;
  condition_logic?: string | null;
  condition_json?: string | Record<string, unknown> | null;
  effect_type?: string | null;
  effect_value?: number | string | null;
  affected_pillar?: string | null;
  rationale?: string | null;
  evidence_grade?: string | null;
  audit_status?: string | null;
  rule_confidence?: number | string | null;
  reference_ids?: string | null;
  reference_ids_list?: string[] | null;
};

type NutrientTargetRecord = {
  ingredient_id?: string | null;
  ingredient?: string | null;
  target_type?: string | null;
  target_value?: number | string | null;
  unit?: string | null;
  jurisdiction?: string | null;
  authority?: string | null;
  reference_ids?: string | null;
  reference_ids_list?: string[] | null;
  audit_status?: string | null;
  notes?: string | null;
};

type TargetProfileRecord = {
  profile_id: string;
  profile_name?: string | null;
  description?: string | null;
  default_for?: string | null;
  audit_status?: string | null;
  reference_ids?: string | null;
  reference_ids_list?: string[] | null;
  notes?: string | null;
};

type UlToxicityRecord = {
  ul_id: string;
  ingredient_id?: string | null;
  ingredient?: string | null;
  population?: string | null;
  age_range?: string | null;
  authority?: string | null;
  ul_value?: number | string | null;
  unit?: string | null;
  scope?: string | null;
  confidence?: number | string | null;
  audit_status?: string | null;
  reference_ids?: string | null;
  reference_ids_list?: string[] | null;
  notes?: string | null;
};

type DoseResponseCurveRecord = {
  curve_id: string;
  ingredient_id?: string | null;
  ingredient?: string | null;
  curve_type?: string | null;
  beneficial_min?: number | string | null;
  target_value?: number | string | null;
  target_unit?: string | null;
  plateau_start?: number | string | null;
  plateau_end?: number | string | null;
  ul_value?: number | string | null;
  ul_unit?: string | null;
  ul_scope?: string | null;
  penalty_start?: number | string | null;
  penalty_slope?: number | string | null;
  score_midpoint?: number | string | null;
  score_cap?: number | string | null;
  audit_status?: string | null;
  reference_ids?: string | null;
  reference_ids_list?: string[] | null;
  notes?: string | null;
};

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};
const hasFlag = (flag: string) => args.includes(`--${flag}`);

const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const normalizeText = (value?: string | null): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const normalizeAuditStatus = (value?: string | null): string => {
  const normalized = (value ?? '').trim().toLowerCase();
  if (!normalized) return 'needs_review';
  if (['verified', 'needs_review', 'needs_resolution', 'derived'].includes(normalized)) {
    return normalized;
  }
  return 'needs_review';
};

const resolveAuditStatus = (value?: string | null): string =>
  forcePending ? 'needs_review' : normalizeAuditStatus(value);

const AUDIT_PRIORITY: Record<string, number> = {
  needs_resolution: 0,
  derived: 1,
  needs_review: 2,
  verified: 3,
};

const mergeAuditStatus = (incoming?: string | null, existing?: string | null): string => {
  const incomingNormalized = normalizeAuditStatus(incoming ?? null);
  const existingNormalized = existing ? normalizeAuditStatus(existing) : null;
  if (!existingNormalized) return incomingNormalized;
  const incomingScore = AUDIT_PRIORITY[incomingNormalized] ?? 0;
  const existingScore = AUDIT_PRIORITY[existingNormalized] ?? 0;
  return existingScore >= incomingScore ? existingNormalized : incomingNormalized;
};

const normalizeAliasText = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const parseList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item ?? '').trim())
      .filter((item) => item.length > 0);
  }
  if (typeof value === 'string') {
    return value
      .split(/[;|,]/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  return [];
};

const parseListFromFields = (...fields: unknown[]): string[] => {
  for (const field of fields) {
    const list = parseList(field);
    if (list.length) return list;
  }
  return [];
};

const parseConditionJson = (value: unknown): Record<string, unknown> | null => {
  if (value && typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
};

const deriveAuditStatus = (referenceIds: string[] | undefined, citations: Map<string, CitationRecord>): string => {
  if (!referenceIds?.length) return 'needs_review';
  let hasVerified = false;
  let hasNeedsReview = false;
  let hasNeedsResolution = false;
  referenceIds.forEach((refId) => {
    const status = normalizeAuditStatus(citations.get(refId)?.audit_status ?? null);
    if (status === 'verified') hasVerified = true;
    else if (status === 'needs_review' || status === 'derived') hasNeedsReview = true;
    else if (status === 'needs_resolution') hasNeedsResolution = true;
  });
  if (hasVerified) return 'verified';
  if (hasNeedsReview) return 'needs_review';
  if (hasNeedsResolution) return 'needs_resolution';
  return 'needs_review';
};

const buildNumRange = (range?: EvidenceRecord['optimal_range']): string | null => {
  if (!range) return null;
  const min = toNumber(range.min ?? null);
  const max = toNumber(range.max ?? null);
  if (min == null || max == null) return null;
  return `[${min},${max}]`;
};

const buildNumRangeFromMinMax = (minValue: unknown, maxValue: unknown): string | null => {
  const min = toNumber(minValue);
  const max = toNumber(maxValue);
  if (min == null || max == null) return null;
  return `[${min},${max}]`;
};

const chunk = <T>(values: T[], size: number): T[][] => {
  if (size <= 0) return [values];
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size));
  }
  return chunks;
};

const filePath = getArg('file');
const dryRun = hasFlag('dry-run');
const strictMode = hasFlag('strict');
const skipDatasetVersion = hasFlag('skip-dataset-version');
const onlyParsing = hasFlag('only-parsing');
const onlyKnowledge = hasFlag('only-knowledge');
const forcePending = hasFlag('force-pending');

if (onlyParsing && onlyKnowledge) {
  console.error('[import] Choose only one of --only-parsing or --only-knowledge');
  process.exit(1);
}

const importParsing = !onlyKnowledge;
const importKnowledge = !onlyParsing;

if (process.env.CI && !strictMode) {
  console.error('[import] CI requires --strict');
  process.exit(1);
}

if (!filePath) {
  console.error(
    'Usage: tsx backend/scripts/import-ingredient-dataset.ts --file <path> [--dry-run] [--strict] [--skip-dataset-version] [--only-parsing|--only-knowledge] [--force-pending]',
  );
  process.exit(1);
}

const main = async () => {
  const raw = await readFile(filePath, 'utf-8');
  const payload = JSON.parse(raw) as DatasetPackage;
  const datasetVersion =
    typeof payload.meta?.version === 'string'
      ? payload.meta.version
      : typeof payload.version === 'string'
        ? payload.version
        : null;

  const sheets = payload.sheets ?? null;
  const usingSheets = Boolean(sheets && Object.keys(sheets).length);
  const getSheet = <T extends Record<string, unknown>>(name: string): T[] => {
    if (!usingSheets || !sheets) return [];
    const value = sheets[name];
    return Array.isArray(value) ? (value as T[]) : [];
  };

  const sheetIngredients = getSheet('ingredients');
  const sheetForms = getSheet('forms');
  const sheetEvidence = getSheet('evidence');
  const sheetCitations = getSheet('citations');
  const sheetFormAliases = getSheet('form_aliases');
  const normalizationRules = getSheet<NormalizationRuleRecord>('normalization_rules');
  const tokenAliases = getSheet<TokenAliasRecord>('token_aliases');
  const genericFormTokens = getSheet<GenericFormTokenRecord>('generic_form_tokens');
  const interactions = getSheet<InteractionRecord>('interactions');
  const nutrientTargets = getSheet<NutrientTargetRecord>('nutrient_targets');
  const targetProfiles = getSheet<TargetProfileRecord>('target_profiles');
  const ulToxicity = getSheet<UlToxicityRecord>('ul__toxicity');
  const doseResponseCurves = getSheet<DoseResponseCurveRecord>('dose_response_curves');

  const citations: CitationRecord[] = importKnowledge
    ? usingSheets
      ? sheetCitations
          .map((row) => ({
            id: String(row.id ?? '').trim(),
            type: String(row.type ?? '').trim(),
            identifier: normalizeText(row.identifier as string | null),
            source: normalizeText(row.source as string | null),
            title: normalizeText(row.title as string | null),
            year: toNumber(row.year),
            url: normalizeText(row.url as string | null),
            audit_status: normalizeText(row.audit_status as string | null),
            accessed_at: normalizeText(row.accessed_at as string | null),
          }))
          .filter((row) => row.id && row.type)
      : Array.isArray(payload.citations)
        ? payload.citations
        : []
    : [];

  const ingredients: IngredientRecord[] = usingSheets
    ? sheetIngredients
        .map((row) => ({
          ingredient_id: String(row.ingredient_id ?? '').trim(),
          ingredient: String(row.ingredient ?? '').trim(),
          category: normalizeText(row.category as string | null),
          base_unit: normalizeText(row.base_unit as string | null),
          synonyms: parseListFromFields(row.synonyms_list, row.synonyms),
          goals: parseListFromFields(row.goals_list, row.goals),
        }))
        .filter((row) => row.ingredient_id && row.ingredient)
    : Array.isArray(payload.ingredients)
      ? payload.ingredients
      : [];

  const aliases: FormAliasRecord[] = usingSheets
    ? sheetFormAliases
        .map((row) => ({
          alias_text: String(row.token_raw ?? '').trim(),
          form_key: String(row.maps_to_form_key ?? '').trim(),
          ingredient_id: normalizeText(row.applies_to_ingredient_id as string | null),
          confidence: toNumber(row.alias_confidence),
          audit_status: 'derived',
          source: datasetVersion ?? 'dataset',
        }))
        .filter((row) => row.alias_text && row.form_key)
    : Array.isArray(payload.form_aliases)
      ? payload.form_aliases
      : [];

  if (!ingredients.length) {
    console.warn('[import] No ingredients found in payload.');
  }

  let runId: string | null = null;
  if (!dryRun) {
    const { data, error } = await supabase
      .from('ingredient_dataset_import_runs')
      .insert({
        dataset_version: datasetVersion,
        strict: strictMode,
      })
      .select('id')
      .maybeSingle();
    if (error) {
      throw new Error(`[import] import run insert failed: ${error.message}`);
    }
    runId = data?.id ?? null;
  }

  const citationMap = new Map<string, CitationRecord>();
  citations.forEach((citation) => {
    if (!citation?.id) return;
    citationMap.set(citation.id, citation);
  });

  if (!dryRun && importKnowledge && citations.length) {
    const citationRows = citations.map((citation) => ({
      id: citation.id,
      type: citation.type,
      identifier: normalizeText(citation.identifier),
      source: normalizeText(citation.source),
      title: normalizeText(citation.title),
      year: toNumber(citation.year),
      url: normalizeText(citation.url),
      audit_status: resolveAuditStatus(citation.audit_status),
      accessed_at: normalizeText(citation.accessed_at),
    }));
    const { error } = await supabase
      .from('citations')
      .upsert(citationRows, { onConflict: 'id' });
    if (error) {
      throw new Error(`[import] citations upsert failed: ${error.message}`);
    }
  }

  const ingredientIdMap = new Map<string, string>();
  const warnings: string[] = [];
  const issues: {
    severity: 'warning' | 'error';
    issue_type: string;
    canonical_key?: string | null;
    ingredient_id?: string | null;
    message: string;
    payload_json?: Record<string, unknown>;
  }[] = [];

  const recordIssue = (issue: {
    severity: 'warning' | 'error';
    issue_type: string;
    canonical_key?: string | null;
    ingredient_id?: string | null;
    message: string;
    payload_json?: Record<string, unknown>;
  }) => {
    issues.push(issue);
    if (issue.severity === 'warning') {
      warnings.push(issue.message);
    }
  };
  let issuesFlushed = false;

  const formRows: {
    ingredient_id: string;
    form_key: string;
    form_label: string;
    relative_factor: number;
    confidence: number;
    evidence_grade: string | null;
    audit_status: string;
  }[] = [];
  const formRefs: { form_key: string; ingredient_id: string; reference_ids: string[] }[] = [];

  const evidenceRows: {
    ingredient_id: string;
    goal: string;
    min_effective_dose: number | null;
    optimal_dose_range: string | null;
    evidence_grade: string | null;
    audit_status: string;
  }[] = [];
  const evidenceRefs: { ingredient_id: string; goal: string; reference_ids: string[] }[] = [];

  const interactionRows: {
    interaction_id: string;
    interaction_type: string | null;
    ingredient_a_id: string | null;
    ingredient_b_id: string | null;
    ingredient_a_key: string | null;
    ingredient_b_key: string | null;
    ingredient_a_name: string | null;
    ingredient_b_name: string | null;
    direction: string | null;
    condition_logic: string | null;
    condition_json: Record<string, unknown> | null;
    effect_type: string | null;
    effect_value: number | null;
    affected_pillar: string | null;
    rationale: string | null;
    evidence_grade: string | null;
    audit_status: string;
    rule_confidence: number | null;
    reference_ids: string[] | null;
    notes: string | null;
  }[] = [];
  const nutrientTargetRows: {
    ingredient_id: string;
    ingredient_key: string | null;
    target_type: string | null;
    target_value: number | null;
    unit: string | null;
    jurisdiction: string | null;
    authority: string | null;
    reference_ids: string[] | null;
    audit_status: string;
    notes: string | null;
  }[] = [];
  const targetProfileRows: {
    profile_id: string;
    profile_name: string | null;
    description: string | null;
    default_for: string | null;
    audit_status: string;
    reference_ids: string[] | null;
    notes: string | null;
  }[] = [];
  const ulToxicityRows: {
    ul_id: string;
    ingredient_id: string;
    ingredient_key: string | null;
    population: string | null;
    age_range: string | null;
    authority: string | null;
    ul_value: number | null;
    unit: string;
    scope: string | null;
    confidence: number | null;
    audit_status: string;
    reference_ids: string[] | null;
    notes: string | null;
  }[] = [];
  const doseResponseRows: {
    curve_id: string;
    ingredient_id: string;
    ingredient_key: string | null;
    curve_type: string | null;
    beneficial_min: number | null;
    target_value: number | null;
    target_unit: string | null;
    plateau_start: number | null;
    plateau_end: number | null;
    ul_value: number | null;
    ul_unit: string | null;
    ul_scope: string | null;
    penalty_start: number | null;
    penalty_slope: number | null;
    score_midpoint: number | null;
    score_cap: number | null;
    notes: string | null;
    audit_status: string;
    reference_ids: string[] | null;
  }[] = [];

  try {
    for (const record of ingredients) {
      if (!record?.ingredient_id || !record.ingredient) {
        continue;
      }
      const canonicalKey = record.ingredient_id.trim();
      const name = record.ingredient.trim();

      let existing = null as { id: string; canonical_key: string | null } | null;
      if (!dryRun) {
        const { data } = await supabase
          .from('ingredients')
          .select('id,canonical_key')
          .eq('canonical_key', canonicalKey)
          .maybeSingle();
        existing = data ?? null;
        if (!existing) {
          const { data: byName } = await supabase
            .from('ingredients')
            .select('id,canonical_key')
            .ilike('name', name)
            .maybeSingle();
          existing = byName ?? null;
        }
      }

      if (!dryRun) {
        const baseUnit = normalizeText(record.base_unit)?.toLowerCase() ?? null;

        if (existing?.id) {
          if (existing.canonical_key && existing.canonical_key !== canonicalKey) {
            const message = `[import] canonical_key conflict for ${canonicalKey} -> existing ${existing.canonical_key}`;
            recordIssue({
              severity: strictMode ? 'error' : 'warning',
              issue_type: 'canonical_key_conflict',
              canonical_key: canonicalKey,
              message,
              payload_json: { existing_canonical_key: existing.canonical_key },
            });
            if (strictMode) throw new Error(message);
            continue;
          }

          const { data: current } = await supabase
            .from('ingredients')
            .select('id,unit,name,canonical_key')
            .eq('id', existing.id)
            .maybeSingle();
          const existingUnit = normalizeText(current?.unit ?? null)?.toLowerCase() ?? null;
          if (baseUnit && existingUnit && baseUnit !== existingUnit) {
            const message = `[import] base_unit mismatch for ${canonicalKey}: ${existingUnit} vs ${baseUnit}`;
            recordIssue({
              severity: strictMode ? 'error' : 'warning',
              issue_type: 'base_unit_mismatch',
              canonical_key: canonicalKey,
              ingredient_id: existing.id,
              message,
              payload_json: { existing_unit: existingUnit, incoming_unit: baseUnit },
            });
            if (strictMode) throw new Error(message);
          }

          const nextUnit =
            existingUnit && baseUnit && existingUnit !== baseUnit ? existingUnit : baseUnit ?? existingUnit;
          const nextName = current?.name ?? name;

          const { error } = await supabase
            .from('ingredients')
            .update({
              canonical_key: canonicalKey,
              name: nextName,
              unit: nextUnit,
              category: normalizeText(record.category),
              goals: record.goals ?? null,
            })
            .eq('id', existing.id);
          if (error) {
            throw new Error(`[import] ingredient update failed (${canonicalKey}): ${error.message}`);
          }
          ingredientIdMap.set(canonicalKey, existing.id);
        } else {
          const { data, error } = await supabase
            .from('ingredients')
            .insert({
              canonical_key: canonicalKey,
              name,
              unit: normalizeText(record.base_unit)?.toLowerCase() ?? null,
              category: normalizeText(record.category),
              goals: record.goals ?? null,
            })
            .select('id')
            .maybeSingle();
          if (error || !data?.id) {
            throw new Error(
              `[import] ingredient insert failed (${canonicalKey}): ${error?.message ?? 'no id'}`,
            );
          }
          ingredientIdMap.set(canonicalKey, data.id as string);
        }
      } else {
        ingredientIdMap.set(canonicalKey, canonicalKey);
      }
    }

  if (!dryRun) {
    for (const record of ingredients) {
      const canonicalKey = record?.ingredient_id?.trim();
      if (!canonicalKey || !record.ingredient) continue;
      const ingredientUuid = ingredientIdMap.get(canonicalKey);
      if (!ingredientUuid) continue;

      const synonyms = Array.isArray(record.synonyms) ? record.synonyms : [];
      if (synonyms.length) {
        const { data: existing } = await supabase
          .from('ingredient_synonyms')
          .select('synonym')
          .eq('ingredient_id', ingredientUuid);
        const existingSet = new Set(
          (existing ?? []).map((row) => String(row.synonym ?? '').trim().toLowerCase()),
        );
        const seen = new Set(existingSet);
        const newRows = synonyms
          .map((syn) => syn?.trim())
          .filter((syn): syn is string => Boolean(syn))
          .filter((syn) => {
            const key = syn.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .map((syn) => ({
            ingredient_id: ingredientUuid,
            synonym: syn,
          }));
        if (newRows.length) {
          const { error } = await supabase
            .from('ingredient_synonyms')
            .insert(newRows);
          if (error) {
            const isDuplicate =
              error.code === '23505' || /duplicate key value/i.test(error.message);
            if (isDuplicate) {
              recordIssue({
                severity: 'warning',
                issue_type: 'synonym_duplicate',
                canonical_key: canonicalKey,
                ingredient_id: ingredientUuid,
                message: `[import] synonym duplicate skipped for ${canonicalKey}`,
                payload_json: { count: newRows.length },
              });
            } else {
              throw new Error(`[import] synonym insert failed (${canonicalKey}): ${error.message}`);
            }
          }
        }
      }
    }
  }

  if (!dryRun && importParsing && aliases.length) {
    for (const alias of aliases) {
      if (!alias?.alias_text || !alias.form_key) continue;
      const aliasText = alias.alias_text.trim();
      const formKey = alias.form_key.trim();
      const aliasNorm = normalizeAliasText(aliasText);
      if (!aliasNorm) continue;
      const ingredientUuid = alias.ingredient_id
        ? ingredientIdMap.get(alias.ingredient_id.trim()) ?? null
        : null;
      if (alias.ingredient_id && !ingredientUuid) {
        recordIssue({
          severity: strictMode ? 'error' : 'warning',
          issue_type: 'alias_missing_ingredient',
          canonical_key: alias.ingredient_id,
          message: `[import] alias ingredient not found for ${alias.alias_text}`,
          payload_json: { alias_text: alias.alias_text, form_key: alias.form_key },
        });
        if (strictMode) {
          throw new Error(`[import] alias ingredient not found for ${alias.alias_text}`);
        }
        continue;
      }
      const baseQuery = supabase
        .from('ingredient_form_aliases')
        .select('id')
        .eq('alias_norm', aliasNorm)
        .eq('form_key', formKey);
      const { data: existingAlias, error } = ingredientUuid
        ? await baseQuery.eq('ingredient_id', ingredientUuid).maybeSingle()
        : await baseQuery.is('ingredient_id', null).maybeSingle();
      if (error) {
        throw new Error(`[import] alias lookup failed (${alias.alias_text}): ${error.message}`);
      }
      const payloadRow = {
        alias_text: aliasText,
        alias_norm: aliasNorm,
        form_key: formKey,
        ingredient_id: ingredientUuid,
        confidence: toNumber(alias.confidence),
        audit_status: normalizeAuditStatus(alias.audit_status ?? null),
        source: normalizeText(alias.source ?? null),
      };
      if (existingAlias?.id) {
        const { error: updateError } = await supabase
          .from('ingredient_form_aliases')
          .update(payloadRow)
          .eq('id', existingAlias.id);
        if (updateError) {
          throw new Error(`[import] alias update failed (${alias.alias_text}): ${updateError.message}`);
        }
      } else {
        const { error: insertError } = await supabase
          .from('ingredient_form_aliases')
          .insert(payloadRow);
        if (insertError) {
          throw new Error(`[import] alias insert failed (${alias.alias_text}): ${insertError.message}`);
        }
      }
    }
  }

  if (!dryRun && importParsing && normalizationRules.length) {
    const ruleRows = normalizationRules
      .map((row) => ({
        rule_id: String(row.rule_id ?? '').trim(),
        pattern: String(row.pattern ?? '').trim(),
        replacement: String(row.replacement ?? '').trim(),
        description: normalizeText(row.description as string | null),
      }))
      .filter((row) => row.rule_id && row.pattern);
    if (ruleRows.length) {
      const { error } = await supabase
        .from('normalization_rules')
        .upsert(ruleRows, { onConflict: 'rule_id' });
      if (error) {
        throw new Error(`[import] normalization_rules upsert failed: ${error.message}`);
      }
    }
  }

  if (!dryRun && importParsing && tokenAliases.length) {
    for (const record of tokenAliases) {
      const tokenRaw = normalizeText(record.token_raw as string | null);
      if (!tokenRaw) continue;
      const tokenNormalized =
        normalizeText(record.token_normalized as string | null) ?? normalizeAliasText(tokenRaw);
      if (!tokenNormalized) continue;
      const ingredientUuid = record.applies_to_ingredient_id
        ? ingredientIdMap.get(record.applies_to_ingredient_id.trim()) ?? null
        : null;
      if (record.applies_to_ingredient_id && !ingredientUuid) {
        recordIssue({
          severity: strictMode ? 'error' : 'warning',
          issue_type: 'token_alias_missing_ingredient',
          canonical_key: record.applies_to_ingredient_id,
          message: `[import] token alias ingredient not found for ${tokenRaw}`,
          payload_json: { token_raw: tokenRaw, token_normalized: tokenNormalized },
        });
        if (strictMode) {
          throw new Error(`[import] token alias ingredient not found for ${tokenRaw}`);
        }
        continue;
      }
      const baseQuery = supabase
        .from('token_aliases')
        .select('id')
        .eq('token_normalized', tokenNormalized);
      const { data: existingAlias, error } = ingredientUuid
        ? await baseQuery.eq('ingredient_id', ingredientUuid).maybeSingle()
        : await baseQuery.is('ingredient_id', null).maybeSingle();
      if (error) {
        throw new Error(`[import] token alias lookup failed (${tokenRaw}): ${error.message}`);
      }
      const payloadRow = {
        token_raw: tokenRaw,
        token_normalized: tokenNormalized,
        alias_confidence: toNumber(record.alias_confidence),
        notes: normalizeText(record.notes),
        ingredient_id: ingredientUuid,
      };
      if (existingAlias?.id) {
        const { error: updateError } = await supabase
          .from('token_aliases')
          .update(payloadRow)
          .eq('id', existingAlias.id);
        if (updateError) {
          throw new Error(`[import] token alias update failed (${tokenRaw}): ${updateError.message}`);
        }
      } else {
        const { error: insertError } = await supabase
          .from('token_aliases')
          .insert(payloadRow);
        if (insertError) {
          throw new Error(`[import] token alias insert failed (${tokenRaw}): ${insertError.message}`);
        }
      }
    }
  }

  if (!dryRun && importParsing && genericFormTokens.length) {
    const tokenRows = genericFormTokens
      .map((row) => {
        const tokenRaw = normalizeText(row.token_raw as string | null);
        if (!tokenRaw) return null;
        const tokenNormalized =
          normalizeText(row.token_normalized as string | null) ?? normalizeAliasText(tokenRaw);
        if (!tokenNormalized) return null;
        return {
          token_raw: tokenRaw,
          token_normalized: tokenNormalized,
          alias_confidence: toNumber(row.alias_confidence),
          notes: normalizeText(row.notes as string | null),
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
    const deduped = new Map<string, (typeof tokenRows)[number]>();
    tokenRows.forEach((row) => {
      const existing = deduped.get(row.token_normalized);
      if (!existing) {
        deduped.set(row.token_normalized, row);
        return;
      }
      const existingConfidence = existing.alias_confidence ?? -1;
      const nextConfidence = row.alias_confidence ?? -1;
      if (nextConfidence > existingConfidence) {
        deduped.set(row.token_normalized, row);
      }
    });
    const uniqueRows = Array.from(deduped.values());
    if (uniqueRows.length) {
      const { error } = await supabase
        .from('generic_form_tokens')
        .upsert(uniqueRows, { onConflict: 'token_normalized' });
      if (error) {
        throw new Error(`[import] generic_form_tokens upsert failed: ${error.message}`);
      }
    }
  }

  const existingFormStatus = new Map<string, string>();
  const existingEvidenceStatus = new Map<string, string>();
  if (!dryRun && importKnowledge && ingredientIdMap.size > 0) {
    const ingredientUuids = Array.from(new Set(ingredientIdMap.values()));
    if (ingredientUuids.length) {
      const { data: existingForms, error: formsError } = await supabase
        .from('ingredient_forms')
        .select('ingredient_id,form_key,audit_status')
        .in('ingredient_id', ingredientUuids);
      if (formsError) {
        throw new Error(`[import] ingredient_forms prefetch failed: ${formsError.message}`);
      }
      (existingForms ?? []).forEach((row) => {
        if (!row?.ingredient_id || !row.form_key) return;
        existingFormStatus.set(
          `${row.ingredient_id}::${row.form_key}`,
          normalizeAuditStatus(row.audit_status ?? null),
        );
      });

      const { data: existingEvidence, error: evidenceError } = await supabase
        .from('ingredient_evidence')
        .select('ingredient_id,goal,audit_status')
        .in('ingredient_id', ingredientUuids);
      if (evidenceError) {
        throw new Error(`[import] ingredient_evidence prefetch failed: ${evidenceError.message}`);
      }
      (existingEvidence ?? []).forEach((row) => {
        if (!row?.ingredient_id || !row.goal) return;
        existingEvidenceStatus.set(
          `${row.ingredient_id}::${row.goal}`,
          normalizeAuditStatus(row.audit_status ?? null),
        );
      });
    }
  }

  if (importKnowledge && usingSheets) {
    sheetForms.forEach((record) => {
      const canonicalKey = normalizeText(record.ingredient_id as string | null);
      if (!canonicalKey) return;
      const ingredientUuid = ingredientIdMap.get(canonicalKey);
      if (!ingredientUuid) {
        recordIssue({
          severity: strictMode ? 'error' : 'warning',
          issue_type: 'form_missing_ingredient',
          canonical_key: canonicalKey,
          message: `[import] form ingredient not found for ${canonicalKey}`,
        });
        if (strictMode) throw new Error(`[import] form ingredient not found for ${canonicalKey}`);
        return;
      }
      const formKey = normalizeText(record.form_key as string | null);
      const label = normalizeText(
        (record.form_display as string | null) ??
          (record.form_label as string | null) ??
          (record.form_key as string | null),
      );
      if (!formKey || !label) return;
      const referenceIds = parseListFromFields(
        record.reference_ids_list,
        record.reference_ids,
        record.factor_reference_ids_list,
        record.factor_reference_ids,
        record.identity_reference_ids_list,
        record.identity_reference_ids,
      );
      const incomingStatus = resolveAuditStatus(record.audit_status as string | null);
      const existingStatus = existingFormStatus.get(`${ingredientUuid}::${formKey}`) ?? null;
      const auditStatus = mergeAuditStatus(incomingStatus, existingStatus);
      const confidence =
        toNumber(record.overall_confidence) ??
        toNumber(record.factor_confidence) ??
        toNumber(record.identity_confidence) ??
        0.5;

      formRows.push({
        ingredient_id: ingredientUuid,
        form_key: formKey,
        form_label: label,
        relative_factor: toNumber(record.relative_factor) ?? 1,
        confidence,
        evidence_grade: normalizeText(record.evidence_grade as string | null),
        audit_status: auditStatus,
      });
      if (referenceIds.length) {
        formRefs.push({
          ingredient_id: ingredientUuid,
          form_key: formKey,
          reference_ids: referenceIds,
        });
      }
    });

    sheetEvidence.forEach((record) => {
      const canonicalKey = normalizeText(record.ingredient_id as string | null);
      if (!canonicalKey) return;
      const ingredientUuid = ingredientIdMap.get(canonicalKey);
      if (!ingredientUuid) {
        recordIssue({
          severity: strictMode ? 'error' : 'warning',
          issue_type: 'evidence_missing_ingredient',
          canonical_key: canonicalKey,
          message: `[import] evidence ingredient not found for ${canonicalKey}`,
        });
        if (strictMode) throw new Error(`[import] evidence ingredient not found for ${canonicalKey}`);
        return;
      }
      const goal = normalizeText(record.goal as string | null);
      if (!goal) return;
      const referenceIds = parseListFromFields(record.reference_ids_list, record.reference_ids);
      const incomingStatus = resolveAuditStatus(record.audit_status as string | null);
      const existingStatus = existingEvidenceStatus.get(`${ingredientUuid}::${goal}`) ?? null;
      const auditStatus = mergeAuditStatus(incomingStatus, existingStatus);
      evidenceRows.push({
        ingredient_id: ingredientUuid,
        goal,
        min_effective_dose: toNumber(record.min_effective_dose),
        optimal_dose_range: buildNumRangeFromMinMax(record.optimal_min, record.optimal_max),
        evidence_grade: normalizeText(record.evidence_grade as string | null),
        audit_status: auditStatus,
      });
      if (referenceIds.length) {
        evidenceRefs.push({
          ingredient_id: ingredientUuid,
          goal,
          reference_ids: referenceIds,
        });
      }
    });
  } else if (importKnowledge) {
    ingredients.forEach((record) => {
      const canonicalKey = record?.ingredient_id?.trim();
      if (!canonicalKey) return;
      const ingredientUuid = ingredientIdMap.get(canonicalKey);
      if (!ingredientUuid) return;

      (record.forms ?? []).forEach((form) => {
        const label = form?.form_display ?? form?.form_label;
        if (!form?.form_key || !label) return;
        const referenceIds = Array.isArray(form.reference_ids) ? form.reference_ids : [];
        const incomingStatus = resolveAuditStatus(form.audit_status ?? null);
        const existingStatus =
          existingFormStatus.get(`${ingredientUuid}::${form.form_key.trim()}`) ?? null;
        const derivedStatus = forcePending
          ? 'needs_review'
          : incomingStatus !== 'needs_review'
            ? incomingStatus
            : deriveAuditStatus(referenceIds, citationMap);
        const auditStatus = mergeAuditStatus(derivedStatus, existingStatus);
        formRows.push({
          ingredient_id: ingredientUuid,
          form_key: form.form_key.trim(),
          form_label: label.trim(),
          relative_factor: toNumber(form.relative_factor) ?? 1,
          confidence: toNumber(form.confidence) ?? 0.5,
          evidence_grade: normalizeText(form.evidence_grade) ?? null,
          audit_status: auditStatus,
        });
        if (referenceIds.length) {
          formRefs.push({
            ingredient_id: ingredientUuid,
            form_key: form.form_key.trim(),
            reference_ids: referenceIds,
          });
        }
      });

      (record.evidence_by_goal ?? []).forEach((evidence) => {
        if (!evidence?.goal) return;
        const referenceIds = Array.isArray(evidence.reference_ids) ? evidence.reference_ids : [];
        const incomingStatus = resolveAuditStatus(evidence.audit_status ?? null);
        const existingStatus =
          existingEvidenceStatus.get(`${ingredientUuid}::${evidence.goal.trim()}`) ?? null;
        const derivedStatus = forcePending
          ? 'needs_review'
          : incomingStatus !== 'needs_review'
            ? incomingStatus
            : deriveAuditStatus(referenceIds, citationMap);
        const auditStatus = mergeAuditStatus(derivedStatus, existingStatus);
        evidenceRows.push({
          ingredient_id: ingredientUuid,
          goal: evidence.goal.trim(),
          min_effective_dose: toNumber(evidence.min_effective_dose),
          optimal_dose_range: buildNumRange(evidence.optimal_range),
          evidence_grade: normalizeText(evidence.evidence_grade),
          audit_status: auditStatus,
        });
        if (referenceIds.length) {
          evidenceRefs.push({
            ingredient_id: ingredientUuid,
            goal: evidence.goal.trim(),
            reference_ids: referenceIds,
          });
        }
      });
    });
  }

  if (importKnowledge && usingSheets) {
    interactions.forEach((record) => {
      const interactionId = normalizeText(record.interaction_id as string | null);
      if (!interactionId) return;
      const ingredientAKey = normalizeText(record.ingredient_a_id as string | null);
      const ingredientBKey = normalizeText(record.ingredient_b_id as string | null);
      const ingredientAUuid = ingredientAKey ? ingredientIdMap.get(ingredientAKey) ?? null : null;
      const ingredientBUuid = ingredientBKey ? ingredientIdMap.get(ingredientBKey) ?? null : null;
      if (ingredientAKey && !ingredientAUuid) {
        recordIssue({
          severity: strictMode ? 'error' : 'warning',
          issue_type: 'interaction_missing_ingredient_a',
          canonical_key: ingredientAKey,
          message: `[import] interaction ingredient A not found for ${interactionId}`,
        });
        if (strictMode) throw new Error(`[import] interaction ingredient A not found for ${interactionId}`);
      }
      if (ingredientBKey && !ingredientBUuid) {
        recordIssue({
          severity: strictMode ? 'error' : 'warning',
          issue_type: 'interaction_missing_ingredient_b',
          canonical_key: ingredientBKey,
          message: `[import] interaction ingredient B not found for ${interactionId}`,
        });
        if (strictMode) throw new Error(`[import] interaction ingredient B not found for ${interactionId}`);
      }

      const conditionJson = parseConditionJson(record.condition_json);
      if (record.condition_json && typeof record.condition_json === 'string' && !conditionJson) {
        recordIssue({
          severity: strictMode ? 'error' : 'warning',
          issue_type: 'interaction_condition_json_invalid',
          canonical_key: ingredientAKey ?? null,
          message: `[import] invalid condition_json for ${interactionId}`,
        });
        if (strictMode) throw new Error(`[import] invalid condition_json for ${interactionId}`);
      }

      const referenceIds = parseListFromFields(record.reference_ids_list, record.reference_ids);
      interactionRows.push({
        interaction_id: interactionId,
        interaction_type: normalizeText(record.interaction_type as string | null),
        ingredient_a_id: ingredientAUuid,
        ingredient_b_id: ingredientBUuid,
        ingredient_a_key: ingredientAKey,
        ingredient_b_key: ingredientBKey,
        ingredient_a_name: normalizeText(record.ingredient_a as string | null),
        ingredient_b_name: normalizeText(record.ingredient_b as string | null),
        direction: normalizeText(record.direction as string | null),
        condition_logic: normalizeText(record.condition_logic as string | null),
        condition_json: conditionJson,
        effect_type: normalizeText(record.effect_type as string | null),
        effect_value: toNumber(record.effect_value),
        affected_pillar: normalizeText(record.affected_pillar as string | null),
        rationale: normalizeText(record.rationale as string | null),
        evidence_grade: normalizeText(record.evidence_grade as string | null),
        audit_status: resolveAuditStatus(record.audit_status as string | null),
        rule_confidence: toNumber(record.rule_confidence),
        reference_ids: referenceIds.length ? referenceIds : null,
        notes: normalizeText(record.notes as string | null),
      });
    });

    nutrientTargets.forEach((record) => {
      const ingredientKey = normalizeText(record.ingredient_id as string | null);
      if (!ingredientKey) return;
      const ingredientUuid = ingredientIdMap.get(ingredientKey);
      if (!ingredientUuid) {
        recordIssue({
          severity: strictMode ? 'error' : 'warning',
          issue_type: 'target_missing_ingredient',
          canonical_key: ingredientKey,
          message: `[import] nutrient target ingredient not found for ${ingredientKey}`,
        });
        if (strictMode) throw new Error(`[import] nutrient target ingredient not found for ${ingredientKey}`);
        return;
      }
      const referenceIds = parseListFromFields(record.reference_ids_list, record.reference_ids);
      nutrientTargetRows.push({
        ingredient_id: ingredientUuid,
        ingredient_key: ingredientKey,
        target_type: normalizeText(record.target_type as string | null),
        target_value: toNumber(record.target_value),
        unit: normalizeText(record.unit as string | null),
        jurisdiction: normalizeText(record.jurisdiction as string | null),
        authority: normalizeText(record.authority as string | null),
        reference_ids: referenceIds.length ? referenceIds : null,
        audit_status: resolveAuditStatus(record.audit_status as string | null),
        notes: normalizeText(record.notes as string | null),
      });
    });

    targetProfiles.forEach((record) => {
      const profileId = normalizeText(record.profile_id as string | null);
      if (!profileId) return;
      const referenceIds = parseListFromFields(record.reference_ids_list, record.reference_ids);
      targetProfileRows.push({
        profile_id: profileId,
        profile_name: normalizeText(record.profile_name as string | null),
        description: normalizeText(record.description as string | null),
        default_for: normalizeText(record.default_for as string | null),
        audit_status: resolveAuditStatus(record.audit_status as string | null),
        reference_ids: referenceIds.length ? referenceIds : null,
        notes: normalizeText(record.notes as string | null),
      });
    });

    ulToxicity.forEach((record) => {
      const ulId = normalizeText(record.ul_id as string | null);
      if (!ulId) return;
      const ingredientKey = normalizeText(record.ingredient_id as string | null);
      if (!ingredientKey) return;
      const ingredientUuid = ingredientIdMap.get(ingredientKey);
      if (!ingredientUuid) {
        recordIssue({
          severity: strictMode ? 'error' : 'warning',
          issue_type: 'ul_missing_ingredient',
          canonical_key: ingredientKey,
          message: `[import] UL ingredient not found for ${ingredientKey}`,
        });
        if (strictMode) throw new Error(`[import] UL ingredient not found for ${ingredientKey}`);
        return;
      }
      const unit = normalizeText(record.unit as string | null);
      if (!unit) {
        recordIssue({
          severity: strictMode ? 'error' : 'warning',
          issue_type: 'ul_missing_unit',
          canonical_key: ingredientKey,
          message: `[import] UL unit missing for ${ulId}`,
        });
        if (strictMode) throw new Error(`[import] UL unit missing for ${ulId}`);
        return;
      }
      const referenceIds = parseListFromFields(record.reference_ids_list, record.reference_ids);
      ulToxicityRows.push({
        ul_id: ulId,
        ingredient_id: ingredientUuid,
        ingredient_key: ingredientKey,
        population: normalizeText(record.population as string | null),
        age_range: normalizeText(record.age_range as string | null),
        authority: normalizeText(record.authority as string | null),
        ul_value: toNumber(record.ul_value),
        unit,
        scope: normalizeText(record.scope as string | null),
        confidence: toNumber(record.confidence),
        audit_status: resolveAuditStatus(record.audit_status as string | null),
        reference_ids: referenceIds.length ? referenceIds : null,
        notes: normalizeText(record.notes as string | null),
      });
    });

    doseResponseCurves.forEach((record) => {
      const curveId = normalizeText(record.curve_id as string | null);
      if (!curveId) return;
      const ingredientKey = normalizeText(record.ingredient_id as string | null);
      if (!ingredientKey) return;
      const ingredientUuid = ingredientIdMap.get(ingredientKey);
      if (!ingredientUuid) {
        recordIssue({
          severity: strictMode ? 'error' : 'warning',
          issue_type: 'curve_missing_ingredient',
          canonical_key: ingredientKey,
          message: `[import] dose curve ingredient not found for ${ingredientKey}`,
        });
        if (strictMode) throw new Error(`[import] dose curve ingredient not found for ${ingredientKey}`);
        return;
      }
      const referenceIds = parseListFromFields(record.reference_ids_list, record.reference_ids);
      doseResponseRows.push({
        curve_id: curveId,
        ingredient_id: ingredientUuid,
        ingredient_key: ingredientKey,
        curve_type: normalizeText(record.curve_type as string | null),
        beneficial_min: toNumber(record.beneficial_min),
        target_value: toNumber(record.target_value),
        target_unit: normalizeText(record.target_unit as string | null),
        plateau_start: toNumber(record.plateau_start),
        plateau_end: toNumber(record.plateau_end),
        ul_value: toNumber(record.ul_value),
        ul_unit: normalizeText(record.ul_unit as string | null),
        ul_scope: normalizeText(record.ul_scope as string | null),
        penalty_start: toNumber(record.penalty_start),
        penalty_slope: toNumber(record.penalty_slope),
        score_midpoint: toNumber(record.score_midpoint),
        score_cap: toNumber(record.score_cap),
        notes: normalizeText(record.notes as string | null),
        audit_status: resolveAuditStatus(record.audit_status as string | null),
        reference_ids: referenceIds.length ? referenceIds : null,
      });
    });
  }

  if (!dryRun && formRows.length) {
    for (const batch of chunk(formRows, 500)) {
      const { error } = await supabase
        .from('ingredient_forms')
        .upsert(batch, { onConflict: 'ingredient_id,form_key' })
        .select('id,ingredient_id,form_key');
      if (error) {
        throw new Error(`[import] ingredient_forms upsert failed: ${error.message}`);
      }
    }
  }

  if (!dryRun && formRefs.length) {
    for (const entry of formRefs) {
      const { data, error } = await supabase
        .from('ingredient_forms')
        .select('id')
        .eq('ingredient_id', entry.ingredient_id)
        .eq('form_key', entry.form_key)
        .maybeSingle();
      if (error || !data?.id) {
        throw new Error(`[import] form lookup failed (${entry.form_key}): ${error?.message ?? 'no id'}`);
      }
      const joinRows = entry.reference_ids.map((ref) => ({
        form_id: data.id,
        citation_id: ref,
      }));
      const { error: joinError } = await supabase
        .from('ingredient_form_citations')
        .upsert(joinRows, { onConflict: 'form_id,citation_id' });
      if (joinError) {
        throw new Error(`[import] form citations upsert failed: ${joinError.message}`);
      }
    }
  }

  if (!dryRun && evidenceRows.length) {
    for (const batch of chunk(evidenceRows, 500)) {
      const { error } = await supabase
        .from('ingredient_evidence')
        .upsert(batch, { onConflict: 'ingredient_id,goal' })
        .select('id,ingredient_id,goal');
      if (error) {
        throw new Error(`[import] ingredient_evidence upsert failed: ${error.message}`);
      }
    }
  }

  if (!dryRun && evidenceRefs.length) {
    for (const entry of evidenceRefs) {
      const { data, error } = await supabase
        .from('ingredient_evidence')
        .select('id')
        .eq('ingredient_id', entry.ingredient_id)
        .eq('goal', entry.goal)
        .maybeSingle();
      if (error || !data?.id) {
        throw new Error(`[import] evidence lookup failed (${entry.goal}): ${error?.message ?? 'no id'}`);
      }
      const joinRows = entry.reference_ids.map((ref) => ({
        evidence_id: data.id,
        citation_id: ref,
      }));
      const { error: joinError } = await supabase
        .from('ingredient_evidence_citations')
        .upsert(joinRows, { onConflict: 'evidence_id,citation_id' });
      if (joinError) {
        throw new Error(`[import] evidence citations upsert failed: ${joinError.message}`);
      }
    }
  }

  if (!dryRun && importKnowledge && interactionRows.length) {
    for (const batch of chunk(interactionRows, 500)) {
      const { error } = await supabase
        .from('interactions')
        .upsert(batch, { onConflict: 'interaction_id' });
      if (error) {
        throw new Error(`[import] interactions upsert failed: ${error.message}`);
      }
    }
  }

  if (!dryRun && importKnowledge && nutrientTargetRows.length) {
    for (const batch of chunk(nutrientTargetRows, 500)) {
      const { error } = await supabase
        .from('nutrient_targets')
        .upsert(batch, { onConflict: 'ingredient_id,target_type,jurisdiction,authority' });
      if (error) {
        throw new Error(`[import] nutrient_targets upsert failed: ${error.message}`);
      }
    }
  }

  if (!dryRun && importKnowledge && targetProfileRows.length) {
    for (const batch of chunk(targetProfileRows, 500)) {
      const { error } = await supabase
        .from('target_profiles')
        .upsert(batch, { onConflict: 'profile_id' });
      if (error) {
        throw new Error(`[import] target_profiles upsert failed: ${error.message}`);
      }
    }
  }

  if (!dryRun && importKnowledge && ulToxicityRows.length) {
    for (const batch of chunk(ulToxicityRows, 500)) {
      const { error } = await supabase
        .from('ul__toxicity')
        .upsert(batch, { onConflict: 'ul_id' });
      if (error) {
        throw new Error(`[import] ul__toxicity upsert failed: ${error.message}`);
      }
    }
  }

  if (!dryRun && importKnowledge && doseResponseRows.length) {
    for (const batch of chunk(doseResponseRows, 500)) {
      const { error } = await supabase
        .from('dose_response_curves')
        .upsert(batch, { onConflict: 'curve_id' });
      if (error) {
        throw new Error(`[import] dose_response_curves upsert failed: ${error.message}`);
      }
    }
  }

  if (!dryRun && datasetVersion && !skipDatasetVersion) {
    const { error } = await supabase
      .from('scoring_dataset_state')
      .upsert({ key: 'ingredient_dataset', version: datasetVersion }, { onConflict: 'key' });
    if (error) {
      throw new Error(`[import] dataset version update failed: ${error.message}`);
    }
  }

  if (!dryRun && runId) {
    if (issues.length) {
      const issueRows = issues.map((issue) => ({
        run_id: runId,
        severity: issue.severity,
        issue_type: issue.issue_type,
        canonical_key: issue.canonical_key ?? null,
        ingredient_id: issue.ingredient_id ?? null,
        message: issue.message,
        payload_json: issue.payload_json ?? null,
      }));
      const { error } = await supabase
        .from('ingredient_dataset_import_issues')
        .insert(issueRows);
      if (error) {
        throw new Error(`[import] issue insert failed: ${error.message}`);
      }
      issuesFlushed = true;
    }
    const { error } = await supabase
      .from('ingredient_dataset_import_runs')
      .update({
        finished_at: new Date().toISOString(),
        stats_json: {
          ingredients: ingredients.length,
          citations: importKnowledge ? citations.length : 0,
          forms: importKnowledge ? formRows.length : 0,
          evidence: importKnowledge ? evidenceRows.length : 0,
          aliases: importParsing ? aliases.length : 0,
          normalization_rules: importParsing ? normalizationRules.length : 0,
          token_aliases: importParsing ? tokenAliases.length : 0,
          generic_form_tokens: importParsing ? genericFormTokens.length : 0,
          interactions: importKnowledge ? interactionRows.length : 0,
          nutrient_targets: importKnowledge ? nutrientTargetRows.length : 0,
          target_profiles: importKnowledge ? targetProfileRows.length : 0,
          ul__toxicity: importKnowledge ? ulToxicityRows.length : 0,
          dose_response_curves: importKnowledge ? doseResponseRows.length : 0,
          warnings: warnings.length,
          issues: issues.length,
        },
      })
      .eq('id', runId);
    if (error) {
      throw new Error(`[import] import run update failed: ${error.message}`);
    }
  }

  warnings.forEach((warning) => console.warn(warning));
  console.log(
    `[import] done ingredients=${ingredients.length} citations=${importKnowledge ? citations.length : 0} forms=${importKnowledge ? formRows.length : 0} evidence=${importKnowledge ? evidenceRows.length : 0} aliases=${importParsing ? aliases.length : 0} parsing_rules=${importParsing ? normalizationRules.length : 0} token_aliases=${importParsing ? tokenAliases.length : 0} generic_form_tokens=${importParsing ? genericFormTokens.length : 0} interactions=${importKnowledge ? interactionRows.length : 0} nutrient_targets=${importKnowledge ? nutrientTargetRows.length : 0} target_profiles=${importKnowledge ? targetProfileRows.length : 0} ul_toxicity=${importKnowledge ? ulToxicityRows.length : 0} dose_response_curves=${importKnowledge ? doseResponseRows.length : 0} dryRun=${dryRun} strict=${strictMode} warnings=${warnings.length}`,
  );
  } catch (error) {
    if (!dryRun && runId) {
      if (issues.length && !issuesFlushed) {
        const issueRows = issues.map((issue) => ({
          run_id: runId,
          severity: issue.severity,
          issue_type: issue.issue_type,
          canonical_key: issue.canonical_key ?? null,
          ingredient_id: issue.ingredient_id ?? null,
          message: issue.message,
          payload_json: issue.payload_json ?? null,
        }));
        await supabase.from('ingredient_dataset_import_issues').insert(issueRows);
      }
      await supabase
        .from('ingredient_dataset_import_runs')
        .update({
          finished_at: new Date().toISOString(),
          stats_json: {
            ingredients: ingredients.length,
            citations: importKnowledge ? citations.length : 0,
            forms: importKnowledge ? formRows.length : 0,
            evidence: importKnowledge ? evidenceRows.length : 0,
            aliases: importParsing ? aliases.length : 0,
            normalization_rules: importParsing ? normalizationRules.length : 0,
            token_aliases: importParsing ? tokenAliases.length : 0,
            generic_form_tokens: importParsing ? genericFormTokens.length : 0,
            interactions: importKnowledge ? interactionRows.length : 0,
            nutrient_targets: importKnowledge ? nutrientTargetRows.length : 0,
            target_profiles: importKnowledge ? targetProfileRows.length : 0,
            ul__toxicity: importKnowledge ? ulToxicityRows.length : 0,
            dose_response_curves: importKnowledge ? doseResponseRows.length : 0,
            warnings: warnings.length,
            issues: issues.length,
            error: error instanceof Error ? error.message : String(error),
          },
        })
        .eq('id', runId);
    }
    throw error;
  }
};

main().catch((error) => {
  console.error('[import] failed', error instanceof Error ? error.message : error);
  process.exit(1);
});
