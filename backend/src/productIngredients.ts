import { supabase } from './supabase.js';
import type { LabelDraft } from './labelAnalysis.js';

type Basis = 'label_serving' | 'recommended_daily' | 'assumed_daily';

type LabelFactsInput = {
  actives: { name: string; amount: number | null; unit: string | null }[];
  inactive: string[];
  proprietaryBlends: {
    name: string;
    totalAmount: number | null;
    unit: string | null;
    ingredients: string[] | null;
  }[];
};

type IngredientLookup = {
  id: string;
  baseUnit: string | null;
  matchMethod: 'exact' | 'synonym' | 'trgm' | 'manual' | null;
  matchConfidence: number | null;
};

type UnitKind = 'mass' | 'volume' | 'iu' | 'cfu' | 'percent' | 'homeopathic' | 'unknown';

type ProductIngredientRow = {
  source: 'dsld' | 'lnhpd' | 'ocr' | 'manual';
  source_id: string;
  canonical_source_id: string | null;
  ingredient_id: string | null;
  name_raw: string;
  name_key: string;
  amount: number | null;
  unit: string | null;
  unit_raw: string | null;
  amount_normalized: number | null;
  unit_normalized: string | null;
  unit_kind: UnitKind | null;
  basis: Basis;
  is_active: boolean;
  is_proprietary_blend: boolean;
  amount_unknown: boolean;
  form_raw: string | null;
  parse_confidence: number | null;
  match_method: IngredientLookup['matchMethod'];
  match_confidence: number | null;
};

const normalizeNameKey = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const buildNameKey = (value: string): string => {
  const normalized = normalizeNameKey(value);
  if (normalized) return normalized;
  return value.trim().toLowerCase();
};

const extractFormRaw = (nameRaw: string): string | null => {
  const trimmed = nameRaw.trim();
  if (!trimmed) return null;
  const parenMatch = trimmed.match(/\((?:as|from)\s+([^)]+)\)/i);
  if (parenMatch?.[1]) return parenMatch[1].trim();

  const asMatch = trimmed.match(/\bas\s+([a-z0-9][a-z0-9\s\-\/+]+)$/i);
  if (asMatch?.[1]) return asMatch[1].trim();

  const formMatch = trimmed.match(
    /\b(bisglycinate|glycinate|picolinate|citrate|gluconate|oxide|malate|taurate|orotate|threonate|phytosome|liposomal|liposome|novasol|meriva|longvida|chelate|chelates|sulfate|chloride|nitrate|aspartate|fumarate|carbonate|acetate|succinate|phosphate)\b/i,
  );
  if (formMatch) return formMatch[1].trim();

  return null;
};

const normalizeUnitLabel = (unitRaw?: string | null): string | null => {
  if (!unitRaw) return null;
  const normalized = unitRaw.trim().toLowerCase();
  if (!normalized) return null;
  if (
    normalized.startsWith('mcg') ||
    normalized.startsWith('ug') ||
    normalized.startsWith('\u00b5g') ||
    normalized.startsWith('\u03bcg') ||
    normalized.startsWith('microgram')
  ) {
    return 'mcg';
  }
  if (normalized.startsWith('mg') || normalized.startsWith('milligram')) return 'mg';
  if (normalized.startsWith('g') || normalized.startsWith('gram')) return 'g';
  if (normalized.startsWith('iu') || normalized.startsWith('i.u')) return 'iu';
  if (
    normalized.startsWith('ml') ||
    normalized.startsWith('milliliter') ||
    normalized.startsWith('millilitre')
  ) {
    return 'ml';
  }
  if (normalized.includes('cfu') || normalized.includes('ufc')) return 'cfu';
  if (normalized.startsWith('kcal')) return 'kcal';
  if (normalized.startsWith('cal')) return 'cal';
  if (normalized.startsWith('%') || normalized.includes('percent')) return '%';
  return normalized;
};

