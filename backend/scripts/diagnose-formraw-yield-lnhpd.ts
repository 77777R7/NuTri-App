import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { supabase } from "../src/supabase.js";
import { extractErrorMeta, withRetry } from "../src/supabaseRetry.js";
import {
  canonicalizeLnhpdFormTokens,
  extractExplicitFormTokens,
} from "../src/formTaxonomy/lnhpdFormTokenMap.js";

type IngredientRow = {
  id: string | null;
  source_id: string | null;
  canonical_source_id: string | null;
  ingredient_id: string | null;
  name_raw: string | null;
  name_key: string | null;
  form_raw: string | null;
};

type IngredientMeta = {
  id: string;
  name: string | null;
};

type IngredientFormRow = {
  ingredient_id: string | null;
  form_key: string | null;
};

type IngredientAliasRow = {
  ingredient_id: string | null;
  alias_norm: string | null;
  form_key: string | null;
};

type SnapshotRow = {
  id: string;
  sourceId: string;
  ingredientId: string;
  nameRaw: string | null;
  formRaw: string | null;
};

type FactsRow = {
  lnhpd_id: string | number | null;
  facts_json: Record<string, unknown> | null;
};

type TokenSourceTokens = {
  name_fields: string[];
  proper_name: string[];
  source_material: string[];
};

type TokenIndexEntry = {
  tokens: string[];
  sourceTokensRaw: TokenSourceTokens;
  sourceTokensNormalized: TokenSourceTokens;
};

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const SOURCE_IDS_FILE = getArg("source-ids-file");
const ID_COLUMN = (getArg("id-column") ?? "canonical_source_id").trim();
const OUTPUT =
  getArg("output") ?? "output/formraw/formraw_yield_lnhpd.json";
const SNAPSHOT_OUTPUT = getArg("snapshot-output");
const COMPARE_SNAPSHOT = getArg("compare-snapshot");
const SAMPLE_LIMIT = Math.max(1, Number(getArg("sample-limit") ?? "20"));
const CHUNK_SIZE = Math.max(1, Number(getArg("chunk-size") ?? "200"));

const ensureDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  await mkdir(dir, { recursive: true });
};

const isEmptyFormRaw = (value: string | null | undefined): boolean =>
  !value || !value.trim();

const normalizeText = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const normalizeAliasToken = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const normalizeIdValue = (value: unknown): string | null => {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
};

const loadSourceIds = async (filePath: string): Promise<string[]> => {
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) {
    return parsed
      .map((value) => normalizeIdValue(value))
      .filter((value): value is string => Boolean(value));
  }
  if (parsed && Array.isArray(parsed.sourceIds)) {
    return parsed.sourceIds
      .map((value: unknown) => normalizeIdValue(value))
      .filter((value): value is string => Boolean(value));
  }
  throw new Error(`[formraw-yield] invalid source ids file: ${filePath}`);
};

const chunkArray = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

const LNHPD_MEDICINAL_NAME_KEYS = [
  "medicinal_ingredient_name",
  "ingredient_name",
  "medicinal_ingredient_name_en",
  "ingredient_name_en",
  "substance_name",
  "name",
];

const LNHPD_PROPER_NAME_KEYS = ["proper_name"];

const LNHPD_SOURCE_MATERIAL_KEYS = [
  "source_material",
  "source_material_desc",
  "source_material_name",
  "source_material_en",
];

const pickStringField = (record: Record<string, unknown>, keys: string[]): string[] => {
  const values: string[] = [];
  keys.forEach((key) => {
    const value = record[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) values.push(trimmed);
    }
  });
  return values;
};

const extractNameKeys = (record: Record<string, unknown>): string[] => {
  const names = pickStringField(record, LNHPD_MEDICINAL_NAME_KEYS);
  const normalized = new Set<string>();
  names.forEach((name) => {
    const key = normalizeText(name);
    if (key) normalized.add(key);
  });
  return Array.from(normalized);
};

const extractFormSources = (record: Record<string, unknown>): string[] => {
  const sources = [
    ...pickStringField(record, LNHPD_MEDICINAL_NAME_KEYS),
    ...pickStringField(record, LNHPD_SOURCE_MATERIAL_KEYS),
    ...pickStringField(record, LNHPD_PROPER_NAME_KEYS),
  ];
  return Array.from(new Set(sources));
};

