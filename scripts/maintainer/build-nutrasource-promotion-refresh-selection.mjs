#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

import { buildQualityMarkLookupKey } from "../../backend/src/qualityMarks/cache.ts";

const ROOT = process.cwd();
const TODAY = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const PROMOTION_SEED_PATH = getArg(
  "promotion-seed",
  path.join(
    ROOT,
    "output",
    "quality_marks",
    "nutrasource_catalog_closure_full_v2_20260315",
    "promotion_ready_seed.json",
  ),
);
const STAGING_PATH = getArg(
  "staging",
  path.join(
    ROOT,
    "output",
    "iherb_header_facts_week2_closure_v2_20260313",
    "staging_products.parser_enriched.json",
  ),
);
const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", "quality_marks", `nutrasource_promotion_refresh_selection_${TODAY}`),
);
const OUT_JSON = getArg("out-json", path.join(OUT_DIR, "selection.json"));
const OUT_MD = getArg("out-md", path.join(OUT_DIR, "selection.md"));

const safeText = (value) => String(value ?? "").trim();
const hasText = (value) => safeText(value).length > 0;
const nowIso = () => new Date().toISOString();

const eligibleProgramIds = (row) =>
  Array.from(
    new Set(
      (Array.isArray(row?.programsEffective) ? row.programsEffective : [])
        .map((value) => safeText(value).toLowerCase())
        .filter((value) => value === "ifos" || value === "igen"),
    ),
  );

const strongestProgramId = (programIds) => {
  if (programIds.includes("ifos")) return "ifos";
  if (programIds.includes("igen")) return "igen";
  return null;
};

const strongestProgramLabel = (programId) =>
  programId === "ifos" ? "IFOS" : programId === "igen" ? "IGEN" : "Unknown";

const toArrayRows = (payload) =>
  Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.products)
    ? payload.products
    : Array.isArray(payload?.rows)
    ? payload.rows
    : Array.isArray(payload?.items)
    ? payload.items
    : [];

const buildOverlayLookup = (payload) => {
  const byProductId = new Map();
  const byBarcode = new Map();

  for (const row of toArrayRows(payload)) {
    const productId = hasText(row?.productId) ? String(row.productId) : null;
    const barcode = hasText(row?.barcode_gtin14) ? String(row.barcode_gtin14) : null;
    const normalized = {
      productId,
      barcode,
      brandName: row?.brandName ?? null,
      productName: row?.title ?? null,
      link: row?.link ?? null,
    };
    if (productId && !byProductId.has(productId)) byProductId.set(productId, normalized);
    if (barcode && !byBarcode.has(barcode)) byBarcode.set(barcode, normalized);
  }

  return { byProductId, byBarcode };
};

const resolveCanonicalOverlayRecord = (matchedRecord, overlayLookup) => {
  if (!matchedRecord || typeof matchedRecord !== "object") return null;
  const productId = hasText(matchedRecord?.product_id) ? String(matchedRecord.product_id) : null;
  const barcode = hasText(matchedRecord?.barcode_gtin14) ? String(matchedRecord.barcode_gtin14) : null;
  if (productId && overlayLookup.byProductId.has(productId)) return overlayLookup.byProductId.get(productId);
  if (barcode && overlayLookup.byBarcode.has(barcode)) return overlayLookup.byBarcode.get(barcode);
  return null;
};

