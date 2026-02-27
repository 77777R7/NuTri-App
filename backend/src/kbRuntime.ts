import fs from "node:fs";
import path from "node:path";

import { getReviewedFormExplain } from "./insights/reviewedPackage.js";

type AliasEntry = {
  // Some generated KB alias entries use null and rely on derived keys (token or ingredientId_token).
  form_key: string | null;
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
    absorption?: { en?: Array<KbSentence> };
    solubility?: { en?: Array<KbSentence> };
    tolerability?: { en?: Array<KbSentence> };
    caveats?: { en?: Array<KbSentence> };
  };
};

type KbSentence = {
  text?: string | null;
  sentence_id?: string | null;
  evidence_snippet_id?: string | null;
  evidence_reference_id?: string | null;
  evidence_grade?: string | null;
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

type ReviewedAliasFile = {
  version?: string;
  aliases?: Record<string, string>;
};

export type FormResolveSource =
  | "label_parenthetical"
  | "label_as_phrase"
  | "label_from_phrase"
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
  "tocotrienols",
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
  "carnitine",
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
  "nicotinate",
  "carnosine",
  "palmitate",
  "tartrate",
  "threonate",
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

const REVIEWED_INGREDIENT_NAME_ALIASES_DEFAULT: Record<string, string> = {
  folic_acid: "folate",
  vitamin_b_12: "vitamin_b12",
  vitamin_b12: "vitamin_b12",
  vitamin_b_6: "vitamin_b6",
  vitamin_b6: "vitamin_b6",
  fish_oil: "omega_3",
  thiamine: "thiamin",
  thiamine_hcl: "thiamine_hcl",
  cat_s_claw: "cat_s_claw",
  cats_claw: "cat_s_claw",
  uncaria_tomentosa: "cat_s_claw",
};

let reviewedAliasLoadAttempted = false;
let reviewedIngredientAliases: Record<string, string> = { ...REVIEWED_INGREDIENT_NAME_ALIASES_DEFAULT };

const getReviewedAliasPath = () =>
  process.env.REVIEWED_INGREDIENT_ALIASES_PATH ??
  path.join(process.cwd(), "data", "reviewed", "reviewed-ingredient-aliases.v1.json");

const getReviewedIngredientAliases = (): Record<string, string> => {
  if (reviewedAliasLoadAttempted) return reviewedIngredientAliases;
  reviewedAliasLoadAttempted = true;
  const loaded = loadJson<ReviewedAliasFile>(getReviewedAliasPath());
  if (!loaded?.aliases || typeof loaded.aliases !== "object") return reviewedIngredientAliases;

  const next: Record<string, string> = { ...REVIEWED_INGREDIENT_NAME_ALIASES_DEFAULT };
  for (const [rawAlias, rawToken] of Object.entries(loaded.aliases)) {
    const alias = normalizeToken(rawAlias);
    const token = normalizeToken(rawToken);
    if (!alias || !token) continue;
    next[alias] = token;
  }
  reviewedIngredientAliases = next;
  return reviewedIngredientAliases;
};

const pickBestAliasEntry = (entries: AliasEntry[] | undefined): AliasEntry | null => {
  if (!entries || entries.length === 0) return null;
  const sorted = [...entries].sort((a, b) => (b.alias_confidence ?? 0) - (a.alias_confidence ?? 0));
  return sorted[0] ?? null;
};

const extractSegmentText = (entry: KbEntry | undefined): string | null => {
  return extractBestSegment(entry)?.text ?? null;
};

const extractBestSegment = (
  entry: KbEntry | undefined,
): {
  text: string;
  sentenceId: string | null;
  excerptId: string | null;
  referenceId: string | null;
  evidenceGrade: string | null;
} | null => {
  if (!entry?.segments) return null;
  const seg = entry.segments;
  const order = [seg.absorption, seg.solubility, seg.tolerability, seg.caveats];
  for (const bucket of order) {
    const sentence = bucket?.en?.[0];
    const text = sentence?.text;
    if (text) {
      return {
        text,
        sentenceId: sentence?.sentence_id ?? null,
        excerptId: sentence?.evidence_snippet_id ?? null,
        referenceId: sentence?.evidence_reference_id ?? null,
        evidenceGrade: sentence?.evidence_grade ?? null,
      };
    }
  }
  return null;
};

const loadJson = <T>(filePath: string): T | null => {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    try {
      return JSON.parse(raw) as T;
    } catch {
      // Some generated KB files still contain NaN placeholders.
      const sanitized = raw.replace(/\bNaN\b/g, "null");
      return JSON.parse(sanitized) as T;
    }
  } catch {
    return null;
  }
};

