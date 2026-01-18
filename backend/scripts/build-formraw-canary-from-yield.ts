import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type YieldPreviewRow = {
  sourceId?: string | null;
  canonicalSourceId?: string | null;
  ingredientId?: string | null;
  formRawBefore?: string | null;
  recognizedTokens?: string[] | null;
  winnerTokens?: string[] | null;
  candidateWritableEmpty?: boolean | null;
};

type CanaryEntry = {
  source: "lnhpd";
  sourceId: string;
  canonicalSourceId?: string | null;
  stage: string;
  status: number;
  reason: string;
  ingredientId?: string | null;
  hintTokens?: string[];
};

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const YIELD_INPUT = getArg("yield-input");
const OUTPUT_JSONL =
  getArg("output") ?? "output/formraw/formraw_canary_lnhpd.jsonl";
const SOURCE_IDS_OUTPUT = getArg("source-ids-output");
const LIMIT = Math.max(1, Number(getArg("limit") ?? "200"));
const REQUIRE_RECOGNIZED = args.includes("--require-recognized");
const REQUIRE_CANDIDATE_WRITABLE = args.includes("--require-candidate-writable");

const ensureDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  await mkdir(dir, { recursive: true });
};

const isEmpty = (value?: string | null) => !value || !value.trim();

const normalizeList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item) => typeof item === "string" && item.trim().length > 0)
    : [];

const run = async () => {
  if (!YIELD_INPUT) {
    throw new Error("[formraw-canary] --yield-input is required");
  }
  const raw = await readFile(YIELD_INPUT, "utf8");
  const parsed = JSON.parse(raw) as { previewRows?: YieldPreviewRow[] };
  const previewRows = Array.isArray(parsed?.previewRows) ? parsed.previewRows : [];
  if (!previewRows.length) {
    throw new Error(`[formraw-canary] previewRows missing in ${YIELD_INPUT}`);
  }

  const entries: CanaryEntry[] = [];
  const sourceIds: string[] = [];
  const seenKeys = new Set<string>();

  for (const row of previewRows) {
    if (!isEmpty(row.formRawBefore)) continue;
    const sourceId = row.sourceId ?? null;
    if (!sourceId) continue;
    const canonicalSourceId = row.canonicalSourceId ?? null;
    const dedupeKey = canonicalSourceId ? `c:${canonicalSourceId}` : `s:${sourceId}`;
    if (seenKeys.has(dedupeKey)) continue;

    if (REQUIRE_CANDIDATE_WRITABLE && !row.candidateWritableEmpty) continue;
    const winnerTokens = normalizeList(row.winnerTokens);
    const recognizedTokens = normalizeList(row.recognizedTokens);
    if (!winnerTokens.length) continue;
    if (REQUIRE_RECOGNIZED && !recognizedTokens.length) continue;

    seenKeys.add(dedupeKey);
    sourceIds.push(sourceId);
    entries.push({
      source: "lnhpd",
      sourceId,
      canonicalSourceId,
      stage: "formraw_explicit_canary",
      status: 0,
      reason: "yield_preview",
      ingredientId: row.ingredientId ?? null,
      hintTokens: recognizedTokens.length ? recognizedTokens : winnerTokens,
    });
    if (entries.length >= LIMIT) break;
  }

  if (!entries.length) {
    throw new Error("[formraw-canary] no eligible rows found in previewRows");
  }

  await ensureDir(OUTPUT_JSONL);
  await writeFile(
    OUTPUT_JSONL,
    `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
    "utf8",
  );

  if (SOURCE_IDS_OUTPUT) {
    await ensureDir(SOURCE_IDS_OUTPUT);
    await writeFile(SOURCE_IDS_OUTPUT, JSON.stringify(sourceIds, null, 2), "utf8");
  }

  const summary = {
    output: OUTPUT_JSONL,
    yieldInput: YIELD_INPUT,
    sourceIdsOutput: SOURCE_IDS_OUTPUT ?? null,
    entries: entries.length,
    requireRecognized: REQUIRE_RECOGNIZED,
    requireCandidateWritable: REQUIRE_CANDIDATE_WRITABLE,
  };

  console.log(JSON.stringify(summary, null, 2));
};

run().catch((error) => {
  console.error("[formraw-canary] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
