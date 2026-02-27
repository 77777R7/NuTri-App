import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { supabase } from "../src/supabase.js";
import {
  collectExplicitFormTokensWithRules,
  loadParsingTokenRules,
  type ParsingTokenRules,
} from "../src/formTaxonomy/parsingTokenRules.js";
import {
  dedupeSeedRows,
  normalizeFormKey,
  type SeedRow,
} from "../src/ingredientFormsSeedUtils.js";

type ScoreSource = "lnhpd" | "dsld";

type TargetEntry = {
  ingredientId: string;
  ingredientName?: string | null;
  canonicalKey?: string | null;
  formRowCount?: number;
  inR1?: boolean;
  inTopN?: boolean;
};

type TargetsFile = {
  summary?: {
    sources?: unknown;
  };
  targets?: TargetEntry[];
};

type ProductIngredientRow = {
  id: string | null;
  ingredient_id: string | null;
  name_raw: string | null;
  form_raw: string | null;
};

type ReviewedFormRecord = {
  form_key?: unknown;
  form_display?: unknown;
  relative_factor?: unknown;
  overall_confidence?: unknown;
  evidence_grade?: unknown;
  reference_ids?: unknown;
};

type ReviewedPackage = {
  indexes?: {
    forms_by_ingredient?: Record<string, Record<string, ReviewedFormRecord>>;
  };
};

const args = process.argv.slice(2);
const getArg = (flag: string): string | null => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const targetsPath = getArg("targets");
if (!targetsPath) {
  throw new Error("[ingredient-forms-seed] --targets is required");
}

const explicitMaxPerIngredient = Math.max(1, Number(getArg("explicit-max-per-ingredient") ?? "3"));
const explicitMinHits = Math.max(1, Number(getArg("explicit-min-hits") ?? "1"));
const pageSize = Math.min(1000, Math.max(1, Number(getArg("page-size") ?? "1000")));
const labelScanLimitPerIngredient = Math.max(
  1,
  Number(getArg("label-scan-limit-per-ingredient") ?? "4000"),
);

const outputPath = getArg("output") ?? path.join(path.dirname(targetsPath), "seed.jsonl");
const summaryPath =
  getArg("summary-output") ?? path.join(path.dirname(outputPath), "seed_summary.json");

const toStringOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
const toNumberOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const normalizeEvidenceGrade = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const grade = value.trim().toUpperCase();
  return grade || null;
};

const toTitle = (value: string): string =>
  value
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const DEFAULT_EXPLICIT_DENYLIST = [
  "leaf",
  "root",
  "seed",
  "bark",
  "flower",
  "herb",
  "extract",
  "powder",
  "ep",
  "pe",
  "std",
  "standardized",
  "standardised",
];

const HIGH_CONFIDENCE_EXPLICIT_KEYS = new Set([
  "citrate",
  "glycinate",
  "bisglycinate",
  "picolinate",
  "gluconate",
  "sulfate",
  "chloride",
  "carbonate",
  "nitrate",
  "phosphate",
  "malate",
  "threonate",
  "taurate",
  "oxide",
  "succinate",
  "acetate",
  "ascorbate",
  "hcl",
  "hydrochloride",
  "methylfolate",
  "folic_acid",
  "5_mthf",
  "methylcobalamin",
  "cyanocobalamin",
  "hydroxocobalamin",
  "adenosylcobalamin",
  "d3_cholecalciferol",
  "d2_ergocalciferol",
  "ubiquinone",
  "ubiquinol",
  "p5p",
  "pyridoxine_hcl",
  "thiamine_hcl",
  "riboflavin_5_phosphate",
]);

const explicitDenylistArg = getArg("explicit-denylist");
const explicitDenylist = new Set(
  (explicitDenylistArg
    ? explicitDenylistArg.split(",").map((item) => item.trim())
    : DEFAULT_EXPLICIT_DENYLIST
  )
    .map((token) => normalizeFormKey(token))
    .filter(Boolean),
);