const isUuidLike = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const REVERSE_FORM_BASE_TOKENS = new Set(REVERSE_FORM_KEYWORDS);
const BOTANICAL_NAME_SUFFIX_TOKENS = new Set([
  "root",
  "leaf",
  "seed",
  "flower",
  "fruit",
  "bark",
  "extract",
  "powder",
  "oil",
  "herb",
  "whole",
]);

const resolveReviewedIngredientCandidates = (
  ingredientName: string | null | undefined,
  kb: KbRuntime | null,
): Array<{ token: string; path: string }> => {
  const aliasMap = getReviewedIngredientAliases();
  const normalized = String(ingredientName ?? "").trim();
  const base = normalizeToken(normalized);
  if (!base) return [];

  const seen = new Set<string>();
  const out: Array<{ token: string; path: string }> = [];
  const add = (tokenRaw: string, pathRaw: string) => {
    const token = normalizeToken(tokenRaw);
    if (!token || seen.has(token)) return;
    seen.add(token);
    out.push({ token, path: pathRaw });
  };

  add(base, "name_exact");
  const directAlias = aliasMap[base];
  if (directAlias) add(directAlias, "name_alias");
  const kbMapped = kb?.ingredientNameIndex?.[base];
  if (kbMapped) add(kbMapped, "kb_name_index");

  const words = normalizeFreeText(normalized)
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length >= 2) {
    const binomial = normalizeToken(`${words[0] ?? ""}_${words[1] ?? ""}`);
    if (binomial) {
      add(binomial, "name_binomial");
      const binomialAlias = aliasMap[binomial];
      if (binomialAlias) add(binomialAlias, "name_binomial_alias");
      const kbBinomial = kb?.ingredientNameIndex?.[binomial];
      if (kbBinomial) add(kbBinomial, "kb_binomial_index");
    }
    const head = normalizeToken(words[0] ?? "");
    if (head) {
      const alias = aliasMap[head];
      if (alias) add(alias, "name_head_alias");
      const kbHead = kb?.ingredientNameIndex?.[head];
      if (kbHead) add(kbHead, "kb_head_index");
    }
  }

  const compositeParts = base.split("_").filter(Boolean);
  if (compositeParts.length >= 2) {
    const tail = compositeParts[compositeParts.length - 1] ?? "";
    if (REVERSE_FORM_BASE_TOKENS.has(tail)) {
      const ingredientOnly = compositeParts.slice(0, -1).join("_");
      if (ingredientOnly) {
        add(ingredientOnly, "name_form_suffix_stripped");
        const suffixAlias = aliasMap[ingredientOnly];
        if (suffixAlias) add(suffixAlias, "name_form_suffix_alias");
      }
    }
    let trimmed = [...compositeParts];
    let strippedAny = false;
    while (trimmed.length >= 2 && BOTANICAL_NAME_SUFFIX_TOKENS.has(trimmed[trimmed.length - 1] ?? "")) {
      trimmed = trimmed.slice(0, -1);
      strippedAny = true;
    }
    if (strippedAny) {
      const botanicalBase = trimmed.join("_");
      if (botanicalBase) {
        add(botanicalBase, "name_botanical_suffix_stripped");
        const botanicalAlias = aliasMap[botanicalBase];
        if (botanicalAlias) add(botanicalAlias, "name_botanical_suffix_alias");
        const kbBotanical = kb?.ingredientNameIndex?.[botanicalBase];
        if (kbBotanical) add(kbBotanical, "kb_botanical_suffix_index");
      }
    }
  }

  if (base.endsWith("s") && base.length > 3) {
    const singular = base.replace(/s$/, "");
    add(singular, "name_singularized");
  }

  return out;
};

