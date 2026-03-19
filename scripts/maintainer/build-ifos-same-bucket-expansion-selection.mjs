#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const TODAY = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const AUDIT_PATH = getArg(
  "audit-json",
  path.join(ROOT, "output", "quality_marks", "quality_mark_audit.json"),
);
const LATEST_PATH = getArg(
  "latest-json",
  path.join(ROOT, "output", "quality_marks", "overnight_loop", "latest.json"),
);
const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", "quality_marks", `ifos_same_bucket_expansion_${TODAY}`),
);
const OUT_JSON = getArg("out-json", path.join(OUT_DIR, "selection.json"));
const OUT_MD = getArg("out-md", path.join(OUT_DIR, "selection.md"));
const BATCH_LIMIT = Math.max(1, Number(getArg("limit", "24")) || 24);

const { buildQualityMarkSourceCandidates } = await import("../../backend/src/qualityMarks/provider.ts");

const readJson = async (targetPath) => JSON.parse(await fs.readFile(targetPath, "utf8"));
const writeJson = async (targetPath, payload) => {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};
const writeText = async (targetPath, text) => {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, text, "utf8");
};

const safeText = (value) => String(value ?? "").trim();
const normalizeLower = (value) => safeText(value).toLowerCase();
const OMEGA_HINT_RE = /\b(omega|dha|epa|fish oil|cod liver|krill|flax|algae|oil)\b/i;

const increment = (map, key, by = 1) => {
  map[key] = (map[key] ?? 0) + by;
};

const sortCounts = (counts) =>
  Object.fromEntries(
    Object.entries(counts).sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    }),
  );

const buildPriorityMap = (latestReport) => {
  const verifiedBrands = [];
  for (const row of Array.isArray(latestReport?.newlyVerifiedSkus) ? latestReport.newlyVerifiedSkus : []) {
    if (safeText(row?.strongestProgramId) !== "ifos") continue;
    const brandName = safeText(row?.brandName);
    if (brandName && !verifiedBrands.includes(brandName)) verifiedBrands.push(brandName);
  }
  return new Map(verifiedBrands.map((brandName, index) => [normalizeLower(brandName), index]));
};

const pickRegistrySources = (row) => {
  const sources = buildQualityMarkSourceCandidates({
    identityType: "gtin14",
    identityValue: row.barcode_gtin14 ?? null,
    sourceType: "web",
    brandName: row.brandName,
    productName: row.productName,
  });
  return {
    brandSource: sources.find((source) => source.adapterKind === "nutrasource_brand_search") ?? null,
    productSource: sources.find((source) => source.adapterKind === "nutrasource_product_search") ?? null,
  };
};

const buildCandidateRow = (row, brandPriorityMap) => {
  const summary = row?.verificationSummary ?? {};
  const warnings = Array.isArray(summary?.warnings) ? summary.warnings.map(String) : [];
  const warningsSet = new Set(warnings);
  if (safeText(summary?.strongestProgramId) !== "ifos") return null;
  if (safeText(summary?.overallStatus) === "verified") return null;
  if (!summary?.officialRegistryChecked) return null;
  if (!warningsSet.has("brand_level_only_match")) return null;
  if (!warningsSet.has("registry_checked_not_found")) return null;

  const { brandSource, productSource } = pickRegistrySources(row);
  if (!brandSource || !productSource) return null;

  const brandName = safeText(row?.brandName);
  const productName = safeText(row?.productName);
  const brandPriority = brandPriorityMap.has(normalizeLower(brandName))
    ? brandPriorityMap.get(normalizeLower(brandName))
    : 99;
  const omegaLike = OMEGA_HINT_RE.test(productName);
  const priorityTier = brandPriority < 99 ? "primary" : "reserve";
  const priorityScore = (priorityTier === "primary" ? 1000 : 0) + (omegaLike ? 100 : 0) - brandPriority;

  return {
    key: safeText(row?.key),
    barcode: safeText(row?.barcode_gtin14),
    brandName,
    productName,
    strongestProgramId: "ifos",
    strongestProgramLabel: "IFOS",
    priorityTier,
    priorityScore,
    upliftBrand: brandPriority < 99,
    omegaLike,
    warnings,
    evidenceRef: safeText(row?.evidenceRef),
    brandSearchUrl: brandSource.url,
    brandSearchQuery: safeText(brandSource.queryText),
    productSearchUrl: productSource.url,
    productSearchQuery: safeText(productSource.queryText),
    detailPageFetchReady: true,
    detailPageFetchPlan:
      "Resolve ProductNum from Nutrasource product search list, then fetch https://certifications.nutrasource.ca/certified-products/product?id=<ProductNum>.",
    selectionReason:
      priorityTier === "primary"
        ? "ifos_same_bucket_primary_after_r1_pass"
        : "ifos_same_bucket_reserve_after_r1_pass",
  };
};

