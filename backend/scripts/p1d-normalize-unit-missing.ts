import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { supabase } from "../src/supabase.js";

type ScoreSource = "lnhpd" | "dsld";
type UnitKind = "mass" | "volume" | "iu" | "cfu" | "percent" | "homeopathic" | "unknown";

type ProductIngredientRow = {
  id: string;
  source_id: string | null;
  canonical_source_id: string | null;
  ingredient_id: string | null;
  name_raw: string | null;
  amount: number | null;
  amount_normalized: number | null;
  amount_unknown: boolean | null;
  unit: string | null;
  unit_normalized: string | null;
  unit_kind: string | null;
  is_active: boolean | null;
};

type IngredientMetaRow = {
  id: string;
  unit: string | null;
};

type UnitResolution = {
  unitNormalized: string;
  unitKind: UnitKind;
  strategy: "builtin" | "dict_exact" | "dict_pattern";
};

type CandidateUpdate = {
  id: string;
  sourceId: string;
  canonicalSourceId: string | null;
  ingredientId: string;
  beforeUnitRaw: string | null;
  beforeUnitNormalized: string | null;
  beforeUnitKind: string | null;
  afterUnitNormalized: string;
  afterUnitKind: UnitKind;
  metaUnit: string | null;
  strategy: UnitResolution["strategy"];
};

type RawUnitStat = {
  rawUnit: string;
  normalizedKey: string;
  count: number;
  sourceIds: string[];
};

type MetaConflict = {
  id: string;
  sourceId: string;
  canonicalSourceId: string | null;
  ingredientId: string;
  unitRaw: string;
  resolvedUnit: string;
  metaUnitRaw: string;
  metaUnitResolved: string;
  resolvedDimension: UnitKind;
  metaDimension: UnitKind;
  blockReason: string;
};

type MetaMismatchDecisionReason =
  | "whitelist"
  | "mass_dimension_match"
  | "cross_dimension_mismatch";

type MetaMismatchDecision = {
  bypass: boolean;
  reason: MetaMismatchDecisionReason;
};

type UnitDimMismatchCodexAuditItem = {
  id: string;
  sourceId: string;
  canonicalSourceId: string | null;
  ingredientId: string;
  nameRaw: string | null;
  amount: number | null;
  amountNormalized: number | null;
  amountUnknown: boolean | null;
  unitRaw: string;
  resolvedUnit: string;
  metaUnitRaw: string;
  metaUnitResolved: string;
  resolvedDimension: UnitKind;
  metaDimension: UnitKind;
  blockReason: string;
  codexDecision: "HOLD";
  codexReason: string;
};

const META_MISMATCH_BYPASS_UNITS = new Set(["fcc_units", "fcc_lu", "fcc_pu"]);

const APPLY_ACK = "I_UNDERSTAND_PROD_WRITE_2026_02_20";
const args = process.argv.slice(2);

const hasFlag = (flag: string): boolean => args.includes(`--${flag}`);
const getArg = (flag: string): string | null => {
  const prefixed = args.find((arg) => arg.startsWith(`--${flag}=`));
  if (prefixed) return prefixed.slice(`--${flag}=`.length);
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  const next = args[idx + 1];
  if (!next || next.startsWith("--")) return null;
  return next;
};

const sourceArg = (getArg("source") ?? "lnhpd").toLowerCase();
const source: ScoreSource = sourceArg === "dsld" ? "dsld" : "lnhpd";
const sourceIdsFile = getArg("source-ids-file");
const outDir = getArg("out-dir") ?? `output/p1d/unit-missing-normalize-${Date.now()}`;
const printTopUnrecognized = Math.max(1, Number(getArg("print-top-unrecognized") ?? "50"));
const applyRequested = hasFlag("apply");
const confirmProd = getArg("confirm-prod") ?? "";
const envAck = process.env.P1D_APPLY_ACK ?? "";

