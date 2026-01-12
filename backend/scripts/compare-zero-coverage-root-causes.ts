import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type RootCauseSummary = {
  zeroCoverageCount: number;
  summary: {
    total: number;
    counts: Record<string, number>;
    ratios: Record<string, number>;
  };
};

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const BEFORE_PATH = getArg("before");
const AFTER_PATH = getArg("after");
const OUTPUT_PATH =
  getArg("output") ?? "output/diagnostics/zero_coverage_compare.json";

const readJson = async (filePath: string): Promise<RootCauseSummary> => {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as RootCauseSummary;
};

const diffCounts = (
  before: Record<string, number>,
  after: Record<string, number>,
): Record<string, number> => {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const result: Record<string, number> = {};
  keys.forEach((key) => {
    result[key] = (after[key] ?? 0) - (before[key] ?? 0);
  });
  return result;
};

const diffRatios = (
  before: Record<string, number>,
  after: Record<string, number>,
): Record<string, number> => {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const result: Record<string, number> = {};
  keys.forEach((key) => {
    const delta = (after[key] ?? 0) - (before[key] ?? 0);
    result[key] = Math.round(delta * 10000) / 10000;
  });
  return result;
};

const ensureDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  await mkdir(dir, { recursive: true });
};

const run = async () => {
  if (!BEFORE_PATH || !AFTER_PATH) {
    throw new Error("Usage: --before <path> --after <path> [--output <path>]");
  }

  const before = await readJson(BEFORE_PATH);
  const after = await readJson(AFTER_PATH);

  const payload = {
    before: {
      zeroCoverageCount: before.zeroCoverageCount,
      summary: before.summary,
    },
    after: {
      zeroCoverageCount: after.zeroCoverageCount,
      summary: after.summary,
    },
    delta: {
      zeroCoverageCount: after.zeroCoverageCount - before.zeroCoverageCount,
      counts: diffCounts(before.summary.counts, after.summary.counts),
      ratios: diffRatios(before.summary.ratios, after.summary.ratios),
    },
  };

  await ensureDir(OUTPUT_PATH);
  await writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2), "utf8");
  console.log(JSON.stringify({ output: OUTPUT_PATH }, null, 2));
};

run().catch((error) => {
  console.error("[zero-coverage-compare] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
