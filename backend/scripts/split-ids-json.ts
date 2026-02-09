import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const INPUT = getArg("input");
const OUT_DIR = getArg("out-dir");
const PREFIX = getArg("prefix") ?? "ids_part_";
const PART_SIZE = Math.max(1, Number(getArg("part-size") ?? "10000"));
const PAD = Math.max(1, Number(getArg("pad") ?? "3"));
const WRITE_SUMMARY = getArg("summary-json");

const normalizeId = (value: unknown): string | null => {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  return null;
};

const normalizeIdList = (payload: unknown): string[] => {
  const candidates =
    Array.isArray(payload)
      ? payload
      : payload && typeof payload === "object"
        ? (payload as any).sourceIds ??
          (payload as any).dsldIds ??
          (payload as any).lnhpdIds ??
          (payload as any).ids ??
          payload
        : payload;

  if (!Array.isArray(candidates)) {
    throw new Error("[split-ids] input JSON must be an array or { sourceIds: [] }");
  }

  return candidates
    .map((value) => normalizeId(value))
    .filter((value): value is string => Boolean(value));
};

const padIndex = (idx: number) => String(idx).padStart(PAD, "0");

const run = async () => {
  if (!INPUT) throw new Error("[split-ids] missing --input");
  if (!OUT_DIR) throw new Error("[split-ids] missing --out-dir");

  const raw = await readFile(INPUT, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  const ids = normalizeIdList(parsed);
  if (!ids.length) throw new Error(`[split-ids] no ids in input: ${INPUT}`);

  await mkdir(OUT_DIR, { recursive: true });

  const parts: { index: number; file: string; count: number; start?: string; end?: string }[] = [];

  for (let i = 0; i < ids.length; i += PART_SIZE) {
    const index = Math.floor(i / PART_SIZE);
    const slice = ids.slice(i, i + PART_SIZE);
    const fileName = `${PREFIX}${padIndex(index)}.json`;
    const filePath = path.join(OUT_DIR, fileName);
    await writeFile(filePath, JSON.stringify(slice, null, 2), "utf8");
    parts.push({
      index,
      file: filePath,
      count: slice.length,
      start: slice[0],
      end: slice[slice.length - 1],
    });
  }

  const summary = {
    input: INPUT,
    outDir: OUT_DIR,
    prefix: PREFIX,
    partSize: PART_SIZE,
    total: ids.length,
    partsCount: parts.length,
    parts,
    generatedAt: new Date().toISOString(),
  };

  if (WRITE_SUMMARY) {
    const dir = path.dirname(WRITE_SUMMARY);
    if (dir && dir !== ".") await mkdir(dir, { recursive: true });
    await writeFile(WRITE_SUMMARY, JSON.stringify(summary, null, 2), "utf8");
  }

  console.log(JSON.stringify(summary, null, 2));
};

run().catch((error) => {
  console.error("[split-ids] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});