const summaryPath = path.resolve(outDir, "summary.json");
const candidatesPath = path.resolve(outDir, "candidates.json");
const rollbackSqlPath = path.resolve(outDir, "rollback.sql");
const failuresPath = path.resolve(outDir, "failures.json");
const unrecognizedUnitsPath = path.resolve(outDir, "unrecognized_raw_units.json");
const metaConflictsPath = path.resolve(outDir, "meta_unit_conflicts.json");
const unitDimMismatchCodexAuditPath = path.resolve(outDir, "unit_dim_mismatch_codex_audit.json");

const KNOWN_UNITS = new Set([
  "mcg",
  "mg",
  "g",
  "kg",
  "ml",
  "iu",
  "cfu",
  "%",
  "ch",
  "x",
  "lm",
  "mt",
  "fcc_units",
  "fcc_lu",
  "fcc_pu",
  "each",
]);

const UNIT_EXACT_DICTIONARY: Record<string, { unitNormalized: string; unitKind: UnitKind }> = {
  mg: { unitNormalized: "mg", unitKind: "mass" },
  "mg.": { unitNormalized: "mg", unitKind: "mass" },
  mgs: { unitNormalized: "mg", unitKind: "mass" },
  milligram: { unitNormalized: "mg", unitKind: "mass" },
  milligrams: { unitNormalized: "mg", unitKind: "mass" },
  mcg: { unitNormalized: "mcg", unitKind: "mass" },
  "mcg.": { unitNormalized: "mcg", unitKind: "mass" },
  ug: { unitNormalized: "mcg", unitKind: "mass" },
  "ug.": { unitNormalized: "mcg", unitKind: "mass" },
  "µg": { unitNormalized: "mcg", unitKind: "mass" },
  "μg": { unitNormalized: "mcg", unitKind: "mass" },
  microgram: { unitNormalized: "mcg", unitKind: "mass" },
  micrograms: { unitNormalized: "mcg", unitKind: "mass" },
  g: { unitNormalized: "g", unitKind: "mass" },
  "g.": { unitNormalized: "g", unitKind: "mass" },
  gm: { unitNormalized: "g", unitKind: "mass" },
  grams: { unitNormalized: "g", unitKind: "mass" },
  gram: { unitNormalized: "g", unitKind: "mass" },
  kg: { unitNormalized: "kg", unitKind: "mass" },
  kilogram: { unitNormalized: "kg", unitKind: "mass" },
  kilograms: { unitNormalized: "kg", unitKind: "mass" },
  ml: { unitNormalized: "ml", unitKind: "volume" },
  "ml.": { unitNormalized: "ml", unitKind: "volume" },
  milliliter: { unitNormalized: "ml", unitKind: "volume" },
  milliliters: { unitNormalized: "ml", unitKind: "volume" },
  millilitre: { unitNormalized: "ml", unitKind: "volume" },
  millilitres: { unitNormalized: "ml", unitKind: "volume" },
  iu: { unitNormalized: "iu", unitKind: "iu" },
  "i.u.": { unitNormalized: "iu", unitKind: "iu" },
  "i.u": { unitNormalized: "iu", unitKind: "iu" },
  "ui": { unitNormalized: "iu", unitKind: "iu" },
  "international unit": { unitNormalized: "iu", unitKind: "iu" },
  "international units": { unitNormalized: "iu", unitKind: "iu" },
  cfu: { unitNormalized: "cfu", unitKind: "cfu" },
  "c.f.u.": { unitNormalized: "cfu", unitKind: "cfu" },
  ufc: { unitNormalized: "cfu", unitKind: "cfu" },
  "%": { unitNormalized: "%", unitKind: "percent" },
  percent: { unitNormalized: "%", unitKind: "percent" },
  "per cent": { unitNormalized: "%", unitKind: "percent" },
  pct: { unitNormalized: "%", unitKind: "percent" },
  c: { unitNormalized: "ch", unitKind: "homeopathic" },
  ch: { unitNormalized: "ch", unitKind: "homeopathic" },
  ck: { unitNormalized: "ch", unitKind: "homeopathic" },
  k: { unitNormalized: "ch", unitKind: "homeopathic" },
  mk: { unitNormalized: "ch", unitKind: "homeopathic" },
  x: { unitNormalized: "x", unitKind: "homeopathic" },
  d: { unitNormalized: "x", unitKind: "homeopathic" },
  dh: { unitNormalized: "x", unitKind: "homeopathic" },
  lm: { unitNormalized: "lm", unitKind: "homeopathic" },
  q: { unitNormalized: "lm", unitKind: "homeopathic" },
  mt: { unitNormalized: "mt", unitKind: "homeopathic" },
  tm: { unitNormalized: "mt", unitKind: "homeopathic" },
  "fcc unit": { unitNormalized: "fcc_units", unitKind: "unknown" },
  "fcc units": { unitNormalized: "fcc_units", unitKind: "unknown" },
  "fcc lu": { unitNormalized: "fcc_lu", unitKind: "unknown" },
  "fcc pu": { unitNormalized: "fcc_pu", unitKind: "unknown" },
  fcc: { unitNormalized: "fcc_units", unitKind: "unknown" },
  lu: { unitNormalized: "fcc_lu", unitKind: "unknown" },
  pu: { unitNormalized: "fcc_pu", unitKind: "unknown" },
  "l.u.": { unitNormalized: "fcc_lu", unitKind: "unknown" },
  "p.u.": { unitNormalized: "fcc_pu", unitKind: "unknown" },
  each: { unitNormalized: "each", unitKind: "unknown" },
};

