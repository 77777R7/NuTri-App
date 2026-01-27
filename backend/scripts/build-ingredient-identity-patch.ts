import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { supabase } from "../src/supabase.js";

type MissingIngredientEntry = {
  nameKey: string;
  count: number;
  sourceCount: number;
  nameRawSamples?: string[];
  sourceIdSamples?: string[];
};

type MissingIngredientSummary = {
  source: string;
  idColumn: string;
  sampleSize: number;
  activeMissingRows: number;
  uniqueMissingKeys: number;
  generatedAt: string;
};

type MissingIngredientPayload = {
  summary: MissingIngredientSummary;
  topMissing: MissingIngredientEntry[];
};

type IngredientRow = {
  id: string;
  canonical_key: string | null;
  name: string | null;
  category: string | null;
  unit: string | null;
};

type AutoApplyEntry = {
  nameKey: string;
  count: number;
  sourceCount: number;
  nameRawSamples: string[];
  sourceIdSamples: string[];
  ingredientId: string;
  canonicalKey: string | null;
  ingredientName: string | null;
  mappingType:
    | "canonical_key"
    | "ingredient_name"
    | "constrained"
    | "new_canonical"
    | "mineral_form";
  confidence: number;
  reason: string;
  constraints?: string[] | null;
};

type ManualReviewEntry = {
  nameKey: string;
  count: number;
  sourceCount: number;
  nameRawSamples: string[];
  sourceIdSamples: string[];
  reason: string;
};

type IngredientPatchRecord = {
  ingredient_id: string;
  ingredient: string;
  category?: string | null;
  base_unit?: string | null;
  synonyms?: string[];
};

const args = process.argv.slice(2);
const getArg = (name: string): string | null => {
  const prefix = `--${name}=`;
  const arg = args.find((value) => value.startsWith(prefix));
  if (arg) return arg.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  if (index !== -1) {
    const next = args[index + 1];
    if (next && !next.startsWith("--")) return next;
  }
  return null;
};

const inputPath =
  getArg("input") ?? "output/ingredient-identity/lnhpd_missing_ingredient_top.json";
const topN = Math.max(1, Number(getArg("top-n") ?? "50"));
const importTopN = Math.max(1, Number(getArg("top-import-n") ?? "20"));
const outDir = getArg("out-dir") ?? "output/ingredient-identity";
const fishOilMode = (getArg("fish-oil-mode") ?? "skip").toLowerCase();
const sourceIdsFile = getArg("source-ids-file");
const idColumn = (getArg("id-column") ?? "canonical_source_id").toLowerCase();
const missingOutputArg = getArg("missing-output");
const patchOutputArg = getArg("patch-output");

const ensureDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  await mkdir(dir, { recursive: true });
};

const normalizeText = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const normalizeCanonicalKey = (value: string): string =>
  value.toLowerCase().replace(/[_\s]+/g, " ").trim();

const normalizeUnit = (unit?: string | null, unitKind?: string | null): string | null => {
  const raw = (unit ?? "").trim().toLowerCase();
  const kind = (unitKind ?? "").trim().toLowerCase();
  if (kind === "cfu" || raw.includes("cfu")) return "cfu";
  if (kind === "iu" || raw === "iu") return "iu";
  if (raw === "ug") return "mcg";
  if (raw === "mcg") return "mcg";
  if (raw === "mg") return "mg";
  if (raw === "g") return "g";
  return null;
};

const dedupeSynonyms = (values: string[]) => {
  const seen = new Set<string>();
  const output: string[] = [];
  values
    .map((value) => value.trim())
    .filter(Boolean)
    .forEach((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      output.push(value);
    });
  return output;
};

const FOOD_POWDER_PHRASES = [
  "carica papaya",
  "mangifera indica",
  "citrus reticulata",
  "lycopersicon esculentum",
  "solanum lycopersicum",
  "zea mays",
  "raphanus sativus",
];
const FOOD_POWDER_TOKENS = new Set([
  "mango",
  "papaya",
  "mandarin",
  "tomato",
  "corn",
  "radish",
]);

const isFoodPowder = (value: string): boolean => {
  const normalized = normalizeText(value);
  if (!normalized) return false;
  if (FOOD_POWDER_PHRASES.some((phrase) => normalized.includes(phrase))) {
    return true;
  }
  const tokens = new Set(normalized.split(/\s+/).filter(Boolean));
  return Array.from(tokens).some((token) => FOOD_POWDER_TOKENS.has(token));
};

const isAnimalSource = (value: string): boolean => {
  const lowered = value.toLowerCase();
  return [
    "porcine",
    "bovine",
    "ovine",
    "sus scrofa",
    "cervus",
    "seal",
    "elk",
    "deer",
    "gland",
    "cartilage",
  ].some((token) => lowered.includes(token));
};

