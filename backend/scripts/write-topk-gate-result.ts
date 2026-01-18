import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type RootCauseSummary = {
  zeroCoverageCount: number;
  summary: {
    counts: Record<string, number>;
  };
};

type TaxonomySummary = {
  ratios?: {
    taxonomyMismatchAmongResolved?: number;
    formRawMissingAmongResolved?: number;
  };
};

type BackfillSummary = {
  processed?: number;
  scores?: number;
  failed?: number;
  ingredientUpsertFailed?: number;
  scoreUpsertFailed?: number;
  computeScoreFailed?: number;
};

type RunlistSummary = {
  totalRunlistLines?: number;
  uniqueSourceIds?: number;
  sourceIdsOutput?: string | null;
};

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const beforePath = getArg("before");
const afterPath = getArg("after");
const taxonomyBeforePath = getArg("taxonomy-before");
const taxonomyAfterPath = getArg("taxonomy-after");
const runlistSummaryPath = getArg("runlist-summary");
const runlistPath = getArg("runlist");
const cohortIdsFile = getArg("source-ids-file");
const summaryDir = getArg("summary-dir");
const outputPath = getArg("output") ?? "output/formraw/topk_gate_result.json";

const readJson = async <T>(filePath: string): Promise<T> => {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
};

const ensureDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  await import("node:fs/promises").then(({ mkdir }) => mkdir(dir, { recursive: true }));
};

const sumSummaries = async (dir: string): Promise<BackfillSummary> => {
  const totals: BackfillSummary = {
    processed: 0,
    scores: 0,
    failed: 0,
    ingredientUpsertFailed: 0,
    scoreUpsertFailed: 0,
    computeScoreFailed: 0,
  };
  const files = await readdir(dir);
  const summaryFiles = files.filter((file) => file.endsWith("_summary.json"));
  for (const file of summaryFiles) {
    const summary = await readJson<BackfillSummary>(path.join(dir, file));
    totals.processed = (totals.processed ?? 0) + (summary.processed ?? 0);
    totals.scores = (totals.scores ?? 0) + (summary.scores ?? 0);
    totals.failed = (totals.failed ?? 0) + (summary.failed ?? 0);
    totals.ingredientUpsertFailed =
      (totals.ingredientUpsertFailed ?? 0) + (summary.ingredientUpsertFailed ?? 0);
    totals.scoreUpsertFailed =
      (totals.scoreUpsertFailed ?? 0) + (summary.scoreUpsertFailed ?? 0);
    totals.computeScoreFailed =
      (totals.computeScoreFailed ?? 0) + (summary.computeScoreFailed ?? 0);
  }
  return totals;
};

const countRunlistLines = async (filePath: string | null): Promise<number> => {
  if (!filePath) return 0;
  const raw = await readFile(filePath, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean).length;
};

const loadIdsFromFile = async (filePath: string | null): Promise<Set<string>> => {
  if (!filePath) return new Set();
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) {
    return new Set(parsed.filter((value) => typeof value === "string" && value.length > 0));
  }
  if (parsed && Array.isArray(parsed.sourceIds)) {
    return new Set(parsed.sourceIds.filter((value: unknown) => typeof value === "string" && value.length > 0));
  }
  return new Set();
};

const checkRunlistSubset = async (
  runlistFile: string | null,
  cohortIdsFilePath: string | null,
): Promise<{ ok: boolean; outOfScope: number }> => {
  if (!runlistFile || !cohortIdsFilePath) return { ok: true, outOfScope: 0 };
  const cohort = await loadIdsFromFile(cohortIdsFilePath);
  if (!cohort.size) return { ok: true, outOfScope: 0 };
  const raw = await readFile(runlistFile, "utf8");
  const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);
  let outOfScope = 0;
  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as { sourceId?: string };
      if (entry?.sourceId && !cohort.has(entry.sourceId)) outOfScope += 1;
    } catch {
      outOfScope += 1;
    }
  }
  return { ok: outOfScope === 0, outOfScope };
};

const ratioDelta = (before: number | null, after: number | null): number | null => {
  if (before == null || after == null || before === 0) return null;
  return (before - after) / before;
};

