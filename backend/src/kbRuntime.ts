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

let cachedKb: KbRuntime | null = null;
let kbLoadAttempted = false;

const normalizeToken = (value: string): string => {
  const lowered = value.toLowerCase().trim();
  const cleaned = lowered.replace(/[^a-z0-9_]+/g, "_");
  return cleaned.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
};

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

export const lookupKbFormExplain = (params: {
  ingredientName: string;
  chemicalForm: string | null;
  chemicalFormConfidence: number | null;
  ingredientId?: string | null;
}): string | null => {
  const kb = getKbRuntime();
  if (!kb) return null;
  if (!params.chemicalForm || params.chemicalFormConfidence === null || params.chemicalFormConfidence < 0.6) {
    return null;
  }

  const ingredientKey = normalizeToken(params.ingredientName);
  const ingredientId = params.ingredientId ?? kb.ingredientNameIndex[ingredientKey];
  if (!ingredientId) return null;

  const token = normalizeToken(params.chemicalForm);
  let formKey: string | null = null;

  const byIngredient = kb.alias.byIngredient?.[ingredientId];
  formKey = pickBestAlias(byIngredient?.[token]) ?? null;

  if (!formKey) {
    formKey = pickBestAlias(kb.alias.global?.[token]) ?? null;
  }

  if (!formKey) {
    formKey = kb.reverseTokenIndex[token] ?? null;
  }

  if (!formKey) return null;
  const entry = kb.runtime.ingredient_form_index?.[`${ingredientId}|${formKey}`];
  const sentence = extractSegmentText(entry);
  return sentence ?? null;
};
