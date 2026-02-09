import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

type GateConfig = {
  missingMax: number;
  taxonomyMismatchAmongResolvedMax: number;
  changedToEmptyCountMax: number;
  failuresLinesMax: number;
  coverageMin: number;
};

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const RUN_DIR = getArg("run-dir");
const OUT_GATE = getArg("out-gate") ?? null;
const OUT_EVIDENCE = getArg("out-evidence") ?? null;

const gate: GateConfig = {
  missingMax: Number(getArg("missing-max") ?? "0.10"),
  taxonomyMismatchAmongResolvedMax: Number(getArg("mismatch-max") ?? "0.08"),
  changedToEmptyCountMax: Number(getArg("changed-to-empty-max") ?? "0"),
  failuresLinesMax: Number(getArg("failures-lines-max") ?? "0"),
  coverageMin: Number(getArg("coverage-min") ?? "0.80"),
};

const ensureDirForFile = async (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  await mkdir(dir, { recursive: true });
};

const readJson = async <T>(filePath: string): Promise<T> => {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
};

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await readFile(filePath, "utf8");
    return true;
  } catch {
    return false;
  }
};

const extractPartId = (fileName: string): string | null => {
  const match = fileName.match(/^ids_part_(\d+)\.json$/);
  return match?.[1] ?? null;
};

type MissingSummary = {
  summary?: { sampleSize?: number; activeMissingRows?: number };
};

type TaxonomyMismatchSummary = {
  ratios?: { taxonomyMismatchAmongResolved?: number };
  sampleSize?: number;
};

type BackfillSummary = {
  failuresLines?: number;
  scoresTable?: string;
  scoreVersion?: string;
  processed?: number;
  skipped?: number;
  failed?: number;
};

type NonemptyDiffPayload =
  | { changedToEmpty?: number; changedToEmptyCount?: number; totalCompared?: number }
  | { changedToEmptyCount?: number; sampleSize?: number }
  | unknown;

const getChangedToEmptyCount = (payload: NonemptyDiffPayload): number | null => {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as any;
  const value =
    typeof record.changedToEmptyCount === "number"
      ? record.changedToEmptyCount
      : typeof record.changedToEmpty === "number"
        ? record.changedToEmpty
        : null;
  return Number.isFinite(value) ? Number(value) : null;
};

const getNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
};

const computeRatio = (num: number, den: number): number | null => {
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return null;
  return num / den;
};