const toSelectionRow = (row, overlayLookup) => {
  const programIds = eligibleProgramIds(row);
  const strongestId = strongestProgramId(programIds);
  const matched = row?.matchedRecord ?? null;
  if (!strongestId || row?.matchTarget !== "iherb_overlay") return null;
  if (!hasText(matched?.product_id) || !hasText(matched?.barcode_gtin14)) return null;
  const canonicalOverlay = resolveCanonicalOverlayRecord(matched, overlayLookup);
  const canonicalBrandName = canonicalOverlay?.brandName ?? row.brandName ?? null;
  const canonicalProductName = canonicalOverlay?.productName ?? row.productName ?? null;
  const canonicalIherbUrl = canonicalOverlay?.link ?? matched.link ?? null;

  return {
    key: buildQualityMarkLookupKey({
      sourceType: "web",
      identityType: "gtin14",
      identityValue: String(matched.barcode_gtin14),
      brandName: canonicalBrandName,
      productName: canonicalProductName,
    }),
    productId: String(matched.product_id),
    barcode: String(matched.barcode_gtin14),
    brandName: canonicalBrandName,
    productName: canonicalProductName,
    iherbUrl: canonicalIherbUrl,
    strongestProgramId: strongestId,
    strongestProgramLabel: strongestProgramLabel(strongestId),
    selectionReason: "nutrasource_promotion_ready",
    detailProgramIds: programIds,
    detailPageUrl: row.detailUrl ?? null,
    detailProductNum: row.productNum ?? null,
    detailBrandId: row.brandId ?? null,
    brandDetailUrl:
      hasText(row?.brandId) ? `https://certifications.nutrasource.ca/certified-products/brand?id=${encodeURIComponent(String(row.brandId))}` : null,
    lotOptions: Array.isArray(row?.lotOptions) ? row.lotOptions : [],
    officialRegistryEvidenceUrl: row.detailUrl ?? null,
    officialRegistryProductName: row.productName ?? null,
    officialRegistryBrandName: row.brandName ?? null,
    matchedOverlayBrandName: canonicalOverlay?.brandName ?? null,
    matchedOverlayProductName: canonicalOverlay?.productName ?? null,
    programsEffective: programIds,
    promotionMatchOutcome: row.matchOutcome ?? null,
  };
};

const toMarkdown = (report) => {
  const lines = [];
  lines.push("# Nutrasource Promotion Refresh Selection");
  lines.push("");
  lines.push(`Generated at: ${report.generatedAt}`);
  lines.push(`Selected rows: ${report.selectedCount}`);
  lines.push("");
  lines.push("## Program Mix");
  lines.push("");
  for (const [program, count] of Object.entries(report.programCounts)) {
    lines.push(`- ${program}: ${count}`);
  }
  lines.push("");
  lines.push("## Sample");
  lines.push("");
  for (const row of report.rows.slice(0, 30)) {
    lines.push(`- ${row.strongestProgramLabel} | ${row.brandName} | ${row.productName} | ${row.iherbUrl ?? "no-url"}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const promotionSeed = JSON.parse(await fs.readFile(PROMOTION_SEED_PATH, "utf8"));
  const staging = JSON.parse(await fs.readFile(STAGING_PATH, "utf8"));
  const overlayLookup = buildOverlayLookup(staging);
  const rows = (Array.isArray(promotionSeed?.rows) ? promotionSeed.rows : [])
    .map((row) => toSelectionRow(row, overlayLookup))
    .filter(Boolean)
    .sort((a, b) => {
      if (a.strongestProgramId !== b.strongestProgramId) {
        return a.strongestProgramId.localeCompare(b.strongestProgramId);
      }
      return `${a.brandName ?? ""}|${a.productName ?? ""}`.localeCompare(`${b.brandName ?? ""}|${b.productName ?? ""}`);
    });

  const report = {
    schemaVersion: "nutrasource_promotion_refresh_selection.v1",
    generatedAt: nowIso(),
    promotionSeedPath: PROMOTION_SEED_PATH,
    stagingPath: STAGING_PATH,
    selectedCount: rows.length,
    programCounts: rows.reduce((acc, row) => {
      acc[row.strongestProgramLabel] = (acc[row.strongestProgramLabel] ?? 0) + 1;
      return acc;
    }, {}),
    rows,
  };

  await fs.writeFile(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(OUT_MD, toMarkdown(report), "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        selected: rows.length,
        outJson: OUT_JSON,
        outMd: OUT_MD,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