const MASS_UNITS = new Set(['mcg', 'ug', 'mg', 'g']);
const VOLUME_UNITS = new Set(['ml']);
const IU_UNITS = new Set(['iu']);
const CFU_UNITS = new Set(['cfu']);
const HOMEOPATHIC_UNITS = new Set(['x', 'c', 'ch', 'd', 'dh', 'lm', 'mk', 'ck', 'mt']);

const classifyUnitKind = (unitRaw?: string | null): UnitKind => {
  if (!unitRaw) return 'unknown';
  const normalized = normalizeUnitLabel(unitRaw) ?? unitRaw.trim().toLowerCase();
  const unit = normalized.trim().toLowerCase();
  if (!unit) return 'unknown';
  if (unit.includes('%') || unit.includes('percent') || unit.includes('dv')) return 'percent';
  if (HOMEOPATHIC_UNITS.has(unit)) return 'homeopathic';
  if (MASS_UNITS.has(unit)) return 'mass';
  if (VOLUME_UNITS.has(unit)) return 'volume';
  if (IU_UNITS.has(unit)) return 'iu';
  if (CFU_UNITS.has(unit)) return 'cfu';
  return 'unknown';
};

const isDoseUnitKind = (unitKind: UnitKind): boolean =>
  unitKind === 'mass' || unitKind === 'volume' || unitKind === 'iu' || unitKind === 'cfu';

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const computeRowParseConfidence = (
  baseConfidence: number | null | undefined,
  params: { amountMissing: boolean; unitKind: UnitKind; hasUnit: boolean },
): number | null => {
  if (typeof baseConfidence !== 'number' || !Number.isFinite(baseConfidence)) return null;
  let score = baseConfidence;
  if (params.amountMissing) score -= 0.15;
  if (!params.hasUnit || !isDoseUnitKind(params.unitKind)) score -= 0.15;
  if (params.unitKind === 'homeopathic') score -= 0.25;
  return clamp(score, 0.05, 0.99);
};

const isRpcMissing = (error?: { code?: string; message?: string } | null): boolean => {
  if (!error) return false;
  if (error.code === 'PGRST202') return true;
  return (error.message ?? '').toLowerCase().includes('could not find the function');
};

const parseCfuMultiplier = (unitLower: string): number | null => {
  if (!unitLower.includes('cfu') && !unitLower.includes('ufc')) return null;
  if (unitLower.includes('trillion')) return 1_000_000_000_000;
  if (unitLower.includes('billion')) return 1_000_000_000;
  if (unitLower.includes('million')) return 1_000_000;
  return 1;
};

const normalizeAmountAndUnit = (
  amount: number | null,
  unitRaw?: string | null,
): { amount: number | null; unit: string | null } => {
  if (!unitRaw) return { amount, unit: null };
  const normalizedUnit = normalizeUnitLabel(unitRaw) ?? unitRaw.trim();
  if (amount == null) return { amount, unit: normalizedUnit };
  const unitLower = unitRaw.trim().toLowerCase();
  const cfuMultiplier = parseCfuMultiplier(unitLower);
  if (cfuMultiplier) {
    return { amount: amount * cfuMultiplier, unit: 'cfu' };
  }
  return { amount, unit: normalizedUnit };
};