const UNIT_PATTERN_DICTIONARY: Array<{
  pattern: RegExp;
  unitNormalized: string;
  unitKind: UnitKind;
}> = [
  { pattern: /\b(micrograms?|mcg|ug|µg|μg)\b/i, unitNormalized: "mcg", unitKind: "mass" },
  { pattern: /\b(milligrams?|mg)\b/i, unitNormalized: "mg", unitKind: "mass" },
  { pattern: /\b(grams?|gm)\b/i, unitNormalized: "g", unitKind: "mass" },
  { pattern: /\b(kilograms?|kg)\b/i, unitNormalized: "kg", unitKind: "mass" },
  { pattern: /\b(millilit(?:er|re)s?|ml)\b/i, unitNormalized: "ml", unitKind: "volume" },
  { pattern: /\b(i\.?\s*u\.?|international units?|ui)\b/i, unitNormalized: "iu", unitKind: "iu" },
  { pattern: /\b(c\.?\s*f\.?\s*u\.?|cfu|ufc)\b/i, unitNormalized: "cfu", unitKind: "cfu" },
  { pattern: /%|\b(percent|per cent|pct)\b/i, unitNormalized: "%", unitKind: "percent" },
  {
    pattern: /^\s*(?:\d+(?:\.\d+)?\s*)?(?:c|ch|ck|k|mk)\b/i,
    unitNormalized: "ch",
    unitKind: "homeopathic",
  },
  { pattern: /^\s*(?:\d+(?:\.\d+)?\s*)?(?:x|d|dh)\b/i, unitNormalized: "x", unitKind: "homeopathic" },
  { pattern: /^\s*(?:\d+(?:\.\d+)?\s*)?(?:lm|q)\b/i, unitNormalized: "lm", unitKind: "homeopathic" },
  { pattern: /^\s*(?:mt|tm)\b/i, unitNormalized: "mt", unitKind: "homeopathic" },
  { pattern: /\bfcc\s*units?\b/i, unitNormalized: "fcc_units", unitKind: "unknown" },
  { pattern: /\bfcc\s*lu\b/i, unitNormalized: "fcc_lu", unitKind: "unknown" },
  { pattern: /\bfcc\s*pu\b/i, unitNormalized: "fcc_pu", unitKind: "unknown" },
  { pattern: /\bfcc\b/i, unitNormalized: "fcc_units", unitKind: "unknown" },
  { pattern: /\bl\.?\s*u\.?\b/i, unitNormalized: "fcc_lu", unitKind: "unknown" },
  { pattern: /\bp\.?\s*u\.?\b/i, unitNormalized: "fcc_pu", unitKind: "unknown" },
];

