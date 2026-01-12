import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { supabase } from "../src/supabase.js";
import { extractErrorMeta, withRetry } from "../src/supabaseRetry.js";

type RootCauseSummary = {
  zeroCoverageCount: number;
  summary: {
    counts: Record<string, number>;
    ratios: Record<string, number>;
  };
};

type TaxonomySummary = {
  ratios?: {
    taxonomyMismatchAmongResolved?: number;
    formRawMissingAmongResolved?: number;
  };
};

type BackfillSummary = {
  failed?: number;
  processed?: number;
  scores?: number;
};

type RunlistSummary = {
  topIngredients?: {
    ingredientId: string;
    canonicalKey?: string | null;
    name?: string | null;
    count?: number;
  }[];
};

type IngredientMetaRow = {
  id: string;
  canonical_key: string | null;
  name: string | null;
};

type IngredientFormRow = {
  ingredient_id: string;
  form_key: string;
};

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const TOP_K = Math.max(1, Number(getArg("top-k") ?? "20"));
const MIN_COUNT = Math.max(1, Number(getArg("min-count") ?? "10"));
const OUT_DIR = getArg("out-dir") ?? "output/formraw/topk_gate";
const BATCH = Math.max(1, Number(getArg("batch") ?? "100"));
const CONCURRENCY = Math.max(1, Number(getArg("concurrency") ?? "2"));

const backendDir =
  path.basename(process.cwd()) === "backend"
    ? process.cwd()
    : path.join(process.cwd(), "backend");

const resolveOutPath = (value: string) =>
  path.isAbsolute(value) ? value : path.join(backendDir, value);

const outDirAbs = resolveOutPath(OUT_DIR);

const runlistPath = path.join(outDirAbs, "topk_formraw_missing.jsonl");
const runlistSummaryPath = path.join(outDirAbs, "topk_formraw_missing_summary.json");
const sourceIdsOutput = path.join(outDirAbs, "topk_formraw_missing_source_ids.json");
const beforePath = path.join(outDirAbs, "before_root_causes.json");
const afterPath = path.join(outDirAbs, "after_root_causes.json");
const comparePath = path.join(outDirAbs, "topk_compare.json");
const rebackfillSummaryPath = path.join(outDirAbs, "topk_rebackfill_summary.json");
const taxonomyBeforeDir = path.join(outDirAbs, "taxonomy_before");
const taxonomyAfterDir = path.join(outDirAbs, "taxonomy_after");
const taxonomyBeforeSummary = path.join(taxonomyBeforeDir, "mismatch_summary_lnhpd.json");
const taxonomyAfterSummary = path.join(taxonomyAfterDir, "mismatch_summary_lnhpd.json");

const ensureDir = async (dir: string) => {
  await mkdir(dir, { recursive: true });
};

