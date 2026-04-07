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

type OverlayRow = {
  product_id: string;
  brand_name: string;
  title: string;
  source_zip_path: string | null;
  supplement_facts: Record<string, unknown> | null;
};

type IngredientFamily =
  | "no_structured_rows"
  | "vitamins_minerals"
  | "fiber_prebiotic"
  | "protein_amino"
  | "omega_fats"
  | "probiotics_enzymes"
  | "herbs_botanicals"
  | "food_beverage"
  | "other";

type SourcePriorityRow = {
  sourceZipPath: string;
  count: number;
  sharePercent: number;
  topBrands: { brandName: string; count: number }[];
  topIngredientFamilies: { family: IngredientFamily; count: number }[];
  sampleProducts: { productId: string; title: string; brandName: string }[];
};

type PriorityReport = {
  generatedAt: string;
  projectRef: string;
  inputQueueJsonl: string;
  parserPartialFactsCount: number;
  topBrands: { brandName: string; count: number }[];
  topIngredientFamilies: { family: IngredientFamily; count: number }[];
  topSourcePriorities: SourcePriorityRow[];
};

const PROJECT_REF = "dlwlobgmjzcmpirwvetq";
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;
const FETCH_CHUNK = 200;
const SOURCE_LIMIT = Math.max(5, Number(getArg("top") ?? "20"));

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
    `${new Date().toISOString().replace(/[:.]/g, "-")}_iherb_parser_partial_facts_priority`,
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

const readNutritionRows = (supplementFacts: Record<string, unknown> | null): Record<string, unknown>[] => {
  if (!supplementFacts) return [];
  const rows =
    (Array.isArray(supplementFacts.nutritionalFacts) ? supplementFacts.nutritionalFacts : null) ??
    (Array.isArray(supplementFacts.nutritional_facts) ? supplementFacts.nutritional_facts : null) ??
    [];
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
};

const classifyIngredientFamily = (name: string): IngredientFamily => {
  const normalized = name.toLowerCase();

  if (
    /\b(vitamin|niacin|riboflavin|thiamin|folate|folic acid|biotin|pantothenic|calcium|magnesium|zinc|iron|selenium|iodine|copper|potassium|sodium|chromium|boron|manganese|molybdenum|phosphorus|choline)\b/.test(
      normalized,
    )
  ) {
    return "vitamins_minerals";
  }

  if (/\b(fiber|inulin|psyllium|prebiotic|fructooligosaccharide|fos|gos)\b/.test(normalized)) {
    return "fiber_prebiotic";
  }

  if (
    /\b(protein|whey|casein|collagen|amino|bcaa|leucine|isoleucine|valine|creatine|glutamine|carnitine|taurine|tyrosine)\b/.test(
      normalized,
    )
  ) {
    return "protein_amino";
  }

  if (/\b(omega|fish oil|krill|dha|epa|ala|flax|algae oil|mct)\b/.test(normalized)) {
    return "omega_fats";
  }

  if (
    /\b(probiotic|prebiotic|enzyme|lactobacillus|bifidobacterium|bacillus|streptococcus|saccharomyces|protease|lipase|amylase|cellulase|bromelain|papaya enzyme)\b/.test(
      normalized,
    )
  ) {
    return "probiotics_enzymes";
  }

  if (/\b(coffee|tea|cocoa|matcha|juice|greens|beet|berry|superfood)\b/.test(normalized)) {
    return "food_beverage";
  }

  if (
    /\b(extract|root|leaf|bark|mushroom|turmeric|ginger|ashwagandha|elderberry|echinacea|maca|ginseng|milk thistle|reishi|lion's mane|cordyceps|herb)\b/.test(
      normalized,
    )
  ) {
    return "herbs_botanicals";
  }

  return "other";
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
      throw new Error(`Failed to fetch overlay rows for parser_partial_facts products: ${error.message}`);
    }

    for (const row of (data ?? []) as OverlayRow[]) {
      rows.set(row.product_id, row);
    }
  }
  return rows;
};

