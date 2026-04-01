#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";
import { normalizeText } from "./lib/iherb-overlay-utils.mjs";

const ROOT = process.cwd();
const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const DEFAULT_BRANDS = [
  "Solaray",
  "Nutricost",
  "Source Naturals",
  "Gaia Herbs",
  "Country Life",
  "Natural Factors",
];

const ACTIVE_IMPORT_QUALITY_PATH = path.join(
  ROOT,
  "docs",
  "exec-plans",
  "active",
  "p0_p3_product_closure",
  "import_quality_validation_report.json",
);
const FALLBACK_STAGING_PATH = path.join(
  ROOT,
  "output",
  "refill_mega_04",
  "item_expansion_02",
  "merge_validation_full",
  "staging_products.scrapling_merged.payload.json",
);

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));
const writeJson = async (filePath, payload) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};
const writeText = async (filePath, body) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${body}`, "utf8");
};

const toArray = (value) => (Array.isArray(value) ? value : []);
const asBool = (value) => value === true;
const csvEscape = (value) => {
  const text = String(value ?? "");
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, "\"\"")}"`;
};

const parseBrands = (value) =>
  (normalizeText(value)
    ? normalizeText(value)
        .split(",")
        .map((entry) => normalizeText(entry))
        .filter(Boolean)
    : DEFAULT_BRANDS
  );

const resolveDefaultStagingPath = async () => {
  try {
    const report = await readJson(ACTIVE_IMPORT_QUALITY_PATH);
    const stagingPath = normalizeText(report?.inputs?.stagingPath);
    if (stagingPath) return path.resolve(ROOT, stagingPath);
  } catch {
    // Fall back to the last known strict baseline staging payload.
  }
  return FALLBACK_STAGING_PATH;
};

const toRows = (payload) => (Array.isArray(payload) ? payload : toArray(payload?.products));

const buildCandidateRow = (row) => {
  const completeness = row?.completeness ?? {};
  const sourceSummary = row?.sourceSummary ?? {};
  const missing = toArray(completeness?.coreMissingFields);
  return {
    productId: normalizeText(row?.productId) || null,
    barcodeGtin14: normalizeText(row?.barcode_gtin14) || null,
    brandName: normalizeText(row?.brandName) || null,
    title: normalizeText(row?.title) || null,
    status: normalizeText(completeness?.status) || null,
    coreMissingFields: missing,
    missingCoreFieldCount: missing.length,
    hasUsIherbPage: asBool(sourceSummary?.hasUsIherbPage),
    npnIgnored: asBool(sourceSummary?.npnIgnored),
    highConfidenceUsProductPageReady: asBool(row?.highConfidenceUsProductPageReady),
    sourceTypes: toArray(sourceSummary?.sourceTypes).map((entry) => normalizeText(entry)).filter(Boolean),
    categories: toArray(row?.categories).map((entry) => normalizeText(entry)).filter(Boolean),
    link: normalizeText(row?.link) || null,
  };
};