const runCmd = async (cmd: string, cmdArgs: string[]) => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, {
      cwd: backendDir,
      stdio: "inherit",
      env: process.env,
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${cmdArgs.join(" ")} exited with ${code}`));
    });
  });
};

const readJson = async <T>(filePath: string): Promise<T> => {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
};

const calculateRatioDelta = (before: number | null, after: number | null): number | null => {
  if (before == null || after == null || before === 0) return null;
  return (before - after) / before;
};

const chunkArray = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

const readSourceIds = async (filePath: string): Promise<string[]> => {
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) {
    return parsed.filter((value) => typeof value === "string" && value.length > 0);
  }
  if (parsed && Array.isArray(parsed.sourceIds)) {
    return parsed.sourceIds.filter((value: unknown) => typeof value === "string" && value.length > 0);
  }
  return [];
};

const SALT_FORM_KEYS = [
  "citrate",
  "gluconate",
  "sulfate",
  "carbonate",
  "chloride",
  "oxide",
  "picolinate",
  "bisglycinate",
  "malate",
  "threonate",
];

const VITAMIN_D_KEYS = [
  "cholecalciferol",
  "ergocalciferol",
  "d3_cholecalciferol",
  "d2_ergocalciferol",
];
const VITAMIN_B12_KEYS = [
  "methylcobalamin",
  "cyanocobalamin",
  "hydroxocobalamin",
  "adenosylcobalamin",
];
const VITAMIN_B6_KEYS = ["pyridoxine_hcl", "p5p"];
const VITAMIN_C_KEYS = ["ascorbic_acid", "sodium_ascorbate", "calcium_ascorbate"];
const COQ10_KEYS = ["ubiquinone", "ubiquinol"];
const MINERAL_KEYWORDS = [
  "magnesium",
  "calcium",
  "zinc",
  "iron",
  "copper",
  "manganese",
  "selenium",
  "chromium",
  "potassium",
  "iodine",
  "boron",
];

const resolveFormKeysForIngredient = (row: IngredientMetaRow): string[] => {
  const canonicalKey = (row.canonical_key ?? "").toLowerCase();
  const name = (row.name ?? "").toLowerCase();
  const has = (value: string) =>
    canonicalKey.includes(value) || name.includes(value);
  const keys = new Set<string>();

  if (has("coenzyme_q10") || has("coq10") || name.includes("coenzyme q10")) {
    COQ10_KEYS.forEach((key) => keys.add(key));
  }
  if (has("vitamin_d") || name.includes("vitamin d")) {
    VITAMIN_D_KEYS.forEach((key) => keys.add(key));
  }
  if (
    has("vitamin_b12") ||
    name.includes("vitamin b12") ||
    name.includes("cobalamin") ||
    name.includes("b12")
  ) {
    VITAMIN_B12_KEYS.forEach((key) => keys.add(key));
  }
  if (has("vitamin_b6") || name.includes("vitamin b6") || name.includes("pyridoxine")) {
    VITAMIN_B6_KEYS.forEach((key) => keys.add(key));
  }
  if (has("vitamin_c") || name.includes("vitamin c") || name.includes("ascorbic")) {
    VITAMIN_C_KEYS.forEach((key) => keys.add(key));
  }
  if (MINERAL_KEYWORDS.some((keyword) => has(keyword))) {
    SALT_FORM_KEYS.forEach((key) => keys.add(key));
  }

  return Array.from(keys);
};

const ensureLabelVerifiedForms = async (
  topIngredients: RunlistSummary["topIngredients"] | undefined,
): Promise<{
  formsInserted: number;
  ingredientsTouched: number;
}> => {
  const ingredientIds = (topIngredients ?? [])
    .map((entry) => entry.ingredientId)
    .filter((id): id is string => Boolean(id));
  if (!ingredientIds.length) {
    return { formsInserted: 0, ingredientsTouched: 0 };
  }

  const { data: ingredientData, error: ingredientError, status: ingredientStatus, rayId: ingredientRay } =
    await withRetry(() =>
      supabase
        .from("ingredients")
        .select("id,canonical_key,name")
        .in("id", ingredientIds),
    );
  if (ingredientError) {
    const meta = extractErrorMeta(ingredientError, ingredientStatus ?? null, ingredientRay ?? null);
    throw new Error(`[topk-gate] ingredient fetch failed: ${meta.message ?? "unknown"}`);
  }
  const ingredientRows = (ingredientData ?? []) as IngredientMetaRow[];

  const { data: formData, error: formError, status: formStatus, rayId: formRay } = await withRetry(() =>
    supabase
      .from("ingredient_forms")
      .select("ingredient_id,form_key")
      .in("ingredient_id", ingredientIds),
  );
  if (formError) {
    const meta = extractErrorMeta(formError, formStatus ?? null, formRay ?? null);
    throw new Error(`[topk-gate] form fetch failed: ${meta.message ?? "unknown"}`);
  }

  const existingForms = new Map<string, Set<string>>();
  ((formData ?? []) as IngredientFormRow[]).forEach((row) => {
    if (!row.ingredient_id || !row.form_key) return;
    const bucket = existingForms.get(row.ingredient_id) ?? new Set<string>();
    bucket.add(row.form_key);
    existingForms.set(row.ingredient_id, bucket);
  });

  const inserts: Record<string, unknown>[] = [];
  ingredientRows.forEach((row) => {
    const requiredKeys = resolveFormKeysForIngredient(row);
    if (!requiredKeys.length) return;
    const existing = existingForms.get(row.id) ?? new Set<string>();
    requiredKeys.forEach((key) => {
      if (existing.has(key)) return;
      inserts.push({
        ingredient_id: row.id,
        form_key: key,
        form_label: key.replace(/_/g, " ").trim(),
        relative_factor: 1,
        confidence: 0.7,
        evidence_grade: "D",
        audit_status: "verified",
      });
    });
  });

  if (!inserts.length) {
    return { formsInserted: 0, ingredientsTouched: 0 };
  }

  const { error: insertError, status: insertStatus, rayId: insertRay } = await withRetry(() =>
    supabase
      .from("ingredient_forms")
      .upsert(inserts, { onConflict: "ingredient_id,form_key" }),
  );
  if (insertError) {
    const meta = extractErrorMeta(insertError, insertStatus ?? null, insertRay ?? null);
    throw new Error(`[topk-gate] form insert failed: ${meta.message ?? "unknown"}`);
  }

  const touchedIngredientIds = new Set(inserts.map((row) => row.ingredient_id as string));
  return { formsInserted: inserts.length, ingredientsTouched: touchedIngredientIds.size };
};

const countFormRawMissing = async (sourceIds: string[]): Promise<number> => {
  let total = 0;
  for (const chunk of chunkArray(sourceIds, 200)) {
    const { data, error, status, rayId } = await withRetry(async () => {
      const { count, error: queryError, status: queryStatus } = await supabase
        .from("product_ingredients")
        .select("id", { count: "exact", head: true })
        .eq("source", "lnhpd")
        .in("source_id", chunk)
        .not("ingredient_id", "is", null)
        .or("form_raw.is.null,form_raw.eq.\"\"");
      return { data: { count: count ?? 0 }, error: queryError, status: queryStatus };
    });
    if (error) {
      const meta = extractErrorMeta(error, status ?? null, rayId ?? null);
      throw new Error(`[topk-gate] form_raw count failed: ${meta.message ?? "unknown"}`);
    }
    const countValue = (data as { count?: number } | null)?.count ?? 0;
    total += countValue;
  }
  return total;
};

const run = async () => {
  await ensureDir(outDirAbs);

  await runCmd("npx", [
    "tsx",
    "scripts/build-top-formraw-missing-rebackfill-lnhpd.ts",
    "--top-k",
    String(TOP_K),
    "--min-count",
    String(MIN_COUNT),
    "--output",
    runlistPath,
    "--source-ids-output",
    sourceIdsOutput,
    "--summary-json",
    runlistSummaryPath,
  ]);

  const runlistSummary = await readJson<RunlistSummary>(runlistSummaryPath);

  await runCmd("npx", [
    "tsx",
    "scripts/diagnose-zero-coverage-root-causes.ts",
    "--source",
    "lnhpd",
    "--source-ids-file",
    sourceIdsOutput,
    "--output",
    beforePath,
  ]);

  await runCmd("npx", [
    "tsx",
    "scripts/diagnose-form-taxonomy-mismatch.ts",
    "--source",
    "lnhpd",
    "--source-ids-file",
    sourceIdsOutput,
    "--out-dir",
    taxonomyBeforeDir,
    "--top-n",
    "50",
  ]);

  const { formsInserted, ingredientsTouched } = await ensureLabelVerifiedForms(
    runlistSummary.topIngredients,
  );

  const cohortSourceIds = await readSourceIds(sourceIdsOutput);
  const formRawMissingBeforeCount = cohortSourceIds.length
    ? await countFormRawMissing(cohortSourceIds)
    : 0;

  await runCmd("npx", [
    "tsx",
    "scripts/backfill-v4-scores.ts",
    "--failures-input",
    runlistPath,
    "--failures-force",
    "--batch",
    String(BATCH),
    "--concurrency",
    String(CONCURRENCY),
    "--summary-json",
    rebackfillSummaryPath,
  ]);

  const formRawMissingAfterCount = cohortSourceIds.length
    ? await countFormRawMissing(cohortSourceIds)
    : 0;
  const formRawUpdatedCount = Math.max(
    0,
    formRawMissingBeforeCount - formRawMissingAfterCount,
  );

  await runCmd("npx", [
    "tsx",
    "scripts/diagnose-zero-coverage-root-causes.ts",
    "--source",
    "lnhpd",
    "--source-ids-file",
    sourceIdsOutput,
    "--output",
    afterPath,
  ]);

  await runCmd("npx", [
    "tsx",
    "scripts/diagnose-form-taxonomy-mismatch.ts",
    "--source",
    "lnhpd",
    "--source-ids-file",
    sourceIdsOutput,
    "--out-dir",
    taxonomyAfterDir,
    "--top-n",
    "50",
  ]);

  await runCmd("npx", [
    "tsx",
    "scripts/compare-zero-coverage-root-causes.ts",
    "--before",
    beforePath,
    "--after",
    afterPath,
    "--output",
    comparePath,
  ]);

  const before = await readJson<RootCauseSummary>(beforePath);
  const after = await readJson<RootCauseSummary>(afterPath);
  const compare = await readJson<Record<string, unknown>>(comparePath);
  const backfillSummary = await readJson<BackfillSummary>(rebackfillSummaryPath);
  const taxonomyBefore = await readJson<TaxonomySummary>(taxonomyBeforeSummary);
  const taxonomyAfter = await readJson<TaxonomySummary>(taxonomyAfterSummary);

  const mismatchBefore = before.summary?.counts?.mismatch ?? 0;
  const mismatchAfter = after.summary?.counts?.mismatch ?? 0;
  const zeroCoverageBefore = before.zeroCoverageCount ?? 0;
  const zeroCoverageAfter = after.zeroCoverageCount ?? 0;

  const mismatchDeltaRatio = calculateRatioDelta(mismatchBefore, mismatchAfter);
  const zeroCoverageDeltaRatio = calculateRatioDelta(zeroCoverageBefore, zeroCoverageAfter);

  const formRawMissingBefore =
    taxonomyBefore.ratios?.formRawMissingAmongResolved ?? null;
  const formRawMissingAfter =
    taxonomyAfter.ratios?.formRawMissingAmongResolved ?? null;
  const formRawMissingDeltaRatio = calculateRatioDelta(
    formRawMissingBefore,
    formRawMissingAfter,
  );

  const taxonomyMismatchAfter =
    taxonomyAfter.ratios?.taxonomyMismatchAmongResolved ?? null;

  const failures = backfillSummary.failed ?? 0;
  const formRawUpdatedOk = formRawUpdatedCount > 0;
  const improvementPassed =
    (mismatchDeltaRatio != null && mismatchDeltaRatio >= 0.2) ||
    (zeroCoverageDeltaRatio != null && zeroCoverageDeltaRatio >= 0.1) ||
    (formRawMissingDeltaRatio != null && formRawMissingDeltaRatio >= 0.2);

  const gateResult = {
    failuresOk: failures === 0,
    taxonomyMismatchOk:
      taxonomyMismatchAfter == null ? false : taxonomyMismatchAfter <= 0.08,
    improvementOk: improvementPassed,
    formRawUpdatedOk,
  };

  const gatePayload = {
    runlist: {
      path: runlistPath,
      summaryPath: runlistSummaryPath,
      sourceIdsOutput,
    },
    formsPromotion: {
      formsInserted,
      ingredientsTouched,
    },
    formRawUpdateCounts: {
      beforeMissing: formRawMissingBeforeCount,
      afterMissing: formRawMissingAfterCount,
      updatedCount: formRawUpdatedCount,
    },
    backfillSummary,
    before: {
      zeroCoverageCount: zeroCoverageBefore,
      mismatchCount: mismatchBefore,
      formRawMissingAmongResolved: formRawMissingBefore,
    },
    after: {
      zeroCoverageCount: zeroCoverageAfter,
      mismatchCount: mismatchAfter,
      formRawMissingAmongResolved: formRawMissingAfter,
      taxonomyMismatchAmongResolved: taxonomyMismatchAfter,
    },
    delta: {
      mismatchDeltaRatio,
      zeroCoverageDeltaRatio,
      formRawMissingDeltaRatio,
    },
    compare,
    gates: {
      ...gateResult,
      pass:
        gateResult.failuresOk &&
        gateResult.taxonomyMismatchOk &&
        gateResult.improvementOk &&
        gateResult.formRawUpdatedOk,
    },
  };

  const gatePath = path.join(outDirAbs, "topk_gate_result.json");
  await writeFile(gatePath, JSON.stringify(gatePayload, null, 2), "utf8");
  console.log(JSON.stringify({ output: gatePath, gates: gatePayload.gates }, null, 2));
};

run().catch((error) => {
  console.error("[topk-gate] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