const toMarkdown = (report) => {
  const lines = [
    "# IFOS Same-Bucket Expansion Selection",
    "",
    `Generated at: ${report.generatedAt}`,
    "",
    "## Summary",
    `- Primary batch rows: ${report.primaryBatchCount}`,
    `- Reserve rows: ${report.reserveCount}`,
    `- Batch limit: ${report.batchLimit}`,
    `- Uplift-proven IFOS brands: ${report.upliftBrands.join(", ") || "none"}`,
    "",
    "## Brand Counts",
  ];

  for (const [brandName, count] of Object.entries(report.brandCounts)) {
    lines.push(`- ${brandName}: ${count}`);
  }

  lines.push("", "## Primary Batch");
  for (const row of report.rows) {
    lines.push(
      `- ${row.brandName} | ${row.productName} | query=${row.productSearchQuery} | omegaLike=${row.omegaLike ? "yes" : "no"}`,
    );
  }

  if (report.reserveRows.length > 0) {
    lines.push("", "## Reserve");
    for (const row of report.reserveRows) {
      lines.push(`- ${row.brandName} | ${row.productName} | query=${row.productSearchQuery}`);
    }
  }

  return `${lines.join("\n")}\n`;
};

const main = async () => {
  const [auditPayload, latestReport] = await Promise.all([
    readJson(AUDIT_PATH),
    readJson(LATEST_PATH),
  ]);

  const brandPriorityMap = buildPriorityMap(latestReport);
  const candidates = (Array.isArray(auditPayload?.rows) ? auditPayload.rows : [])
    .map((row) => buildCandidateRow(row, brandPriorityMap))
    .filter(Boolean)
    .sort((a, b) => {
      if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
      if (a.brandName !== b.brandName) return a.brandName.localeCompare(b.brandName);
      return a.productName.localeCompare(b.productName);
    });

  const primaryRows = candidates.filter((row) => row.priorityTier === "primary");
  const reserveRows = candidates.filter((row) => row.priorityTier !== "primary");
  const rows = primaryRows.slice(0, BATCH_LIMIT);

  const report = {
    schemaVersion: "ifos_same_bucket_expansion_selection.v1",
    generatedAt: new Date().toISOString(),
    inputs: {
      auditPath: AUDIT_PATH,
      latestPath: LATEST_PATH,
    },
    upliftBrands: Array.from(brandPriorityMap.keys()),
    batchLimit: BATCH_LIMIT,
    candidateCount: candidates.length,
    primaryBatchCount: rows.length,
    reserveCount: reserveRows.length,
    brandCounts: sortCounts(
      rows.reduce((acc, row) => {
        increment(acc, row.brandName);
        return acc;
      }, {}),
    ),
    rows,
    reserveRows,
  };

  await writeJson(OUT_JSON, report);
  await writeText(OUT_MD, toMarkdown(report));
  console.log(
    JSON.stringify(
      {
        ok: true,
        outJson: OUT_JSON,
        outMd: OUT_MD,
        primaryBatchCount: report.primaryBatchCount,
        reserveCount: report.reserveCount,
      },
      null,
      2,
    ),
  );
};

await main();