const resolveIngredientLookup = async (
  name: string,
  cache: Map<string, IngredientLookup | null>,
): Promise<IngredientLookup | null> => {
  const key = normalizeNameKey(name);
  if (!key) return null;
  if (cache.has(key)) return cache.get(key) ?? null;

  try {
    const { data: ingredient, error } = await supabase
      .from('ingredients')
      .select('id,unit')
      .ilike('name', name)
      .maybeSingle();
    if (!error && ingredient?.id) {
      const lookup: IngredientLookup = {
        id: ingredient.id as string,
        baseUnit: ingredient.unit ?? null,
        matchMethod: 'exact',
        matchConfidence: 1,
      };
      cache.set(key, lookup);
      return lookup;
    }
  } catch {
    // Ignore lookup failures and fall through to synonyms.
  }

  try {
    const { data: synonym, error } = await supabase
      .from('ingredient_synonyms')
      .select('ingredient_id')
      .ilike('synonym', name)
      .maybeSingle();
    if (!error && synonym?.ingredient_id) {
      const { data: ingredient, error: ingredientError } = await supabase
        .from('ingredients')
        .select('id,unit')
        .eq('id', synonym.ingredient_id)
        .maybeSingle();
      if (!ingredientError && ingredient?.id) {
        const lookup: IngredientLookup = {
          id: ingredient.id as string,
          baseUnit: ingredient.unit ?? null,
          matchMethod: 'synonym',
          matchConfidence: 0.97,
        };
        cache.set(key, lookup);
        return lookup;
      }
    }
  } catch {
    // Ignore lookup failures and fall through to fuzzy.
  }

  try {
    const { data, error } = await supabase.rpc('resolve_ingredient_lookup', {
      query_text: name,
    });
    if (error) {
      if (!isRpcMissing(error)) {
        console.warn('[ProductIngredients] Ingredient lookup RPC failed', error.message);
      }
      cache.set(key, null);
      return null;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (row?.ingredient_id) {
      const matchConfidence =
        typeof row.match_confidence === 'number'
          ? row.match_confidence
          : Number(row.match_confidence);
      const lookup: IngredientLookup = {
        id: row.ingredient_id as string,
        baseUnit: row.base_unit ?? null,
        matchMethod: row.match_method ?? 'trgm',
        matchConfidence: Number.isFinite(matchConfidence) ? matchConfidence : null,
      };
      cache.set(key, lookup);
      return lookup;
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'message' in error) {
      console.warn('[ProductIngredients] Ingredient lookup RPC error', (error as Error).message);
    }
  }

  cache.set(key, null);
  return null;
};

const resolveConversionFactor = async (
  ingredientId: string,
  fromUnit: string,
  toUnit: string,
  cache: Map<string, number | null>,
): Promise<number | null> => {
  const key = `${ingredientId}:${fromUnit}:${toUnit}`;
  if (cache.has(key)) return cache.get(key) ?? null;

  try {
    const { data, error } = await supabase
      .from('ingredient_unit_conversions')
      .select('factor')
      .eq('ingredient_id', ingredientId)
      .eq('from_unit', fromUnit)
      .eq('to_unit', toUnit)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error || !data?.length) {
      cache.set(key, null);
      return null;
    }
    const factor = Number(data[0]?.factor);
    const resolved = Number.isFinite(factor) ? factor : null;
    cache.set(key, resolved);
    return resolved;
  } catch {
    cache.set(key, null);
    return null;
  }
};

const hydrateRowsWithLookups = async (rows: ProductIngredientRow[]): Promise<void> => {
  const ingredientCache = new Map<string, IngredientLookup | null>();
  const conversionCache = new Map<string, number | null>();

  for (const row of rows) {
    const lookup = await resolveIngredientLookup(row.name_raw, ingredientCache);
    row.ingredient_id = lookup?.id ?? null;
    row.match_method = lookup?.matchMethod ?? null;
    row.match_confidence = lookup?.matchConfidence ?? null;

    if (row.amount == null || !row.unit || !lookup?.baseUnit) {
      continue;
    }

    if (row.unit === lookup.baseUnit) {
      row.amount_normalized = row.amount;
      row.unit_normalized = lookup.baseUnit;
      continue;
    }

    const factor = await resolveConversionFactor(
      lookup.id,
      row.unit,
      lookup.baseUnit,
      conversionCache,
    );
    if (factor != null) {
      row.amount_normalized = row.amount * factor;
      row.unit_normalized = lookup.baseUnit;
    } else {
      row.amount_unknown = true;
      if (row.unit_kind && isDoseUnitKind(row.unit_kind)) {
        row.unit_kind = 'unknown';
      }
    }
  }
};