const fetchIngredientNames = async (ingredientIds: string[]): Promise<Map<string, string | null>> => {
  const map = new Map<string, string | null>();
  if (!ingredientIds.length) return map;
  for (const chunk of chunkArray(ingredientIds, CHUNK_SIZE)) {
    const { data, error } = await withRetry(() =>
      supabase
        .from("ingredients")
        .select("id,name")
        .in("id", chunk),
    );
    if (error) {
      const meta = extractErrorMeta(error);
      throw new Error(`[formraw-yield] ingredient meta fetch failed: ${meta.message ?? error.message}`);
    }
    (data ?? []).forEach((row) => {
      if (row?.id) map.set(row.id as string, (row as IngredientMeta).name ?? null);
    });
  }
  return map;
};

const fetchFactsJsonByIds = async (
  sourceIds: string[],
): Promise<Map<string, Record<string, unknown>>> => {
  const factsMap = new Map<string, Record<string, unknown>>();
  for (const chunk of chunkArray(sourceIds, CHUNK_SIZE)) {
    const { data, error, status, rayId } = await withRetry(() =>
      supabase
        .from("lnhpd_facts_complete")
        .select("lnhpd_id,facts_json")
        .in("lnhpd_id", chunk),
    );
    if (error) {
      const meta = extractErrorMeta(error, status, rayId ?? null);
      throw new Error(`[formraw-yield] facts_complete fetch failed: ${meta.message ?? error.message}`);
    }
    (data ?? []).forEach((row) => {
      const entry = row as FactsRow;
      if (!entry?.lnhpd_id || !entry.facts_json) return;
      factsMap.set(String(entry.lnhpd_id), entry.facts_json);
    });
  }

  const missing = sourceIds.filter((id) => !factsMap.has(id));
  for (const chunk of chunkArray(missing, CHUNK_SIZE)) {
    const { data, error, status, rayId } = await withRetry(() =>
      supabase
        .from("lnhpd_facts")
        .select("lnhpd_id,facts_json")
        .eq("is_on_market", true)
        .in("lnhpd_id", chunk),
    );
    if (error) {
      const meta = extractErrorMeta(error, status, rayId ?? null);
      throw new Error(`[formraw-yield] facts fallback fetch failed: ${meta.message ?? error.message}`);
    }
    (data ?? []).forEach((row) => {
      const entry = row as FactsRow;
      if (!entry?.lnhpd_id || !entry.facts_json) return;
      factsMap.set(String(entry.lnhpd_id), entry.facts_json);
    });
  }

  return factsMap;
};

const fetchRecognizedFormKeys = async (): Promise<Set<string>> => {
  const keys = new Set<string>();
  const { data: formData, error: formError } = await withRetry(() =>
    supabase.from("ingredient_forms").select("form_key"),
  );
  if (formError) {
    const meta = extractErrorMeta(formError);
    throw new Error(`[formraw-yield] form keys fetch failed: ${meta.message ?? formError.message}`);
  }
  (formData ?? []).forEach((row) => {
    const key = typeof row?.form_key === "string" ? row.form_key.trim() : "";
    if (key) keys.add(key.toLowerCase());
  });

  const { data: aliasData, error: aliasError } = await withRetry(() =>
    supabase.from("ingredient_form_aliases").select("form_key"),
  );
  if (aliasError) {
    const meta = extractErrorMeta(aliasError);
    throw new Error(`[formraw-yield] alias form keys fetch failed: ${meta.message ?? aliasError.message}`);
  }
  (aliasData ?? []).forEach((row) => {
    const key = typeof row?.form_key === "string" ? row.form_key.trim() : "";
    if (key) keys.add(key.toLowerCase());
  });

  return keys;
};

const fetchFormKeysByIngredient = async (
  ingredientIds: string[],
): Promise<Map<string, Set<string>>> => {
  const map = new Map<string, Set<string>>();
  if (!ingredientIds.length) return map;
  for (const chunk of chunkArray(ingredientIds, CHUNK_SIZE)) {
    const { data, error } = await withRetry(() =>
      supabase
        .from("ingredient_forms")
        .select("ingredient_id,form_key")
        .in("ingredient_id", chunk),
    );
    if (error) {
      const meta = extractErrorMeta(error);
      throw new Error(`[formraw-yield] form fetch failed: ${meta.message ?? error.message}`);
    }
    (data ?? []).forEach((row) => {
      const entry = row as IngredientFormRow;
      const ingredientId = entry?.ingredient_id ?? null;
      const formKey =
        typeof entry?.form_key === "string" ? entry.form_key.trim().toLowerCase() : "";
      if (!ingredientId || !formKey) return;
      const bucket = map.get(ingredientId) ?? new Set<string>();
      bucket.add(formKey);
      map.set(ingredientId, bucket);
    });
  }
  return map;
};