const buildReviewedFormKeyCandidates = (
  ingredientToken: string,
  formKeyRaw: string,
): Array<{ formKey: string; path: string }> => {
  const formKey = normalizeToken(formKeyRaw);
  if (!formKey) return [];

  const seen = new Set<string>();
  const out: Array<{ formKey: string; path: string }> = [];
  const add = (raw: string, pathRaw: string) => {
    const normalized = normalizeToken(raw);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push({ formKey: normalized, path: pathRaw });
  };

  add(formKey, "exact");
  add(`${ingredientToken}_${formKey}`, "prefixed_ingredient");

  if (formKey.startsWith(`${ingredientToken}_`)) {
    add(formKey.slice(ingredientToken.length + 1), "strip_ingredient_prefix");
  }

  if (/\bhcl\b/.test(formKey)) add(formKey.replace(/\bhcl\b/g, "hydrochloride"), "hcl_to_hydrochloride");
  if (/\bhydrochloride\b/.test(formKey)) add(formKey.replace(/\bhydrochloride\b/g, "hcl"), "hydrochloride_to_hcl");

  if (ingredientToken === "thiamin" && (formKey === "hcl" || formKey === "hydrochloride" || formKey === "thiamin_hcl")) {
    add("thiamine_hcl", "thiamin_variant");
  }

  return out;
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
    // Guard against generator artifacts (e.g. "NaN") that should never be treated as a real form_key.
    if (!formKey || formKey === "null" || formKey === "undefined" || formKey === "NaN") continue;
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

const extractReverseTokenFromName = (
  name: string,
  ingredientId: string | null,
): { token: string; evidenceText: string; resolveSource: FormResolveSource } | null => {
  if (!ingredientId || !isAllowedIngredient(ingredientId)) return null;
  const normalizedName = normalizeFreeText(name);
  if (!normalizedName) return null;

  // Tocotrienols are commonly listed with a Greek prefix (e.g. "Gamma Tocotrienols").
  // Treat the ingredient name itself as the "form token" so KB-first can explain the identity
  // without guessing delivery form or comparative performance.
  if (ingredientId === "tocotrienols" && /\btocotrienol(s)?\b/i.test(normalizedName)) {
    return { token: "tocotrienols", evidenceText: name, resolveSource: "reverse_name_parse" };
  }

  const parenthetical = normalizedName.match(/\(as ([^)]+)\)/i);
  if (parenthetical?.[1]) {
    const extracted = normalizeFreeText(parenthetical[1]);
    if (hasBlacklistToken(extracted)) return null;
    return { token: normalizeToken(extracted), evidenceText: parenthetical[0], resolveSource: "label_parenthetical" };
  }

  const asMatch = normalizedName.match(/\bas ([^,]+?)(?:,|$)/i);
  if (asMatch?.[1]) {
    const extracted = normalizeFreeText(asMatch[1]);
    if (hasBlacklistToken(extracted)) return null;
    return { token: normalizeToken(extracted), evidenceText: asMatch[0], resolveSource: "label_as_phrase" };
  }

  const fromMatch = normalizedName.match(/\bfrom ([^,]+?)(?:,|$)/i);
  if (fromMatch?.[1]) {
    const extracted = normalizeFreeText(fromMatch[1]);
    if (hasBlacklistToken(extracted)) return null;
    return { token: normalizeToken(extracted), evidenceText: fromMatch[0], resolveSource: "label_from_phrase" };
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
      return { token: normalizedToken, evidenceText: name, resolveSource: "reverse_name_parse" };
    }
  }

  return null;
};

