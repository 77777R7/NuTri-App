import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type SummaryPayload = Record<string, unknown>;
type RatiosPayload = Record<string, unknown>;

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const SUMMARY_PATH = getArg("summary");
const TAXONOMY_PATH = getArg("taxonomy");
const PRECHECK_BEFORE_PATH = getArg("precheck-before");
const PRECHECK_AFTER_PATH = getArg("precheck-after");
const NONEMPTY_DIFF_PATH = getArg("nonempty-diff");
const CANDIDATE_EMPTY_BEFORE_PATH = getArg("candidate-empty-before");
const CANDIDATE_EMPTY_AFTER_PATH = getArg("candidate-empty-after");
const YIELD_PATH = getArg("yield");
const OUTPUT_PATH = getArg("output") ?? "output/orchestrator/chunk_guardrail_summary.json";

const ensureDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  await mkdir(dir, { recursive: true });
};

const readJson = async (filePath: string | null): Promise<SummaryPayload | null> => {
  if (!filePath) return null;
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as SummaryPayload;
};

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const getRatios = (payload: SummaryPayload): RatiosPayload | null => {
  const ratios = (payload as { ratios?: unknown }).ratios;
  if (!ratios || typeof ratios !== "object") return null;
  return ratios as RatiosPayload;
};

const run = async () => {
  if (!SUMMARY_PATH) {
    throw new Error("[guardrail] --summary is required");
  }
  if (!TAXONOMY_PATH) {
    throw new Error("[guardrail] --taxonomy is required");
  }
  if (!PRECHECK_BEFORE_PATH || !PRECHECK_AFTER_PATH) {
    throw new Error("[guardrail] --precheck-before and --precheck-after are required");
  }

  const [
    summary,
    taxonomy,
    preBefore,
    preAfter,
    nonempty,
    yieldReport,
    candidateEmptyBefore,
    candidateEmptyAfter,
  ] =
    await Promise.all([
      readJson(SUMMARY_PATH),
      readJson(TAXONOMY_PATH),
      readJson(PRECHECK_BEFORE_PATH),
      readJson(PRECHECK_AFTER_PATH),
      readJson(NONEMPTY_DIFF_PATH),
      readJson(YIELD_PATH),
      readJson(CANDIDATE_EMPTY_BEFORE_PATH),
      readJson(CANDIDATE_EMPTY_AFTER_PATH),
    ]);

  if (!summary || !taxonomy || !preBefore || !preAfter) {
    throw new Error("[guardrail] required inputs missing or invalid");
  }

  const taxonomyRatios = getRatios(taxonomy);
  const beforeEmpty = toNumber(preBefore.formRawEmptyRows) ?? null;
  const afterEmpty = toNumber(preAfter.formRawEmptyRows) ?? null;
  const beforeNonEmpty = toNumber(preBefore.formRawNonEmptyRows) ?? null;
  const afterNonEmpty = toNumber(preAfter.formRawNonEmptyRows) ?? null;
  const writeYieldDelta =
    beforeEmpty != null && afterEmpty != null ? afterEmpty - beforeEmpty : null;
  const candidateEmptyBeforeCount =
    toNumber(candidateEmptyBefore?.candidateEmptyRows) ??
    (Array.isArray((candidateEmptyBefore as { rows?: unknown })?.rows)
      ? ((candidateEmptyBefore as { rows?: unknown }).rows as unknown[]).length
      : null);
  const candidateEmptyAfterCount =
    toNumber(candidateEmptyAfter?.candidateEmptyRows) ??
    (Array.isArray((candidateEmptyAfter as { rows?: unknown })?.rows)
      ? ((candidateEmptyAfter as { rows?: unknown }).rows as unknown[]).length
      : null);
  const emptyToNonEmptyCandidates =
    toNumber(candidateEmptyAfter?.emptyToNonEmpty) ??
    (Array.isArray((candidateEmptyAfter as { rows?: unknown })?.rows)
      ? ((candidateEmptyAfter as { rows?: unknown }).rows as Array<Record<string, unknown>>)
          .filter((row) => {
            const afterValue = row?.formRawAfter;
            return typeof afterValue === "string" && afterValue.trim().length > 0;
          }).length
      : null);
  const emptyToNonEmpty =
    emptyToNonEmptyCandidates ??
    (beforeEmpty != null && afterEmpty != null ? beforeEmpty - afterEmpty : null);
  const candidateWritableEmptyRows =
    candidateEmptyBeforeCount ??
    toNumber(yieldReport?.candidateWritableEmptyRows) ??
    toNumber(yieldReport?.candidateWritableRows) ??
    null;
  const candidateWritableAlreadyFilledRows =
    toNumber(yieldReport?.candidateWritableAlreadyFilledRows) ?? null;
  const candidateFormRawRows = toNumber(yieldReport?.candidateFormRawRows) ?? null;
  const writeYieldRate =
    emptyToNonEmpty != null &&
    candidateWritableEmptyRows &&
    candidateWritableEmptyRows > 0
      ? Number((emptyToNonEmpty / candidateWritableEmptyRows).toFixed(4))
      : null;
  const writeYieldGateRequired =
    candidateWritableEmptyRows != null && candidateWritableEmptyRows >= 10;
  const writeYieldGatePassed = writeYieldGateRequired
    ? (emptyToNonEmpty ?? 0) >= 1
    : null;

  const payload = {
    source: summary.source ?? null,
    scoreVersion: summary.scoreVersion ?? null,
    startId: summary.startId ?? null,
    lastId: summary.lastId ?? null,
    nextStart: summary.nextStart ?? null,
    processed: summary.processed ?? null,
    failed: summary.failed ?? null,
    failuresLines: summary.failuresLines ?? null,
    taxonomyMismatchAmongResolved:
      taxonomyRatios?.["taxonomyMismatchAmongResolved"] ?? null,
    formRawMissingAmongResolved:
      taxonomyRatios?.["formRawMissingAmongResolved"] ?? null,
    formRawNoMatchAmongResolved:
      taxonomyRatios?.["formRawNoMatchAmongResolved"] ?? null,
    formRawEmptyRowsBefore: beforeEmpty,
    formRawEmptyRowsAfter: afterEmpty,
    formRawNonEmptyRowsBefore: beforeNonEmpty,
    formRawNonEmptyRowsAfter: afterNonEmpty,
    changedToEmpty: nonempty?.changedToEmpty ?? 0,
    candidateFormRawRows,
    candidateWritableEmptyRows,
    candidateWritableAlreadyFilledRows,
    candidateEmptyRowsBefore: candidateEmptyBeforeCount,
    candidateEmptyRowsAfter: candidateEmptyAfterCount,
    writeYieldDelta,
    emptyToNonEmpty,
    writeYieldRate,
    writeYieldGateRequired,
    writeYieldGatePassed,
    inputs: {
      summary: SUMMARY_PATH,
      taxonomy: TAXONOMY_PATH,
      precheckBefore: PRECHECK_BEFORE_PATH,
      precheckAfter: PRECHECK_AFTER_PATH,
      nonemptyDiff: NONEMPTY_DIFF_PATH,
      candidateEmptyBefore: CANDIDATE_EMPTY_BEFORE_PATH,
      candidateEmptyAfter: CANDIDATE_EMPTY_AFTER_PATH,
      yield: YIELD_PATH,
    },
    timestamp: new Date().toISOString(),
  };

  await ensureDir(OUTPUT_PATH);
  await writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2), "utf8");
  console.log(`[guardrail] wrote ${OUTPUT_PATH}`);
};

run().catch((error) => {
  console.error("[guardrail] failed", error);
  process.exit(1);
});