const normalizeLooseText = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const hasExplicitAsFormPattern = (source: string, token: string): boolean => {
  const normalizedSource = normalizeLooseText(source);
  if (!normalizedSource) return false;
  const tokenText = normalizeLooseText(token.replace(/_/g, " "));
  if (!tokenText) return false;
  const asNeedles = [
    `as ${tokenText}`,
    `from ${tokenText}`,
    `as a ${tokenText}`,
    `as an ${tokenText}`,
    `(${tokenText})`,
  ];
  if (asNeedles.some((needle) => normalizedSource.includes(needle))) return true;
  return /\((?:as|from)\s+[^\)]+\)/i.test(source) && normalizedSource.includes(tokenText);
};

const isHighConfidenceExplicitToken = (token: string): boolean => {
  if (HIGH_CONFIDENCE_EXPLICIT_KEYS.has(token)) return true;
  return /(citrate|glycinate|picolinate|gluconate|sulfate|chloride|carbonate|phosphate|malate|taurate|oxide|hcl)$/.test(
    token,
  );
};

const ensureDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  await mkdir(dir, { recursive: true });
};

const readJson = async <T>(filePath: string): Promise<T> => {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
};

const readTargets = async (filePath: string): Promise<{ sources: ScoreSource[]; targets: TargetEntry[] }> => {
  const payload = await readJson<TargetsFile>(filePath);
  const targets = Array.isArray(payload.targets) ? payload.targets : [];
  const sourceValues = Array.isArray(payload.summary?.sources) ? payload.summary?.sources : [];
  const sources = sourceValues
    .map((value) => (typeof value === "string" ? value.trim().toLowerCase() : ""))
    .filter((value): value is ScoreSource => value === "lnhpd" || value === "dsld");
  return {
    sources: Array.from(new Set(sources.length ? sources : ["lnhpd", "dsld"])),
    targets,
  };
};

const findReviewedPath = async (): Promise<string> => {
  const candidates = [
    path.join(process.cwd(), "data", "reviewed", "reviewed-form-explains-v4.json"),
    path.join(process.cwd(), "backend", "data", "reviewed", "reviewed-form-explains-v4.json"),
  ];
  for (const candidate of candidates) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await readFile(candidate, "utf8");
      return candidate;
    } catch {
      // continue
    }
  }
  throw new Error("[ingredient-forms-seed] reviewed-form-explains-v4.json not found");
};

const findReviewedOverridesPath = async (): Promise<string | null> => {
  const envPath = toStringOrNull(process.env.REVIEWED_FORM_EXPLAINS_OVERRIDES_PATH);
  const candidates = [
    envPath,
    path.join(process.cwd(), "data", "reviewed", "reviewed-form-explains-overrides.v1.json"),
    path.join(process.cwd(), "backend", "data", "reviewed", "reviewed-form-explains-overrides.v1.json"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const candidate of candidates) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await readFile(candidate, "utf8");
      return candidate;
    } catch {
      // continue
    }
  }
  return null;
};

const mergeFormsByIngredient = (
  base: Record<string, Record<string, ReviewedFormRecord>>,
  overrides: Record<string, Record<string, ReviewedFormRecord>>,
): Record<string, Record<string, ReviewedFormRecord>> => {
  const out: Record<string, Record<string, ReviewedFormRecord>> = {};
  for (const [ingredientKey, forms] of Object.entries(base)) {
    out[ingredientKey] = { ...(forms ?? {}) };
  }
  for (const [ingredientKey, forms] of Object.entries(overrides)) {
    out[ingredientKey] = {
      ...(out[ingredientKey] ?? {}),
      ...(forms ?? {}),
    };
  }
  return out;
};

