import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

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

type MismatchSummary = {
  counts?: { activeRows?: number };
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

const inputA = getArg("input-a");
const inputB = getArg("input-b");
const mismatchA = getArg("mismatch-a");
const mismatchB = getArg("mismatch-b");
const outPath =
  getArg("output") ?? "output/ingredient-identity/ingredient_id_missing_union.json";
const statsPath =
  getArg("stats-output") ??
  "output/ingredient-identity/ingredient_id_missing_union_stats.json";
const minCount = Math.max(1, Number(getArg("min-count") ?? "5"));
const targetRatio = Math.max(0, Number(getArg("target-ratio") ?? "0.1"));
const buffer = Math.max(1, Number(getArg("buffer") ?? "1.3"));

if (!inputA || !inputB || !mismatchA || !mismatchB) {
  throw new Error(
    "[identity-union] --input-a/--input-b/--mismatch-a/--mismatch-b are required",
  );
}

const ensureDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  await mkdir(dir, { recursive: true });
};

const normalizeKey = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const readJson = async <T>(filePath: string): Promise<T> =>
  JSON.parse(await readFile(filePath, "utf8")) as T;

const dedupe = (values: string[]): string[] => {
  const seen = new Set<string>();
  const output: string[] = [];
  values.forEach((value) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    output.push(trimmed);
  });
  return output;
};

const run = async () => {
  const payloadA = await readJson<MissingIngredientPayload>(inputA);
  const payloadB = await readJson<MissingIngredientPayload>(inputB);
  const mismatchAData = await readJson<MismatchSummary>(mismatchA);
  const mismatchBData = await readJson<MismatchSummary>(mismatchB);

  const missingRowsA = payloadA.summary.activeMissingRows ?? 0;
  const missingRowsB = payloadB.summary.activeMissingRows ?? 0;
  const activeRowsA = mismatchAData.counts?.activeRows ?? 0;
  const activeRowsB = mismatchBData.counts?.activeRows ?? 0;

  const needFixA = Math.max(
    0,
    missingRowsA - Math.floor(targetRatio * activeRowsA),
  );
  const needFixB = Math.max(
    0,
    missingRowsB - Math.floor(targetRatio * activeRowsB),
  );
  const worstNeedFix = Math.max(needFixA, needFixB);
  const coverageTarget = Math.ceil(worstNeedFix * buffer);

  const merged = new Map<
    string,
    {
      countA: number;
      countB: number;
      sourceCount: number;
      nameRawSamples: string[];
      sourceIdSamples: string[];
    }
  >();

  const addEntries = (entries: MissingIngredientEntry[], isA: boolean) => {
    entries.forEach((entry) => {
      const key = normalizeKey(entry.nameKey);
      if (!key) return;
      const existing =
        merged.get(key) ?? {
          countA: 0,
          countB: 0,
          sourceCount: 0,
          nameRawSamples: [],
          sourceIdSamples: [],
        };
      if (isA) existing.countA += entry.count;
      else existing.countB += entry.count;
      existing.sourceCount = Math.max(existing.sourceCount, entry.sourceCount);
      existing.nameRawSamples = dedupe([
        ...existing.nameRawSamples,
        ...(entry.nameRawSamples ?? []),
      ]);
      existing.sourceIdSamples = dedupe([
        ...existing.sourceIdSamples,
        ...(entry.sourceIdSamples ?? []),
      ]);
      merged.set(key, existing);
    });
  };

  addEntries(payloadA.topMissing, true);
  addEntries(payloadB.topMissing, false);

  const eligible = Array.from(merged.entries())
    .map(([nameKey, value]) => ({
      nameKey,
      count: value.countA + value.countB,
      sourceCount: value.sourceCount,
      nameRawSamples: value.nameRawSamples,
      sourceIdSamples: value.sourceIdSamples,
    }))
    .filter((entry) => entry.count >= minCount)
    .sort((a, b) => b.count - a.count);

  const selected: MissingIngredientEntry[] = [];
  let cumulative = 0;
  for (const entry of eligible) {
    if (coverageTarget > 0 && cumulative >= coverageTarget) break;
    selected.push(entry);
    cumulative += entry.count;
  }

  const coverageEstimate =
    Math.max(missingRowsA, missingRowsB) > 0
      ? Number((cumulative / Math.max(missingRowsA, missingRowsB)).toFixed(4))
      : 0;

  const outputPayload: MissingIngredientPayload = {
    summary: {
      source: payloadA.summary.source ?? payloadB.summary.source ?? "lnhpd",
      idColumn: payloadA.summary.idColumn ?? payloadB.summary.idColumn ?? "source_id",
      sampleSize: payloadA.summary.sampleSize ?? payloadB.summary.sampleSize ?? 0,
      activeMissingRows: Math.max(missingRowsA, missingRowsB),
      uniqueMissingKeys: selected.length,
      generatedAt: new Date().toISOString(),
    },
    topMissing: selected,
  };

  const stats = {
    inputA,
    inputB,
    mismatchA,
    mismatchB,
    missingRowsA,
    missingRowsB,
    activeRowsA,
    activeRowsB,
    needFixA,
    needFixB,
    worstNeedFix,
    coverageTarget,
    minCount,
    buffer,
    eligibleCount: eligible.length,
    selectedCount: selected.length,
    coverageEstimate,
  };

  await ensureDir(outPath);
  await writeFile(outPath, JSON.stringify(outputPayload, null, 2), "utf8");
  await ensureDir(statsPath);
  await writeFile(statsPath, JSON.stringify(stats, null, 2), "utf8");

  console.log(
    `[identity-union] selected=${selected.length} coverage=${coverageEstimate} output=${outPath}`,
  );
};

run().catch((error) => {
  console.error("[identity-union] failed:", error);
  process.exit(1);
});