const usage = () => {
  console.log(
    [
      "Usage: node --import tsx backend/scripts/p1d-normalize-unit-missing.ts [options]",
      "",
      "Options:",
      "  --source <lnhpd|dsld>                  Source (default: lnhpd)",
      "  --source-ids-file <path>               JSON with sourceIds array (required)",
      "  --out-dir <path>                       Output directory",
      "  --print-top-unrecognized <n>           Top-N unrecognized raw units in summary (default: 50)",
      "  --apply                                Execute DB writes",
      `  --confirm-prod ${APPLY_ACK}  Required with --apply`,
      "",
      "Required env when --apply:",
      `  P1D_APPLY_ACK=${APPLY_ACK}`,
    ].join("\n"),
  );
};

const ensureDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  await mkdir(dir, { recursive: true });
};

const chunkArray = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

const normalizeSourceIds = (payload: unknown): string[] => {
  const rawIds =
    Array.isArray(payload)
      ? payload
      : Array.isArray((payload as { sourceIds?: unknown } | null | undefined)?.sourceIds)
        ? (payload as { sourceIds: unknown[] }).sourceIds
        : [];

  return Array.from(
    new Set(
      rawIds
        .map((value) => {
          if (typeof value === "string") return value.trim();
          if (typeof value === "number") return String(value);
          return "";
        })
        .filter(Boolean),
    ),
  );
};

const sqlLiteral = (value: unknown): string => {
  if (value == null) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return `'${String(value).replace(/'/g, "''")}'`;
};

const normalizeUnitText = (value: string): string =>
  value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\u00b5/g, "µ")
    .replace(/\u03bc/g, "µ")
    .trim();

export const inferUnitKind = (unitNormalized: string | null): UnitKind | null => {
  if (!unitNormalized) return null;
  if (["mcg", "mg", "g", "kg"].includes(unitNormalized)) return "mass";
  if (unitNormalized === "ml") return "volume";
  if (unitNormalized === "iu") return "iu";
  if (unitNormalized === "cfu") return "cfu";
  if (unitNormalized === "%") return "percent";
  if (["ch", "x", "lm", "mt"].includes(unitNormalized)) return "homeopathic";
  if (["fcc_units", "fcc_lu", "fcc_pu", "each"].includes(unitNormalized)) return "unknown";
  return null;
};

export const resolveUnitFromRaw = (unitRaw?: string | null): UnitResolution | null => {
  if (!unitRaw) return null;
  const normalized = normalizeUnitText(unitRaw);
  if (!normalized) return null;

  if (KNOWN_UNITS.has(normalized)) {
    const kind = inferUnitKind(normalized);
    if (kind) return { unitNormalized: normalized, unitKind: kind, strategy: "builtin" };
  }

  const exact = UNIT_EXACT_DICTIONARY[normalized];
  if (exact) {
    return {
      unitNormalized: exact.unitNormalized,
      unitKind: exact.unitKind,
      strategy: "dict_exact",
    };
  }

  for (const item of UNIT_PATTERN_DICTIONARY) {
    if (item.pattern.test(normalized)) {
      return {
        unitNormalized: item.unitNormalized,
        unitKind: item.unitKind,
        strategy: "dict_pattern",
      };
    }
  }

  return null;
};

export const shouldBypassMetaUnitMismatch = (
  resolved: UnitResolution,
  metaResolved: UnitResolution,
): MetaMismatchDecision => {
  if (
    resolved.unitKind === "homeopathic" ||
    resolved.unitKind === "percent" ||
    META_MISMATCH_BYPASS_UNITS.has(resolved.unitNormalized)
  ) {
    return { bypass: true, reason: "whitelist" };
  }
  if (resolved.unitKind === "mass" && metaResolved.unitKind === "mass") {
    return { bypass: true, reason: "mass_dimension_match" };
  }
  return { bypass: false, reason: "cross_dimension_mismatch" };
};

