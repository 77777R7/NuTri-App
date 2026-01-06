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
};

type ProductIngredientRow = {
  source: 'dsld' | 'lnhpd' | 'ocr' | 'manual';
  source_id: string;
  canonical_source_id: string | null;
  ingredient_id: string | null;
  name_raw: string;
  amount: number | null;
  unit: string | null;
  unit_raw: string | null;
  amount_normalized: number | null;
  unit_normalized: string | null;
  basis: Basis;
  is_active: boolean;
  is_proprietary_blend: boolean;
  amount_unknown: boolean;
  form_raw: string | null;
  parse_confidence: number | null;
};

const normalizeNameKey = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

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
      const lookup = { id: ingredient.id as string, baseUnit: ingredient.unit ?? null };
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
    if (error || !synonym?.ingredient_id) {
      cache.set(key, null);
      return null;
    }

    const { data: ingredient, error: ingredientError } = await supabase
      .from('ingredients')
      .select('id,unit')
      .eq('id', synonym.ingredient_id)
      .maybeSingle();
    if (!ingredientError && ingredient?.id) {
      const lookup = { id: ingredient.id as string, baseUnit: ingredient.unit ?? null };
      cache.set(key, lookup);
      return lookup;
    }
  } catch {
    // Ignore lookup failures and return null.
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
    }
  }
};

const dedupeProductIngredientRows = (rows: ProductIngredientRow[]): ProductIngredientRow[] => {
  const map = new Map<string, ProductIngredientRow>();
  for (const row of rows) {
    const key = `${row.source}:${row.source_id}:${row.name_raw}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...row });
      continue;
    }
    const merged: ProductIngredientRow = { ...existing };
    merged.canonical_source_id = existing.canonical_source_id ?? row.canonical_source_id ?? null;
    merged.ingredient_id = existing.ingredient_id ?? row.ingredient_id ?? null;
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
    merged.amount_unknown = merged.amount == null;

    const parseValues = [existing.parse_confidence, row.parse_confidence].filter(
      (value): value is number => typeof value === 'number',
    );
    merged.parse_confidence = parseValues.length ? Math.max(...parseValues) : null;

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
      .upsert(dedupedRows, { onConflict: 'source,source_id,name_raw' });
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
    rows.push({
      source: params.source,
      source_id: params.sourceId,
      canonical_source_id: params.canonicalSourceId ?? null,
      ingredient_id: null,
      name_raw: item.name,
      amount: normalized.amount ?? null,
      unit: normalized.unit,
      unit_raw: item.unit ?? null,
      amount_normalized: null,
      unit_normalized: null,
      basis,
      is_active: true,
      is_proprietary_blend: false,
      amount_unknown: normalized.amount == null,
      form_raw: null,
      parse_confidence: params.parseConfidence ?? null,
    });
  });

  params.labelFacts.proprietaryBlends.forEach((blend) => {
    if (!blend.name) return;
    const normalized = normalizeAmountAndUnit(blend.totalAmount ?? null, blend.unit ?? null);
    rows.push({
      source: params.source,
      source_id: params.sourceId,
      canonical_source_id: params.canonicalSourceId ?? null,
      ingredient_id: null,
      name_raw: blend.name,
      amount: normalized.amount ?? null,
      unit: normalized.unit,
      unit_raw: blend.unit ?? null,
      amount_normalized: null,
      unit_normalized: null,
      basis,
      is_active: true,
      is_proprietary_blend: true,
      amount_unknown: normalized.amount == null,
      form_raw: null,
      parse_confidence: params.parseConfidence ?? null,
    });
  });

  params.labelFacts.inactive.forEach((name) => {
    if (!name) return;
    rows.push({
      source: params.source,
      source_id: params.sourceId,
      canonical_source_id: params.canonicalSourceId ?? null,
      ingredient_id: null,
      name_raw: name,
      amount: null,
      unit: null,
      unit_raw: null,
      amount_normalized: null,
      unit_normalized: null,
      basis,
      is_active: false,
      is_proprietary_blend: false,
      amount_unknown: true,
      form_raw: null,
      parse_confidence: params.parseConfidence ?? null,
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
    const amountUnknown = normalized.amount == null && ingredient.dvPercent == null;
    return {
      source: 'ocr',
      source_id: params.sourceId,
      canonical_source_id: null,
      ingredient_id: null,
      name_raw: ingredient.name,
      amount: normalized.amount ?? null,
      unit: normalized.unit,
      unit_raw: ingredient.unit ?? null,
      amount_normalized: null,
      unit_normalized: null,
      basis,
      is_active: true,
      is_proprietary_blend: false,
      amount_unknown: amountUnknown,
      form_raw: null,
      parse_confidence: ingredient.confidence ?? params.draft.confidenceScore ?? null,
    };
  });

  await upsertProductIngredientRows(rows);
}