const isExcipientOrMetal = (value: string): boolean => {
  const lowered = value.toLowerCase();
  return [
    "ethyl alcohol",
    "ethanol",
    "titanium dioxide",
    "silicon dioxide",
    "tin",
    "propylene glycol",
    "glycerin",
    "magnesium stearate",
  ].some((token) => lowered.includes(token));
};

const MICROBE_GENUS = new Set([
  "lactobacillus",
  "bifidobacterium",
  "streptococcus",
  "bacillus",
  "saccharomyces",
  "lactococcus",
  "enterococcus",
  "pediococcus",
  "propionibacterium",
]);

const isMicrobeName = (
  value: string,
  samples: string[],
  unitHint?: Map<string, number>,
): boolean => {
  if ((unitHint?.get("cfu") ?? 0) > 0) return true;
  const lowered = value.toLowerCase();
  if (Array.from(MICROBE_GENUS).some((token) => lowered.includes(token))) return true;
  return samples.some((sample) =>
    Array.from(MICROBE_GENUS).some((token) => sample.toLowerCase().includes(token)),
  );
};

const FORM_TOKENS = new Set([
  "citrate",
  "oxide",
  "gluconate",
  "sulfate",
  "carbonate",
  "chloride",
  "phosphate",
  "picolinate",
  "bisglycinate",
  "glycinate",
  "malate",
  "taurate",
  "threonate",
  "chelate",
  "acetate",
]);

const MINERAL_CANONICAL_MAP: Array<{ tokens: string[]; keys: string[] }> = [
  { tokens: ["zinc", "zincum"], keys: ["zinc"] },
  { tokens: ["ferrum", "iron"], keys: ["iron"] },
  { tokens: ["natrum", "sodium"], keys: ["sodium", "sodium_chloride"] },
  { tokens: ["kalium", "potassium"], keys: ["potassium"] },
  { tokens: ["magnesium"], keys: ["magnesium"] },
  { tokens: ["calcium"], keys: ["calcium"] },
  { tokens: ["cuprum", "copper"], keys: ["copper"] },
  { tokens: ["silicea", "silica", "silicon"], keys: ["silica", "silicon"] },
  { tokens: ["phosphorus"], keys: ["phosphorus"] },
  { tokens: ["chromium"], keys: ["chromium"] },
  { tokens: ["manganese"], keys: ["manganese"] },
  { tokens: ["iodine"], keys: ["iodine"] },
  { tokens: ["molybdenum"], keys: ["molybdenum"] },
  { tokens: ["boron"], keys: ["boron"] },
  { tokens: ["vanadium"], keys: ["vanadium"] },
  { tokens: ["nickel"], keys: ["nickel"] },
];

const NON_BOTANICAL_TOKENS = new Set([
  "vitamin",
  "acid",
  "protein",
  "oil",
  "extract",
  "powder",
  "root",
  "leaf",
  "seed",
  "concentrate",
  "isolate",
  "dioxide",
  "citrate",
  "oxide",
  "gluconate",
  "sulfate",
  "chloride",
  "phosphate",
  "picolinate",
  "bisglycinate",
  "glycinate",
  "malate",
  "taurate",
  "threonate",
  "chelate",
  "acetate",
  "elemental",
]);

const CURATED_SYNONYM_MAP: Record<
  string,
  {
    keys: string[];
    reason: string;
    confidence?: number;
    category?: string;
    baseUnit?: string;
  }
