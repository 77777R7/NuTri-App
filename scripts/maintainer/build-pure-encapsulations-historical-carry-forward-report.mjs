#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

import {
  normalizeText,
} from "./lib/iherb-overlay-utils.mjs";

const ROOT = process.cwd();
const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const DEFAULT_UNRESOLVED_JSON = path.join(
  ROOT,
  "output",
  "pure_encapsulations_official_url_resolver_v3",
  "unresolved_rows.json",
);
const DEFAULT_HISTORY_JSON = path.join(
  ROOT,
  "output",
  "p0_p3_v1_strict_only_merge_cohort_20260318",
  "v1_strict_only_full_staging.json",
);
const DEFAULT_EXTRA_ROWS_JSON = path.join(
  ROOT,
  "output",
  "pure_encapsulations_official_url_resolver_v3",
  "resolved_rows.json",
);
const DEFAULT_OUT_DIR = path.join(
  ROOT,
  "output",
  `pure_encapsulations_historical_carry_forward_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`,
);

const UNRESOLVED_JSON = path.resolve(ROOT, getArg("unresolved-json", DEFAULT_UNRESOLVED_JSON));
const HISTORY_JSON = path.resolve(ROOT, getArg("history-staging-json", DEFAULT_HISTORY_JSON));
const EXTRA_ROWS_JSON = path.resolve(ROOT, getArg("extra-rows-json", DEFAULT_EXTRA_ROWS_JSON));
const OUT_DIR = path.resolve(ROOT, getArg("out-dir", DEFAULT_OUT_DIR));

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));
const writeJson = async (filePath, payload) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};
const writeText = async (filePath, body) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, body, "utf8");
};

const toArray = (value) => (Array.isArray(value) ? value : []);
const lower = (value) => normalizeText(value).toLowerCase();

const MANUAL_TITLE_ALIASES = {
  "l-glutamine powder": ["l-glutamine powder"],
  "magnesium (powder)": ["magnesium powder"],
  "puregenomics multivitamin": ["puregenomics multivitamin"],
  "ubiquinol-qh 100 mg": ["ubiquinol-qh 100 mg"],
  "vitamin d3 25 mcg": ["vitamin d3, 25 mcg"],
  "ultra b-complex w/ pqq": ["ultra-b-complex with pqq"],
  "ultra pure pack": ["ultra pure pack"],
  "niacitol 650 mg": ["niacitol"],
  "vitamin d3 250 mcg": ["vitamin d3, 250 mcg"],
  "mineral 650 without copper & iron": ["nutrient 950 without copper and iron"],
  "methylcobalamin 1000 mcg": ["methylcobalamin 1 000 mcg"],
};

const MANUAL_HISTORY_PRODUCT_IDS = {
  "methylcobalamin 1000 mcg": "158058",
  "vitamin d3 250 mcg": "18820",
};

const buildCarryForwardCandidate = (historyRow, unresolvedRow) => {
  const sourceUrls = new Set(
    [
      ...(historyRow?.sourceSummary?.sourceUrls ?? []),
      historyRow?.link ?? null,
      ...(unresolvedRow?.knownProductUrls ?? []),
    ].filter(Boolean),
  );

  return {
    brandName: unresolvedRow?.brandName ?? historyRow?.brandName ?? historyRow?.brand ?? "Pure Encapsulations",
    title: unresolvedRow?.title ?? historyRow?.title ?? null,
    normalizedTitle:
      normalizeText(unresolvedRow?.title ?? historyRow?.normalizedTitle ?? historyRow?.title ?? null)
        .toLowerCase() || null,
    productId: unresolvedRow?.productId ?? historyRow?.productId ?? null,
    upcCode: unresolvedRow?.upcCode ?? historyRow?.upcCode ?? null,
    barcode_gtin14: unresolvedRow?.barcode_gtin14 ?? historyRow?.barcode_gtin14 ?? null,
    link: unresolvedRow?.knownProductUrls?.[0] ?? historyRow?.link ?? null,
    productCatalogImage: historyRow?.productCatalogImage ?? null,
    productImages: Array.isArray(historyRow?.productImages) ? historyRow.productImages : [],
    categories: Array.isArray(historyRow?.categories) ? historyRow.categories : [],
    count: historyRow?.count ?? historyRow?.packageQuantity ?? historyRow?.netContent ?? null,
    dosageForm: historyRow?.dosageForm ?? null,
    serving: historyRow?.serving ?? null,
    supplementFacts: historyRow?.supplementFacts ?? null,
    descriptionSections: historyRow?.descriptionSections ?? {},
    sourceSummary: {
      ...(historyRow?.sourceSummary ?? {}),
      sourceKind: "historical_carry_forward",
      sourceUrls: [...sourceUrls].sort(),
      sourceNotes: [
        ...new Set(
          [
            ...(historyRow?.sourceSummary?.sourceNotes ?? []),
            "pure_encapsulations_historical_full_overlay",
          ].filter(Boolean),
        ),
      ],
      sourceRank: Number(historyRow?.sourceSummary?.sourceRank ?? 95),
    },
    fetchDiagnostics: {
      extractionWarnings: ["historical_carry_forward"],
    },
  };
};

