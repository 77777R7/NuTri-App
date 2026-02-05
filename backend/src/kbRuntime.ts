import fs from "node:fs";
import path from "node:path";

type AliasEntry = {
  form_key: string;
  alias_confidence?: number | null;
  notes?: string | null;
};

type AliasMap = {
  global?: Record<string, AliasEntry[]>;
  byIngredient?: Record<string, Record<string, AliasEntry[]>>;
  reverse?: Record<string, string[]>;
};

type KbEntry = {
  ingredient_id?: string | null;
  ingredient?: string | null;
  form_key?: string | null;
  form_display?: string | null;
  segments?: {
    absorption?: { en?: Array<{ text?: string | null }> };
    solubility?: { en?: Array<{ text?: string | null }> };
    tolerability?: { en?: Array<{ text?: string | null }> };
    caveats?: { en?: Array<{ text?: string | null }> };
  };
};

type KbRuntimeIndex = {
  ingredient_form_index?: Record<string, KbEntry>;
  alias_index?: Record<string, AliasEntry[]>;
  ingredient_top_forms?: Record<string, string[]>;
  meta?: Record<string, unknown>;
};

type KbRuntime = {
  runtime: KbRuntimeIndex;
  alias: AliasMap;
  ingredientNameIndex: Record<string, string>;
  reverseTokenIndex: Record<string, string>;
};

export type FormResolveSource =
  | "digest_chemical_form"
  | "alias_map_by_ingredient"
  | "alias_map_global"
  | "reverse_name_parse"
  | "none";

let cachedKb: KbRuntime | null = null;
let kbLoadAttempted = false;

const REVERSE_FORM_ALLOWLIST = new Set([
  "calcium",
  "magnesium",
  "zinc",
  "iron",
  "copper",
  "selenium",
  "iodine",
  "chromium",
  "manganese",
  "molybdenum",
  "potassium",
  "vitamin_a",
  "vitamin_b",
  "vitamin_c",
  "vitamin_d",
  "vitamin_e",
  "vitamin_k",
  "folate",
  "folic_acid",
  "niacin",
  "riboflavin",
  "thiamin",
  "omega_3",
  "epa",
  "dha",
  "creatine",
  "coq10",
  "l_carnitine",
]);

const REVERSE_FORM_BLACKLIST = ["dioxide", "peroxide", "antioxidant", "oxidative"];

const REVERSE_FORM_KEYWORDS = [
  "oxide",
  "citrate",
  "gluconate",
  "carbonate",
  "sulfate",
  "chloride",
  "ascorbate",
  "glycinate",
  "malate",
  "picolinate",
  "tartrate",
  "succinate",
  "nitrate",
  "phosphate",
  "fumarate",
  "lactate",
  "bisglycinate",
  "chelate",
  "acetate",
  "hydrochloride",
  "hcl",
];

const normalizeToken = (value: string): string => {
  const lowered = value.toLowerCase().trim();
  const cleaned = lowered.replace(/[^a-z0-9_]+/g, "_");
  return cleaned.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
};

const normalizeFreeText = (value: string): string => value.toLowerCase().trim();

const pickBestAlias = (entries: AliasEntry[] | undefined): string | null => {
  if (!entries || entries.length === 0) return null;
  const sorted = [...entries].sort((a, b) => (b.alias_confidence ?? 0) - (a.alias_confidence ?? 0));
  return sorted[0]?.form_key ?? null;
};

const extractSegmentText = (entry: KbEntry | undefined): string | null => {
  if (!entry?.segments) return null;
  const seg = entry.segments;
  const order = [seg.absorption, seg.solubility, seg.tolerability, seg.caveats];
  for (const bucket of order) {
    const text = bucket?.en?.[0]?.text;
    if (text) return text;
  }
  return null;
};