> = {
  "3 pyridinecarboxamide": {
    keys: ["nicotinamide", "niacinamide", "vitamin_b3"],
    reason: "curated_niacinamide",
  },
  "2 5 cyclohexadiene 1 4 dione 2 2e 6e 10e 14e 18e 22e 26e 30e 34e 3 7 11 15 19 23 27 31 35 39 decamethyl 2 6 10 14 18 22 26 30 34 38 tetracontadecaenyl 5 6 dimethoxy 3 methyl":
    {
      keys: ["coenzyme_q10", "ubiquinone", "coq10"],
      reason: "curated_coq10",
    },
  "2 amino 2 deoxy d glucose sulfate": {
    keys: ["glucosamine_sulfate", "glucosamine"],
    reason: "curated_glucosamine_sulfate",
  },
  "2 aminoethanesulfonic acid": {
    keys: ["taurine"],
    reason: "curated_taurine",
  },
  "n acetyl 5 methoxytryptamine": {
    keys: ["melatonin"],
    reason: "curated_melatonin",
  },
  "n 2 5 methoxy 1h indol 3 yl ethyl acetamide": {
    keys: ["melatonin"],
    reason: "curated_melatonin_alt",
  },
  "1 3 7 trimethylxanthine": {
    keys: ["caffeine"],
    reason: "curated_caffeine",
  },
  "n aminoiminomethyl n methylglycine monohydrate": {
    keys: ["creatine_monohydrate", "creatine"],
    reason: "curated_creatine",
  },
  "dimethyl sulfone": {
    keys: ["msm", "methylsulfonylmethane"],
    reason: "curated_msm",
  },
  "1 2 3 5 4 6 hexahydroxycyclohexane": {
    keys: ["inositol", "myo_inositol"],
    reason: "curated_inositol",
  },
  "2 hydroxy n n n trimethylethanaminium": {
    keys: ["choline", "choline_bitartrate"],
    reason: "curated_choline",
  },
  "beta aminopropionic acid": {
    keys: ["beta_alanine"],
    reason: "curated_beta_alanine",
  },
  "3 3 4 5 7 pentahydroxyflavone": {
    keys: ["quercetin"],
    reason: "curated_quercetin",
  },
  "1e 6e 1 7 bis 4 hydroxy 3 methoxyphenyl 1 6 heptadiene 3 5 dione": {
    keys: ["curcumin"],
    reason: "curated_curcumin",
  },
  dmae: {
    keys: ["dmae", "dimethylaminoethanol"],
    reason: "curated_dmae",
    category: "chemical",
  },
  "uva ursi": {
    keys: ["uva_ursi", "bearberry"],
    reason: "curated_uva_ursi",
    category: "botanical",
  },
  kelp: {
    keys: ["kelp"],
    reason: "curated_kelp",
    category: "botanical",
  },
  "vanadyl sulfate": {
    keys: ["vanadium", "vanadyl_sulfate"],
    reason: "curated_vanadyl_sulfate",
    category: "mineral",
  },
  "total omega 3 fatty acids": {
    keys: ["omega_3", "omega_3_fatty_acids"],
    reason: "curated_total_omega3",
    category: "lipid",
  },
  vinpocetine: {
    keys: ["vinpocetine"],
    reason: "curated_vinpocetine",
    category: "chemical",
  },
  "shark cartilage": {
    keys: ["shark_cartilage"],
    reason: "curated_shark_cartilage",
    category: "animal",
  },
};

const LATIN_BINOMIAL_STRICT_RE =
  /^([A-Z][a-z]+)\s+([a-z]{2,})(?:\s+(?:var\.?|subsp\.?|ssp\.?|f\.?|cv\.?|×|x)\s+([a-z]{2,}))?$/;

const LATIN_SECOND_WORD_STOPLIST = new Set([
  "protein",
  "oil",
  "extract",
  "powder",
  "root",
  "leaf",
  "seed",
  "concentrate",
  "isolate",
  "dioxide",
  "chloride",
  "sulfate",
  "oxide",
  "acid",
]);

const readSourceIds = async (filePath: string): Promise<string[]> => {
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (Array.isArray(parsed)) {
    return parsed.filter((item): item is string => typeof item === "string");
  }
  if (parsed && typeof parsed === "object") {
    const record = parsed as { sourceIds?: unknown };
    if (Array.isArray(record.sourceIds)) {
      return record.sourceIds.filter((item): item is string => typeof item === "string");
    }
  }
  return [];
};

const chunkArray = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

const fetchUnitSamples = async (
  sourceIds: string[],
  sourceColumn: "source_id" | "canonical_source_id",
): Promise<
  Array<{
    name_key: string | null;
    unit: string | null;
    unit_normalized: string | null;
    unit_kind: string | null;
    ingredient_id: string | null;
    is_active: boolean;
  }>
> => {
  const rows: Array<{
    name_key: string | null;
    unit: string | null;
    unit_normalized: string | null;
    unit_kind: string | null;
    ingredient_id: string | null;
    is_active: boolean;
  }> = [];
  for (const chunk of chunkArray(sourceIds, 200)) {
    const { data, error } = await supabase
      .from("product_ingredients")
      .select("name_key,unit,unit_normalized,unit_kind,ingredient_id,is_active")
      .eq("source", "lnhpd")
      .in(sourceColumn, chunk);
    if (error) throw error;
    rows.push(...((data ?? []) as typeof rows));
  }
  return rows;
};

const titleCase = (value: string): string =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");

const fetchIngredients = async (): Promise<IngredientRow[]> => {
  const { data, error } = await supabase
    .from("ingredients")
    .select("id,canonical_key,name,category,unit");
  if (error) throw error;
  return (data ?? []) as IngredientRow[];
};

const buildLookup = (rows: IngredientRow[]) => {
  const canonicalMap = new Map<string, IngredientRow>();
  const nameMap = new Map<string, IngredientRow[]>();
  const canonicalKeyIndex = new Map<string, IngredientRow>();

  rows.forEach((row) => {
    if (row.canonical_key) {
      canonicalKeyIndex.set(row.canonical_key, row);
      const normalized = normalizeCanonicalKey(row.canonical_key);
      if (!canonicalMap.has(normalized)) {
        canonicalMap.set(normalized, row);
      }
    }
    if (row.name) {
      const normalized = normalizeText(row.name);
      if (!normalized) return;
      const bucket = nameMap.get(normalized) ?? [];
      bucket.push(row);
      nameMap.set(normalized, bucket);
    }
  });

  return { canonicalMap, nameMap, canonicalKeyIndex };
};