const fetchAliasMaps = async (
  ingredientIds: string[],
): Promise<{ global: Map<string, string>; scoped: Map<string, Map<string, string>> }> => {
  const global = new Map<string, string>();
  const scoped = new Map<string, Map<string, string>>();

  const { data: globalAliases, error: globalError } = await withRetry(() =>
    supabase
      .from("ingredient_form_aliases")
      .select("ingredient_id,alias_norm,form_key")
      .is("ingredient_id", null),
  );
  if (globalError) {
    const meta = extractErrorMeta(globalError);
    throw new Error(`[formraw-yield] alias fetch failed: ${meta.message ?? globalError.message}`);
  }
  (globalAliases ?? []).forEach((row) => {
    const entry = row as IngredientAliasRow;
    const aliasNorm = normalizeAliasToken(entry?.alias_norm ?? "");
    const formKey =
      typeof entry?.form_key === "string" ? entry.form_key.trim().toLowerCase() : "";
    if (!aliasNorm || !formKey) return;
    if (!global.has(aliasNorm)) global.set(aliasNorm, formKey);
  });

  if (!ingredientIds.length) return { global, scoped };
  for (const chunk of chunkArray(ingredientIds, CHUNK_SIZE)) {
    const { data, error } = await withRetry(() =>
      supabase
        .from("ingredient_form_aliases")
        .select("ingredient_id,alias_norm,form_key")
        .in("ingredient_id", chunk),
    );
    if (error) {
      const meta = extractErrorMeta(error);
      throw new Error(`[formraw-yield] alias fetch failed: ${meta.message ?? error.message}`);
    }
    (data ?? []).forEach((row) => {
      const entry = row as IngredientAliasRow;
      const ingredientId = entry?.ingredient_id ?? null;
      const aliasNorm = normalizeAliasToken(entry?.alias_norm ?? "");
      const formKey =
        typeof entry?.form_key === "string" ? entry.form_key.trim().toLowerCase() : "";
      if (!ingredientId || !aliasNorm || !formKey) return;
      const bucket = scoped.get(ingredientId) ?? new Map<string, string>();
      if (!bucket.has(aliasNorm)) bucket.set(aliasNorm, formKey);
      scoped.set(ingredientId, bucket);
    });
  }

  return { global, scoped };
};

const collectRawTokens = (sources: string[]): string[] => {
  const tokens: string[] = [];
  sources.forEach((source) => {
    if (!source || !source.trim()) return;
    tokens.push(...extractExplicitFormTokens(source));
  });
  return tokens;
};

const mergeTokenLists = (target: Set<string>, tokens: string[]) => {
  tokens.forEach((token) => {
    if (!token) return;
    target.add(token);
  });
};

const normalizeTokenList = (tokens: string[]): string[] =>
  canonicalizeLnhpdFormTokens(tokens);

