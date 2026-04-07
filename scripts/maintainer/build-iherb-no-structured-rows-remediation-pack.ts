#!/usr/bin/env -S node --import tsx

import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import { normalizeIherbSupplementFactsRowsWithTitleFallback } from "../../backend/src/iherbOverlayIngredients.ts";

type QueueRow = {
  remediationLane: string;
  productId: string;
  brandName: string;
  title: string;
  barcode: string | null;
  sourceZipPath: string | null;
  factsStatus: string;
};

type OverlayFactRow = {
  substancy?: string | null;
  amountPerServing?: string | null;
  dailyValuePercent?: string | null;
};

type OverlayRow = {
  product_id: string;
  brand_name: string;
  title: string;
  source_zip_path: string | null;
  supplement_facts: Record<string, unknown> | null;
};

type FailureMode =
  | "missing_nutritional_facts_rows"
  | "dense_blend_concatenation"
  | "rows_present_but_unparsed"
  | "other_no_structured_rows";

type FailureModeSummary = {
  count: number;
  topBrands: { brandName: string; count: number }[];
  topSourceZipPaths: { sourceZipPath: string; count: number }[];
  sampleProducts: { productId: string; brandName: string; title: string }[];
  suggestedFix: string;
};

type RemediationPack = {
  generatedAt: string;
  projectRef: string;
  inputQueueJsonl: string;
  noStructuredRowsCount: number;
  failureModeSummary: Record<FailureMode, FailureModeSummary>;
};

const PROJECT_REF = "dlwlobgmjzcmpirwvetq";
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;
const FETCH_CHUNK = 200;
const SAMPLE_LIMIT = 12;

function getArg(flag: string): string | null {
  const args = process.argv.slice(2);
  const index = args.indexOf(`--${flag}`);
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

const resolveLatestQueueJsonl = async (): Promise<string> => {
  const maintainerRoot = path.join(process.cwd(), "output", "maintainer-gates");
  const entries = await fs.readdir(maintainerRoot, { withFileTypes: true });
  const candidateDirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith("_iherb_unknown_remediation_queue"))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  const latestDir = candidateDirs[0];
  if (!latestDir) {
    throw new Error("No previous iHerb unknown remediation queue run found under output/maintainer-gates.");
  }
  return path.join(maintainerRoot, latestDir, "iherb_unknown_remediation_queue.jsonl");
};

const queueJsonlPathPromise = getArg("queue-jsonl")
  ? Promise.resolve(path.resolve(getArg("queue-jsonl") as string))
  : resolveLatestQueueJsonl();

const outputDirPromise = (async (): Promise<string> => {
  const explicit = getArg("out-dir");
  if (explicit) return path.resolve(explicit);
  return path.join(
    process.cwd(),
    "output",
    "maintainer-gates",
    `${new Date().toISOString().replace(/[:.]/g, "-")}_iherb_no_structured_rows_remediation_pack`,
  );
})();

const getServiceRoleKey = (): string => {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return process.env.SUPABASE_SERVICE_ROLE_KEY;
  }

  const raw = execFileSync(
    "supabase",
    ["projects", "api-keys", "--project-ref", PROJECT_REF, "-o", "json"],
    { encoding: "utf8" },
  );
  const apiKeys = JSON.parse(raw) as { id?: string; name?: string; api_key?: string }[];
  const serviceRoleKey =
    apiKeys.find((entry) => entry.id === "service_role" || entry.name === "service_role")?.api_key ?? "";
  if (!serviceRoleKey) {
    throw new Error("Unable to resolve Supabase service role key from Supabase CLI login.");
  }
  return serviceRoleKey;
};

const supabase = createClient(SUPABASE_URL, getServiceRoleKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const increment = (map: Map<string, number>, key: string, delta = 1) => {
  map.set(key, (map.get(key) ?? 0) + delta);
};

const toTopEntries = <TKey extends string>(
  map: Map<TKey, number>,
  keyName: string,
  limit = 12,
): Record<string, string | number>[] =>
  [...map.entries()]
    .sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])))
    .slice(0, limit)
    .map(([key, count]) => ({ [keyName]: key, count }));

