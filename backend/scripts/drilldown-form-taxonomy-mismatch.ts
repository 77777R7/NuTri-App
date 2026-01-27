import fs from "node:fs/promises";
import path from "node:path";

type MatchAttempt = {
  aliasMatchedFormKeys?: string[];
  formsAvailable?: Array<{ formKey: string; formLabel: string }>;
};

type MismatchExample = {
  source?: string;
  sourceId?: string;
  canonicalSourceId?: string | null;
  ingredientId?: string | null;
  nameRaw?: string | null;
  formRaw?: string | null;
  tokens?: string[];
  matchAttempt?: MatchAttempt;
};

type DrilldownRow = {
  source: string;
  sourceId: string | null;
  canonicalSourceId: string | null;
  ingredientId: string | null;
  nameRaw: string | null;
  formRaw: string | null;
  token: string;
  mappedFormKeys: string[];
  allowedFormKeys: string[];
  reason: string;
};

const args = process.argv.slice(2);
const getArg = (name: string): string | null => {
  const prefix = `--${name}=`;
  const inline = args.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1) {
    const next = args[idx + 1];
    if (next && !next.startsWith("--")) return next;
  }
  return null;
};

const input = getArg("input");
const outDirArg = getArg("out-dir");
const topN = Math.max(1, Number(getArg("top-n") ?? "50"));

if (!input) {
  console.error("[drilldown] --input is required (mismatch_examples_*.jsonl)");
  process.exit(1);
}

const isValidToken = (value: string): boolean => {
  if (!value) return false;
  if (value.length <= 1) return false;
  if (/^\d+$/.test(value)) return false;
  return true;
};

const ensureDir = async (dir: string) => {
  await fs.mkdir(dir, { recursive: true });
};

const run = async () => {
  const raw = await fs.readFile(input, "utf8");
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const rows: DrilldownRow[] = [];
  const tokenCounts = new Map<string, number>();
  const ingredientTokenCounts = new Map<string, number>();

  lines.forEach((line) => {
    let parsed: MismatchExample | null = null;
    try {
      parsed = JSON.parse(line) as MismatchExample;
    } catch {
      return;
    }
    if (!parsed) return;

    const tokens = (parsed.tokens ?? []).filter((token) => isValidToken(token));
    if (!tokens.length) return;

    const mappedFormKeys = parsed.matchAttempt?.aliasMatchedFormKeys ?? [];
    const allowedFormKeys =
      parsed.matchAttempt?.formsAvailable?.map((form) => form.formKey) ?? [];

    tokens.forEach((token) => {
      rows.push({
        source: parsed.source ?? "lnhpd",
        sourceId: parsed.sourceId ?? null,
        canonicalSourceId: parsed.canonicalSourceId ?? null,
        ingredientId: parsed.ingredientId ?? null,
        nameRaw: parsed.nameRaw ?? null,
        formRaw: parsed.formRaw ?? null,
        token,
        mappedFormKeys,
        allowedFormKeys,
        reason: "alias_not_in_forms",
      });

      tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1);
      const ingredientKey = `${parsed.ingredientId ?? "unknown"}::${token}`;
      ingredientTokenCounts.set(
        ingredientKey,
        (ingredientTokenCounts.get(ingredientKey) ?? 0) + 1,
      );
    });
  });

  const outDir = outDirArg ?? path.dirname(input);
  await ensureDir(outDir);

  const rowsPath = path.join(outDir, "mismatch_drilldown_rows.jsonl");
  const tokenAggPath = path.join(outDir, "mismatch_drilldown_top_tokens.json");
  const ingredientAggPath = path.join(
    outDir,
    "mismatch_drilldown_top_ingredient_tokens.json",
  );

  await fs.writeFile(
    rowsPath,
    rows.map((row) => JSON.stringify(row)).join("\n"),
    "utf8",
  );

  const topTokens = Array.from(tokenCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([token, count]) => ({ token, count }));

  const topIngredientTokens = Array.from(ingredientTokenCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([key, count]) => {
      const [ingredientId, token] = key.split("::");
      return { ingredientId, token, count };
    });

  await fs.writeFile(
    tokenAggPath,
    JSON.stringify(
      {
        input,
        totalRows: rows.length,
        topN,
        tokens: topTokens,
      },
      null,
      2,
    ),
    "utf8",
  );

  await fs.writeFile(
    ingredientAggPath,
    JSON.stringify(
      {
        input,
        totalRows: rows.length,
        topN,
        ingredientTokens: topIngredientTokens,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        rowsPath,
        tokenAggPath,
        ingredientAggPath,
        totalRows: rows.length,
      },
      null,
      2,
    ),
  );
};

run().catch((error) => {
  console.error("[drilldown] failed:", error);
  process.exit(1);
});