const resolveFormKeyFromToken = (kb: KbRuntime, ingredientId: string, token: string) => {
  const runtimeIndex = kb.runtime.ingredient_form_index ?? {};
  const hasRuntimeEntry = (formKey: string | null): boolean =>
    Boolean(formKey && runtimeIndex[`${ingredientId}|${formKey}`]);
  const preferRuntimeKey = (candidates: Array<string | null>): string | null =>
    candidates.find((candidate) => hasRuntimeEntry(candidate)) ?? candidates.find(Boolean) ?? null;

  // If the incoming token is already a canonical KB form_key, use it directly.
  if (hasRuntimeEntry(token)) {
    return { formKey: token, resolveSource: "digest_chemical_form" as FormResolveSource };
  }

  // Some DSLD labels embed the ingredient id into the tokenized name (e.g. "Iron Ferrous Fumarate" ->
  // "iron_ferrous_fumarate"). If the suffix is a runtime form_key for this ingredient, prefer it.
  const derivedPrefix = `${ingredientId}_`;
  const derivedSuffix = token.startsWith(derivedPrefix) ? token.slice(derivedPrefix.length) : null;
  if (derivedSuffix && hasRuntimeEntry(derivedSuffix)) {
    return { formKey: derivedSuffix, resolveSource: "alias_map_by_ingredient" as FormResolveSource };
  }
  // DSLD can also prefix label heads with stereochemistry tokens like "L-" (e.g. "L-Carnitine HCl"),
  // which normalize to "l_carnitine_hcl". Prefer a derived suffix when it maps to a shipped runtime key.
  for (const stereoPrefix of ["l", "d", "dl"]) {
    const prefix = `${stereoPrefix}_${ingredientId}_`;
    if (!token.startsWith(prefix)) continue;
    const suffix = token.slice(prefix.length);
    if (suffix && hasRuntimeEntry(suffix)) {
      return { formKey: suffix, resolveSource: "alias_map_by_ingredient" as FormResolveSource };
    }
    // Some labels include an extra leading "l_" before the form token (e.g. "l_tartrate").
    if (suffix?.startsWith("l_")) {
      const stripped = suffix.slice(2);
      if (stripped && hasRuntimeEntry(stripped)) {
        return { formKey: stripped, resolveSource: "alias_map_by_ingredient" as FormResolveSource };
      }
    }
  }

  // Canonicalize common shorthand tokens to shipped runtime keys when possible.
  // This keeps both scan and runtime resolution stable without requiring every dataset to
  // spell the exact KB form_key (e.g. "Magnesium L-Threonate" vs "threonate").
  if (ingredientId === "magnesium" && token === "threonate" && hasRuntimeEntry("l_threonate")) {
    return { formKey: "l_threonate", resolveSource: "alias_map_by_ingredient" as FormResolveSource };
  }
  if (ingredientId === "vitamin_a" && token === "palmitate" && hasRuntimeEntry("retinyl_palmitate")) {
    return { formKey: "retinyl_palmitate", resolveSource: "alias_map_by_ingredient" as FormResolveSource };
  }
  if (ingredientId === "vitamin_a" && token === "acetate" && hasRuntimeEntry("retinyl_acetate")) {
    return { formKey: "retinyl_acetate", resolveSource: "alias_map_by_ingredient" as FormResolveSource };
  }
  // Vitamin K2: DSLD labels frequently use MK-7 / MK-4 (hyphenated) which normalize to mk_7 / mk_4.
  // Canonicalize to shipped runtime keys (mk7/mk4) so we don't report false gaps or miss KB matches.
  if (ingredientId === "vitamin_k2" && token === "mk_7" && hasRuntimeEntry("mk7")) {
    return { formKey: "mk7", resolveSource: "alias_map_by_ingredient" as FormResolveSource };
  }
  if (ingredientId === "vitamin_k2" && token === "mk_4" && hasRuntimeEntry("mk4")) {
    return { formKey: "mk4", resolveSource: "alias_map_by_ingredient" as FormResolveSource };
  }

  // Vitamin B1 (thiamin) hydrochloride is commonly disclosed as "Thiamine Hydrochloride" or "Thiamine HCl".
  // Canonicalize to the KB form key to avoid duplicate runtime entries like "thiamin+hydrochloride".
  if (
    ingredientId === "thiamin" &&
    (token === "hydrochloride" || token === "hcl" || token === "thiamine_hydrochloride") &&
    hasRuntimeEntry("thiamine_hcl")
  ) {
    return { formKey: "thiamine_hcl", resolveSource: "alias_map_by_ingredient" as FormResolveSource };
  }
  // Carnitine hydrochloride is commonly abbreviated as "HCl" on labels.
  // Canonicalize to the shipped runtime key to avoid duplicate entries like "carnitine+hydrochloride".
  if (
    (ingredientId === "carnitine" || ingredientId === "l_carnitine") &&
    (token === "hydrochloride" || token === "hcl") &&
    hasRuntimeEntry("hcl")
  ) {
    return { formKey: "hcl", resolveSource: "alias_map_by_ingredient" as FormResolveSource };
  }

  const byIngredient = kb.alias.byIngredient?.[ingredientId];
  const byIngredientEntry = pickBestAliasEntry(byIngredient?.[token]);
  if (byIngredientEntry) {
    const prefix = `${ingredientId}_`;
    const derivedSuffix = token.startsWith(prefix) ? token.slice(prefix.length) : null;
    const formKey = byIngredientEntry.form_key ?? preferRuntimeKey([token, derivedSuffix]);
    return { formKey, resolveSource: "alias_map_by_ingredient" as FormResolveSource };
  }

  const globalEntry = pickBestAliasEntry(kb.alias.global?.[token]);
  if (globalEntry) {
    const prefixed = `${ingredientId}_${token}`;
    const formKey = globalEntry.form_key ?? preferRuntimeKey([token, prefixed]);
    return { formKey, resolveSource: "alias_map_global" as FormResolveSource };
  }

  const reverseKey = kb.reverseTokenIndex[token] ?? null;
  if (reverseKey) return { formKey: reverseKey, resolveSource: "alias_map_global" as FormResolveSource };
  return { formKey: null, resolveSource: "none" as FormResolveSource };
};

