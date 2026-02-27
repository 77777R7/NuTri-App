import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type OdsUlScope =
  | "total_intake"
  | "supplements_only"
  | "supplements_or_fortified_only";

export type OdsUlLifeStage = "adult_19_plus" | "pregnancy" | "lactation";

export type OdsUlAltUnit = {
  unit: string;
  factor: number;
  direction: string;
};

export type OdsUlGroup = {
  lifeStage: OdsUlLifeStage;
  value: number;
  unit: string;
};

export type OdsUlItem = {
  ingredientCanonicalKey: string;
  displayName: string;
  sourceUrl: string | null;
  sourceUpdatedAt: string | null;
  scope: OdsUlScope;
  unit: string | null;
  altUnits: OdsUlAltUnit[];
  groups: OdsUlGroup[];
  notes: string[];
  noUlEstablished: boolean;
};

export type OdsUlDataset = {
  version: string;
  generatedAt: string;
  sourceIndexUrl: string;
  parserVersion: string;
  items: OdsUlItem[];
};

export type OdsAliasDataset = {
  version: string;
  generatedAt: string;
  aliases: Record<string, string>;
};

export type OdsUlUnitPolicyRule = {
  ingredientCanonicalKey: string;
  labelHints: string[];
  appliesToUnits: string[];
  ulUnit: string | null;
  blockConversionWhenHintsPresent: boolean;
  reasonCode: string;
  warningMessage: string;
};

export type OdsUlUnitPolicyDataset = {
  version: string;
  generatedAt: string;
  rules: OdsUlUnitPolicyRule[];
};

export type OdsUlUnitPolicyEvaluation = {
  warn: boolean;
  blockConversion: boolean;
  reasonCode: string;
  warningMessage: string;
};

export type DoseConversionResult = {
  ok: boolean;
  value: number | null;
  unit: string | null;
  reasonCode:
    | "DIRECT_UNIT_MATCH"
    | "MASS_UNIT_CONVERTED"
    | "ALT_UNIT_CONVERTED"
    | "UNSUPPORTED_UNIT_CONVERSION"
    | "INVALID_INPUT";
  confidence: number;
};

export type UlRiskLevel = "low" | "moderate" | "high";

const DEFAULT_UL_DATASET: OdsUlDataset = {
  version: "v1",
  generatedAt: new Date(0).toISOString(),
  sourceIndexUrl: "offline_ods_sync",
  parserVersion: "fallback_empty",
  items: [],
};

const DEFAULT_ALIAS_DATASET: OdsAliasDataset = {
  version: "v1",
  generatedAt: new Date(0).toISOString(),
  aliases: {},
};

const DEFAULT_UNIT_POLICY_DATASET: OdsUlUnitPolicyDataset = {
  version: "v1",
  generatedAt: new Date(0).toISOString(),
  rules: [],
};

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ODS_UL_DATASET_PATH = path.join(ROOT_DIR, "data", "ods", "ods_ul.normalized.v1.json");
const ODS_ALIAS_MAP_PATH = path.join(ROOT_DIR, "data", "ods", "ods_alias_map.v1.json");
const ODS_UL_UNIT_POLICY_PATH = path.join(ROOT_DIR, "data", "ods", "ods_ul_unit_policy.v1.json");

const MASS_TO_MG_FACTOR: Record<string, number> = {
  mcg: 0.001,
  ug: 0.001,
  mg: 1,
  g: 1000,
};

const normalizeCanonicalKey = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || null;
};

const normalizeUnit = (unit: string | null | undefined): string | null => {
  if (!unit) return null;
  const normalized = unit.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "μg" || normalized === "µg" || normalized === "ug") return "mcg";
  if (normalized === "i.u." || normalized === "i.u" || normalized === "ui") return "iu";
  if (normalized === "milligram" || normalized === "milligrams") return "mg";
  if (normalized === "microgram" || normalized === "micrograms") return "mcg";
  if (normalized === "gram" || normalized === "grams") return "g";
  return normalized;
};