const fetchLabelRowsByIngredient = async (
  ingredientIds: string[],
  sources: ScoreSource[],
  scanLimitPerIngredient: number,
): Promise<{
  rows: ProductIngredientRow[];
  truncatedIngredientIds: string[];
  timedOutIngredientIds: string[];
}> => {
  const out: ProductIngredientRow[] = [];
  const truncatedIngredientIds: string[] = [];
  const timedOutIngredientIds: string[] = [];

  for (const ingredientId of ingredientIds) {
    let cursor: string | null = null;
    let scannedForIngredient = 0;
    while (true) {
      let query = supabase
        .from("product_ingredients")
        .select("id,ingredient_id,name_raw,form_raw")
        .in("source", sources)
        .eq("is_active", true)
        .eq("ingredient_id", ingredientId)
        .order("id", { ascending: true })
        .limit(pageSize);
      if (cursor) {
        query = query.gt("id", cursor as never);
      }
      // eslint-disable-next-line no-await-in-loop
      const { data, error } = await query;
      if (error) {
        const code = typeof error.code === "string" ? error.code : null;
        const message = typeof error.message === "string" ? error.message : "";
        if (code === "57014" || /statement timeout/i.test(message)) {
          timedOutIngredientIds.push(ingredientId);
          break;
        }
        throw error;
      }
      const rows = (data ?? []) as ProductIngredientRow[];
      if (!rows.length) break;

      const remaining = Math.max(0, scanLimitPerIngredient - scannedForIngredient);
      if (!remaining) {
        truncatedIngredientIds.push(ingredientId);
        break;
      }
      const acceptedRows = rows.slice(0, remaining);
      out.push(...acceptedRows);
      scannedForIngredient += acceptedRows.length;

      if (scannedForIngredient >= scanLimitPerIngredient) {
        truncatedIngredientIds.push(ingredientId);
        break;
      }
      if (rows.length < pageSize) break;
      const nextCursor = rows[rows.length - 1]?.id ?? null;
      if (!nextCursor || nextCursor === cursor) break;
      cursor = nextCursor;
    }
  }
  return {
    rows: out,
    truncatedIngredientIds: Array.from(new Set(truncatedIngredientIds)),
    timedOutIngredientIds: Array.from(new Set(timedOutIngredientIds)),
  };
};

const resolveTargetOrigin = (target: TargetEntry): SeedRow["target_origin"] => {
  const inR1 = Boolean(target.inR1);
  const inTopN = Boolean(target.inTopN);
  if (inR1 && inTopN) return "r1+topn";
  if (inR1) return "r1";
  return "topn";
};

const buildExplicitTokenIndex = (
  rows: ProductIngredientRow[],
  rules: ParsingTokenRules,
): Map<string, Map<string, { count: number; refs: string[]; asFormHits: number }>> => {
  const byIngredient = new Map<string, Map<string, { count: number; refs: string[]; asFormHits: number }>>();

  rows.forEach((row) => {
    const ingredientId = row.ingredient_id;
    if (!ingredientId) return;
    const sourceValues = [row.form_raw, row.name_raw].filter(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    );
    if (!sourceValues.length) return;
    const bucket = byIngredient.get(ingredientId) ?? new Map<string, { count: number; refs: string[]; asFormHits: number }>();

    sourceValues.forEach((sourceValue) => {
      const tokens = collectExplicitFormTokensWithRules([sourceValue], rules)
        .map((token) => normalizeFormKey(token))
        .filter(Boolean);
      tokens.forEach((token) => {
        const entry = bucket.get(token) ?? { count: 0, refs: [], asFormHits: 0 };
        entry.count += 1;
        if (hasExplicitAsFormPattern(sourceValue, token)) {
          entry.asFormHits += 1;
        }
        if (entry.refs.length < 5 && !entry.refs.includes(sourceValue)) {
          entry.refs.push(sourceValue);
        }
        bucket.set(token, entry);
      });
    });
    byIngredient.set(ingredientId, bucket);
  });

  return byIngredient;
};

const buildExplicitWhitelist = (rules: ParsingTokenRules): Set<string> => {
  const whitelist = new Set<string>();
  rules.formRawTokens.forEach((token) => {
    const normalized = normalizeFormKey(token);
    if (normalized) whitelist.add(normalized);
  });
  rules.tokenMatchers.forEach((matcher) => {
    const normalized = normalizeFormKey(matcher.token);
    if (normalized) whitelist.add(normalized);
  });
  return whitelist;
};