const buildTokenIndex = (factsJson: Record<string, unknown>): Map<string, TokenIndexEntry> => {
  const index = new Map<
    string,
    {
      tokens: Set<string>;
      sourceTokensRaw: {
        name_fields: Set<string>;
        proper_name: Set<string>;
        source_material: Set<string>;
      };
      sourceTokensNormalized: {
        name_fields: Set<string>;
        proper_name: Set<string>;
        source_material: Set<string>;
      };
    }
  >();
  const medicinalRaw = factsJson.medicinalIngredients;
  const medicinal = Array.isArray(medicinalRaw)
    ? medicinalRaw
    : medicinalRaw
      ? [medicinalRaw]
      : [];

  medicinal.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    const nameKeys = extractNameKeys(record);
    if (!nameKeys.length) return;
    const nameSources = pickStringField(record, LNHPD_MEDICINAL_NAME_KEYS);
    const properSources = pickStringField(record, LNHPD_PROPER_NAME_KEYS);
    const materialSources = pickStringField(record, LNHPD_SOURCE_MATERIAL_KEYS);
    const rawNameTokens = collectRawTokens(nameSources);
    const rawProperTokens = collectRawTokens(properSources);
    const rawMaterialTokens = collectRawTokens(materialSources);
    const normalizedNameTokens = normalizeTokenList(rawNameTokens);
    const normalizedProperTokens = normalizeTokenList(rawProperTokens);
    const normalizedMaterialTokens = normalizeTokenList(rawMaterialTokens);
    const combinedTokens = normalizeTokenList([
      ...rawNameTokens,
      ...rawProperTokens,
      ...rawMaterialTokens,
    ]);
    if (!combinedTokens.length) return;

    nameKeys.forEach((key) => {
      const entry =
        index.get(key) ?? {
          tokens: new Set<string>(),
          sourceTokensRaw: {
            name_fields: new Set<string>(),
            proper_name: new Set<string>(),
            source_material: new Set<string>(),
          },
          sourceTokensNormalized: {
            name_fields: new Set<string>(),
            proper_name: new Set<string>(),
            source_material: new Set<string>(),
          },
        };
      mergeTokenLists(entry.tokens, combinedTokens);
      mergeTokenLists(entry.sourceTokensRaw.name_fields, rawNameTokens);
      mergeTokenLists(entry.sourceTokensRaw.proper_name, rawProperTokens);
      mergeTokenLists(entry.sourceTokensRaw.source_material, rawMaterialTokens);
      mergeTokenLists(entry.sourceTokensNormalized.name_fields, normalizedNameTokens);
      mergeTokenLists(entry.sourceTokensNormalized.proper_name, normalizedProperTokens);
      mergeTokenLists(entry.sourceTokensNormalized.source_material, normalizedMaterialTokens);
      index.set(key, entry);
    });
  });

  const normalized = new Map<string, TokenIndexEntry>();
  index.forEach((value, key) => {
    normalized.set(key, {
      tokens: Array.from(value.tokens),
      sourceTokensRaw: {
        name_fields: Array.from(value.sourceTokensRaw.name_fields),
        proper_name: Array.from(value.sourceTokensRaw.proper_name),
        source_material: Array.from(value.sourceTokensRaw.source_material),
      },
      sourceTokensNormalized: {
        name_fields: Array.from(value.sourceTokensNormalized.name_fields),
        proper_name: Array.from(value.sourceTokensNormalized.proper_name),
        source_material: Array.from(value.sourceTokensNormalized.source_material),
      },
    });
  });
  return normalized;
};

const fetchRowsForSourceIds = async (
  sourceIds: string[],
  idColumn: string,
): Promise<IngredientRow[]> => {
  const rows: IngredientRow[] = [];
  for (const chunk of chunkArray(sourceIds, CHUNK_SIZE)) {
    const { data, error } = await withRetry(() =>
      supabase
        .from("product_ingredients")
        .select("id,source_id,canonical_source_id,ingredient_id,name_raw,name_key,form_raw")
        .eq("source", "lnhpd")
        .eq("is_active", true)
        .in(idColumn, chunk)
        .not("ingredient_id", "is", null),
    );
    if (error) {
      const meta = extractErrorMeta(error);
      throw new Error(`[formraw-yield] query failed: ${meta.message ?? error.message}`);
    }
    rows.push(...((data ?? []) as IngredientRow[]));
  }
  return rows;
};

const fetchRowsByIds = async (rowIds: string[]): Promise<IngredientRow[]> => {
  const rows: IngredientRow[] = [];
  for (const chunk of chunkArray(rowIds, CHUNK_SIZE)) {
    const { data, error } = await withRetry(() =>
      supabase
        .from("product_ingredients")
        .select("id,source_id,canonical_source_id,ingredient_id,name_raw,name_key,form_raw")
        .in("id", chunk),
    );
    if (error) {
      const meta = extractErrorMeta(error);
      throw new Error(`[formraw-yield] id fetch failed: ${meta.message ?? error.message}`);
    }
    rows.push(...((data ?? []) as IngredientRow[]));
  }
  return rows;
};

const NUTRIENT_MATCHERS: Array<{ key: string; pattern: RegExp }> = [
  { key: "vitamin_c", pattern: /\bvitamin c\b|\bascorbic acid\b|\bascorbate\b/ },
  { key: "vitamin_d", pattern: /\bvitamin d\b|\bcholecalciferol\b|\bergocalciferol\b/ },
  { key: "vitamin_b12", pattern: /\bvitamin b12\b|\bcobalamin\b/ },
  { key: "vitamin_b6", pattern: /\bvitamin b6\b|\bpyridoxine\b|\bp5p\b/ },
  { key: "folate", pattern: /\bfolate\b|\bfolic acid\b|\bmethylfolate\b|\bmthf\b/ },
  { key: "magnesium", pattern: /\bmagnesium\b/ },
  { key: "calcium", pattern: /\bcalcium\b/ },
  { key: "zinc", pattern: /\bzinc\b/ },
];

