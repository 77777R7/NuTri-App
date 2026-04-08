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

type SplitLane =
  | "likely_non_supplement_surface"
  | "likely_parser_failure_supplement_surface"
  | "manual_review";

type SplitSummary = {
  count: number;
  topBrands: { brandName: string; count: number }[];
  topSourceZipPaths: { sourceZipPath: string; count: number }[];
  sampleProducts: {
    productId: string;
    brandName: string;
    title: string;
    sourceZipPath: string | null;
    firstRawRows: string[];
  }[];
  suggestedFix: string;
};

type SplitRow = {
  splitLane: SplitLane;
  productId: string;
  brandName: string;
  title: string;
  sourceZipPath: string | null;
  firstRawRows: string[];
};

type SplitReport = {
  generatedAt: string;
  projectRef: string;
  inputQueueJsonl: string;
  rowsPresentButUnparsedCount: number;
  splitSummary: Record<SplitLane, SplitSummary>;
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
    `${new Date().toISOString().replace(/[:.]/g, "-")}_iherb_rows_present_unparsed_split`,
  );
})();

const getServiceRoleKey = (): string => {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env.SUPABASE_SERVICE_ROLE_KEY;

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
      throw new Error(`Failed to fetch overlay rows for rows_present_unparsed split: ${error.message}`);
    }
    for (const row of (data ?? []) as OverlayRow[]) {
      rows.set(row.product_id, row);
    }
  }
  return rows;
};

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

const NON_SUPPLEMENT_PATTERNS = [
  /\btea\b/i,
  /\bcoffee\b/i,
  /\bhoney\b/i,
  /\bsauce\b/i,
  /\bseasonings?\b/i,
  /\bspices?\b/i,
  /\bmarinade\b/i,
  /\baminos\b/i,
  /\bsweetener\b/i,
  /\bjam\b/i,
  /\bjelly\b/i,
  /\bspread\b/i,
  /\bbutter\b/i,
  /\bchocolate\b/i,
  /\bcandy\b/i,
  /\bsnacks?\b/i,
  /\bpopcorn\b/i,
  /\bchips?\b/i,
  /\bcrackers?\b/i,
  /\boats?\b/i,
  /\bfood\b/i,
  /\bbeverage\b/i,
  /\bdrink\b/i,
  /\bbroth\b/i,
  /\bpowdered honey\b/i,
  /\bvinegar\b/i,
  /\bculinary\b/i,
  /\bwalden farms\b/i,
  /\bfrontier co-op\b/i,
  /\bbuddha teas\b/i,
  /\begmont honey\b/i,
  /\bdelighteas\b/i,
  /\bgaea\b/i,
  /\burban accents\b/i,
  /\blawry'?s\b/i,
  /\bcomvita\b/i,
  /\bbragg\b/i,
];

const SUPPLEMENT_HARD_SIGNAL_PATTERNS = [
  /\bcapsules?\b/i,
  /\btablets?\b/i,
  /\bsoftgels?\b/i,
  /\bveg(?:gie)?\s*caps?\b/i,
  /\bgummies?\b/i,
  /\bprobiotic\b/i,
  /\benzyme\b/i,
  /\bextract\b/i,
  /\bformula\b/i,
  /\bcomplex\b/i,
  /\bblend\b/i,
  /\bdrops?\b/i,
  /\bspray\b/i,
  /\bcaps\b/i,
  /\bcfu\b/i,
  /\bper capsule\b/i,
  /\bper tablet\b/i,
  /\bper softgel\b/i,
  /\bmg\b/i,
  /\bmcg\b/i,
];

const classifySplitLane = (title: string, brandName: string, rawRowNames: string[]): SplitLane => {
  const corpus = `${title} ${brandName} ${rawRowNames.join(" | ")}`;
  const nonSupplementHit = NON_SUPPLEMENT_PATTERNS.some((pattern) => pattern.test(corpus));
  const supplementHit = SUPPLEMENT_HARD_SIGNAL_PATTERNS.some((pattern) => pattern.test(corpus));

  if (nonSupplementHit && !supplementHit) {
    return "likely_non_supplement_surface";
  }

  if (supplementHit && !nonSupplementHit) {
    return "likely_parser_failure_supplement_surface";
  }

  return "manual_review";
};

const suggestedFixByLane: Record<SplitLane, string> = {
  likely_non_supplement_surface:
    "Add or strengthen a non-supplement / pantry surface gate so these products do not flow into supplement-goal scoring.",
  likely_parser_failure_supplement_surface:
    "Prioritize parser/filter-rule fixes for this set; these products look like real supplement surfaces with rows present but zero structured ingredients.",
  manual_review:
    "Manual review needed; this bucket mixes supplement and food-like signals or lacks enough intent signal to auto-route cleanly.",
};

