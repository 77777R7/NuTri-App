import { readFile, writeFile } from "node:fs/promises";
import fs from "node:fs/promises";
import path from "node:path";

type GateConfig = {
  coverageMin: number;
  missingMax: number;
  taxonomyMismatchAmongResolvedMax: number;
  changedToEmptyCountMax: number;
  failuresLinesMax: number;
};

type PartPaths = {
  ids: string;
  backfillSummary: string;
  validIds: string;
  skippedIds: string;
  skippedReasons: string;
  missingSummary: string;
  taxonomyMismatchSummary: string;
  nonemptyDiff: string;
};

type PartGateSummary = {
  paths: PartPaths;
  inputCount: number | null;
  validCount: number | null;
  coverage: number | null;
  failuresLines: number | null;
  missingRatio: number | null;
  missingRatioMode: "uniqueMissingKeys/sampleSize" | "activeMissingRows/sampleSize" | null;
  activeMissingRows: number | null;
  uniqueMissingKeys: number | null;
  activeMissingRatio: number | null;
  sampleSize: number | null;
  taxonomyMismatchAmongResolved: number | null;
  changedToEmptyCount: number | null;
  gate: GateConfig;
  pass: boolean;
};

type AggregateSummary = {
  generatedAt: string;
  runDir: string;
  gate: GateConfig;
  overall: {
    pass: boolean;
    failingParts: string[];
    incompleteParts: string[];
  };
  parts: Record<string, PartGateSummary>;
};

type EvidencePack = {
  generatedAt: string;
  runDir: string;
  parts: Record<string, PartPaths>;
  gateSummaryPath: string;
};

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const runDirArg = getArg("run-dir");
const outGateArg = getArg("out-gate");
const outEvidenceArg = getArg("out-evidence");

if (!runDirArg) throw new Error(`[aggregate-scale-run] missing --run-dir`);
if (!outGateArg) throw new Error(`[aggregate-scale-run] missing --out-gate`);
if (!outEvidenceArg) throw new Error(`[aggregate-scale-run] missing --out-evidence`);

const GATE: GateConfig = {
  coverageMin: 0.8,
  missingMax: 0.1,
  taxonomyMismatchAmongResolvedMax: 0.08,
  changedToEmptyCountMax: 0,
  failuresLinesMax: 0,
};

