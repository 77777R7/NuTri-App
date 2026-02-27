import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

type IdMode = "impact_key" | "source_id_raw" | "canonical_source_id";

type RootCauseProduct = {
  sourceId?: string | null;
  source_id?: string | null;
  canonicalSourceId?: string | null;
  canonical_source_id?: string | null;
  primaryReason?: string | null;
  primary_reason?: string | null;
};

type RootCausePayload = {
  products?: RootCauseProduct[] | null;
};

type SourceIdsPayload = {
  sourceIds: string[];
};

type TargetSummaryPayload = {
  generatedAt: string;
  beforeJson: string;
  reason: string;
  idMode: IdMode;
  totalProducts: number;
  matchedProducts: number;
  droppedMissingId: number;
  targetCount: number;
  sample: string[];
  output: string;
};

const args = process.argv.slice(2);

const getArg = (flag: string): string | null => {
  const prefixed = args.find((value) => value.startsWith(`--${flag}=`));
  if (prefixed) return prefixed.slice(`--${flag}=`.length);
  const index = args.indexOf(`--${flag}`);
  if (index === -1) return null;
  const next = args[index + 1];
  if (!next || next.startsWith("--")) return null;
  return next;
};

const normalize = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const intNorm = (value: unknown): string | null => {
  const text = normalize(value);
  if (!text) return null;
  if (/^[+-]?\d+$/.test(text)) {
    const parsed = Number.parseInt(text, 10);
    if (Number.isFinite(parsed)) return String(parsed);
  }
  return text;
};

const resolveReason = (product: RootCauseProduct): string => {
  return normalize(product.primaryReason ?? product.primary_reason) ?? "";
};

const resolveSourceId = (product: RootCauseProduct): string | null =>
  normalize(product.sourceId ?? product.source_id);

const resolveCanonicalSourceId = (product: RootCauseProduct): string | null =>
  normalize(product.canonicalSourceId ?? product.canonical_source_id);

export const resolveIdByMode = (
  product: RootCauseProduct,
  idMode: IdMode,
): string | null => {
  if (idMode === "source_id_raw") return resolveSourceId(product);
  if (idMode === "canonical_source_id") return resolveCanonicalSourceId(product);
  return intNorm(resolveCanonicalSourceId(product) ?? resolveSourceId(product));
};

const ensureDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  await mkdir(dir, { recursive: true });
};

const writeJson = async (filePath: string, payload: unknown) => {
  await ensureDir(filePath);
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const parseIdMode = (value: string | null): IdMode => {
  const mode = (value ?? "impact_key").trim().toLowerCase();
  if (mode === "source_id_raw") return "source_id_raw";
  if (mode === "canonical_source_id") return "canonical_source_id";
  if (mode === "impact_key") return "impact_key";
  throw new Error(
    `[build-rootcause-target-ids] invalid --id-mode: ${value}. expected one of: impact_key, source_id_raw, canonical_source_id`,
  );
};

export const buildTargetIds = (params: {
  payload: RootCausePayload;
  reason: string;
  idMode: IdMode;
}): { sourceIds: string[]; matchedProducts: number; droppedMissingId: number } => {
  const products = Array.isArray(params.payload.products) ? params.payload.products : [];
  let matchedProducts = 0;
  let droppedMissingId = 0;
  const ids = new Set<string>();

  for (const product of products) {
    if (resolveReason(product) !== params.reason) continue;
    matchedProducts += 1;
    const id = resolveIdByMode(product, params.idMode);
    if (!id) {
      droppedMissingId += 1;
      continue;
    }
    ids.add(id);
  }

  return {
    sourceIds: Array.from(ids).sort((a, b) => a.localeCompare(b)),
    matchedProducts,
    droppedMissingId,
  };
};

export const run = async () => {
  const beforeJsonArg = getArg("before-json");
  const reason = normalize(getArg("reason"));
  const outputArg = getArg("output");
  const summaryArg = getArg("summary");
  const idMode = parseIdMode(getArg("id-mode"));

  if (!beforeJsonArg) {
    throw new Error("[build-rootcause-target-ids] --before-json is required");
  }
  if (!reason) {
    throw new Error("[build-rootcause-target-ids] --reason is required");
  }
  if (!outputArg) {
    throw new Error("[build-rootcause-target-ids] --output is required");
  }
  if (!summaryArg) {
    throw new Error("[build-rootcause-target-ids] --summary is required");
  }

  const beforeJson = path.resolve(beforeJsonArg);
  const outputPath = path.resolve(outputArg);
  const summaryPath = path.resolve(summaryArg);
  const raw = await readFile(beforeJson, "utf8");
  const payload = JSON.parse(raw) as RootCausePayload;
  const products = Array.isArray(payload.products) ? payload.products : [];

  const result = buildTargetIds({ payload, reason, idMode });

  const outputPayload: SourceIdsPayload = { sourceIds: result.sourceIds };
  const summaryPayload: TargetSummaryPayload = {
    generatedAt: new Date().toISOString(),
    beforeJson,
    reason,
    idMode,
    totalProducts: products.length,
    matchedProducts: result.matchedProducts,
    droppedMissingId: result.droppedMissingId,
    targetCount: result.sourceIds.length,
    sample: result.sourceIds.slice(0, 20),
    output: outputPath,
  };

  await writeJson(outputPath, outputPayload);
  await writeJson(summaryPath, summaryPayload);

  console.log(
    JSON.stringify(
      {
        output: outputPath,
        summary: summaryPath,
        reason,
        idMode,
        targetCount: result.sourceIds.length,
      },
      null,
      2,
    ),
  );
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  run().catch((error) => {
    console.error(
      "[build-rootcause-target-ids] failed:",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  });
}
