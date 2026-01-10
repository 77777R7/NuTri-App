import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type RebackfillEntry = {
  source: "lnhpd";
  sourceId: string;
  canonicalSourceId: string;
  stage: string;
  status: number;
};

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const SOURCE_IDS_FILE =
  getArg("source-ids-file") ?? "output/diagnostics/lnhpd_sample_ids.json";
const OUTPUT_PATH =
  getArg("output") ??
  "output/formraw/formraw_rebackfill_lnhpd_fixed_sample.jsonl";

const ensureDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  await mkdir(dir, { recursive: true });
};

const run = async () => {
  const raw = await readFile(SOURCE_IDS_FILE, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  let ids: unknown = parsed;
  if (!Array.isArray(parsed) && parsed && typeof parsed === "object") {
    ids = (parsed as { sourceIds?: unknown }).sourceIds ?? parsed;
  }
  if (!Array.isArray(ids)) {
    throw new Error("source-ids-file must be a JSON array or { sourceIds: [] }");
  }

  const entries: RebackfillEntry[] = ids
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0)
    .map((sourceId) => ({
      source: "lnhpd",
      sourceId,
      canonicalSourceId: sourceId,
      stage: "formraw_fixed_sample",
      status: 0,
    }));

  if (entries.length !== ids.length) {
    throw new Error(
      `invalid source ids: expected ${ids.length} entries, got ${entries.length}`,
    );
  }

  await ensureDir(OUTPUT_PATH);
  const lines = entries.map((entry) => JSON.stringify(entry));
  await writeFile(OUTPUT_PATH, `${lines.join("\n")}\n`, "utf8");

  console.log(`[formraw] fixed sample entries=${entries.length} output=${OUTPUT_PATH}`);
};

run().catch((error) => {
  console.error("[formraw] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