const run = async () => {
  const { sources, targets } = await readTargets(targetsPath);
  const targetList = targets.filter((row) => typeof row.ingredientId === "string" && row.ingredientId.trim().length > 0);
  const ingredientIds = Array.from(new Set(targetList.map((row) => row.ingredientId.trim())));

  if (!ingredientIds.length) {
    await ensureDir(outputPath);
    await writeFile(outputPath, "", "utf8");
    const emptySummary = {
      generatedAt: new Date().toISOString(),
      targetsPath,
      outputPath,
      reviewedPath: null,
      reviewedOverridesPath: null,
      sources,
      targetIngredients: 0,
      reviewedIngredientCount: 0,
      reviewedOverridesIngredientCount: 0,
      productIngredientRowsScanned: 0,
      explicitMaxPerIngredient,
      explicitMinHits,
      explicitWhitelistSize: 0,
      explicitDenylistSize: explicitDenylist.size,
      explicitDroppedByWhitelistCount: 0,
      explicitDroppedByWhitelistTop: [],
      labelScanLimitPerIngredient,
      truncatedIngredientCount: 0,
      truncatedIngredientIds: [],
      explicitQueryTimeoutIngredientCount: 0,
      explicitQueryTimeoutIngredientIds: [],
      explicitQuality: {
        acceptedCount: 0,
        deniedGenericCount: 0,
        downgradedToUnspecifiedCount: 0,
        denylistTokens: Array.from(explicitDenylist.values()).sort((a, b) => a.localeCompare(b)),
        deniedGenericTop: [],
        deniedByQualityGateCount: 0,
        deniedByQualityGateTop: [],
      },
      seedRowsRaw: 0,
      seedRowsFinal: 0,
      layerCountsRaw: {},
      layerCountsFinal: {},
      emptyTargetSet: true,
    };
    await ensureDir(summaryPath);
    await writeFile(summaryPath, JSON.stringify(emptySummary, null, 2), "utf8");
    console.log("[ingredient-forms-seed] targets=0 rowsRaw=0 rowsFinal=0 emptyTargetSet=true");
    console.log(`[ingredient-forms-seed] output=${outputPath}`);
    console.log(`[ingredient-forms-seed] summary=${summaryPath}`);
    return;
  }

  const reviewedPath = await findReviewedPath();
  const reviewed = await readJson<ReviewedPackage>(reviewedPath);
  const reviewedOverridesPath = await findReviewedOverridesPath();
  const reviewedOverrides = reviewedOverridesPath
    ? await readJson<ReviewedPackage>(reviewedOverridesPath)
    : null;
  const formsByIngredient = mergeFormsByIngredient(
    reviewed.indexes?.forms_by_ingredient ?? {},
    reviewedOverrides?.indexes?.forms_by_ingredient ?? {},
  );

  const [rules, labelScan] = await Promise.all([
    loadParsingTokenRules(),
    fetchLabelRowsByIngredient(ingredientIds, sources, labelScanLimitPerIngredient),
  ]);
  const ingredientRows = labelScan.rows;

  const explicitIndex = buildExplicitTokenIndex(ingredientRows, rules);
  const explicitWhitelist = buildExplicitWhitelist(rules);
  const explicitTimedOutSet = new Set(labelScan.timedOutIngredientIds);
  const explicitDroppedByWhitelist = new Map<string, number>();
  const explicitDeniedGeneric = new Map<string, number>();
  const explicitDeniedQualityGate = new Map<string, number>();
  let explicitAcceptedCount = 0;
  let explicitDowngradedToUnspecifiedCount = 0;

  const seedRowsRaw: SeedRow[] = [];

  targetList.forEach((target) => {
    const ingredientId = target.ingredientId.trim();
    const origin = resolveTargetOrigin(target);
    const canonicalKey = toStringOrNull(target.canonicalKey);

    const reviewedForms = canonicalKey ? formsByIngredient[canonicalKey] : null;
    if (reviewedForms && typeof reviewedForms === "object") {
      Object.values(reviewedForms).forEach((formRecord) => {
        const formKey = normalizeFormKey(toStringOrNull(formRecord.form_key) ?? "");
        if (!formKey) return;
        const formLabel =
          toStringOrNull(formRecord.form_display) ??
          toTitle(formKey);
        const refsRaw = Array.isArray(formRecord.reference_ids)
          ? formRecord.reference_ids
              .map((item) => toStringOrNull(item))
              .filter((item): item is string => Boolean(item))
          : [];
        seedRowsRaw.push({
          ingredient_id: ingredientId,
          form_key: formKey,
          form_label: formLabel,
          relative_factor: toNumberOrNull(formRecord.relative_factor) ?? 1,
          confidence: clamp(toNumberOrNull(formRecord.overall_confidence) ?? 0.75, 0, 1),
          evidence_grade: normalizeEvidenceGrade(formRecord.evidence_grade),
          audit_status: "verified",
          source_layer: "reviewed_package",
          quality_gate: "passed",
          source_reason: canonicalKey
            ? `reviewed_package:forms_by_ingredient:${canonicalKey}`
            : "reviewed_package:forms_by_ingredient",
          target_origin: origin,
          source_refs: refsRaw,
        });
      });
    }

    const explicitTokenBucket = explicitIndex.get(ingredientId) ?? null;
    const explicitRowsRaw = explicitTokenBucket
      ? Array.from(explicitTokenBucket.entries())
          .sort((a, b) => b[1].count - a[1].count)
          .filter(([, meta]) => meta.count >= explicitMinHits)
      : [];

    const explicitAcceptedRows: Array<[string, { count: number; refs: string[]; asFormHits: number }]> = [];
    explicitRowsRaw.forEach(([token, meta]) => {
      if (!explicitWhitelist.has(token)) {
        explicitDroppedByWhitelist.set(
          token,
          (explicitDroppedByWhitelist.get(token) ?? 0) + 1,
        );
        return;
      }
      if (explicitDenylist.has(token)) {
        explicitDeniedGeneric.set(token, (explicitDeniedGeneric.get(token) ?? 0) + 1);
        return;
      }
      if (meta.asFormHits <= 0 && !isHighConfidenceExplicitToken(token)) {
        explicitDeniedQualityGate.set(token, (explicitDeniedQualityGate.get(token) ?? 0) + 1);
        return;
      }
      explicitAcceptedRows.push([token, meta]);
    });

    explicitAcceptedRows.slice(0, explicitMaxPerIngredient).forEach(([token, meta]) => {
      explicitAcceptedCount += 1;
      seedRowsRaw.push({
        ingredient_id: ingredientId,
        form_key: token,
        form_label: toTitle(token),
        relative_factor: 1,
        confidence: 0.9,
        evidence_grade: "B",
        audit_status: "verified",
        source_layer: "explicit_as_form",
        quality_gate: "passed",
        source_reason: `explicit_as_form:token=${token}:hits=${meta.count}:as_hits=${meta.asFormHits}`,
        target_origin: origin,
        source_refs: meta.refs,
      });
    });

    const hasTierSignal = seedRowsRaw.some(
      (row) => row.ingredient_id === ingredientId && (row.source_layer === "reviewed_package" || row.source_layer === "explicit_as_form"),
    );

    if (!hasTierSignal) {
      const downgradedByQualityGate = explicitRowsRaw.length > 0 && explicitAcceptedRows.length === 0;
      if (downgradedByQualityGate) {
        explicitDowngradedToUnspecifiedCount += 1;
      }
      seedRowsRaw.push({
        ingredient_id: ingredientId,
        form_key: "unspecified",
        form_label: "Unspecified form",
        relative_factor: 1,
        confidence: 0.2,
        evidence_grade: "D",
        audit_status: "derived",
        source_layer: "unspecified_fallback",
        quality_gate: downgradedByQualityGate ? "downgraded" : "passed",
        source_reason: explicitTimedOutSet.has(ingredientId)
          ? "fallback_when_no_reviewed_or_explicit_timeout"
          : downgradedByQualityGate
            ? "fallback_after_explicit_quality_gate"
          : "fallback_when_no_reviewed_or_explicit_match",
        target_origin: origin,
        source_refs: [],
      });
    }
  });

  const seedRows = dedupeSeedRows(seedRowsRaw);
  const lines = seedRows.map((row) => JSON.stringify(row)).join("\n");
  await ensureDir(outputPath);
  await writeFile(outputPath, `${lines}${lines ? "\n" : ""}`, "utf8");

  const layerCountsRaw = seedRowsRaw.reduce<Record<string, number>>((acc, row) => {
    acc[row.source_layer] = (acc[row.source_layer] ?? 0) + 1;
    return acc;
  }, {});
  const layerCountsFinal = seedRows.reduce<Record<string, number>>((acc, row) => {
    acc[row.source_layer] = (acc[row.source_layer] ?? 0) + 1;
    return acc;
  }, {});

  const summary = {
    generatedAt: new Date().toISOString(),
    targetsPath,
    outputPath,
    reviewedPath,
    reviewedOverridesPath,
    sources,
    targetIngredients: ingredientIds.length,
    reviewedIngredientCount: Object.keys(reviewed.indexes?.forms_by_ingredient ?? {}).length,
    reviewedOverridesIngredientCount: Object.keys(
      reviewedOverrides?.indexes?.forms_by_ingredient ?? {},
    ).length,
    productIngredientRowsScanned: ingredientRows.length,
    explicitMaxPerIngredient,
    explicitMinHits,
    explicitWhitelistSize: explicitWhitelist.size,
    explicitDenylistSize: explicitDenylist.size,
    explicitDroppedByWhitelistCount: Array.from(explicitDroppedByWhitelist.values()).reduce(
      (sum, value) => sum + value,
      0,
    ),
    explicitDroppedByWhitelistTop: Array.from(explicitDroppedByWhitelist.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([formKey, count]) => ({ formKey, count })),
    labelScanLimitPerIngredient,
    truncatedIngredientCount: labelScan.truncatedIngredientIds.length,
    truncatedIngredientIds: labelScan.truncatedIngredientIds,
    explicitQueryTimeoutIngredientCount: labelScan.timedOutIngredientIds.length,
    explicitQueryTimeoutIngredientIds: labelScan.timedOutIngredientIds,
    explicitQuality: {
      acceptedCount: explicitAcceptedCount,
      deniedGenericCount: Array.from(explicitDeniedGeneric.values()).reduce((sum, value) => sum + value, 0),
      downgradedToUnspecifiedCount: explicitDowngradedToUnspecifiedCount,
      denylistTokens: Array.from(explicitDenylist.values()).sort((a, b) => a.localeCompare(b)),
      deniedGenericTop: Array.from(explicitDeniedGeneric.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([formKey, count]) => ({ formKey, count })),
      deniedByQualityGateCount: Array.from(explicitDeniedQualityGate.values()).reduce(
        (sum, value) => sum + value,
        0,
      ),
      deniedByQualityGateTop: Array.from(explicitDeniedQualityGate.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([formKey, count]) => ({ formKey, count })),
    },
    seedRowsRaw: seedRowsRaw.length,
    seedRowsFinal: seedRows.length,
    layerCountsRaw,
    layerCountsFinal,
  };

  await ensureDir(summaryPath);
  await writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf8");

  console.log(
    `[ingredient-forms-seed] targets=${ingredientIds.length} rowsRaw=${seedRowsRaw.length} rowsFinal=${seedRows.length}`,
  );
  console.log(`[ingredient-forms-seed] output=${outputPath}`);
  console.log(`[ingredient-forms-seed] summary=${summaryPath}`);
};

run().catch((error) => {
  console.error("[ingredient-forms-seed] failed:", error);
  process.exit(1);
});
