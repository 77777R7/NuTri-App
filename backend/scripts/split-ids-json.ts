import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const input = getArg("input");
const outDir = getArg("out-dir") ?? "output/parts";
const prefix = getArg("prefix") ?? "ids_part_";
const padRaw = getArg("pad") ?? "3";
const partSizeRaw = getArg("part-size") ?? "10000";
const summaryJson = getArg("summary-json") ?? null;

if (!input) throw new Error(`[split-ids] missing --input`);

const pad = Math.max(1, Number(padRaw));
const partSize = Math.max(1, Number(partSizeRaw));

const normalizeIdList = (value: unknown): string[] => {
  const parsed =
    Array.isArray(value)
      ? value
      : Array.isArray((value as { sourceIds?: unknown })?.sourceIds)
        ? (value as { sourceIds?: unknown }).sourceIds
        : Array.isArray((value as { lnhpdIds?: unknown })?.lnhpdIds)
          ? (value as { lnhpdIds?: unknown }).lnhpdIds
          : Array.isArray((value as { dsldIds?: unknown })?.dsldIds)
            ? (value as { dsldIds?: unknown }).dsldIds
            : Array.isArray((value as { ids?: unknown })?.ids)
              ? (value as { ids?: unknown }).ids
              : [];

  return parsed
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
};

const readIds = async (): Promise<string[]> => {
  const raw = await readFile(input, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  return normalizeIdList(parsed);
};

const ensureDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  await mkdir(dir, { recursive: true });
};

const padIndex = (index: number) => String(index).padStart(pad, "0");

const main = async () => {
  const ids = await readIds();
  await mkdir(outDir, { recursive: true });

  const parts = [];
  for (let offset = 0, index = 0; offset < ids.length; offset += partSize, index += 1) {
    const slice = ids.slice(offset, offset + partSize);
    const file = path.join(outDir, `${prefix}${padIndex(index)}.json`);
    await ensureDir(file);
    await writeFile(file, JSON.stringify(slice, null, 2), "utf8");

    parts.push({
      index,
      file,
      count: slice.length,
      start: slice[0] ?? null,
      end: slice[slice.length - 1] ?? null,
    });
  }

  const summary = {
    input,
    outDir,
    prefix,
    partSize,
    total: ids.length,
    partsCount: parts.length,
    parts,
    generatedAt: new Date().toISOString(),
  };

  if (summaryJson) {
    await ensureDir(summaryJson);
    await writeFile(summaryJson, JSON.stringify(summary, null, 2), "utf8");
  }

  console.log(JSON.stringify(summary, null, 2));
};

await main();