const normalizeVitaminIngredientToken = (value: string): string | null => {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!cleaned.startsWith("vitamin")) return null;
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  const second = parts[1];

  // vitamin d3/d2 -> vitamin_d; vitamin k1/k2 -> vitamin_k1/vitamin_k2; vitamin b-12 -> vitamin_b12
  const match = second.match(/^([a-z])(\d+)?$/i);
  if (!match) return null;
  const letter = match[1].toLowerCase();
  const num = match[2] ?? "";
  if (letter === "d") return "vitamin_d";
  if (letter === "k") {
    if (num === "2") return "vitamin_k2";
    if (num === "1") return "vitamin_k1";
    return "vitamin_k1";
  }
  if (letter === "b") {
    // Normalize b12 / b-12 / b 12 etc
    const joined = parts.slice(1).join("");
    const bNum = joined.replace(/^b/i, "").replace(/[^0-9]/g, "");
    if (bNum) return `vitamin_b${bNum}`;
    return null;
  }
  if (letter === "a") return "vitamin_a";
  if (letter === "c") return "vitamin_c";
  if (letter === "e") return "vitamin_e";
  return `vitamin_${letter}${num}`;
};

const VITAMIN_C_SALT_CATIONS = new Set(["calcium", "sodium", "magnesium", "potassium"]);

const extractHeadWord = (value: string): string | null => {
  const cleaned = normalizeFreeText(value)
    .replace(/^(as|from)\s+/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!cleaned) return null;
  return cleaned.split(/\s+/)[0] ?? null;
};

const isVitaminCScopeName = (value: string): boolean => {
  const cleaned = normalizeFreeText(value);
  if (!cleaned) return false;

  // Strong, unambiguous vitamin C signals.
  if (/\bvitamin\s*c\b/.test(cleaned)) return true;
  if (/\bascorbic\b/.test(cleaned)) return true;
  if (/\bester[-_ ]?c\b/.test(cleaned)) return true;

  // Avoid misattribution like "Zinc Ascorbate": treat "ascorbate" as vitamin C scope only when the
  // label head is a common vitamin C salt cation (calcium/sodium/magnesium/potassium).
  if (/\bascorbate\b/.test(cleaned)) {
    const head = extractHeadWord(cleaned);
    if (head && VITAMIN_C_SALT_CATIONS.has(head)) return true;
  }

  return false;
};

const FIRST_WORD_ALLOWLIST = new Set([
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
  "vitamin",
  // P1: allow a small set of non-vitamin/mineral ingredient families to resolve when the DSLD label
  // embeds the form in the ingredient name (e.g. "Creatine Citrate"). Keep this list conservative.
  "creatine",
  "carnitine",
]);

const resolveIngredientId = (
  kb: KbRuntime,
  ingredientName: string,
  providedIngredientId?: string | null,
): string | null => {
  // Some DSLD strings can start with "as ..." (e.g. "as Calcium Ascorbate"). Strip the leading
  // marker so ingredient resolution doesn't collapse to an empty "beforeAs" token.
  const cleanedIngredientName = ingredientName.replace(/^(as|from)\s+/i, "").trim();

  if (providedIngredientId) return providedIngredientId;
  const direct = kb.ingredientNameIndex[normalizeToken(cleanedIngredientName)];
  if (direct) return direct;
  const strippedParenthetical = cleanedIngredientName.replace(/\([^)]*\)/g, " ").trim();
  const withoutParenthetical = kb.ingredientNameIndex[normalizeToken(strippedParenthetical)];
  if (withoutParenthetical) return withoutParenthetical;
  const beforeComma = strippedParenthetical.split(",")[0]?.trim() ?? strippedParenthetical;
  const commaToken = kb.ingredientNameIndex[normalizeToken(beforeComma)];
  if (commaToken) return commaToken;
  const beforeAs = beforeComma.split(/\bas\b/i)[0]?.trim() ?? beforeComma;
  const asToken = kb.ingredientNameIndex[normalizeToken(beforeAs)];
  if (asToken) return asToken;

  // Some DSLD labels include a leading Greek descriptor (e.g. "Gamma Tocotrienols").
  // If stripping the prefix matches a known ingredient, prefer that.
  const greekMatch = beforeAs.match(/^(alpha|beta|gamma|delta)\s+(.+)$/i);
  if (greekMatch?.[2]) {
    const remainder = greekMatch[2].trim();
    const greekToken = kb.ingredientNameIndex[normalizeToken(remainder)];
    if (greekToken) return greekToken;
    if (/\btocotrienol\b/i.test(remainder)) {
      const tocotrienols = kb.ingredientNameIndex["tocotrienols"];
      if (tocotrienols) return tocotrienols;
    }
  }

  // P0: Vitamin C forms are commonly listed as salts (e.g. calcium/sodium ascorbate).
  // Prefer vitamin_c scope over mineral scope only when the ingredient name indicates vitamin C
  // (avoid misattribution like "Zinc Ascorbate").
  if (isVitaminCScopeName(beforeAs)) {
    const vitaminC = kb.ingredientNameIndex["vitamin_c"];
    if (vitaminC) return vitaminC;
  }

  const vitaminToken = normalizeVitaminIngredientToken(beforeAs);
  if (vitaminToken) {
    const vitaminId = kb.ingredientNameIndex[vitaminToken];
    if (vitaminId) return vitaminId;
  }

  // P0-B: first-word fallback is allowlisted (minerals + vitamin only) to avoid misattribution.
  const words = normalizeFreeText(beforeAs)
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  let headWord = words[0] ?? null;
  // Handle common prefixes like "L-" (e.g. "L-Carnitine ...") or quantity prefixes like
  // "tri-" / "di-" (e.g. "Tri-Creatine Malate", "Di-Calcium Malate") while still staying conservative:
  // only shift to the second token if it is explicitly allowlisted.
  if (headWord && (headWord === "l" || headWord === "d" || headWord === "dl" || headWord === "tri" || headWord === "di") && words[1]) {
    const second = words[1];
    if (FIRST_WORD_ALLOWLIST.has(second)) headWord = second;
  }
  if (!headWord || !FIRST_WORD_ALLOWLIST.has(headWord)) return null;
  const firstToken = kb.ingredientNameIndex[normalizeToken(headWord)];
  return firstToken ?? null;
};