const readNutritionRows = (supplementFacts: Record<string, unknown> | null): OverlayFactRow[] => {
  if (!supplementFacts) return [];
  const rows =
    (Array.isArray(supplementFacts.nutritionalFacts) ? supplementFacts.nutritionalFacts : null) ??
    (Array.isArray(supplementFacts.nutritional_facts) ? supplementFacts.nutritional_facts : null) ??
    [];
  return Array.isArray(rows) ? (rows as OverlayFactRow[]) : [];
};

const fetchOverlayRowsByProductIds = async (productIds: string[]): Promise<Map<string, OverlayRow>> => {
  const rows = new Map<string, OverlayRow>();
  for (let index = 0; index < productIds.length; index += FETCH_CHUNK) {
    const chunk = productIds.slice(index, index + FETCH_CHUNK);
    const { data, error } = await supabase
      .from("iherb_overlay_products")
      .select("product_id,brand_name,title,source_zip_path,supplement_facts")
      .in("product_id", chunk);

    if (error) {
      throw new Error(`Failed to fetch overlay rows for no_structured_rows pack: ${error.message}`);
    }

    for (const row of (data ?? []) as OverlayRow[]) {
      rows.set(row.product_id, row);
    }
  }
  return rows;
};

const DENSE_BLEND_PATTERN =
  /\b(?:blend|complex|formula|matrix)(?:[A-Z0-9]|\s*[A-Z][a-z]+.*(?:;|,).+)/;

const PROBIOTIC_PATTERN =
  /\b(?:lactobacillus|bifidobacterium|saccharomyces|streptococcus|bacillus|cfu|myoviridae|siphoviridae|phage)\b/i;

const classifyFailureMode = (rows: OverlayFactRow[]): FailureMode => {
  if (rows.length === 0) {
    return "missing_nutritional_facts_rows";
  }

  const rawNames = rows
    .map((row) => String(row.substancy ?? "").trim())
    .filter(Boolean);

  const hasDenseBlend = rawNames.some((name) => DENSE_BLEND_PATTERN.test(name));
  const hasProbioticDenseShape = rawNames.some((name) => PROBIOTIC_PATTERN.test(name) && /[;,]/.test(name));

  if (hasDenseBlend || hasProbioticDenseShape) {
    return "dense_blend_concatenation";
  }

  if (rawNames.length > 0) {
    return "rows_present_but_unparsed";
  }

  return "other_no_structured_rows";
};

const suggestedFixByMode: Record<FailureMode, string> = {
  missing_nutritional_facts_rows:
    "Backfill sources where supplement_facts.nutritionalFacts is empty or missing, or exclude these products from supplement-goal scoring when they are non-supplement surfaces.",
  dense_blend_concatenation:
    "Improve parser splitting for dense blend/formula rows, especially concatenated 'Blend/Complex/Formula' labels and probiotic/phage member lists.",
  rows_present_but_unparsed:
    "Review row cleaning/filtering rules; these products have nutritional rows but current normalization collapses them to zero structured ingredients.",
  other_no_structured_rows:
    "Manual review needed; these products do not fit the main missing-rows or dense-blend patterns.",
};

const FAILURE_MODES: readonly FailureMode[] = [
  "missing_nutritional_facts_rows",
  "dense_blend_concatenation",
  "rows_present_but_unparsed",
  "other_no_structured_rows",
] as const;

