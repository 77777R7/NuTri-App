import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type OutlierRow = {
  sourceId: string;
  overallDelta: number | null;
  triggered?: {
    verifiedForms?: Array<{
      ingredientId: string | null;
      formKey: string | null;
    }>;
    verifiedEvidence?: Array<{
      ingredientId: string | null;
      goal: string | null;
    }>;
  } | null;
  baselineTriggered?: {
    verifiedForms?: Array<{
      ingredientId: string | null;
      formKey: string | null;
    }>;
    verifiedEvidence?: Array<{
      ingredientId: string | null;
      goal: string | null;
    }>;
  } | null;
};

type CulpritStats = {
  key: string;
  ingredientId: string | null;
  subKey: string | null;
  count: number;
  gt20Count: number;
  gt10Count: number;
  meanAbsDelta: number;
  maxAbsDelta: number;
};

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const input = getArg("input") ?? "output/outliers_gt20.jsonl";
const output =
  getArg("output") ?? "output/outlier_culprits.json";
const topN = Math.max(1, Number(getArg("top-n") ?? "20"));
const shadowOnly = args.includes("--shadow-only");

const ensureDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  await writeFile(dir + "/.keep", "", { flag: "a" });
};

const addStats = (
  map: Map<string, { ingredientId: string | null; subKey: string | null; sum: number; max: number; count: number; gt10: number; gt20: number }>,
  key: string,
  ingredientId: string | null,
  subKey: string | null,
  absDelta: number,
) => {
  const bucket = map.get(key) ?? {
    ingredientId,
    subKey,
    sum: 0,
    max: 0,
    count: 0,
    gt10: 0,
    gt20: 0,
  };
  bucket.sum += absDelta;
  bucket.max = Math.max(bucket.max, absDelta);
  bucket.count += 1;
  if (absDelta > 10) bucket.gt10 += 1;
  if (absDelta > 20) bucket.gt20 += 1;
  map.set(key, bucket);
};

const toStats = (map: Map<string, { ingredientId: string | null; subKey: string | null; sum: number; max: number; count: number; gt10: number; gt20: number }>) =>
  Array.from(map.entries()).map(([key, bucket]) => ({
    key,
    ingredientId: bucket.ingredientId,
    subKey: bucket.subKey,
    count: bucket.count,
    gt20Count: bucket.gt20,
    gt10Count: bucket.gt10,
    meanAbsDelta: Number((bucket.sum / bucket.count).toFixed(4)),
    maxAbsDelta: Number(bucket.max.toFixed(4)),
  }));

const run = async () => {
  const raw = await readFile(input, "utf8");
  const lines = raw.split(/\n/).filter(Boolean);
  const rows: OutlierRow[] = lines.map((line) => JSON.parse(line));

  const evidenceMap = new Map<string, { ingredientId: string | null; subKey: string | null; sum: number; max: number; count: number; gt10: number; gt20: number }>();
  const formMap = new Map<string, { ingredientId: string | null; subKey: string | null; sum: number; max: number; count: number; gt10: number; gt20: number }>();

  let total = 0;
  let gt10 = 0;
  let gt20 = 0;

  rows.forEach((row) => {
    const delta = typeof row.overallDelta === "number" ? Math.abs(row.overallDelta) : 0;
    total += 1;
    if (delta > 10) gt10 += 1;
    if (delta > 20) gt20 += 1;

    const baselineEvidenceKeys = new Set(
      (row.baselineTriggered?.verifiedEvidence ?? []).map(
        (ev) => `${ev.ingredientId ?? "unknown"}::${ev.goal ?? "unknown"}`,
      ),
    );
    const baselineFormKeys = new Set(
      (row.baselineTriggered?.verifiedForms ?? []).map(
        (form) => `${form.ingredientId ?? "unknown"}::${form.formKey ?? "unknown"}`,
      ),
    );

    const evidence = row.triggered?.verifiedEvidence ?? [];
    evidence.forEach((ev) => {
      const key = `${ev.ingredientId ?? "unknown"}::${ev.goal ?? "unknown"}`;
      if (shadowOnly && baselineEvidenceKeys.has(key)) return;
      addStats(evidenceMap, key, ev.ingredientId ?? null, ev.goal ?? null, delta);
    });
    const forms = row.triggered?.verifiedForms ?? [];
    forms.forEach((form) => {
      const key = `${form.ingredientId ?? "unknown"}::${form.formKey ?? "unknown"}`;
      if (shadowOnly && baselineFormKeys.has(key)) return;
      addStats(formMap, key, form.ingredientId ?? null, form.formKey ?? null, delta);
    });
  });

  const evidenceStats = toStats(evidenceMap).sort((a, b) => b.gt20Count - a.gt20Count || b.count - a.count);
  const formStats = toStats(formMap).sort((a, b) => b.gt20Count - a.gt20Count || b.count - a.count);

  const payload = {
    input,
    shadowOnly,
    totalOutliers: total,
    gt10Count: gt10,
    gt20Count: gt20,
    topEvidenceKeys: evidenceStats.slice(0, topN),
    topFormKeys: formStats.slice(0, topN),
    evidenceStats,
    formStats,
    generatedAt: new Date().toISOString(),
  };

  await ensureDir(output);
  await writeFile(output, JSON.stringify(payload, null, 2), "utf8");
  console.log(`[outlier-culprits] wrote ${output}`);
};

run().catch((error) => {
  console.error(`[outlier-culprits] ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