const run = async () => {
  if (!beforePath || !afterPath || !taxonomyAfterPath || !runlistSummaryPath) {
    throw new Error("Missing required args: --before --after --taxonomy-after --runlist-summary");
  }

  const [before, after, taxonomyAfter, runlistSummary] = await Promise.all([
    readJson<RootCauseSummary>(beforePath),
    readJson<RootCauseSummary>(afterPath),
    readJson<TaxonomySummary>(taxonomyAfterPath),
    readJson<RunlistSummary>(runlistSummaryPath),
  ]);

  const taxonomyBefore = taxonomyBeforePath
    ? await readJson<TaxonomySummary>(taxonomyBeforePath)
    : null;

  const backfillTotals = summaryDir ? await sumSummaries(summaryDir) : null;
  const runlistLines = await countRunlistLines(runlistPath);

  const cohortIdsPath =
    cohortIdsFile ?? (runlistSummary.sourceIdsOutput ?? null);
  const subsetCheck = await checkRunlistSubset(runlistPath, cohortIdsPath);

  const mismatchBefore = before.summary?.counts?.mismatch ?? 0;
  const mismatchAfter = after.summary?.counts?.mismatch ?? 0;
  const zeroCoverageBefore = before.zeroCoverageCount ?? 0;
  const zeroCoverageAfter = after.zeroCoverageCount ?? 0;

  const formRawMissingBefore =
    taxonomyBefore?.ratios?.formRawMissingAmongResolved ?? null;
  const formRawMissingAfter =
    taxonomyAfter?.ratios?.formRawMissingAmongResolved ?? null;
  const taxonomyMismatchAfter =
    taxonomyAfter?.ratios?.taxonomyMismatchAmongResolved ?? null;

  const mismatchDeltaRatio = ratioDelta(mismatchBefore, mismatchAfter);
  const zeroCoverageDeltaRatio = ratioDelta(zeroCoverageBefore, zeroCoverageAfter);
  const formRawMissingDeltaRatio = ratioDelta(formRawMissingBefore, formRawMissingAfter);

  const failures = backfillTotals?.failed ?? 0;
  const improvementPassed =
    (mismatchDeltaRatio != null && mismatchDeltaRatio >= 0.2) ||
    (zeroCoverageDeltaRatio != null && zeroCoverageDeltaRatio >= 0.1) ||
    (formRawMissingDeltaRatio != null && formRawMissingDeltaRatio >= 0.2);

  const gateResult = {
    failuresOk: failures === 0,
    taxonomyMismatchOk:
      taxonomyMismatchAfter == null ? false : taxonomyMismatchAfter <= 0.08,
    improvementOk: improvementPassed,
    runlistLinesOk: runlistLines > 0,
    uniqueSourceIdsOk: (runlistSummary.uniqueSourceIds ?? 0) >= 200,
    runlistSubsetOk: subsetCheck.ok,
  };

  const reasons: string[] = [];
  if (!gateResult.failuresOk) reasons.push("failures_nonzero");
  if (!gateResult.taxonomyMismatchOk) reasons.push("taxonomy_mismatch_threshold");
  if (!gateResult.improvementOk) reasons.push("no_required_improvement");
  if (!gateResult.runlistLinesOk) reasons.push("empty_runlist");
  if (!gateResult.uniqueSourceIdsOk) reasons.push("insufficient_unique_source_ids");
  if (!gateResult.runlistSubsetOk) reasons.push("runlist_out_of_scope");

  const payload = {
    before: {
      zeroCoverageCount: zeroCoverageBefore,
      mismatchCount: mismatchBefore,
      counts: before.summary?.counts ?? {},
    },
    after: {
      zeroCoverageCount: zeroCoverageAfter,
      mismatchCount: mismatchAfter,
      counts: after.summary?.counts ?? {},
    },
    deltas: {
      mismatchDeltaRatio,
      zeroCoverageDeltaRatio,
      formRawMissingDeltaRatio,
    },
    taxonomy: {
      before: taxonomyBefore?.ratios ?? null,
      after: taxonomyAfter?.ratios ?? null,
    },
    runlist: {
      runlistLines,
      runlistSummary: runlistSummaryPath,
      uniqueSourceIds: runlistSummary.uniqueSourceIds ?? 0,
      cohortIdsFile: cohortIdsPath ?? null,
      outOfScopeCount: subsetCheck.outOfScope,
    },
    backfill: backfillTotals,
    gates: {
      ...gateResult,
      pass: reasons.length === 0,
      reasons,
    },
  };

  await ensureDir(outputPath);
  await writeFile(outputPath, JSON.stringify(payload, null, 2), "utf8");
  console.log(JSON.stringify({ output: outputPath, gates: payload.gates }, null, 2));
};

run().catch((error) => {
  console.error("[topk-gate-result] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