const readJson = async <T>(filePath: string): Promise<T | null> => {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const countJsonArray = async (filePath: string): Promise<number | null> => {
  const data = await readJson<unknown>(filePath);
  return Array.isArray(data) ? data.length : null;
};

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const extractChangedToEmptyCount = (payload: unknown): number | null => {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as {
    changedToEmptyCount?: unknown;
    changedToEmptyRows?: unknown;
    changedToEmpty?: unknown;
  };

  const direct = toNumber(record.changedToEmptyCount);
  if (direct != null) return direct;

  if (Array.isArray(record.changedToEmptyRows)) return record.changedToEmptyRows.length;

  if (typeof record.changedToEmpty === "number" && Number.isFinite(record.changedToEmpty)) {
    return record.changedToEmpty;
  }
  if (Array.isArray(record.changedToEmpty)) return record.changedToEmpty.length;

  return null;
};

const extractFailuresLines = (payload: unknown): number | null => {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as { failuresLines?: unknown };
  return toNumber(record.failuresLines);
};

const extractMissingMetrics = (
  payload: unknown,
): {
  activeMissingRows: number | null;
  uniqueMissingKeys: number | null;
  sampleSize: number | null;
  activeMissingRatio: number | null;
  missingRatio: number | null;
  missingRatioMode: "uniqueMissingKeys/sampleSize" | "activeMissingRows/sampleSize" | null;
} => {
  if (!payload || typeof payload !== "object") {
    return {
      activeMissingRows: null,
      uniqueMissingKeys: null,
      sampleSize: null,
      activeMissingRatio: null,
      missingRatio: null,
      missingRatioMode: null,
    };
  }
  const record = payload as { summary?: unknown };
  if (!record.summary || typeof record.summary !== "object") {
    return {
      activeMissingRows: null,
      uniqueMissingKeys: null,
      sampleSize: null,
      activeMissingRatio: null,
      missingRatio: null,
      missingRatioMode: null,
    };
  }
  const summary = record.summary as {
    activeMissingRows?: unknown;
    uniqueMissingKeys?: unknown;
    sampleSize?: unknown;
  };
  const activeMissingRows = toNumber(summary.activeMissingRows);
  const uniqueMissingKeys = toNumber(summary.uniqueMissingKeys);
  const sampleSize = toNumber(summary.sampleSize);
  const activeMissingRatio =
    activeMissingRows != null && sampleSize != null && sampleSize > 0
      ? activeMissingRows / sampleSize
      : null;
  if (sampleSize == null || sampleSize <= 0) {
    return {
      activeMissingRows,
      uniqueMissingKeys,
      sampleSize,
      activeMissingRatio,
      missingRatio: null,
      missingRatioMode: null,
    };
  }
  if (uniqueMissingKeys != null) {
    return {
      activeMissingRows,
      uniqueMissingKeys,
      sampleSize,
      activeMissingRatio,
      missingRatio: uniqueMissingKeys / sampleSize,
      missingRatioMode: "uniqueMissingKeys/sampleSize",
    };
  }
  if (activeMissingRows != null) {
    return {
      activeMissingRows,
      uniqueMissingKeys,
      sampleSize,
      activeMissingRatio,
      missingRatio: activeMissingRows / sampleSize,
      missingRatioMode: "activeMissingRows/sampleSize",
    };
  }
  return {
    activeMissingRows,
    uniqueMissingKeys,
    sampleSize,
    activeMissingRatio,
    missingRatio: null,
    missingRatioMode: null,
  };
};

const extractTaxonomyMismatchAmongResolved = (payload: unknown): number | null => {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as { ratios?: unknown };
  if (!record.ratios || typeof record.ratios !== "object") return null;
  const ratios = record.ratios as { taxonomyMismatchAmongResolved?: unknown };
  return toNumber(ratios.taxonomyMismatchAmongResolved);
};

const computePartPass = (part: PartGateSummary, incomplete: boolean): boolean => {
  if (incomplete) return false;
  if (part.inputCount == null || part.validCount == null) return false;
  if (part.coverage == null) return false;
  if (part.failuresLines == null) return false;
  if (part.changedToEmptyCount == null) return false;
  if (part.missingRatio == null) return false;
  if (part.taxonomyMismatchAmongResolved == null) return false;

  return (
    part.coverage >= GATE.coverageMin &&
    part.failuresLines <= GATE.failuresLinesMax &&
    part.changedToEmptyCount <= GATE.changedToEmptyCountMax &&
    part.missingRatio <= GATE.missingMax &&
    part.taxonomyMismatchAmongResolved <= GATE.taxonomyMismatchAmongResolvedMax
  );
};

const main = async () => {
  const runDir = path.resolve(process.cwd(), runDirArg);
  const outGate = path.resolve(process.cwd(), outGateArg);
  const outEvidence = path.resolve(process.cwd(), outEvidenceArg);

  const partsDir = path.join(runDir, "parts");
  const partFiles = (await fs.readdir(partsDir)).filter((name) =>
    /^ids_part_\d+\.json$/.test(name),
  );

  const partIds = partFiles
    .map((name) => name.replace(/^ids_part_/, "").replace(/\.json$/, ""))
    .sort();

  const parts: Record<string, PartGateSummary> = {};
  const evidenceParts: Record<string, PartPaths> = {};
  const failingParts: string[] = [];
  const incompleteParts: string[] = [];

  for (const partId of partIds) {
    const idsPath = path.join(runDir, "parts", `ids_part_${partId}.json`);
    const partDir = path.join(runDir, "parts", `part_${partId}`);

    const paths: PartPaths = {
      ids: idsPath,
      backfillSummary: path.join(partDir, "backfill_summary.json"),
      validIds: path.join(partDir, "valid_ids.json"),
      skippedIds: path.join(partDir, "skipped_ids.json"),
      skippedReasons: path.join(partDir, "skipped_reasons.json"),
      missingSummary: path.join(partDir, "ingredient_id_missing.json"),
      taxonomyMismatchSummary: path.join(partDir, "taxonomy", "mismatch_summary_dsld.json"),
      nonemptyDiff: path.join(partDir, "nonempty_diff.json"),
    };

    evidenceParts[partId] = paths;

    const inputCount = await countJsonArray(paths.ids);
    const validCount = (await fileExists(paths.validIds)) ? await countJsonArray(paths.validIds) : null;
    const coverage =
      inputCount != null && validCount != null && inputCount > 0 ? validCount / inputCount : null;

    const backfillSummary = (await fileExists(paths.backfillSummary))
      ? await readJson<unknown>(paths.backfillSummary)
      : null;
    const failuresLines = extractFailuresLines(backfillSummary);

    const missingSummary = (await fileExists(paths.missingSummary))
      ? await readJson<unknown>(paths.missingSummary)
      : null;
    const missing = extractMissingMetrics(missingSummary);

    const taxonomySummary = (await fileExists(paths.taxonomyMismatchSummary))
      ? await readJson<unknown>(paths.taxonomyMismatchSummary)
      : null;
    const taxonomyMismatchAmongResolved = extractTaxonomyMismatchAmongResolved(taxonomySummary);

    const nonemptyDiff = (await fileExists(paths.nonemptyDiff))
      ? await readJson<unknown>(paths.nonemptyDiff)
      : null;
    const changedToEmptyCount = extractChangedToEmptyCount(nonemptyDiff);

    const required = [
      paths.backfillSummary,
      paths.validIds,
      paths.missingSummary,
      paths.taxonomyMismatchSummary,
      paths.nonemptyDiff,
    ];
    const missingRequired = [];
    for (const requiredPath of required) {
      // validIds is required, but if file exists but is empty it's still fine.
      if (!(await fileExists(requiredPath))) missingRequired.push(requiredPath);
    }
    const incomplete = missingRequired.length > 0;

    const partSummary: PartGateSummary = {
      paths,
      inputCount,
      validCount,
      coverage,
      failuresLines,
      missingRatio: missing.missingRatio,
      missingRatioMode: missing.missingRatioMode,
      activeMissingRows: missing.activeMissingRows,
      uniqueMissingKeys: missing.uniqueMissingKeys,
      activeMissingRatio: missing.activeMissingRatio,
      sampleSize: missing.sampleSize,
      taxonomyMismatchAmongResolved,
      changedToEmptyCount,
      gate: GATE,
      pass: false, // filled below
    };

    partSummary.pass = computePartPass(partSummary, incomplete);

    parts[partId] = partSummary;

    if (incomplete) incompleteParts.push(partId);
    else if (!partSummary.pass) failingParts.push(partId);
  }

  const overallPass = failingParts.length === 0 && incompleteParts.length === 0;

  const summary: AggregateSummary = {
    generatedAt: new Date().toISOString(),
    runDir,
    gate: GATE,
    overall: {
      pass: overallPass,
      failingParts,
      incompleteParts,
    },
    parts,
  };

  const evidence: EvidencePack = {
    generatedAt: summary.generatedAt,
    runDir,
    parts: evidenceParts,
    gateSummaryPath: outGate,
  };

  await fs.mkdir(path.dirname(outGate), { recursive: true });
  await fs.mkdir(path.dirname(outEvidence), { recursive: true });
  await writeFile(outGate, JSON.stringify(summary, null, 2), "utf8");
  await writeFile(outEvidence, JSON.stringify(evidence, null, 2), "utf8");

  console.log(
    JSON.stringify(
      {
        runDir,
        parts: partIds.length,
        overall: summary.overall,
        outGate,
        outEvidence,
      },
      null,
      2,
    ),
  );
};

await main();