const loadSourceIds = async (filePath: string): Promise<string[]> => {
  const resolved = path.resolve(filePath);
  const raw = await readFile(resolved, "utf8");
  const payload = JSON.parse(raw) as unknown;
  const sourceIds = normalizeSourceIds(payload);
  if (!sourceIds.length) {
    throw new Error("[unit-normalize] source ids file resolved to empty list");
  }
  return sourceIds;
};

const fetchActiveRows = async (sourceIds: string[]): Promise<ProductIngredientRow[]> => {
  const rows: ProductIngredientRow[] = [];
  for (const chunk of chunkArray(sourceIds, 200)) {
    const { data, error } = await supabase
      .from("product_ingredients")
      .select(
        "id,source_id,canonical_source_id,ingredient_id,name_raw,amount,amount_normalized,amount_unknown,unit,unit_normalized,unit_kind,is_active",
      )
      .eq("source", source)
      .eq("is_active", true)
      .in("source_id", chunk);
    if (error) {
      throw new Error(`[unit-normalize] product_ingredients fetch failed: ${error.message}`);
    }
    rows.push(...((data ?? []) as ProductIngredientRow[]));
  }
  return rows;
};

const fetchIngredientMeta = async (
  ingredientIds: string[],
): Promise<Map<string, IngredientMetaRow>> => {
  const meta = new Map<string, IngredientMetaRow>();
  for (const chunk of chunkArray(ingredientIds, 200)) {
    const { data, error } = await supabase
      .from("ingredients")
      .select("id,unit")
      .in("id", chunk);
    if (error) {
      throw new Error(`[unit-normalize] ingredients fetch failed: ${error.message}`);
    }
    (data ?? []).forEach((row) => {
      if (!row?.id) return;
      meta.set(row.id as string, {
        id: row.id as string,
        unit: (row.unit as string | null) ?? null,
      });
    });
  }
  return meta;
};

const topRawUnitStats = (
  map: Map<string, { rawUnit: string; count: number; sourceIds: Set<string> }>,
  topN: number,
): RawUnitStat[] =>
  Array.from(map.entries())
    .map(([normalizedKey, item]) => ({
      rawUnit: item.rawUnit,
      normalizedKey,
      count: item.count,
      sourceIds: Array.from(item.sourceIds).slice(0, 50),
    }))
    .sort((a, b) => b.count - a.count || a.normalizedKey.localeCompare(b.normalizedKey))
    .slice(0, topN);