const readMissingPayload = async (filePath: string): Promise<MissingIngredientPayload> => {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as MissingIngredientPayload;
};

const buildCsv = (rows: ManualReviewEntry[]): string => {
  const header = [
    "nameKey",
    "count",
    "sourceCount",
    "nameRawSamples",
    "sourceIdSamples",
    "reason",
  ];
  const lines = [header.join(",")];
  rows.forEach((row) => {
    const values = [
      row.nameKey,
      String(row.count),
      String(row.sourceCount),
      `"${row.nameRawSamples.join(" | ").replace(/\"/g, '""')}"`,
      `"${row.sourceIdSamples.join(" | ").replace(/\"/g, '""')}"`,
      row.reason,
    ];
    lines.push(values.join(","));
  });
  return lines.join("\n");
};

const run = async () => {
  const payload = await readMissingPayload(inputPath);
  const totalMissing = payload.summary.activeMissingRows || 0;
  const topMissing = payload.topMissing.slice(0, topN);
  const importCandidates = payload.topMissing.slice(0, importTopN);
  const { canonicalMap, nameMap, canonicalKeyIndex } = buildLookup(await fetchIngredients());
  const sourceColumn =
    idColumn === "source_id" ? "source_id" : ("canonical_source_id" as const);

  const topMissingKeySet = new Set(
    topMissing.map((entry) => normalizeText(entry.nameKey)),
  );
  const unitCounts = new Map<string, Map<string, number>>();
  if (sourceIdsFile) {
    const sourceIds = await readSourceIds(sourceIdsFile);
    if (sourceIds.length) {
      const rows = await fetchUnitSamples(sourceIds, sourceColumn);
      rows.forEach((row) => {
        if (!row.is_active || row.ingredient_id) return;
        const key = normalizeText(row.name_key ?? "");
        if (!key || !topMissingKeySet.has(key)) return;
        const unit = normalizeUnit(row.unit_normalized ?? row.unit, row.unit_kind);
        if (!unit) return;
        const bucket = unitCounts.get(key) ?? new Map<string, number>();
        bucket.set(unit, (bucket.get(unit) ?? 0) + 1);
        unitCounts.set(key, bucket);
      });
    }
  }

  const inferBaseUnit = (nameKey: string): string => {
    const bucket = unitCounts.get(nameKey);
    if (!bucket) return "mg";
    const candidates = ["cfu", "iu", "mcg", "mg", "g"];
    for (const unit of candidates) {
      if ((bucket.get(unit) ?? 0) > 0) return unit;
    }
    return "mg";
  };

  const autoApply: AutoApplyEntry[] = [];
  const manualQueue: ManualReviewEntry[] = [];
  const importPatchRecords: IngredientPatchRecord[] = [];
  let cumulative = 0;

  const enrichedTop = topMissing.map((entry) => {
    cumulative += entry.count;
    const cumulativeCoverage = totalMissing
      ? Number((cumulative / totalMissing).toFixed(4))
      : 0;
    return {
      ...entry,
      cumulativeCount: cumulative,
      cumulativeCoverage,
    };
  });

  const resolveCanonicalFromKeys = (keys: string[]): IngredientRow | null => {
    for (const key of keys) {
      const match = canonicalKeyIndex.get(key);
      if (match) return match;
    }
    return null;
  };

  const resolveCuratedSynonym = (nameKey: string) => {
    const rule = CURATED_SYNONYM_MAP[nameKey];
    if (!rule) return null;
    return {
      rule,
      match: resolveCanonicalFromKeys(rule.keys),
    };
  };

  const isMineralLike = (nameKey: string): boolean => {
    const tokens = new Set(nameKey.split(/\s+/).filter(Boolean));
    return MINERAL_CANONICAL_MAP.some((rule) =>
      rule.tokens.some((token) => tokens.has(token)),
    );
  };

  const mergePatchRecords = (
    records: IngredientPatchRecord[],
  ): IngredientPatchRecord[] => {
    const grouped = new Map<string, IngredientPatchRecord[]>();
    records.forEach((record) => {
      const key = record.ingredient_id;
      const bucket = grouped.get(key) ?? [];
      bucket.push(record);
      grouped.set(key, bucket);
    });

    const pickUnit = (entries: IngredientPatchRecord[]): string | undefined => {
      const totals = new Map<string, number>();
      const addCounts = (key: string) => {
        const bucket = unitCounts.get(key);
        if (!bucket) return;
        bucket.forEach((count, unit) => {
          totals.set(unit, (totals.get(unit) ?? 0) + count);
        });
      };

      entries.forEach((entry) => {
        if (entry.ingredient) addCounts(normalizeText(entry.ingredient));
        (entry.synonyms ?? []).forEach((syn) => addCounts(normalizeText(syn)));
      });

      if (totals.size === 0) {
        return entries.find((entry) => entry.base_unit)?.base_unit;
      }

      let bestUnit: string | undefined;
      let bestCount = -1;
      totals.forEach((count, unit) => {
        if (count > bestCount) {
          bestUnit = unit;
          bestCount = count;
        }
      });
      return bestUnit;
    };

    const merged: IngredientPatchRecord[] = [];
    grouped.forEach((entries, ingredientId) => {
      const existing = canonicalKeyIndex.get(ingredientId);
      const ingredient =
        existing?.name ?? entries.find((entry) => entry.ingredient)?.ingredient ?? ingredientId;
      const entryCategory = entries.find((entry) => entry.category)?.category ?? undefined;
      const baseUnit = existing?.unit ?? pickUnit(entries);
      const category = existing ? existing.category ?? undefined : entryCategory;
      const synonyms = dedupeSynonyms(
        entries.flatMap((entry) => entry.synonyms ?? []),
      );
      merged.push({
        ingredient_id: ingredientId,
        ingredient,
        category,
        base_unit: baseUnit,
        synonyms,
      });
    });
    return merged;
  };

  const matchMineralCanonical = (nameKey: string): IngredientRow | null => {
    const tokens = new Set(nameKey.split(/\s+/).filter(Boolean));
    for (const rule of MINERAL_CANONICAL_MAP) {
      if (!rule.tokens.some((token) => tokens.has(token))) continue;
      const match = resolveCanonicalFromKeys(rule.keys);
      if (match) return match;
    }
    return null;
  };

  const queueSynonymPatch = (params: {
    canonicalKey: string | null;
    ingredientName: string | null;
    synonyms: string[];
    category?: string | null;
    baseUnit?: string | null;
  }) => {
    if (!params.canonicalKey) return;
    const synonyms = dedupeSynonyms(params.synonyms);
    if (!synonyms.length) return;
    importPatchRecords.push({
      ingredient_id: params.canonicalKey,
      ingredient:
        params.ingredientName ??
        titleCase(params.canonicalKey.replace(/_/g, " ")),
      category: params.category ?? undefined,
      base_unit: params.baseUnit ?? undefined,
      synonyms,
    });
  };

  const resolveLatinBinomial = (
    nameKey: string,
    samples: string[],
  ): { canonicalKey: string; displayName: string } | null => {
    if (!samples.length) return null;
    if (nameKey.split(/\s+/).some((token) => NON_BOTANICAL_TOKENS.has(token))) return null;
    for (const sample of samples) {
      const cleaned = sample
        .replace(/[()[\]{}]/g, " ")
        .replace(/[^A-Za-z\s×x.]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const match = cleaned.match(LATIN_BINOMIAL_STRICT_RE);
      if (!match) continue;
      const genus = match[1];
      const species = match[2].toLowerCase();
      if (LATIN_SECOND_WORD_STOPLIST.has(species)) continue;
      if (MICROBE_GENUS.has(genus.toLowerCase())) continue;
      const canonicalKey = `${genus}_${species}`.toLowerCase();
      return { canonicalKey, displayName: `${genus} ${species}` };
    }
    return null;
  };

  topMissing.forEach((entry) => {
    const nameKey = normalizeText(entry.nameKey);
    const nameRawSamples = entry.nameRawSamples ?? [];
    const sourceIdSamples = entry.sourceIdSamples ?? [];
    if (!nameKey) return;

    const curated = resolveCuratedSynonym(nameKey);
    if (curated) {
      if (curated.match) {
        autoApply.push({
          nameKey,
          count: entry.count,
          sourceCount: entry.sourceCount,
          nameRawSamples,
          sourceIdSamples,
          ingredientId: curated.match.id,
          canonicalKey: curated.match.canonical_key ?? null,
          ingredientName: curated.match.name ?? null,
          mappingType: "curated_synonym",
          confidence: curated.rule.confidence ?? 0.9,
          reason: curated.rule.reason,
        });
        queueSynonymPatch({
          canonicalKey: curated.match.canonical_key ?? null,
          ingredientName: curated.match.name ?? null,
          synonyms: [entry.nameKey, ...nameRawSamples],
        });
      } else {
        const preferredKey = curated.rule.keys[0] ?? nameKey.replace(/\s+/g, "_");
        autoApply.push({
          nameKey,
          count: entry.count,
          sourceCount: entry.sourceCount,
          nameRawSamples,
          sourceIdSamples,
          ingredientId: "NEW",
          canonicalKey: preferredKey,
          ingredientName: titleCase(preferredKey.replace(/_/g, " ")),
          mappingType: "new_canonical",
          confidence: curated.rule.confidence ?? 0.9,
          reason: "curated_create_canonical",
          constraints: ["create_canonical_for_curated_synonym"],
        });
        importPatchRecords.push({
          ingredient_id: preferredKey,
          ingredient: titleCase(preferredKey.replace(/_/g, " ")),
          category: curated.rule.category ?? "chemical",
          base_unit: curated.rule.baseUnit ?? inferBaseUnit(nameKey),
          synonyms: dedupeSynonyms([entry.nameKey, ...nameRawSamples]),
        });
      }
      return;
    }

    const canonicalMatch = canonicalMap.get(nameKey);

    if (canonicalMatch) {
      autoApply.push({
        nameKey,
        count: entry.count,
        sourceCount: entry.sourceCount,
        nameRawSamples,
        sourceIdSamples,
        ingredientId: canonicalMatch.id,
        canonicalKey: canonicalMatch.canonical_key ?? null,
        ingredientName: canonicalMatch.name ?? null,
        mappingType: "canonical_key",
        confidence: 0.98,
        reason: "canonical_key_match",
      });
      queueSynonymPatch({
        canonicalKey: canonicalMatch.canonical_key ?? null,
        ingredientName: canonicalMatch.name ?? null,
        synonyms: [entry.nameKey, ...nameRawSamples],
      });
      return;
    }

    const nameMatches = nameMap.get(nameKey) ?? [];
    if (nameMatches.length === 1) {
      const match = nameMatches[0];
      autoApply.push({
        nameKey,
        count: entry.count,
        sourceCount: entry.sourceCount,
        nameRawSamples,
        sourceIdSamples,
        ingredientId: match.id,
        canonicalKey: match.canonical_key ?? null,
        ingredientName: match.name ?? null,
        mappingType: "ingredient_name",
        confidence: 0.95,
        reason: "ingredient_name_match",
      });
      queueSynonymPatch({
        canonicalKey: match.canonical_key ?? null,
        ingredientName: match.name ?? null,
        synonyms: [entry.nameKey, ...nameRawSamples],
      });
      return;
    }

    if (nameKey === "fish oil") {
      const fishOil =
        canonicalKeyIndex.get("fish_oil") ?? canonicalKeyIndex.get("omega_3");
      if (fishOil && fishOilMode === "omega3") {
        autoApply.push({
          nameKey,
          count: entry.count,
          sourceCount: entry.sourceCount,
          nameRawSamples,
          sourceIdSamples,
          ingredientId: fishOil.id,
          canonicalKey: fishOil.canonical_key ?? null,
          ingredientName: fishOil.name ?? null,
          mappingType: "constrained",
          confidence: 0.85,
          reason: "constrained_mapping_fish_oil",
          constraints: ["only_apply_when_name_key_is_fish_oil"],
        });
        queueSynonymPatch({
          canonicalKey: fishOil.canonical_key ?? null,
          ingredientName: fishOil.name ?? null,
          synonyms: [entry.nameKey, ...nameRawSamples],
        });
        return;
      }
      if (fishOilMode === "canonical") {
        autoApply.push({
          nameKey,
          count: entry.count,
          sourceCount: entry.sourceCount,
          nameRawSamples,
          sourceIdSamples,
          ingredientId: fishOil?.id ?? "NEW",
          canonicalKey: fishOil?.canonical_key ?? "fish_oil",
          ingredientName: fishOil?.name ?? "Fish Oil",
          mappingType: "constrained",
          confidence: 0.85,
          reason: "constrained_mapping_fish_oil_canonical",
          constraints: ["create_fish_oil_canonical_if_missing"],
        });
        if (fishOil?.canonical_key) {
          queueSynonymPatch({
            canonicalKey: fishOil.canonical_key ?? null,
            ingredientName: fishOil.name ?? null,
            synonyms: [entry.nameKey, ...nameRawSamples],
          });
        } else {
          importPatchRecords.push({
            ingredient_id: "fish_oil",
            ingredient: "Fish Oil",
            category: "animal",
            base_unit: "mg",
            synonyms: dedupeSynonyms([entry.nameKey, ...nameRawSamples]),
          });
        }
        return;
      }
    }

    if (isFoodPowder(nameKey)) {
      manualQueue.push({
        nameKey,
        count: entry.count,
        sourceCount: entry.sourceCount,
        nameRawSamples,
        sourceIdSamples,
        reason: "food_powder_excluded",
      });
      return;
    }

    if (isExcipientOrMetal(nameKey)) {
      manualQueue.push({
        nameKey,
        count: entry.count,
        sourceCount: entry.sourceCount,
        nameRawSamples,
        sourceIdSamples,
        reason: "excipient_excluded",
      });
      return;
    }

    if (isMicrobeName(nameKey, nameRawSamples, unitCounts.get(nameKey))) {
      manualQueue.push({
        nameKey,
        count: entry.count,
        sourceCount: entry.sourceCount,
        nameRawSamples,
        sourceIdSamples,
        reason: "microbe_excluded",
      });
      return;
    }

    if (isAnimalSource(nameKey)) {
      manualQueue.push({
        nameKey,
        count: entry.count,
        sourceCount: entry.sourceCount,
        nameRawSamples,
        sourceIdSamples,
        reason: "animal_source_excluded",
      });
      return;
    }

    const mineralMatch = matchMineralCanonical(nameKey);
    if (mineralMatch) {
      autoApply.push({
        nameKey,
        count: entry.count,
        sourceCount: entry.sourceCount,
        nameRawSamples,
        sourceIdSamples,
        ingredientId: mineralMatch.id,
        canonicalKey: mineralMatch.canonical_key ?? null,
        ingredientName: mineralMatch.name ?? null,
        mappingType: "mineral_form",
        confidence: 0.9,
        reason: "mineral_form_match",
      });
      queueSynonymPatch({
        canonicalKey: mineralMatch.canonical_key ?? null,
        ingredientName: mineralMatch.name ?? null,
        synonyms: [entry.nameKey, ...nameRawSamples],
      });
      return;
    }

    if (isMineralLike(nameKey)) {
      manualQueue.push({
        nameKey,
        count: entry.count,
        sourceCount: entry.sourceCount,
        nameRawSamples,
        sourceIdSamples,
        reason: "mineral_no_canonical",
      });
      return;
    }

    const latinBinomial = resolveLatinBinomial(nameKey, nameRawSamples);
    if (latinBinomial) {
      autoApply.push({
        nameKey,
        count: entry.count,
        sourceCount: entry.sourceCount,
        nameRawSamples,
        sourceIdSamples,
        ingredientId: "NEW",
        canonicalKey: latinBinomial.canonicalKey,
        ingredientName: latinBinomial.displayName,
        mappingType: "new_canonical",
        confidence: 0.9,
        reason: "latin_binomial_auto",
        constraints: ["create_botanical_canonical"],
      });
      return;
    }

    const reason =
      nameMatches.length > 1 ? "ambiguous_name_match" : "no_match";
    manualQueue.push({
      nameKey,
      count: entry.count,
      sourceCount: entry.sourceCount,
      nameRawSamples,
      sourceIdSamples,
      reason,
    });
  });

  importCandidates.forEach((entry) => {
    const nameKey = normalizeText(entry.nameKey);
    const nameRawSamples = entry.nameRawSamples ?? [];
    const sourceIdSamples = entry.sourceIdSamples ?? [];
    const canonicalMatch = canonicalMap.get(nameKey);
    const nameMatches = nameMap.get(nameKey) ?? [];
    if (!nameKey) return;

    if (nameKey === "fish oil") {
      if (fishOilMode === "omega3") {
        const omega3 = canonicalKeyIndex.get("omega_3");
        if (omega3) {
          importPatchRecords.push({
            ingredient_id: omega3.canonical_key ?? "omega_3",
            ingredient: omega3.name ?? "Omega-3",
            synonyms: dedupeSynonyms(["Fish oil", ...nameRawSamples]),
          });
        }
      } else if (fishOilMode === "canonical") {
        importPatchRecords.push({
          ingredient_id: "fish_oil",
          ingredient: "Fish Oil",
          category: "lipid",
          base_unit: "mg",
          synonyms: dedupeSynonyms(["Fish oil", ...nameRawSamples]),
        });
      }
      return;
    }

    const curated = resolveCuratedSynonym(nameKey);
    if (curated) {
      if (curated.match) {
        importPatchRecords.push({
          ingredient_id: curated.match.canonical_key ?? curated.match.id,
          ingredient: curated.match.name ?? curated.match.canonical_key ?? nameKey,
          synonyms: dedupeSynonyms(nameRawSamples),
        });
      } else {
        manualQueue.push({
          nameKey,
          count: entry.count,
          sourceCount: entry.sourceCount,
          nameRawSamples,
          sourceIdSamples,
          reason: "curated_no_canonical",
        });
      }
      return;
    }

    if (isFoodPowder(nameKey) || isAnimalSource(nameKey)) {
      return;
    }

    if (
      isExcipientOrMetal(nameKey) ||
      isMicrobeName(nameKey, nameRawSamples, unitCounts.get(nameKey))
    ) {
      manualQueue.push({
        nameKey,
        count: entry.count,
        sourceCount: entry.sourceCount,
        nameRawSamples,
        sourceIdSamples,
        reason: "excluded_non_medicinal",
      });
      return;
    }

    const mineralMatch = matchMineralCanonical(nameKey);
    if (mineralMatch) {
      importPatchRecords.push({
        ingredient_id: mineralMatch.canonical_key ?? nameKey.replace(/\s+/g, "_"),
        ingredient: mineralMatch.name ?? entry.nameKey,
        synonyms: dedupeSynonyms([entry.nameKey, ...nameRawSamples]),
      });
      return;
    }

    if (isMineralLike(nameKey)) {
      return;
    }

    if (canonicalMatch) {
      importPatchRecords.push({
        ingredient_id: canonicalMatch.canonical_key ?? nameKey.replace(/\s+/g, "_"),
        ingredient: canonicalMatch.name ?? entry.nameKey,
        synonyms: dedupeSynonyms([entry.nameKey, ...nameRawSamples]),
      });
      return;
    }

    if (nameMatches.length === 1) {
      const match = nameMatches[0];
      importPatchRecords.push({
        ingredient_id: match.canonical_key ?? nameKey.replace(/\s+/g, "_"),
        ingredient: match.name ?? entry.nameKey,
        synonyms: dedupeSynonyms([entry.nameKey, ...nameRawSamples]),
      });
      return;
    }

    const latinBinomial = resolveLatinBinomial(nameKey, nameRawSamples);
    if (latinBinomial) {
      importPatchRecords.push({
        ingredient_id: latinBinomial.canonicalKey,
        ingredient: latinBinomial.displayName,
        category: "botanical",
        base_unit: inferBaseUnit(nameKey),
        synonyms: dedupeSynonyms([entry.nameKey, ...nameRawSamples]),
      });
    } else {
      manualQueue.push({
        nameKey,
        count: entry.count,
        sourceCount: entry.sourceCount,
        nameRawSamples,
        sourceIdSamples,
        reason: "no_safe_botanical",
      });
    }
  });

  const summary = {
    source: payload.summary.source,
    totalMissingRows: totalMissing,
    topN,
    autoApplyCount: autoApply.length,
    manualCount: manualQueue.length,
    generatedAt: new Date().toISOString(),
  };

  const missingKeysOutput =
    missingOutputArg ?? path.join(outDir, `missing_keys_top${topN}.json`);
  const autoApplyOutput = path.join(outDir, "identity_patch_auto_apply.json");
  const manualOutputJson = path.join(outDir, "identity_manual_review_queue.json");
  const manualOutputCsv = path.join(outDir, "identity_manual_review_queue.csv");
  const bucketStatsOutput = path.join(outDir, "identity_patch_bucket_stats.json");
  const patchOutput =
    patchOutputArg ?? path.join(outDir, `identity_top${importTopN}_import_patch.json`);

  const dedupedPatchRecords = mergePatchRecords(importPatchRecords);

  const bucketStats = {
    autoApply: autoApply.reduce<Record<string, number>>((acc, entry) => {
      acc[entry.mappingType] = (acc[entry.mappingType] ?? 0) + 1;
      return acc;
    }, {}),
    manual: manualQueue.reduce<Record<string, number>>((acc, entry) => {
      acc[entry.reason] = (acc[entry.reason] ?? 0) + 1;
      return acc;
    }, {}),
    categories: {
      botanical: autoApply.filter((entry) => entry.mappingType === "new_canonical").length,
      mineral:
        autoApply.filter((entry) => entry.mappingType === "mineral_form").length +
        manualQueue.filter((entry) => entry.reason === "mineral_no_canonical").length,
      food: manualQueue.filter((entry) => entry.reason === "food_powder_excluded").length,
      animal: manualQueue.filter((entry) => entry.reason === "animal_source_excluded").length,
      chemical: autoApply.filter((entry) => entry.mappingType === "curated_synonym").length,
      excluded: manualQueue.filter((entry) =>
        ["food_powder_excluded", "animal_source_excluded", "no_safe_botanical"].includes(
          entry.reason,
        ),
      ).length,
    },
    totals: {
      autoApply: autoApply.length,
      manual: manualQueue.length,
      patchRecords: dedupedPatchRecords.length,
    },
  };

  await ensureDir(missingKeysOutput);
  await writeFile(
    missingKeysOutput,
    JSON.stringify({ summary, topMissing: enrichedTop }, null, 2),
    "utf8",
  );

  await ensureDir(autoApplyOutput);
  await writeFile(
    autoApplyOutput,
    JSON.stringify({ summary, autoApply }, null, 2),
    "utf8",
  );

  await ensureDir(manualOutputJson);
  await writeFile(
    manualOutputJson,
    JSON.stringify({ summary, manualQueue }, null, 2),
    "utf8",
  );

  await ensureDir(manualOutputCsv);
  await writeFile(manualOutputCsv, buildCsv(manualQueue), "utf8");

  await ensureDir(bucketStatsOutput);
  await writeFile(bucketStatsOutput, JSON.stringify(bucketStats, null, 2), "utf8");

  await ensureDir(patchOutput);
  await writeFile(
    patchOutput,
    JSON.stringify(
      {
        version: "identity_patch_v1",
        generated_at: new Date().toISOString(),
        ingredients: dedupedPatchRecords,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(
    `[identity-patch] topN=${topN} auto=${autoApply.length} manual=${manualQueue.length} out=${outDir}`,
  );
};

run().catch((error) => {
  console.error("[identity-patch] failed:", error);
  process.exit(1);
});