const safeNumber = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const readJson = (filePath: string): unknown | null => {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const sanitizeAltUnits = (value: unknown): OdsUlAltUnit[] => {
  if (!Array.isArray(value)) return [];
  const out: OdsUlAltUnit[] = [];
  for (const row of value) {
    if (!isRecord(row)) continue;
    const unit = normalizeUnit(typeof row.unit === "string" ? row.unit : null);
    const factor = safeNumber(row.factor);
    const direction = typeof row.direction === "string" ? row.direction.trim() : "";
    if (!unit || factor == null || factor <= 0 || !direction) continue;
    out.push({ unit, factor, direction });
  }
  return out;
};

const sanitizeGroups = (value: unknown): OdsUlGroup[] => {
  if (!Array.isArray(value)) return [];
  const out: OdsUlGroup[] = [];
  for (const row of value) {
    if (!isRecord(row)) continue;
    const lifeStageRaw = typeof row.lifeStage === "string" ? row.lifeStage.trim() : "";
    if (
      lifeStageRaw !== "adult_19_plus" &&
      lifeStageRaw !== "pregnancy" &&
      lifeStageRaw !== "lactation"
    ) {
      continue;
    }
    const unit = normalizeUnit(typeof row.unit === "string" ? row.unit : null);
    const valueNum = safeNumber(row.value);
    if (!unit || valueNum == null || valueNum <= 0) continue;
    out.push({
      lifeStage: lifeStageRaw,
      value: valueNum,
      unit,
    });
  }
  return out;
};

const sanitizeScope = (value: unknown): OdsUlScope => {
  if (value === "supplements_only") return "supplements_only";
  if (value === "supplements_or_fortified_only") return "supplements_or_fortified_only";
  return "total_intake";
};

const sanitizeItem = (row: unknown): OdsUlItem | null => {
  if (!isRecord(row)) return null;
  const ingredientCanonicalKey = normalizeCanonicalKey(
    typeof row.ingredientCanonicalKey === "string" ? row.ingredientCanonicalKey : null,
  );
  if (!ingredientCanonicalKey) return null;
  const displayName =
    typeof row.displayName === "string" && row.displayName.trim()
      ? row.displayName.trim()
      : ingredientCanonicalKey;
  const unit = normalizeUnit(typeof row.unit === "string" ? row.unit : null);
  const altUnits = sanitizeAltUnits(row.altUnits);
  const groups = sanitizeGroups(row.groups);
  const noUlEstablished =
    Boolean(row.noUlEstablished) || (!groups.length && row.noUlEstablished !== false);
  const notes = Array.isArray(row.notes)
    ? row.notes
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
        .slice(0, 8)
    : [];
  return {
    ingredientCanonicalKey,
    displayName,
    sourceUrl:
      typeof row.sourceUrl === "string" && row.sourceUrl.trim() ? row.sourceUrl.trim() : null,
    sourceUpdatedAt:
      typeof row.sourceUpdatedAt === "string" && row.sourceUpdatedAt.trim()
        ? row.sourceUpdatedAt.trim()
        : null,
    scope: sanitizeScope(row.scope),
    unit,
    altUnits,
    groups,
    notes,
    noUlEstablished,
  };
};

let cachedUlDataset: OdsUlDataset | null = null;
let cachedUlByCanonical: Map<string, OdsUlItem> | null = null;
let cachedAliasDataset: OdsAliasDataset | null = null;
let cachedAliasMap: Map<string, string> | null = null;
let cachedUnitPolicyDataset: OdsUlUnitPolicyDataset | null = null;
let cachedUnitPolicyByCanonical: Map<string, OdsUlUnitPolicyRule> | null = null;

const buildUlLookup = (dataset: OdsUlDataset): Map<string, OdsUlItem> => {
  const out = new Map<string, OdsUlItem>();
  dataset.items.forEach((item) => {
    out.set(item.ingredientCanonicalKey, item);
  });
  return out;
};

const hydrateUlDataset = (raw: unknown): OdsUlDataset => {
  if (!isRecord(raw)) return DEFAULT_UL_DATASET;
  const itemsRaw = Array.isArray(raw.items) ? raw.items : [];
  const items = itemsRaw.map(sanitizeItem).filter((item): item is OdsUlItem => item !== null);
  return {
    version: typeof raw.version === "string" && raw.version.trim() ? raw.version.trim() : "v1",
    generatedAt:
      typeof raw.generatedAt === "string" && raw.generatedAt.trim()
        ? raw.generatedAt.trim()
        : new Date(0).toISOString(),
    sourceIndexUrl:
      typeof raw.sourceIndexUrl === "string" && raw.sourceIndexUrl.trim()
        ? raw.sourceIndexUrl.trim()
        : DEFAULT_UL_DATASET.sourceIndexUrl,
    parserVersion:
      typeof raw.parserVersion === "string" && raw.parserVersion.trim()
        ? raw.parserVersion.trim()
        : "unknown",
    items,
  };
};

const hydrateAliasDataset = (raw: unknown): OdsAliasDataset => {
  if (!isRecord(raw)) return DEFAULT_ALIAS_DATASET;
  const aliasesRaw = isRecord(raw.aliases) ? raw.aliases : {};
  const aliases = Object.entries(aliasesRaw).reduce<Record<string, string>>((acc, [k, v]) => {
    const key = normalizeCanonicalKey(k);
    const value = normalizeCanonicalKey(typeof v === "string" ? v : null);
    if (!key || !value) return acc;
    acc[key] = value;
    return acc;
  }, {});
  return {
    version: typeof raw.version === "string" && raw.version.trim() ? raw.version.trim() : "v1",
    generatedAt:
      typeof raw.generatedAt === "string" && raw.generatedAt.trim()
        ? raw.generatedAt.trim()
        : new Date(0).toISOString(),
    aliases,
  };
};

const hydrateUnitPolicyDataset = (raw: unknown): OdsUlUnitPolicyDataset => {
  if (!isRecord(raw)) return DEFAULT_UNIT_POLICY_DATASET;
  const rulesRaw = Array.isArray(raw.rules) ? raw.rules : [];
  const rules: OdsUlUnitPolicyRule[] = [];
  for (const rule of rulesRaw) {
    if (!isRecord(rule)) continue;
    const ingredientCanonicalKey = normalizeCanonicalKey(
      typeof rule.ingredientCanonicalKey === "string" ? rule.ingredientCanonicalKey : null,
    );
    if (!ingredientCanonicalKey) continue;
    const labelHints = Array.isArray(rule.labelHints)
      ? rule.labelHints
          .map((item) => (typeof item === "string" ? item.trim().toLowerCase() : ""))
          .filter(Boolean)
      : [];
    const appliesToUnits = Array.isArray(rule.appliesToUnits)
      ? rule.appliesToUnits
          .map((item) => normalizeUnit(typeof item === "string" ? item : null))
          .filter((item): item is string => Boolean(item))
      : [];
    const ulUnit = normalizeUnit(typeof rule.ulUnit === "string" ? rule.ulUnit : null);
    const reasonCode =
      typeof rule.reasonCode === "string" && rule.reasonCode.trim()
        ? rule.reasonCode.trim()
        : "UNIT_POLICY_WARNING";
    const warningMessage =
      typeof rule.warningMessage === "string" && rule.warningMessage.trim()
        ? rule.warningMessage.trim()
        : "Unit basis may not match UL basis.";
    const blockConversionWhenHintsPresent = Boolean(rule.blockConversionWhenHintsPresent);
    rules.push({
      ingredientCanonicalKey,
      labelHints,
      appliesToUnits,
      ulUnit,
      blockConversionWhenHintsPresent,
      reasonCode,
      warningMessage,
    });
  }
  return {
    version: typeof raw.version === "string" && raw.version.trim() ? raw.version.trim() : "v1",
    generatedAt:
      typeof raw.generatedAt === "string" && raw.generatedAt.trim()
        ? raw.generatedAt.trim()
        : new Date(0).toISOString(),
    rules,
  };
};

export const getOdsUlDataset = (): OdsUlDataset => {
  if (cachedUlDataset) return cachedUlDataset;
  const raw = readJson(ODS_UL_DATASET_PATH);
  cachedUlDataset = hydrateUlDataset(raw);
  cachedUlByCanonical = buildUlLookup(cachedUlDataset);
  return cachedUlDataset;
};

export const getOdsAliasDataset = (): OdsAliasDataset => {
  if (cachedAliasDataset) return cachedAliasDataset;
  const raw = readJson(ODS_ALIAS_MAP_PATH);
  cachedAliasDataset = hydrateAliasDataset(raw);
  cachedAliasMap = new Map<string, string>(Object.entries(cachedAliasDataset.aliases));
  return cachedAliasDataset;
};

const getOdsAliasMap = (): Map<string, string> => {
  if (cachedAliasMap) return cachedAliasMap;
  getOdsAliasDataset();
  return cachedAliasMap ?? new Map();
};

export const getOdsUlUnitPolicyDataset = (): OdsUlUnitPolicyDataset => {
  if (cachedUnitPolicyDataset) return cachedUnitPolicyDataset;
  const raw = readJson(ODS_UL_UNIT_POLICY_PATH);
  cachedUnitPolicyDataset = hydrateUnitPolicyDataset(raw);
  cachedUnitPolicyByCanonical = new Map<string, OdsUlUnitPolicyRule>();
  cachedUnitPolicyDataset.rules.forEach((rule) => {
    cachedUnitPolicyByCanonical?.set(rule.ingredientCanonicalKey, rule);
  });
  return cachedUnitPolicyDataset;
};

const getOdsUlUnitPolicyMap = (): Map<string, OdsUlUnitPolicyRule> => {
  if (cachedUnitPolicyByCanonical) return cachedUnitPolicyByCanonical;
  getOdsUlUnitPolicyDataset();
  return cachedUnitPolicyByCanonical ?? new Map();
};

export const lookupUlByCanonicalKey = (
  canonicalKey: string | null | undefined,
  aliasHints: Array<string | null | undefined> = [],
): OdsUlItem | null => {
  const normalized = normalizeCanonicalKey(canonicalKey);
  if (!normalized) return null;
  const dataset = getOdsUlDataset();
  if (!cachedUlByCanonical) cachedUlByCanonical = buildUlLookup(dataset);
  const direct = cachedUlByCanonical.get(normalized);
  if (direct) return direct;

  const aliases = getOdsAliasMap();
  const candidates = [normalized, ...aliasHints.map((item) => normalizeCanonicalKey(item))].filter(
    (item): item is string => Boolean(item),
  );
  for (const key of candidates) {
    const mappedCanonical = aliases.get(key);
    if (!mappedCanonical) continue;
    const found = cachedUlByCanonical.get(mappedCanonical);
    if (found) return found;
  }
  return null;
};

export const evaluateUlUnitPolicy = (params: {
  canonicalKey: string | null | undefined;
  labelText?: string | null;
  fromUnit?: string | null;
  targetUnit?: string | null;
}): OdsUlUnitPolicyEvaluation | null => {
  const canonicalKey = normalizeCanonicalKey(params.canonicalKey);
  if (!canonicalKey) return null;
  const policy = getOdsUlUnitPolicyMap().get(canonicalKey);
  if (!policy) return null;

  const fromUnit = normalizeUnit(params.fromUnit);
  const targetUnit = normalizeUnit(params.targetUnit);
  const labelText = String(params.labelText ?? "").toLowerCase();
  const hintMatched = policy.labelHints.some((hint) => labelText.includes(hint));
  const unitMatched =
    !policy.appliesToUnits.length || (fromUnit != null && policy.appliesToUnits.includes(fromUnit));
  const ulUnitMatched = !policy.ulUnit || targetUnit === policy.ulUnit;

  if (!hintMatched || !unitMatched || !ulUnitMatched) return null;
  return {
    warn: true,
    blockConversion: policy.blockConversionWhenHintsPresent,
    reasonCode: policy.reasonCode,
    warningMessage: policy.warningMessage,
  };
};

export const getUlLimitByLifeStage = (
  item: OdsUlItem,
  lifeStage: OdsUlLifeStage = "adult_19_plus",
): OdsUlGroup | null =>
  item.groups.find((group) => group.lifeStage === lifeStage) ?? null;

const convertMassUnit = (
  value: number,
  fromUnit: string,
  toUnit: string,
): number | null => {
  const fromFactor = MASS_TO_MG_FACTOR[fromUnit];
  const toFactor = MASS_TO_MG_FACTOR[toUnit];
  if (!fromFactor || !toFactor) return null;
  return (value * fromFactor) / toFactor;
};

const convertViaAltUnits = (
  value: number,
  fromUnit: string,
  toUnit: string,
  altUnits: OdsUlAltUnit[],
): number | null => {
  for (const alt of altUnits) {
    const [leftRaw, rightRaw] = alt.direction.split("->").map((part) => normalizeUnit(part));
    const left = leftRaw;
    const right = rightRaw;
    if (!left || !right) continue;
    if (left === fromUnit && right === toUnit) {
      return value * alt.factor;
    }
    if (left === toUnit && right === fromUnit) {
      return value / alt.factor;
    }
  }
  return null;
};

export const convertDoseToUlUnit = (params: {
  amount: number | null | undefined;
  fromUnit: string | null | undefined;
  targetUnit: string | null | undefined;
  altUnits?: OdsUlAltUnit[] | null;
}): DoseConversionResult => {
  const amount = safeNumber(params.amount);
  const fromUnit = normalizeUnit(params.fromUnit);
  const targetUnit = normalizeUnit(params.targetUnit);
  if (amount == null || amount < 0 || !fromUnit || !targetUnit) {
    return {
      ok: false,
      value: null,
      unit: targetUnit ?? null,
      reasonCode: "INVALID_INPUT",
      confidence: 0.1,
    };
  }
  if (fromUnit === targetUnit) {
    return {
      ok: true,
      value: amount,
      unit: targetUnit,
      reasonCode: "DIRECT_UNIT_MATCH",
      confidence: 0.95,
    };
  }
  const massConverted = convertMassUnit(amount, fromUnit, targetUnit);
  if (massConverted != null && Number.isFinite(massConverted)) {
    return {
      ok: true,
      value: massConverted,
      unit: targetUnit,
      reasonCode: "MASS_UNIT_CONVERTED",
      confidence: 0.9,
    };
  }
  const altConverted = convertViaAltUnits(amount, fromUnit, targetUnit, params.altUnits ?? []);
  if (altConverted != null && Number.isFinite(altConverted)) {
    return {
      ok: true,
      value: altConverted,
      unit: targetUnit,
      reasonCode: "ALT_UNIT_CONVERTED",
      confidence: 0.85,
    };
  }
  return {
    ok: false,
    value: null,
    unit: targetUnit,
    reasonCode: "UNSUPPORTED_UNIT_CONVERSION",
    confidence: 0.2,
  };
};

export const classifyUlRisk = (ratio: number): UlRiskLevel => {
  if (!Number.isFinite(ratio) || ratio <= 0) return "low";
  if (ratio >= 1.2) return "high";
  if (ratio >= 1) return "moderate";
  return "low";
};

export const buildUlScopeNote = (params: {
  scope: OdsUlScope;
  canonicalKey: string | null | undefined;
}): string | null => {
  const canonicalKey = normalizeCanonicalKey(params.canonicalKey);
  if (params.scope === "supplements_only") {
    if (canonicalKey === "magnesium") {
      return "UL applies to supplemental magnesium (and medications), not naturally occurring food intake.";
    }
    return "UL applies to supplemental sources only.";
  }
  if (params.scope === "supplements_or_fortified_only") {
    if (canonicalKey === "folate") {
      return "UL applies to folic acid from supplements or fortified foods, not naturally occurring food folate.";
    }
    return "UL applies to supplements and fortified-food sources.";
  }
  return null;
};

const formatAmountValue = (value: number): string => {
  if (!Number.isFinite(value)) return "0";
  if (value >= 1000) return String(Math.round(value));
  if (value >= 100) return String(Math.round(value * 10) / 10);
  if (value >= 10) return String(Math.round(value * 10) / 10);
  if (value >= 1) return String(Math.round(value * 100) / 100);
  return String(Math.round(value * 1000) / 1000);
};

const formatUnitLabel = (unit: string): string => {
  const normalized = normalizeUnit(unit) ?? unit.trim().toLowerCase();
  if (normalized === "iu") return "IU";
  if (normalized === "mcg") return "mcg";
  if (normalized === "mg") return "mg";
  if (normalized === "g") return "g";
  return normalized;
};

export const formatDoseText = (value: number, unit: string): string =>
  `${formatAmountValue(value)} ${formatUnitLabel(unit)}`;

export const normalizeOdsCanonicalKey = normalizeCanonicalKey;