const summarizeMissing = async (rows: IngredientRow[]) => {
  let resolvedRows = 0;
  let missingFormRawRows = 0;
  const missingByIngredient = new Map<string, number>();

  rows.forEach((row) => {
    const ingredientId = row.ingredient_id ?? null;
    if (!ingredientId) return;
    resolvedRows += 1;
    if (isEmptyFormRaw(row.form_raw)) {
      missingFormRawRows += 1;
      missingByIngredient.set(
        ingredientId,
        (missingByIngredient.get(ingredientId) ?? 0) + 1,
      );
    }
  });

  const missingIds = Array.from(missingByIngredient.keys());
  const ingredientNames = await fetchIngredientNames(missingIds);

  const missingTop = Array.from(missingByIngredient.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([ingredientId, count]) => ({
      ingredientId,
      ingredientName: ingredientNames.get(ingredientId) ?? null,
      count,
    }));

  return { resolvedRows, missingFormRawRows, missingTop };
};

const run = async () => {
  if (!SOURCE_IDS_FILE) {
    throw new Error("[formraw-yield] --source-ids-file is required");
  }
  if (!["source_id", "canonical_source_id"].includes(ID_COLUMN)) {
    throw new Error(`[formraw-yield] invalid --id-column: ${ID_COLUMN}`);
  }
  const sourceIds = await loadSourceIds(SOURCE_IDS_FILE);
  if (!sourceIds.length) {
    throw new Error(`[formraw-yield] source ids file empty: ${SOURCE_IDS_FILE}`);
  }

  const rows = await fetchRowsForSourceIds(sourceIds, ID_COLUMN);
  const { resolvedRows, missingFormRawRows, missingTop } = await summarizeMissing(rows);
  const ingredientIds = Array.from(
    new Set(rows.map((row) => row.ingredient_id).filter((id): id is string => Boolean(id))),
  );
  const ingredientNames = await fetchIngredientNames(ingredientIds);
  const canonicalIds = Array.from(
    new Set(
      rows
        .map((row) => row.canonical_source_id)
        .filter((value): value is string => Boolean(value)),
    ),
  );
  const factsMap = await fetchFactsJsonByIds(canonicalIds);
  const recognizedFormKeys = await fetchRecognizedFormKeys();
  const formKeysByIngredient = await fetchFormKeysByIngredient(ingredientIds);
  const aliasMaps = await fetchAliasMaps(ingredientIds);
  const tokenIndexBySourceId = new Map<string, Map<string, TokenIndexEntry>>();
  factsMap.forEach((factsJson, canonicalId) => {
    tokenIndexBySourceId.set(canonicalId, buildTokenIndex(factsJson));
  });

  let candidateFormRawRows = 0;
  let candidateWritableEmptyRows = 0;
  let candidateWritableAlreadyFilledRows = 0;
  const blockedByReason = new Map<string, number>();
  const candidateTokenSources = {
    name_fields: 0,
    proper_name: 0,
    source_material: 0,
  };
  const candidateCoverageByIngredient = new Map<string, number>();
  const previewRows: Array<Record<string, unknown>> = [];
  rows.forEach((row) => {
    const isEmpty = isEmptyFormRaw(row.form_raw);
    const canonicalId = row.canonical_source_id ?? null;
    if (!canonicalId) return;
    const tokenIndex = tokenIndexBySourceId.get(canonicalId);
    if (!tokenIndex) return;
    const nameKey = row.name_key ?? (row.name_raw ? normalizeText(row.name_raw) : "");
    if (!nameKey) return;
    const entry = tokenIndex.get(nameKey);
    const tokens = entry?.tokens ?? [];
    if (!tokens.length) return;
    if (isEmpty) {
      candidateFormRawRows += 1;
    }
    if (entry?.sourceTokensNormalized.name_fields.length) {
      candidateTokenSources.name_fields += 1;
    }
    if (entry?.sourceTokensNormalized.proper_name.length) {
      candidateTokenSources.proper_name += 1;
    }
    if (entry?.sourceTokensNormalized.source_material.length) {
      candidateTokenSources.source_material += 1;
    }
    const recognizedTokens = tokens.filter((token) =>
      recognizedFormKeys.has(token.toLowerCase()),
    );

    const ingredientId = row.ingredient_id ?? null;
    const formKeys = ingredientId ? formKeysByIngredient.get(ingredientId) ?? new Set() : new Set();
    const aliasScoped = ingredientId ? aliasMaps.scoped.get(ingredientId) ?? new Map() : new Map();
    const hasForms = formKeys.size > 0;
    const mappedFormKeys = new Set<string>();
    let taxonomyConflict = false;

    tokens.forEach((token) => {
      const tokenKey = token.toLowerCase();
      let mappedKey: string | null = null;
      if (hasForms && formKeys.has(tokenKey)) {
        mappedKey = tokenKey;
      } else {
        const aliasKey = normalizeAliasToken(tokenKey);
        const aliasFormKey =
          aliasScoped.get(aliasKey) ?? aliasMaps.global.get(aliasKey) ?? null;
        if (aliasFormKey) mappedKey = aliasFormKey;
      }
      if (!mappedKey) return;
      mappedFormKeys.add(mappedKey);
      if (hasForms && !formKeys.has(mappedKey)) taxonomyConflict = true;
    });

    const mappedTokens = Array.from(mappedFormKeys);
    const ambiguous = mappedTokens.length > 1;
    const mapsToFormKey = mappedTokens.length === 1 ? mappedTokens[0] : null;
    const noMap = !mappedTokens.length || !hasForms;
    const candidateWritable =
      Boolean(tokens.length) && Boolean(mapsToFormKey) && !taxonomyConflict && !ambiguous;

    let blockedReason: string | null = null;
    if (!tokens.length) {
      blockedReason = "SKIP_NO_TOKENS";
    } else if (!hasForms || noMap) {
      blockedReason = "SKIP_NO_MAP_TO_FORM_KEY";
    } else if (taxonomyConflict) {
      blockedReason = "SKIP_TAXONOMY_CONFLICT";
    } else if (ambiguous) {
      blockedReason = "SKIP_AMBIGUOUS_TOKENS";
    } else if (!isEmpty) {
      blockedReason = "SKIP_ALREADY_NONEMPTY";
    }

    if (blockedReason) {
      blockedByReason.set(
        blockedReason,
        (blockedByReason.get(blockedReason) ?? 0) + 1,
      );
    }

    if (candidateWritable) {
      if (isEmpty) {
        candidateWritableEmptyRows += 1;
      } else {
        candidateWritableAlreadyFilledRows += 1;
      }
    }
    const label = (
      (ingredientId ? ingredientNames.get(ingredientId) : null) ??
      row.name_raw ??
      ""
    ).toLowerCase();
    if (!label) return;
    NUTRIENT_MATCHERS.forEach((matcher) => {
      if (!matcher.pattern.test(label)) return;
      candidateCoverageByIngredient.set(
        matcher.key,
        (candidateCoverageByIngredient.get(matcher.key) ?? 0) + 1,
      );
    });

    if (isEmpty && previewRows.length < SAMPLE_LIMIT) {
      const matchedFields = [
        entry?.sourceTokensNormalized.name_fields.length ? "name_fields" : null,
        entry?.sourceTokensNormalized.proper_name.length ? "proper_name" : null,
        entry?.sourceTokensNormalized.source_material.length ? "source_material" : null,
      ].filter(Boolean);
      previewRows.push({
        sourceId:
          (ID_COLUMN === "canonical_source_id" ? row.canonical_source_id : row.source_id) ??
          null,
        canonicalSourceId: row.canonical_source_id ?? null,
        productIngredientId: row.id ?? null,
        ingredientId,
        nameRaw: row.name_raw ?? null,
        nameKey: row.name_key ?? nameKey,
        formRawBefore: row.form_raw ?? null,
        matchedFields,
        tokensRawBySource: entry?.sourceTokensRaw ?? null,
        tokensNormalizedBySource: entry?.sourceTokensNormalized ?? null,
        extractedTokens: tokens,
        recognizedTokens,
        mappedTokens,
        mapsToFormKey,
        candidateWritableEmpty: candidateWritable && isEmpty,
        blockedReason,
        winnerTokens: recognizedTokens.length ? recognizedTokens : tokens,
      });
    }
  });

  const payload: Record<string, unknown> = {
    source: "lnhpd",
    timestamp: new Date().toISOString(),
    sourceIdsFile: SOURCE_IDS_FILE,
    idColumn: ID_COLUMN,
    sourceIdsCount: sourceIds.length,
    resolvedRows,
    missingFormRawRows,
    missingFormRawRatio: resolvedRows ? missingFormRawRows / resolvedRows : null,
    candidateFormRawRows,
    candidateFormRawRatio: resolvedRows ? candidateFormRawRows / resolvedRows : null,
    candidateWritableEmptyRows,
    candidateWritableAlreadyFilledRows,
    candidateWritableEmptyRatio: resolvedRows
      ? candidateWritableEmptyRows / resolvedRows
      : null,
    candidateWritableAlreadyFilledRatio: resolvedRows
      ? candidateWritableAlreadyFilledRows / resolvedRows
      : null,
    candidateTokenSources,
    blockedByReason: Array.from(blockedByReason.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
    candidateCoverageByIngredient: Array.from(candidateCoverageByIngredient.entries())
      .map(([nutrient, count]) => ({ nutrient, count }))
      .sort((a, b) => b.count - a.count),
    missingByIngredientTop: missingTop,
    previewRows,
    snapshotOutput: SNAPSHOT_OUTPUT ?? null,
    compareSnapshot: COMPARE_SNAPSHOT ?? null,
  };

  if (SNAPSHOT_OUTPUT) {
    const snapshotRows: SnapshotRow[] = rows
      .filter((row) => row.id && row.source_id && row.ingredient_id)
      .filter((row) => isEmptyFormRaw(row.form_raw))
      .map((row) => ({
        id: row.id as string,
        sourceId:
          (ID_COLUMN === "canonical_source_id" ? row.canonical_source_id : row.source_id) ??
          "",
        ingredientId: row.ingredient_id as string,
        nameRaw: row.name_raw ?? null,
        formRaw: row.form_raw ?? null,
      }));
    await ensureDir(SNAPSHOT_OUTPUT);
    await writeFile(SNAPSHOT_OUTPUT, JSON.stringify(snapshotRows, null, 2), "utf8");
    payload.snapshotRows = snapshotRows.length;
  }

  if (COMPARE_SNAPSHOT) {
    const raw = await readFile(COMPARE_SNAPSHOT, "utf8");
    const beforeRows = JSON.parse(raw) as SnapshotRow[];
    const rowIds = beforeRows.map((row) => row.id);
    const currentRows = await fetchRowsByIds(rowIds);
    const currentMap = new Map<string, IngredientRow>();
    currentRows.forEach((row) => {
      if (row.id) currentMap.set(row.id, row);
    });

    const updatedByIngredient = new Map<string, number>();
    const sampleUpdated: Array<Record<string, unknown>> = [];

    beforeRows.forEach((before) => {
      const current = currentMap.get(before.id);
      if (!current || isEmptyFormRaw(current.form_raw)) return;
      const ingredientId = current.ingredient_id ?? before.ingredientId;
      if (!ingredientId) return;
      updatedByIngredient.set(
        ingredientId,
        (updatedByIngredient.get(ingredientId) ?? 0) + 1,
      );
      if (sampleUpdated.length < SAMPLE_LIMIT) {
        sampleUpdated.push({
          sourceId: before.sourceId,
          ingredientId,
          nameRaw: current.name_raw ?? before.nameRaw,
          formRawBefore: before.formRaw,
          formRawAfter: current.form_raw ?? null,
        });
      }
    });

    const updatedIds = Array.from(updatedByIngredient.keys());
    const updatedNames = await fetchIngredientNames(updatedIds);
    const updatedTop = Array.from(updatedByIngredient.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([ingredientId, count]) => ({
        ingredientId,
        ingredientName: updatedNames.get(ingredientId) ?? null,
        count,
      }));

    payload.formRawUpdatedCount = updatedByIngredient.size
      ? Array.from(updatedByIngredient.values()).reduce((sum, value) => sum + value, 0)
      : 0;
    payload.updatedByIngredientTop = updatedTop;
    payload.sampleUpdatedRows = sampleUpdated;
  }

  await ensureDir(OUTPUT);
  await writeFile(OUTPUT, JSON.stringify(payload, null, 2), "utf8");
  console.log(JSON.stringify({ output: OUTPUT, ...payload }, null, 2));
};

run().catch((error) => {
  console.error("[formraw-yield] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