const run = async () => {
  const queueJsonlPath = await queueJsonlPathPromise;
  const outputDir = await outputDirPromise;
  await fs.mkdir(outputDir, { recursive: true });

  const raw = await fs.readFile(queueJsonlPath, "utf8");
  const queueRows = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as QueueRow)
    .filter((row) => row.remediationLane === "parser_partial_facts");

  const productIds = [...new Set(queueRows.map((row) => row.productId))];
  const overlayByProductId = await fetchOverlayRowsByProductIds(productIds);

  const overallBrandCounts = new Map<string, number>();
  const overallFamilyCounts = new Map<IngredientFamily, number>();
  const sourceCounts = new Map<string, number>();
  const sourceBrandCounts = new Map<string, Map<string, number>>();
  const sourceFamilyCounts = new Map<string, Map<IngredientFamily, number>>();
  const sourceSamples = new Map<string, { productId: string; title: string; brandName: string }[]>();

  for (const queueRow of queueRows) {
    const overlayRow = overlayByProductId.get(queueRow.productId);
    const sourceZipPath = overlayRow?.source_zip_path ?? queueRow.sourceZipPath ?? "unknown_source";
    const brandName = overlayRow?.brand_name ?? queueRow.brandName;
    const title = overlayRow?.title ?? queueRow.title;

    increment(overallBrandCounts, brandName);
    increment(sourceCounts, sourceZipPath);

    if (!sourceBrandCounts.has(sourceZipPath)) {
      sourceBrandCounts.set(sourceZipPath, new Map<string, number>());
    }
    increment(sourceBrandCounts.get(sourceZipPath) as Map<string, number>, brandName);

    if (!sourceSamples.has(sourceZipPath)) {
      sourceSamples.set(sourceZipPath, []);
    }
    const samples = sourceSamples.get(sourceZipPath) as { productId: string; title: string; brandName: string }[];
    if (samples.length < 3) {
      samples.push({ productId: queueRow.productId, title, brandName });
    }

    const normalizedRows = normalizeIherbSupplementFactsRowsWithTitleFallback({
      rows: readNutritionRows(overlayRow?.supplement_facts ?? null),
      title: overlayRow?.title ?? null,
      brandName: overlayRow?.brand_name ?? null,
      sourceZipPath: overlayRow?.source_zip_path ?? queueRow.sourceZipPath,
    });
    const families = new Set<IngredientFamily>();
    if (normalizedRows.length === 0) {
      families.add("no_structured_rows");
    } else {
      for (const normalizedRow of normalizedRows) {
        families.add(classifyIngredientFamily(normalizedRow.name));
      }
    }

    if (!sourceFamilyCounts.has(sourceZipPath)) {
      sourceFamilyCounts.set(sourceZipPath, new Map<IngredientFamily, number>());
    }
    const familyCountsForSource = sourceFamilyCounts.get(sourceZipPath) as Map<IngredientFamily, number>;

    for (const family of families) {
      increment(overallFamilyCounts, family);
      increment(familyCountsForSource, family);
    }
  }

  const topSourcePriorities: SourcePriorityRow[] = [...sourceCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, SOURCE_LIMIT)
    .map(([sourceZipPath, count]) => ({
      sourceZipPath,
      count,
      sharePercent: Number(((count / queueRows.length) * 100).toFixed(2)),
      topBrands: toTopEntries(
        (sourceBrandCounts.get(sourceZipPath) ?? new Map<string, number>()) as Map<string, number>,
        "brandName",
        3,
      ) as { brandName: string; count: number }[],
      topIngredientFamilies: toTopEntries(
        (sourceFamilyCounts.get(sourceZipPath) ?? new Map<IngredientFamily, number>()) as Map<IngredientFamily, number>,
        "family",
        4,
      ) as { family: IngredientFamily; count: number }[],
      sampleProducts: sourceSamples.get(sourceZipPath) ?? [],
    }));

  const report: PriorityReport = {
    generatedAt: new Date().toISOString(),
    projectRef: PROJECT_REF,
    inputQueueJsonl: queueJsonlPath,
    parserPartialFactsCount: queueRows.length,
    topBrands: toTopEntries(overallBrandCounts, "brandName", 20) as { brandName: string; count: number }[],
    topIngredientFamilies: toTopEntries(overallFamilyCounts, "family", 12) as {
      family: IngredientFamily;
      count: number;
    }[],
    topSourcePriorities,
  };

  const jsonPath = path.join(outputDir, "iherb_parser_partial_facts_priority.json");
  const mdPath = path.join(outputDir, "iherb_parser_partial_facts_priority.md");

  const markdownLines: string[] = [
    "# iHerb Parser Partial Facts Priority",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Input queue: ${report.inputQueueJsonl}`,
    `- parser_partial_facts rows: ${report.parserPartialFactsCount}`,
    "",
    "## Top Ingredient Families",
    ...report.topIngredientFamilies.map(
      (familyRow) => `- ${familyRow.family}: ${familyRow.count}`,
    ),
    "",
    "## Top Brands",
    ...report.topBrands.map((brandRow) => `- ${brandRow.brandName}: ${brandRow.count}`),
    "",
    "## Top Source Priorities",
  ];

  for (const sourceRow of report.topSourcePriorities) {
    markdownLines.push(`- ${sourceRow.sourceZipPath}: ${sourceRow.count} rows (${sourceRow.sharePercent}%)`);
    markdownLines.push(
      `  top brands: ${sourceRow.topBrands.map((brandRow) => `${brandRow.brandName} (${brandRow.count})`).join(", ") || "n/a"}`,
    );
    markdownLines.push(
      `  top ingredient families: ${sourceRow.topIngredientFamilies.map((familyRow) => `${familyRow.family} (${familyRow.count})`).join(", ") || "n/a"}`,
    );
    markdownLines.push(
      `  sample products: ${sourceRow.sampleProducts.map((sample) => `${sample.brandName} — ${sample.title}`).join(" | ") || "n/a"}`,
    );
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
        parserPartialFactsCount: report.parserPartialFactsCount,
        topSourceZipPath: report.topSourcePriorities[0]?.sourceZipPath ?? null,
      },
      null,
      2,
    ),
  );
};

run().catch((error) => {
  console.error("[iherb-parser-partial-facts-priority] failed", error);
  process.exitCode = 1;
});