const run = async () => {
  const queueJsonlPath = await queueJsonlPathPromise;
  const outputDir = await outputDirPromise;
  await fs.mkdir(outputDir, { recursive: true });

  const rawQueue = await fs.readFile(queueJsonlPath, "utf8");
  const parserPartialFactsRows = rawQueue
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as QueueRow)
    .filter((row) => row.remediationLane === "parser_partial_facts");

  const productIds = [...new Set(parserPartialFactsRows.map((row) => row.productId))];
  const overlayByProductId = await fetchOverlayRowsByProductIds(productIds);

  const modeCounts = new Map<FailureMode, number>();
  const modeBrandCounts = new Map<FailureMode, Map<string, number>>();
  const modeZipCounts = new Map<FailureMode, Map<string, number>>();
  const modeSamples = new Map<FailureMode, { productId: string; brandName: string; title: string }[]>();

  for (const mode of FAILURE_MODES) {
    modeBrandCounts.set(mode, new Map<string, number>());
    modeZipCounts.set(mode, new Map<string, number>());
    modeSamples.set(mode, []);
  }

  let noStructuredRowsCount = 0;

  for (const queueRow of parserPartialFactsRows) {
    const overlayRow = overlayByProductId.get(queueRow.productId);
    const nutritionRows = readNutritionRows(overlayRow?.supplement_facts ?? null);
    const normalizedRows = normalizeIherbSupplementFactsRowsWithTitleFallback({
      rows: nutritionRows,
      title: overlayRow?.title ?? queueRow.title,
      brandName: overlayRow?.brand_name ?? queueRow.brandName,
      sourceZipPath: overlayRow?.source_zip_path ?? queueRow.sourceZipPath,
    });
    if (normalizedRows.length > 0) continue;

    noStructuredRowsCount += 1;
    const mode = classifyFailureMode(nutritionRows);
    increment(modeCounts, mode);
    increment(modeBrandCounts.get(mode) as Map<string, number>, overlayRow?.brand_name ?? queueRow.brandName);
    increment(
      modeZipCounts.get(mode) as Map<string, number>,
      overlayRow?.source_zip_path ?? queueRow.sourceZipPath ?? "unknown_source",
    );

    const samples = modeSamples.get(mode) as { productId: string; brandName: string; title: string }[];
    if (samples.length < SAMPLE_LIMIT) {
      samples.push({
        productId: queueRow.productId,
        brandName: overlayRow?.brand_name ?? queueRow.brandName,
        title: overlayRow?.title ?? queueRow.title,
      });
    }
  }

  const failureModeSummary = Object.fromEntries(
    FAILURE_MODES.map((mode) => [
      mode,
      {
        count: modeCounts.get(mode) ?? 0,
        topBrands: toTopEntries(modeBrandCounts.get(mode) as Map<string, number>, "brandName", 12) as {
          brandName: string;
          count: number;
        }[],
        topSourceZipPaths: toTopEntries(modeZipCounts.get(mode) as Map<string, number>, "sourceZipPath", 12) as {
          sourceZipPath: string;
          count: number;
        }[],
        sampleProducts: modeSamples.get(mode) ?? [],
        suggestedFix: suggestedFixByMode[mode],
      },
    ]),
  ) as Record<FailureMode, FailureModeSummary>;

  const report: RemediationPack = {
    generatedAt: new Date().toISOString(),
    projectRef: PROJECT_REF,
    inputQueueJsonl: queueJsonlPath,
    noStructuredRowsCount,
    failureModeSummary,
  };

  const jsonPath = path.join(outputDir, "iherb_no_structured_rows_remediation_pack.json");
  const mdPath = path.join(outputDir, "iherb_no_structured_rows_remediation_pack.md");

  const markdownLines: string[] = [
    "# iHerb No Structured Rows Remediation Pack",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Input queue: ${report.inputQueueJsonl}`,
    `- no_structured_rows count: ${report.noStructuredRowsCount}`,
    "",
  ];

  for (const mode of FAILURE_MODES) {
    const summary = failureModeSummary[mode];
    markdownLines.push(`## ${mode}`);
    markdownLines.push(`- count: ${summary.count}`);
    markdownLines.push(`- fix: ${summary.suggestedFix}`);
    markdownLines.push(
      ...summary.topSourceZipPaths.map((entry) => `- source: ${entry.sourceZipPath} (${entry.count})`),
    );
    markdownLines.push(
      ...summary.topBrands.map((entry) => `- brand: ${entry.brandName} (${entry.count})`),
    );
    markdownLines.push(
      ...summary.sampleProducts.map(
        (sample) => `- sample: ${sample.brandName} — ${sample.title} [${sample.productId}]`,
      ),
    );
    markdownLines.push("");
  }

  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(mdPath, `${markdownLines.join("\n")}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        status: "ok",
        outputDir,
        jsonPath,
        mdPath,
        noStructuredRowsCount,
        topFailureMode: FAILURE_MODES
          .map((mode) => ({ mode, count: failureModeSummary[mode].count }))
          .sort((left, right) => right.count - left.count)[0] ?? null,
      },
      null,
      2,
    ),
  );
};

run().catch((error) => {
  console.error("[iherb-no-structured-rows-remediation-pack] failed", error);
  process.exitCode = 1;
});