const run = async () => {
  if (!RUN_DIR) throw new Error("[aggregate-scale] missing --run-dir");

  const runDirAbs = path.resolve(RUN_DIR);
  const outGateAbs = OUT_GATE ? path.resolve(OUT_GATE) : null;
  const outEvidenceAbs = OUT_EVIDENCE ? path.resolve(OUT_EVIDENCE) : null;

  const partsDir = path.join(runDirAbs, "parts");
  const entries = await readdir(partsDir);
  const idsFiles = entries
    .filter((name) => name.startsWith("ids_part_") && name.endsWith(".json"))
    .sort();

  const parts: Record<string, any> = {};
  const evidenceParts: Record<string, any> = {};
  const failingParts: string[] = [];
  const incompleteParts: string[] = [];

  for (const idsFileName of idsFiles) {
    const partId = extractPartId(idsFileName);
    if (!partId) continue;

    const idsPath = path.join(partsDir, idsFileName);
    const partDir = path.join(partsDir, `part_${partId}`);
    const backfillSummaryPath = path.join(partDir, "backfill_summary.json");
    const missingPath = path.join(partDir, "ingredient_id_missing.json");
    const mismatchPath = path.join(partDir, "taxonomy", "mismatch_summary_dsld.json");
    const nonemptyDiffPath = path.join(partDir, "nonempty_diff.json");
    const validIdsPath = path.join(partDir, "valid_ids.json");
    const skippedIdsPath = path.join(partDir, "skipped_ids.json");
    const skippedReasonsPath = path.join(partDir, "skipped_reasons.json");

    evidenceParts[partId] = {
      ids: idsPath,
      backfillSummary: backfillSummaryPath,
      validIds: validIdsPath,
      skippedIds: skippedIdsPath,
      skippedReasons: skippedReasonsPath,
      missingSummary: missingPath,
      taxonomyMismatchSummary: mismatchPath,
      nonemptyDiff: nonemptyDiffPath,
    };

    const required = [
      { key: "backfillSummary", path: backfillSummaryPath },
      { key: "validIds", path: validIdsPath },
      { key: "missingSummary", path: missingPath },
      { key: "taxonomyMismatchSummary", path: mismatchPath },
      { key: "nonemptyDiff", path: nonemptyDiffPath },
    ];

    const missingFiles: Array<{ key: string; path: string }> = [];
    for (const item of required) {
      if (!(await fileExists(item.path))) missingFiles.push(item);
    }

    const inputIds = await readJson<string[]>(idsPath);
    const inputCount = Array.isArray(inputIds) ? inputIds.length : 0;

    if (missingFiles.length) {
      incompleteParts.push(partId);
      parts[partId] = {
        pass: false,
        status: "INCOMPLETE",
        missingFiles,
        inputCount,
      };
      continue;
    }

    const backfill = await readJson<BackfillSummary>(backfillSummaryPath);
    const failuresLines = getNumber(backfill.failuresLines) ?? null;

    const validIds = await readJson<string[]>(validIdsPath);
    const validCount = Array.isArray(validIds) ? validIds.length : 0;
    const coverage = computeRatio(validCount, inputCount) ?? 0;

    const missingSummary = await readJson<MissingSummary>(missingPath);
    const sampleSize = getNumber(missingSummary.summary?.sampleSize) ?? validCount ?? 0;
    const activeMissingRows = getNumber(missingSummary.summary?.activeMissingRows) ?? null;
    const missingRatio =
      activeMissingRows == null ? null : computeRatio(activeMissingRows, sampleSize);

    const mismatchSummary = await readJson<TaxonomyMismatchSummary>(mismatchPath);
    const taxonomyMismatchAmongResolved =
      getNumber(mismatchSummary.ratios?.taxonomyMismatchAmongResolved) ?? null;

    const nonemptyDiff = await readJson<NonemptyDiffPayload>(nonemptyDiffPath);
    const changedToEmptyCount = getChangedToEmptyCount(nonemptyDiff) ?? null;

    const coveragePass = coverage >= gate.coverageMin;
    const missingPass = missingRatio != null && missingRatio <= gate.missingMax;
    const mismatchPass =
      taxonomyMismatchAmongResolved != null &&
      taxonomyMismatchAmongResolved <= gate.taxonomyMismatchAmongResolvedMax;
    const changedToEmptyPass =
      changedToEmptyCount != null && changedToEmptyCount <= gate.changedToEmptyCountMax;
    const failuresPass = failuresLines != null && failuresLines <= gate.failuresLinesMax;

    const pass = coveragePass && missingPass && mismatchPass && changedToEmptyPass && failuresPass;
    if (!pass) failingParts.push(partId);

    parts[partId] = {
      paths: evidenceParts[partId],
      inputCount,
      validCount,
      coverage,
      failuresLines,
      missingRatio,
      activeMissingRows,
      sampleSize,
      taxonomyMismatchAmongResolved,
      changedToEmptyCount,
      gate: {
        coverageMin: gate.coverageMin,
        missingMax: gate.missingMax,
        taxonomyMismatchAmongResolvedMax: gate.taxonomyMismatchAmongResolvedMax,
        changedToEmptyCountMax: gate.changedToEmptyCountMax,
        failuresLinesMax: gate.failuresLinesMax,
      },
      pass,
    };
  }

  const overallPass = failingParts.length === 0 && incompleteParts.length === 0;

  const gateSummary = {
    generatedAt: new Date().toISOString(),
    runDir: runDirAbs,
    gate,
    parts,
    overall: {
      pass: overallPass,
      failingParts,
      incompleteParts,
    },
  };

  const evidencePack = {
    generatedAt: new Date().toISOString(),
    runDir: runDirAbs,
    parts: evidenceParts,
    gateSummaryPath: outGateAbs,
  };

  if (outGateAbs) {
    await ensureDirForFile(outGateAbs);
    await writeFile(outGateAbs, JSON.stringify(gateSummary, null, 2), "utf8");
  }
  if (outEvidenceAbs) {
    await ensureDirForFile(outEvidenceAbs);
    await writeFile(outEvidenceAbs, JSON.stringify(evidencePack, null, 2), "utf8");
  }

  console.log(
    JSON.stringify(
      {
        runDir: runDirAbs,
        parts: Object.keys(parts).length,
        overall: gateSummary.overall,
        outGate: outGateAbs,
        outEvidence: outEvidenceAbs,
      },
      null,
      2,
    ),
  );
};

run().catch((error) => {
  console.error("[aggregate-scale] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