const loadJson = <T>(filePath: string): T | null => {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

export const getKbRuntime = (): KbRuntime | null => {
  if (cachedKb) return cachedKb;
  if (kbLoadAttempted) return null;
  kbLoadAttempted = true;

  const runtimePath =
    process.env.KB_RUNTIME_INDEX_PATH ?? path.join(process.cwd(), "data", "kb", "kb_runtime_index.json");
  const aliasPath =
    process.env.KB_FORM_ALIAS_PATH ?? path.join(process.cwd(), "data", "kb", "form_alias_map.json");

  const runtime = loadJson<KbRuntimeIndex>(runtimePath);
  const alias = loadJson<AliasMap>(aliasPath);
  if (!runtime || !alias) return null;

  const ingredientNameIndex: Record<string, string> = {};
  for (const entry of Object.values(runtime.ingredient_form_index ?? {})) {
    if (!entry.ingredient || !entry.ingredient_id) continue;
    const key = normalizeToken(entry.ingredient);
    if (!ingredientNameIndex[key]) ingredientNameIndex[key] = entry.ingredient_id;
  }

  const reverseTokenIndex: Record<string, string> = {};
  for (const [formKey, tokens] of Object.entries(alias.reverse ?? {})) {
    for (const token of tokens) {
      const normalized = normalizeToken(token);
      if (!normalized) continue;
      if (!reverseTokenIndex[normalized]) reverseTokenIndex[normalized] = formKey;
    }
  }

  cachedKb = {
    runtime,
    alias,
    ingredientNameIndex,
    reverseTokenIndex,
  };

  return cachedKb;
};

const hasBlacklistToken = (value: string): boolean => {
  const lower = normalizeFreeText(value);
  return REVERSE_FORM_BLACKLIST.some((token) => lower.includes(token));
};

const isAllowedIngredient = (ingredientId: string | null | undefined): boolean => {
  if (!ingredientId) return false;
  if (REVERSE_FORM_ALLOWLIST.has(ingredientId)) return true;
  if (ingredientId.startsWith("vitamin_b") && REVERSE_FORM_ALLOWLIST.has("vitamin_b")) return true;
  return false;
};

const extractReverseTokenFromName = (name: string, ingredientId: string | null): string | null => {
  if (!ingredientId || !isAllowedIngredient(ingredientId)) return null;
  const normalizedName = normalizeFreeText(name);
  if (!normalizedName) return null;

  const parenthetical = normalizedName.match(/\(as ([^)]+)\)/i);
  if (parenthetical?.[1]) {
    if (hasBlacklistToken(parenthetical[1])) return null;
    return normalizeToken(parenthetical[1]);
  }

  const asMatch = normalizedName.match(/\bas ([^,]+?)(?:,|$)/i);
  if (asMatch?.[1]) {
    if (hasBlacklistToken(asMatch[1])) return null;
    return normalizeToken(asMatch[1]);
  }

  const fromMatch = normalizedName.match(/\bfrom ([^,]+?)(?:,|$)/i);
  if (fromMatch?.[1]) {
    if (hasBlacklistToken(fromMatch[1])) return null;
    return normalizeToken(fromMatch[1]);
  }

  const keywordMatch = REVERSE_FORM_KEYWORDS.find((keyword) => {
    if (!normalizedName.includes(keyword)) return false;
    const regex = new RegExp(`\\b${keyword}\\b`, "i");
    return regex.test(normalizedName);
  });

  if (keywordMatch) {
    if (hasBlacklistToken(normalizedName)) return null;
    const normalizedToken = normalizeToken(name);
    const ingredientToken = normalizeToken(ingredientId);
    if (normalizedToken.startsWith(`${ingredientToken}_`) || normalizedToken.endsWith(`_${keywordMatch}`)) {
      return normalizedToken;
    }
  }

  return null;
};

const resolveFormKeyFromToken = (kb: KbRuntime, ingredientId: string, token: string) => {
  const byIngredient = kb.alias.byIngredient?.[ingredientId];
  const byIngredientKey = pickBestAlias(byIngredient?.[token]) ?? null;
  if (byIngredientKey) return { formKey: byIngredientKey, resolveSource: "alias_map_by_ingredient" as FormResolveSource };
  const globalKey = pickBestAlias(kb.alias.global?.[token]) ?? null;
  if (globalKey) return { formKey: globalKey, resolveSource: "alias_map_global" as FormResolveSource };
  const reverseKey = kb.reverseTokenIndex[token] ?? null;
  if (reverseKey) return { formKey: reverseKey, resolveSource: "alias_map_global" as FormResolveSource };
  return { formKey: null, resolveSource: "none" as FormResolveSource };
};

export const lookupKbFormExplain = (params: {
  ingredientName: string;
  chemicalForm: string | null;
  chemicalFormConfidence: number | null;
  ingredientId?: string | null;
}): { sentence: string | null; resolveSource: FormResolveSource } => {
  const kb = getKbRuntime();
  if (!kb) return { sentence: null, resolveSource: "none" };

  const ingredientKey = normalizeToken(params.ingredientName);
  const ingredientId = params.ingredientId ?? kb.ingredientNameIndex[ingredientKey];
  if (!ingredientId) return { sentence: null, resolveSource: "none" };

  if (params.chemicalForm && params.chemicalFormConfidence !== null && params.chemicalFormConfidence >= 0.6) {
    const token = normalizeToken(params.chemicalForm);
    const resolved = resolveFormKeyFromToken(kb, ingredientId, token);
    if (resolved.formKey) {
      const entry = kb.runtime.ingredient_form_index?.[`${ingredientId}|${resolved.formKey}`];
      const sentence = extractSegmentText(entry);
      if (sentence) {
        return { sentence, resolveSource: resolved.resolveSource ?? "digest_chemical_form" };
      }
    }
  }

  const reverseToken = extractReverseTokenFromName(params.ingredientName, ingredientId);
  if (reverseToken) {
    const resolved = resolveFormKeyFromToken(kb, ingredientId, reverseToken);
    if (resolved.formKey) {
      const entry = kb.runtime.ingredient_form_index?.[`${ingredientId}|${resolved.formKey}`];
      const sentence = extractSegmentText(entry);
      if (sentence) {
        return { sentence, resolveSource: "reverse_name_parse" };
      }
    }
  }

  return { sentence: null, resolveSource: "none" };
};