export const lookupKbFormExplain = (params: {
  ingredientName: string;
  chemicalForm: string | null;
  chemicalFormConfidence: number | null;
  chemicalFormSource?:
    | "lnhpd_meta"
    | "label_parenthetical"
    | "label_as_phrase"
    | "label_from_phrase"
    | "ingredient_name"
    | "none"
    | null;
  chemicalFormEvidence?: string | null;
  ingredientId?: string | null;
}): {
  sentence: string | null;
  sentenceId: string | null;
  excerptId: string | null;
  referenceId: string | null;
  evidenceGrade: string | null;
  resolveSource: FormResolveSource;
  evidenceText: string | null;
} => {
  const kb = getKbRuntime();
  if (!kb) {
    return {
      sentence: null,
      sentenceId: null,
      excerptId: null,
      referenceId: null,
      evidenceGrade: null,
      resolveSource: "none",
      evidenceText: null,
    };
  }

  const ingredientId = resolveIngredientId(kb, params.ingredientName, params.ingredientId);
  if (!ingredientId) {
    return {
      sentence: null,
      sentenceId: null,
      excerptId: null,
      referenceId: null,
      evidenceGrade: null,
      resolveSource: "none",
      evidenceText: null,
    };
  }

  if (params.chemicalForm && params.chemicalFormConfidence !== null && params.chemicalFormConfidence >= 0.6) {
    const token = normalizeToken(params.chemicalForm);
    const resolved = resolveFormKeyFromToken(kb, ingredientId, token);
    if (resolved.formKey) {
      const entry = kb.runtime.ingredient_form_index?.[`${ingredientId}|${resolved.formKey}`];
      const seg = extractBestSegment(entry);
      if (seg) {
        const explicitSource =
          params.chemicalFormSource === "label_parenthetical" ||
          params.chemicalFormSource === "label_as_phrase" ||
          params.chemicalFormSource === "label_from_phrase"
            ? params.chemicalFormSource
            : null;
        return {
          sentence: seg.text,
          sentenceId: seg.sentenceId,
          excerptId: seg.excerptId,
          referenceId: seg.referenceId,
          evidenceGrade: seg.evidenceGrade,
          resolveSource: explicitSource ?? resolved.resolveSource ?? "digest_chemical_form",
          evidenceText: params.chemicalFormEvidence ?? params.chemicalForm,
        };
      }
    }
  }

  const reverseToken = extractReverseTokenFromName(params.ingredientName, ingredientId);
  if (reverseToken) {
    const resolved = resolveFormKeyFromToken(kb, ingredientId, reverseToken.token);
    if (resolved.formKey) {
      const entry = kb.runtime.ingredient_form_index?.[`${ingredientId}|${resolved.formKey}`];
      const seg = extractBestSegment(entry);
      if (seg) {
        return {
          sentence: seg.text,
          sentenceId: seg.sentenceId,
          excerptId: seg.excerptId,
          referenceId: seg.referenceId,
          evidenceGrade: seg.evidenceGrade,
          resolveSource: reverseToken.resolveSource,
          evidenceText: reverseToken.evidenceText,
        };
      }
    }
  }

  return {
    sentence: null,
    sentenceId: null,
    excerptId: null,
    referenceId: null,
    evidenceGrade: null,
    resolveSource: "none",
    evidenceText: null,
  };
};