const canonicalize = (value) =>
  lower(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[®™•(),]/g, " ")
    .replace(/pure encapsulations/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const statusOf = (row) => row?.completeness?.status ?? row?.status ?? null;

const buildHistoryPool = (rows) =>
  rows.filter((row) => {
    const brand = lower(row?.brand ?? row?.brandName ?? "");
    return brand === "pure encapsulations" && statusOf(row) === "full_overlay_ready";
  });

const matchHistoryRow = (unresolvedRow, historyPool) => {
  const title = normalizeText(unresolvedRow?.title);
  const canonical = canonicalize(title);
  const aliasNeedles = MANUAL_TITLE_ALIASES[lower(title)] ?? [];
  const manualProductId = MANUAL_HISTORY_PRODUCT_IDS[lower(title)];

  if (manualProductId) {
    const manualMatch = historyPool.find((row) => normalizeText(row?.productId) === manualProductId);
    if (manualMatch) return manualMatch;
  }

  let matches = historyPool.filter((row) => {
    const candidateTitle = normalizeText(row?.title);
    const candidateCanonical = canonicalize(candidateTitle);
    if (candidateCanonical === canonical) return true;
    if (candidateCanonical.includes(canonical) || canonical.includes(candidateCanonical)) return true;
    return aliasNeedles.some((needle) => candidateCanonical.includes(canonicalize(needle)));
  });

  if (matches.length === 1) return matches[0];

  matches = matches.filter((row) => {
    const candidateTitle = lower(row?.title);
    const dosageForm = lower(row?.dosageForm ?? "");
    const titleLower = lower(title);
    if (titleLower.includes("powder")) return candidateTitle.includes("powder") || dosageForm.includes("powder");
    if (titleLower.includes("liquid")) return candidateTitle.includes("liquid") || dosageForm.includes("liquid");
    if (titleLower.includes("packet") || titleLower.includes("pack")) return candidateTitle.includes("pack");
    return true;
  });

  return matches.length === 1 ? matches[0] : null;
};

const main = async () => {
  const unresolvedRows = await readJson(UNRESOLVED_JSON);
  const extraRows = await readJson(EXTRA_ROWS_JSON);
  const historyRaw = await readJson(HISTORY_JSON);
  const historyRows = Array.isArray(historyRaw) ? historyRaw : (historyRaw.products ?? []);
  const historyPool = buildHistoryPool(historyRows);

  const queueRows = [
    ...unresolvedRows,
    ...extraRows.map((row) => ({
      productId: row.productId ?? null,
      title: row.title ?? null,
      brandName: "Pure Encapsulations",
      barcode_gtin14: null,
      knownProductUrls: row.productPageUrl ? [row.productPageUrl] : [],
      sourceTypes: row.sourceTypes ?? ["official_browser_resolved"],
      resolutionCode: "official_page_unavailable",
    })),
  ];

  const matchedRows = [];
  const stillUnmatchedRows = [];

  for (const unresolvedRow of queueRows) {
    const historyRow = matchHistoryRow(unresolvedRow, historyPool);
    if (!historyRow) {
      stillUnmatchedRows.push(unresolvedRow);
      continue;
    }
    const carryForwardRecord = buildCarryForwardCandidate(historyRow, unresolvedRow);
    const candidate = {
      ...carryForwardRecord,
    };
    matchedRows.push({
      unresolvedProductId: unresolvedRow.productId ?? null,
      unresolvedTitle: unresolvedRow.title ?? null,
      matchedHistoryProductId: historyRow.productId ?? null,
      matchedHistoryTitle: historyRow.title ?? null,
      candidate,
      result: {
        productId: unresolvedRow.productId ?? null,
        title: unresolvedRow.title ?? null,
        pageUrl: unresolvedRow.knownProductUrls?.[0] ?? null,
        outcome: "scrapling_candidate_built",
        sectionKeys: Object.keys(candidate.descriptionSections ?? {}),
        factRows: candidate.supplementFacts?.nutritionalFacts?.length ?? 0,
        hasPrimaryImage: Boolean(candidate.productCatalogImage),
        extractionWarnings: ["historical_carry_forward"],
        candidate,
      },
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    inputs: {
      unresolvedJson: UNRESOLVED_JSON,
      extraRowsJson: EXTRA_ROWS_JSON,
      historyJson: HISTORY_JSON,
    },
    selectedCount: matchedRows.length,
    results: matchedRows.map((row) => row.result),
  };

  const summary = {
    generatedAt: report.generatedAt,
    unresolvedInputCount: queueRows.length,
    matchedCarryForwardCount: matchedRows.length,
    stillUnmatchedCount: stillUnmatchedRows.length,
  };

  await fs.mkdir(OUT_DIR, { recursive: true });
  await writeJson(path.join(OUT_DIR, "summary.json"), summary);
  await writeJson(path.join(OUT_DIR, "matched_rows.json"), matchedRows);
  await writeJson(path.join(OUT_DIR, "still_unmatched_rows.json"), stillUnmatchedRows);
  await writeJson(path.join(OUT_DIR, "scrapling_official_fallback_report.json"), report);

  const md = [
    "# Pure Encapsulations Historical Carry Forward",
    "",
    `- unresolvedInputCount: ${summary.unresolvedInputCount}`,
    `- matchedCarryForwardCount: ${summary.matchedCarryForwardCount}`,
    `- stillUnmatchedCount: ${summary.stillUnmatchedCount}`,
    "",
    "## Matched Rows",
    ...matchedRows.map(
      (row) => `- ${row.unresolvedTitle} -> ${row.matchedHistoryTitle} (${row.matchedHistoryProductId})`,
    ),
  ].join("\n");
  await writeText(path.join(OUT_DIR, "summary.md"), `${md}\n`);

  console.log(JSON.stringify(summary, null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