const SPLIT_LANES: readonly SplitLane[] = [
  "likely_non_supplement_surface",
  "likely_parser_failure_supplement_surface",
  "manual_review",
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

  const splitCounts = new Map<SplitLane, number>();
  const splitBrandCounts = new Map<SplitLane, Map<string, number>>();
  const splitZipCounts = new Map<SplitLane, Map<string, number>>();
  const splitSamples = new Map<
    SplitLane,
    { productId: string; brandName: string; title: string; sourceZipPath: string | null; firstRawRows: string[] }[]
  >();
  const splitRows: SplitRow[] = [];

  for (const lane of SPLIT_LANES) {
    splitBrandCounts.set(lane, new Map<string, number>());
    splitZipCounts.set(lane, new Map<string, number>());
    splitSamples.set(lane, []);
  }

  let rowsPresentButUnparsedCount = 0;

  for (const queueRow of parserPartialFactsRows) {
    const overlayRow = overlayByProductId.get(queueRow.productId);
    const nutritionRows = readNutritionRows(overlayRow?.supplement_facts ?? null);
    if (nutritionRows.length === 0) continue;

    const normalizedRows = normalizeIherbSupplementFactsRowsWithTitleFallback({
      rows: nutritionRows,
      title: overlayRow?.title ?? queueRow.title,
      brandName: overlayRow?.brand_name ?? queueRow.brandName,
      sourceZipPath: overlayRow?.source_zip_path ?? queueRow.sourceZipPath,
    });
    if (normalizedRows.length > 0) continue;

    const rawRowNames = nutritionRows
      .map((row) => String(row.substancy ?? "").trim())
      .filter(Boolean);

    rowsPresentButUnparsedCount += 1;
    const lane = classifySplitLane(
      overlayRow?.title ?? queueRow.title,
      overlayRow?.brand_name ?? queueRow.brandName,
      rawRowNames,
    );
    splitRows.push({
      splitLane: lane,
      productId: queueRow.productId,
      brandName: overlayRow?.brand_name ?? queueRow.brandName,
      title: overlayRow?.title ?? queueRow.title,
      sourceZipPath: overlayRow?.source_zip_path ?? queueRow.sourceZipPath,
      firstRawRows: rawRowNames.slice(0, 2),
    });

    increment(splitCounts, lane);
    increment(splitBrandCounts.get(lane) as Map<string, number>, overlayRow?.brand_name ?? queueRow.brandName);
    increment(
      splitZipCounts.get(lane) as Map<string, number>,
      overlayRow?.source_zip_path ?? queueRow.sourceZipPath ?? "unknown_source",
    );

    const samples = splitSamples.get(lane) as {
      productId: string;
      brandName: string;
      title: string;
      sourceZipPath: string | null;
      firstRawRows: string[];
    }[];
    if (samples.length < SAMPLE_LIMIT) {
      samples.push({
        productId: queueRow.productId,
        brandName: overlayRow?.brand_name ?? queueRow.brandName,
        title: overlayRow?.title ?? queueRow.title,
        sourceZipPath: overlayRow?.source_zip_path ?? queueRow.sourceZipPath,
        firstRawRows: rawRowNames.slice(0, 2),
      });
    }
  }

  const splitSummary = Object.fromEntries(
    SPLIT_LANES.map((lane) => [
      lane,
      {
        count: splitCounts.get(lane) ?? 0,
        topBrands: toTopEntries(splitBrandCounts.get(lane) as Map<string, number>, "brandName", 12) as {
          brandName: string;
          count: number;
        }[],
        topSourceZipPaths: toTopEntries(splitZipCounts.get(lane) as Map<string, number>, "sourceZipPath", 12) as {
          sourceZipPath: string;
          count: number;
        }[],
        sampleProducts: splitSamples.get(lane) ?? [],
        suggestedFix: suggestedFixByLane[lane],
      },
    ]),
  ) as Record<SplitLane, SplitSummary>;

  const report: SplitReport = {
    generatedAt: new Date().toISOString(),
    projectRef: PROJECT_REF,
    inputQueueJsonl: queueJsonlPath,
    rowsPresentButUnparsedCount,
    splitSummary,
  };

  const jsonPath = path.join(outputDir, "iherb_rows_present_unparsed_split.json");
  const jsonlPath = path.join(outputDir, "iherb_rows_present_unparsed_split.jsonl");
  const mdPath = path.join(outputDir, "iherb_rows_present_unparsed_split.md");

  const markdownLines: string[] = [
    "# iHerb Rows Present But Unparsed Split",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Input queue: ${report.inputQueueJsonl}`,
    `- rows_present_but_unparsed count: ${report.rowsPresentButUnparsedCount}`,
    "",
  ];

  for (const lane of SPLIT_LANES) {
    const summary = splitSummary[lane];
    markdownLines.push(`## ${lane}`);
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
        (sample) =>
          `- sample: ${sample.brandName} — ${sample.title} [${sample.productId}] :: ${sample.firstRawRows.join(" || ")}`,
      ),
    );
    markdownLines.push("");
  }

  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(jsonlPath, `${splitRows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
  await fs.writeFile(mdPath, `${markdownLines.join("\n")}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        status: "ok",
        outputDir,
        jsonPath,
        jsonlPath,
        mdPath,
        rowsPresentButUnparsedCount,
        splitCounts: Object.fromEntries(SPLIT_LANES.map((lane) => [lane, splitSummary[lane].count])),
      },
      null,
      2,
    ),
  );
};

run().catch((error) => {
  console.error("[iherb-rows-present-unparsed-split] failed", error);
  process.exitCode = 1;
});