const dedupeProductIngredientRows = (rows: ProductIngredientRow[]): ProductIngredientRow[] => {
  const map = new Map<string, ProductIngredientRow>();
  for (const row of rows) {
    const nameKey = row.name_key || buildNameKey(row.name_raw);
    const key = `${row.source}:${row.source_id}:${row.basis}:${nameKey}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...row, name_key: nameKey });
      continue;
    }
    const merged: ProductIngredientRow = { ...existing };
    merged.canonical_source_id = existing.canonical_source_id ?? row.canonical_source_id ?? null;
    merged.ingredient_id = existing.ingredient_id ?? row.ingredient_id ?? null;
    merged.name_key = existing.name_key || row.name_key || nameKey;
    merged.unit_kind = existing.unit_kind ?? row.unit_kind ?? null;
    merged.form_raw = existing.form_raw ?? row.form_raw;
    merged.is_active = existing.is_active || row.is_active;
    merged.is_proprietary_blend = existing.is_proprietary_blend || row.is_proprietary_blend;

    if (existing.amount == null && row.amount != null) {
      merged.amount = row.amount;
      merged.unit = row.unit;
      merged.unit_raw = row.unit_raw;
    } else {
      merged.amount = existing.amount ?? row.amount ?? null;
      merged.unit = existing.unit ?? row.unit;
      merged.unit_raw = existing.unit_raw ?? row.unit_raw;
    }

    merged.amount_normalized = existing.amount_normalized ?? row.amount_normalized ?? null;
    merged.unit_normalized = existing.unit_normalized ?? row.unit_normalized ?? null;
    merged.amount_unknown = Boolean(
      existing.amount_unknown || row.amount_unknown || merged.amount == null,
    );

    const parseValues = [existing.parse_confidence, row.parse_confidence].filter(
      (value): value is number => typeof value === 'number',
    );
    merged.parse_confidence = parseValues.length ? Math.max(...parseValues) : null;

    const existingMatch = existing.match_confidence ?? -1;
    const nextMatch = row.match_confidence ?? -1;
    if (nextMatch > existingMatch) {
      merged.match_confidence = row.match_confidence ?? null;
      merged.match_method = row.match_method ?? null;
    } else {
      merged.match_confidence = existing.match_confidence ?? null;
      merged.match_method = existing.match_method ?? null;
    }

    map.set(key, merged);
  }
  return Array.from(map.values());
};

const upsertProductIngredientRows = async (rows: ProductIngredientRow[]): Promise<void> => {
  const dedupedRows = dedupeProductIngredientRows(rows);
  if (!dedupedRows.length) return;
  try {
    await hydrateRowsWithLookups(dedupedRows);
    const { error } = await supabase
      .from('product_ingredients')
      .upsert(dedupedRows, { onConflict: 'source,source_id,basis,name_key' });
    if (error) {
      console.warn('[ProductIngredients] Upsert failed', error.message);
    }
  } catch (error) {
    console.warn('[ProductIngredients] Upsert error', error);
  }
};

export async function upsertProductIngredientsFromLabelFacts(params: {
  source: 'dsld' | 'lnhpd';
  sourceId: string;
  canonicalSourceId?: string | null;
  labelFacts: LabelFactsInput;
  basis?: Basis;
  parseConfidence?: number | null;
}): Promise<void> {
  const basis = params.basis ?? 'label_serving';
  const rows: ProductIngredientRow[] = [];

  params.labelFacts.actives.forEach((item) => {
    if (!item.name) return;
    const normalized = normalizeAmountAndUnit(item.amount ?? null, item.unit ?? null);
    const unitKind = classifyUnitKind(item.unit ?? normalized.unit);
    const amountMissing = normalized.amount == null;
    const amountUnknown = amountMissing || !isDoseUnitKind(unitKind);
    const nameKey = buildNameKey(item.name);
    const formRaw = extractFormRaw(item.name);
    rows.push({
      source: params.source,
      source_id: params.sourceId,
      canonical_source_id: params.canonicalSourceId ?? null,
      ingredient_id: null,
      name_raw: item.name,
      name_key: nameKey,
      amount: normalized.amount ?? null,
      unit: normalized.unit,
      unit_raw: item.unit ?? null,
      amount_normalized: null,
      unit_normalized: null,
      unit_kind: unitKind,
      basis,
      is_active: true,
      is_proprietary_blend: false,
      amount_unknown: amountUnknown,
      form_raw: formRaw,
      parse_confidence: computeRowParseConfidence(params.parseConfidence, {
        amountMissing,
        unitKind,
        hasUnit: normalized.unit != null,
      }),
      match_method: null,
      match_confidence: null,
    });
  });

  params.labelFacts.proprietaryBlends.forEach((blend) => {
    if (!blend.name) return;
    const normalized = normalizeAmountAndUnit(blend.totalAmount ?? null, blend.unit ?? null);
    const unitKind = classifyUnitKind(blend.unit ?? normalized.unit);
    const amountMissing = normalized.amount == null;
    const amountUnknown = amountMissing || !isDoseUnitKind(unitKind);
    const nameKey = buildNameKey(blend.name);
    const formRaw = extractFormRaw(blend.name);
    rows.push({
      source: params.source,
      source_id: params.sourceId,
      canonical_source_id: params.canonicalSourceId ?? null,
      ingredient_id: null,
      name_raw: blend.name,
      name_key: nameKey,
      amount: normalized.amount ?? null,
      unit: normalized.unit,
      unit_raw: blend.unit ?? null,
      amount_normalized: null,
      unit_normalized: null,
      unit_kind: unitKind,
      basis,
      is_active: true,
      is_proprietary_blend: true,
      amount_unknown: amountUnknown,
      form_raw: formRaw,
      parse_confidence: computeRowParseConfidence(params.parseConfidence, {
        amountMissing,
        unitKind,
        hasUnit: normalized.unit != null,
      }),
      match_method: null,
      match_confidence: null,
    });
  });

  params.labelFacts.inactive.forEach((name) => {
    if (!name) return;
    const unitKind = classifyUnitKind(null);
    const amountMissing = true;
    const amountUnknown = true;
    const nameKey = buildNameKey(name);
    const formRaw = extractFormRaw(name);
    rows.push({
      source: params.source,
      source_id: params.sourceId,
      canonical_source_id: params.canonicalSourceId ?? null,
      ingredient_id: null,
      name_raw: name,
      name_key: nameKey,
      amount: null,
      unit: null,
      unit_raw: null,
      amount_normalized: null,
      unit_normalized: null,
      unit_kind: unitKind,
      basis,
      is_active: false,
      is_proprietary_blend: false,
      amount_unknown: amountUnknown,
      form_raw: formRaw,
      parse_confidence: computeRowParseConfidence(params.parseConfidence, {
        amountMissing,
        unitKind,
        hasUnit: false,
      }),
      match_method: null,
      match_confidence: null,
    });
  });

  await upsertProductIngredientRows(rows);
}

export async function upsertProductIngredientsFromDraft(params: {
  sourceId: string;
  draft: LabelDraft;
  basis?: Basis;
}): Promise<void> {
  const basis = params.basis ?? 'label_serving';
  const rows: ProductIngredientRow[] = params.draft.ingredients.map((ingredient) => {
    const normalized = normalizeAmountAndUnit(
      ingredient.amount ?? null,
      ingredient.unit ?? null,
    );
    const unitKind = classifyUnitKind(ingredient.unit ?? normalized.unit);
    const nameKey = buildNameKey(ingredient.name);
    const formRaw = extractFormRaw(ingredient.name);
    const amountUnknown =
      normalized.amount == null && ingredient.dvPercent == null
        ? true
        : !isDoseUnitKind(unitKind);
    return {
      source: 'ocr',
      source_id: params.sourceId,
      canonical_source_id: null,
      ingredient_id: null,
      name_raw: ingredient.name,
      name_key: nameKey,
      amount: normalized.amount ?? null,
      unit: normalized.unit,
      unit_raw: ingredient.unit ?? null,
      amount_normalized: null,
      unit_normalized: null,
      unit_kind: unitKind,
      basis,
      is_active: true,
      is_proprietary_blend: false,
      amount_unknown: amountUnknown,
      form_raw: formRaw,
      parse_confidence: ingredient.confidence ?? params.draft.confidenceScore ?? null,
      match_method: null,
      match_confidence: null,
    };
  });

  await upsertProductIngredientRows(rows);
}