export const run = async () => {
  if (!sourceIdsFile) {
    usage();
    throw new Error("[unit-normalize] --source-ids-file is required");
  }

  if (applyRequested && (confirmProd !== APPLY_ACK || envAck !== APPLY_ACK)) {
    throw new Error(
      `[unit-normalize] --apply requires --confirm-prod ${APPLY_ACK} and env P1D_APPLY_ACK=${APPLY_ACK}`,
    );
  }

  const sourceIds = await loadSourceIds(sourceIdsFile);
  const activeRows = await fetchActiveRows(sourceIds);
  const ingredientIds = Array.from(
    new Set(
      activeRows
        .map((row) => row.ingredient_id)
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    ),
  );
  const metaByIngredient = await fetchIngredientMeta(ingredientIds);

  const skippedByReason: Record<string, number> = {};
  const mappingStrategyCounts: Record<string, number> = {};
  const candidates: CandidateUpdate[] = [];
  const metaConflicts: MetaConflict[] = [];
  const unitDimMismatchCodexAuditItems: UnitDimMismatchCodexAuditItem[] = [];
  let metaUnitMismatchBypassedWhitelistCount = 0;
  let metaUnitMismatchBypassedMassCount = 0;
  let metaUnitMismatchBlockedCrossDimCount = 0;
  const unrecognizedRawUnitMap = new Map<
    string,
    { rawUnit: string; count: number; sourceIds: Set<string> }
  >();

  const bumpSkip = (reason: string) => {
    skippedByReason[reason] = (skippedByReason[reason] ?? 0) + 1;
  };

  const bumpMappingStrategy = (strategy: string) => {
    mappingStrategyCounts[strategy] = (mappingStrategyCounts[strategy] ?? 0) + 1;
  };

  const trackUnrecognized = (unitRaw: string, sourceId: string) => {
    const key = normalizeUnitText(unitRaw);
    const existing = unrecognizedRawUnitMap.get(key) ?? {
      rawUnit: unitRaw,
      count: 0,
      sourceIds: new Set<string>(),
    };
    existing.count += 1;
    existing.sourceIds.add(sourceId);
    unrecognizedRawUnitMap.set(key, existing);
  };

  for (const row of activeRows) {
    if (!row.id || !row.source_id) {
      bumpSkip("invalid_row");
      continue;
    }
    if (!row.ingredient_id) {
      bumpSkip("no_ingredient_id");
      continue;
    }

    const unitRaw = row.unit?.trim() ?? "";
    if (!unitRaw) {
      bumpSkip("no_raw_unit");
      continue;
    }

    const resolved = resolveUnitFromRaw(unitRaw);
    if (!resolved) {
      bumpSkip("unrecognized_raw_unit");
      trackUnrecognized(unitRaw, row.source_id);
      continue;
    }
    bumpMappingStrategy(resolved.strategy);

    const metaUnitRaw = metaByIngredient.get(row.ingredient_id)?.unit ?? null;
    const metaResolved = resolveUnitFromRaw(metaUnitRaw);
    if (metaResolved && resolved.unitNormalized !== metaResolved.unitNormalized) {
      const decision = shouldBypassMetaUnitMismatch(resolved, metaResolved);
      if (!decision.bypass) {
        bumpSkip("meta_unit_mismatch");
        metaUnitMismatchBlockedCrossDimCount += 1;
        metaConflicts.push({
          id: row.id,
          sourceId: row.source_id,
          canonicalSourceId: row.canonical_source_id ?? null,
          ingredientId: row.ingredient_id,
          unitRaw,
          resolvedUnit: resolved.unitNormalized,
          metaUnitRaw,
          metaUnitResolved: metaResolved.unitNormalized,
          resolvedDimension: resolved.unitKind,
          metaDimension: metaResolved.unitKind,
          blockReason: decision.reason,
        });
        unitDimMismatchCodexAuditItems.push({
          id: row.id,
          sourceId: row.source_id,
          canonicalSourceId: row.canonical_source_id ?? null,
          ingredientId: row.ingredient_id,
          nameRaw: row.name_raw ?? null,
          amount: row.amount,
          amountNormalized: row.amount_normalized,
          amountUnknown: row.amount_unknown,
          unitRaw,
          resolvedUnit: resolved.unitNormalized,
          metaUnitRaw,
          metaUnitResolved: metaResolved.unitNormalized,
          resolvedDimension: resolved.unitKind,
          metaDimension: metaResolved.unitKind,
          blockReason: decision.reason,
          codexDecision: "HOLD",
          codexReason: "Missing density/per-serving context; no auto-write.",
        });
        continue;
      }
      if (decision.reason === "whitelist") {
        metaUnitMismatchBypassedWhitelistCount += 1;
      } else {
        metaUnitMismatchBypassedMassCount += 1;
      }
    }

    const currentResolved = resolveUnitFromRaw(row.unit_normalized);
    const currentKind = row.unit_kind?.trim().toLowerCase() ?? null;
    if (
      currentResolved?.unitNormalized === resolved.unitNormalized &&
      currentKind === resolved.unitKind
    ) {
      bumpSkip("already_normalized");
      continue;
    }

    candidates.push({
      id: row.id,
      sourceId: row.source_id,
      canonicalSourceId: row.canonical_source_id ?? null,
      ingredientId: row.ingredient_id,
      beforeUnitRaw: row.unit ?? null,
      beforeUnitNormalized: row.unit_normalized ?? null,
      beforeUnitKind: row.unit_kind ?? null,
      afterUnitNormalized: resolved.unitNormalized,
      afterUnitKind: resolved.unitKind,
      metaUnit: metaResolved?.unitNormalized ?? null,
      strategy: resolved.strategy,
    });
  }

  const failures: Array<{ id: string; sourceId: string; error: string }> = [];
  const applied: CandidateUpdate[] = [];

  if (applyRequested && candidates.length > 0) {
    for (const candidate of candidates) {
      const { error } = await supabase
        .from("product_ingredients")
        .update({
          unit_normalized: candidate.afterUnitNormalized,
          unit_kind: candidate.afterUnitKind,
        })
        .eq("id", candidate.id);
      if (error) {
        failures.push({
          id: candidate.id,
          sourceId: candidate.sourceId,
          error: error.message,
        });
        continue;
      }
      applied.push(candidate);
    }
  }

  const rollbackSql = applied
    .map(
      (row) =>
        `UPDATE product_ingredients SET unit_normalized = ${sqlLiteral(
          row.beforeUnitNormalized,
        )}, unit_kind = ${sqlLiteral(row.beforeUnitKind)} WHERE id = ${sqlLiteral(row.id)};`,
    )
    .join("\n");

  const unrecognizedTop = topRawUnitStats(unrecognizedRawUnitMap, printTopUnrecognized);
  const allUnrecognized = topRawUnitStats(unrecognizedRawUnitMap, Number.MAX_SAFE_INTEGER);
  const sortedMetaConflicts = metaConflicts
    .slice()
    .sort((a, b) => a.unitRaw.localeCompare(b.unitRaw) || a.sourceId.localeCompare(b.sourceId));
  const sortedUnitDimMismatchCodexAuditItems = unitDimMismatchCodexAuditItems
    .slice()
    .sort((a, b) => a.unitRaw.localeCompare(b.unitRaw) || a.sourceId.localeCompare(b.sourceId));
  const metaUnitMismatchBypassedCount =
    metaUnitMismatchBypassedWhitelistCount + metaUnitMismatchBypassedMassCount;

  const summary = {
    timestamp: new Date().toISOString(),
    source,
    sourceIdsFile: path.resolve(sourceIdsFile),
    sourceIdCount: sourceIds.length,
    fetchedActiveRows: activeRows.length,
    ingredientMetaCount: metaByIngredient.size,
    candidateCount: candidates.length,
    applyRequested,
    appliedCount: applied.length,
    failedCount: failures.length,
    skippedByReason,
    mappingStrategyCounts,
    unrecognizedRawUnitTop: unrecognizedTop,
    metaUnitConflictCount: sortedMetaConflicts.length,
    metaUnitMismatchBypassedWhitelistCount,
    metaUnitMismatchBypassedMassCount,
    metaUnitMismatchBlockedCrossDimCount,
    metaUnitMismatchBypassedCount,
    unitDimMismatchCodexAuditCount: sortedUnitDimMismatchCodexAuditItems.length,
    output: {
      summaryPath,
      candidatesPath,
      rollbackSqlPath,
      failuresPath,
      unrecognizedUnitsPath,
      metaConflictsPath,
      unitDimMismatchCodexAuditPath,
    },
  };

  await ensureDir(summaryPath);
  await writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf8");
  await writeFile(candidatesPath, JSON.stringify(candidates, null, 2), "utf8");
  await writeFile(failuresPath, JSON.stringify(failures, null, 2), "utf8");
  await writeFile(
    unrecognizedUnitsPath,
    JSON.stringify({ source, total: allUnrecognized.length, items: allUnrecognized }, null, 2),
    "utf8",
  );
  await writeFile(
    metaConflictsPath,
    JSON.stringify({ source, total: sortedMetaConflicts.length, items: sortedMetaConflicts }, null, 2),
    "utf8",
  );
  await writeFile(
    unitDimMismatchCodexAuditPath,
    JSON.stringify(
      {
        source,
        total: sortedUnitDimMismatchCodexAuditItems.length,
        items: sortedUnitDimMismatchCodexAuditItems,
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(
    rollbackSqlPath,
    rollbackSql ? `${rollbackSql}\n` : "-- no applied updates\n",
    "utf8",
  );

  console.log(JSON.stringify(summary, null, 2));
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  run().catch((error) => {
    console.error("[unit-normalize] failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