export type RuntimeInsightSegmentKind = "absorption" | "solubility" | "tolerability" | "caveats";

export type RuntimeInsightSegment = {
  kind: RuntimeInsightSegmentKind;
  text: string;
  sentenceId: string | null;
  excerptId: string | null;
  referenceId: string | null;
  evidenceGrade: string | null;
};

export const lookupKbRuntimeFormInsights = (params: {
  ingredientId: string;
  formKey: string;
  ingredientName?: string | null;
  ingredientCanonicalKey?: string | null;
}): {
  status: "ok" | "not_found";
  reason: "no_runtime" | "ingredient_not_supported" | "no_entry_for_form_key" | null;
  formDisplay: string | null;
  segments: RuntimeInsightSegment[];
  meta: {
    packageSha256: string | null;
    reviewedAt: string | null;
    source: "reviewed_package" | "kb_runtime" | null;
    datasetVersion: string | null;
  };
  debug: {
    ingredientResolvePath: string | null;
    formKeyResolvePath: string | null;
    reviewedLookupTried: string[];
  };
} => {
  const kb = getKbRuntime();
  const toRuntimeSegments = (
    kind: RuntimeInsightSegmentKind,
    rows: Array<{
      text: string;
      sentenceId: string | null;
      excerptId: string | null;
      referenceId: string | null;
      evidenceGrade: string | null;
    }> | undefined,
  ): RuntimeInsightSegment[] => {
    if (!rows?.length) return [];
    return rows
      .map((row) => {
        const text = typeof row.text === "string" ? row.text.trim() : "";
        if (!text) return null;
        return {
          kind,
          text,
          sentenceId: row.sentenceId,
          excerptId: row.excerptId,
          referenceId: row.referenceId,
          evidenceGrade: row.evidenceGrade,
        } satisfies RuntimeInsightSegment;
      })
      .filter((row): row is RuntimeInsightSegment => Boolean(row));
  };

  const reviewedLookupTried: string[] = [];
  let ingredientResolvePath: string | null = null;
  let formKeyResolvePath: string | null = null;

  const normalizeIngredientCandidate = normalizeToken(params.ingredientId);
  const ingredientCandidates: Array<{ token: string; path: string }> = [];
  const seenIngredientCandidates = new Set<string>();
  const pushIngredientCandidate = (tokenRaw: string, pathRaw: string) => {
    const token = normalizeToken(tokenRaw);
    if (!token || seenIngredientCandidates.has(token)) return;
    seenIngredientCandidates.add(token);
    ingredientCandidates.push({ token, path: pathRaw });
  };

  const canonicalIngredientToken = normalizeToken(params.ingredientCanonicalKey ?? "");
  if (canonicalIngredientToken) {
    pushIngredientCandidate(canonicalIngredientToken, "ingredient_canonical_key");
  }
  if (normalizeIngredientCandidate && !isUuidLike(params.ingredientId)) {
    pushIngredientCandidate(normalizeIngredientCandidate, "ingredient_id_exact");
  }

  resolveReviewedIngredientCandidates(params.ingredientName, kb).forEach((candidate) =>
    pushIngredientCandidate(candidate.token, candidate.path),
  );

  const tryReviewedLookup = (
    ingredientToken: string,
    ingredientPath: string,
    formKey: string,
    formPath: string,
  ) => {
    const normalizedIngredient = normalizeToken(ingredientToken);
    const normalizedForm = normalizeToken(formKey);
    if (!normalizedIngredient || !normalizedForm) return null;
    reviewedLookupTried.push(`${normalizedIngredient}|${normalizedForm}`);
    const reviewed = getReviewedFormExplain(normalizedIngredient, normalizedForm, "en");
    if (!reviewed) return null;

    ingredientResolvePath = ingredientPath;
    formKeyResolvePath = formPath;
    const reviewedSegments = [
      ...toRuntimeSegments("absorption", reviewed.segments.absorption),
      ...toRuntimeSegments("solubility", reviewed.segments.solubility),
      ...toRuntimeSegments("tolerability", reviewed.segments.tolerability),
      ...toRuntimeSegments("caveats", reviewed.segments.caveats),
    ];

    return {
      status: "ok" as const,
      reason: null,
      formDisplay: reviewed.formLabel ?? normalizedForm,
      segments: reviewedSegments,
      meta: {
        packageSha256: reviewed.meta.packageSha256,
        reviewedAt: reviewed.meta.reviewedAt,
        source: "reviewed_package" as const,
        datasetVersion: reviewed.meta.datasetVersion,
      },
      debug: {
        ingredientResolvePath,
        formKeyResolvePath,
        reviewedLookupTried,
      },
    };
  };

  for (const ingredientCandidate of ingredientCandidates) {
    const formCandidates = buildReviewedFormKeyCandidates(ingredientCandidate.token, params.formKey);
    for (const formCandidate of formCandidates) {
      const reviewedMatch = tryReviewedLookup(
        ingredientCandidate.token,
        ingredientCandidate.path,
        formCandidate.formKey,
        formCandidate.path,
      );
      if (reviewedMatch) return reviewedMatch;
    }
  }

  const meta = {
    packageSha256:
      typeof kb?.runtime?.meta?.package_sha256 === "string" ? (kb.runtime.meta.package_sha256 as string) : null,
    reviewedAt:
      typeof kb?.runtime?.meta?.reviewed_at === "string" ? (kb.runtime.meta.reviewed_at as string) : null,
    source: kb ? ("kb_runtime" as const) : null,
    datasetVersion:
      typeof kb?.runtime?.meta?.source_version === "string" ? (kb.runtime.meta.source_version as string) : null,
  };
  if (!kb) {
    return {
      status: "not_found",
      reason: "no_runtime",
      formDisplay: null,
      segments: [],
      meta,
      debug: {
        ingredientResolvePath,
        formKeyResolvePath,
        reviewedLookupTried,
      },
    };
  }

  let resolvedRuntimeIngredientToken: string | null = null;
  let entry: KbEntry | undefined;
  for (const candidate of ingredientCandidates) {
    const key = `${candidate.token}|${params.formKey}`;
    const candidateEntry = kb.runtime.ingredient_form_index?.[key];
    if (!candidateEntry) continue;
    resolvedRuntimeIngredientToken = candidate.token;
    ingredientResolvePath = ingredientResolvePath ?? candidate.path;
    formKeyResolvePath = formKeyResolvePath ?? "runtime_exact";
    entry = candidateEntry;
    break;
  }
  if (!entry) {
    const hasIngredient = ingredientCandidates.some((candidate) =>
      Object.keys(kb.runtime.ingredient_form_index ?? {}).some((indexKey) =>
        indexKey.startsWith(`${candidate.token}|`),
      ),
    );
    return {
      status: "not_found",
      reason: hasIngredient ? "no_entry_for_form_key" : "ingredient_not_supported",
      formDisplay: null,
      segments: [],
      meta,
      debug: {
        ingredientResolvePath,
        formKeyResolvePath,
        reviewedLookupTried,
      },
    };
  }

  const readBucket = (
    kind: RuntimeInsightSegmentKind,
    bucket?: { en?: Array<KbSentence> },
  ): RuntimeInsightSegment[] => {
    if (!bucket?.en?.length) return [];
    return bucket.en
      .map((sentence) => {
        const text = typeof sentence.text === "string" ? sentence.text.trim() : "";
        if (!text) return null;
        return {
          kind,
          text,
          sentenceId: sentence.sentence_id ?? null,
          excerptId: sentence.evidence_snippet_id ?? null,
          referenceId: sentence.evidence_reference_id ?? null,
          evidenceGrade: sentence.evidence_grade ?? null,
        } satisfies RuntimeInsightSegment;
      })
      .filter((row): row is RuntimeInsightSegment => Boolean(row));
  };

  const segments = [
    ...readBucket("absorption", entry.segments?.absorption),
    ...readBucket("solubility", entry.segments?.solubility),
    ...readBucket("tolerability", entry.segments?.tolerability),
    ...readBucket("caveats", entry.segments?.caveats),
  ];

  return {
    status: "ok",
    reason: null,
    formDisplay: entry.form_display ?? entry.form_key ?? null,
    segments,
    meta,
    debug: {
      ingredientResolvePath:
        ingredientResolvePath ??
        (resolvedRuntimeIngredientToken ? "runtime_ingredient_fallback" : null),
      formKeyResolvePath,
      reviewedLookupTried,
    },
  };
};