const toMarkdown = ({ generatedAt, stagingPath, brands, summary, rowsByBrand }) => {
  const lines = [
    "# Strict Upside Candidate Pack",
    "",
    `- generatedAt: ${generatedAt}`,
    `- stagingPath: ${stagingPath}`,
    `- brands: ${brands.join(", ")}`,
    `- totalCandidates: ${summary.totalCandidates}`,
    "",
    "## Brand Summary",
    "",
  ];

  for (const brandSummary of summary.brands) {
    lines.push(`- ${brandSummary.brandName}: ${brandSummary.candidateCount} candidates`);
    lines.push(`  missing combos: ${brandSummary.topMissingCombos.map(([combo, count]) => `${combo || "(none)"} x${count}`).join(" | ") || "(none)"}`);
  }

  for (const brand of brands) {
    const rows = rowsByBrand[brand] ?? [];
    lines.push("", `## ${brand}`, "");
    if (rows.length === 0) {
      lines.push("- no candidates");
      continue;
    }
    for (const row of rows) {
      lines.push(
        `- ${row.productId || "n/a"} | ${row.title || "untitled"} | missing=${row.coreMissingFields.join(", ") || "(none)"} | barcode=${row.barcodeGtin14 || "n/a"}`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
};

const toCsv = (rows) => {
  const header = [
    "brandName",
    "productId",
    "barcodeGtin14",
    "title",
    "status",
    "missingCoreFieldCount",
    "coreMissingFields",
    "hasUsIherbPage",
    "npnIgnored",
    "highConfidenceUsProductPageReady",
    "sourceTypes",
    "categories",
    "link",
  ];
  const body = rows.map((row) =>
    [
      row.brandName,
      row.productId,
      row.barcodeGtin14,
      row.title,
      row.status,
      row.missingCoreFieldCount,
      row.coreMissingFields.join(" | "),
      row.hasUsIherbPage,
      row.npnIgnored,
      row.highConfidenceUsProductPageReady,
      row.sourceTypes.join(" | "),
      row.categories.join(" | "),
      row.link,
    ]
      .map(csvEscape)
      .join(","),
  );
  return `${header.join(",")}\n${body.join("\n")}\n`;
};

const main = async () => {
  const stagingPath = path.resolve(ROOT, getArg("staging-json", await resolveDefaultStagingPath()));
  const brands = parseBrands(getArg("brands", ""));
  const outDir = path.resolve(
    ROOT,
    getArg(
      "out-dir",
      path.join(ROOT, "output", `strict_upside_brand_candidates_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`),
    ),
  );

  const payload = await readJson(stagingPath);
  const candidateRows = toRows(payload)
    .map(buildCandidateRow)
    .filter((row) => brands.includes(row.brandName))
    .filter((row) => row.status === "partial_overlay")
    .filter((row) => row.hasUsIherbPage && !row.npnIgnored)
    .filter((row) => row.missingCoreFieldCount >= 1 && row.missingCoreFieldCount <= 2)
    .sort((left, right) =>
      left.brandName.localeCompare(right.brandName) ||
      left.missingCoreFieldCount - right.missingCoreFieldCount ||
      (left.title || "").localeCompare(right.title || ""),
    );

  const rowsByBrand = Object.fromEntries(brands.map((brand) => [brand, candidateRows.filter((row) => row.brandName === brand)]));
  const summary = {
    totalCandidates: candidateRows.length,
    brands: brands.map((brand) => {
      const rows = rowsByBrand[brand] ?? [];
      const comboCounts = new Map();
      for (const row of rows) {
        const key = row.coreMissingFields.join(", ");
        comboCounts.set(key, (comboCounts.get(key) ?? 0) + 1);
      }
      return {
        brandName: brand,
        candidateCount: rows.length,
        productIds: rows.map((row) => row.productId).filter(Boolean),
        topMissingCombos: [...comboCounts.entries()].sort((left, right) => right[1] - left[1]).slice(0, 5),
      };
    }),
  };

  const report = {
    generatedAt: new Date().toISOString(),
    stagingPath,
    brands,
    summary,
    rowsByBrand,
  };

  await fs.mkdir(outDir, { recursive: true });
  await writeJson(path.join(outDir, "strict_upside_candidates.json"), report);
  await writeJson(
    path.join(outDir, "strict_upside_product_ids_by_brand.json"),
    Object.fromEntries(summary.brands.map((entry) => [entry.brandName, entry.productIds])),
  );
  await writeText(path.join(outDir, "strict_upside_candidates.csv"), toCsv(candidateRows));
  await writeText(path.join(outDir, "summary.md"), toMarkdown(report));

  console.log(
    JSON.stringify(
      {
        ok: true,
        generatedAt: report.generatedAt,
        outDir,
        totalCandidates: summary.totalCandidates,
        byBrand: summary.brands.map((entry) => ({
          brandName: entry.brandName,
          candidateCount: entry.candidateCount,
        })),
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
