#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

import {
  CORE_COMPLETE_FIELDS,
  SECONDARY_COMPLETE_FIELDS,
  buildOverlayRecordKey,
  buildPatchStrategy,
  classifyOverlayStatus,
  collectProductsFromEntry,
  deriveCompleteness,
  extractOverlayRecordFromSeedRow,
  extractOverlayRecordFromZipRow,
  qualifiesHighConfidenceUsProductPage,
  mergeOverlayRecords,
  normalizeLower,
  normalizeText,
  stableHash,
} from "./lib/iherb-overlay-utils.mjs";

const ROOT = process.cwd();
const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const getArgs = (name) => {
  const flag = `--${name}`;
  const values = [];
  for (let idx = 0; idx < args.length; idx += 1) {
    if (args[idx] === flag && idx + 1 < args.length) {
      values.push(args[idx + 1]);
    }
  }
  return values;
};

const ZIP_PATH = getArg(
  "zip",
  "/Users/howard07/.codex/worktrees/f971/nutri-app/data/iherb_products_09e814d1b48847f7be1e38b52eb5e0b3_20260303_115845.zip",
);
const SEED_JSON_PATHS = getArgs("seed-json");
const OUT_DIR = getArg("out-dir", path.join(ROOT, "output", "iherb_overlay_staging"));

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));

const sha256File = async (filePath) => {
  const buf = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
};

const extractZipJsonEntries = (zipPath, destDir) => {
  const script = `
import json, os, pathlib, sys, zipfile

zip_path = sys.argv[1]
dest_dir = pathlib.Path(sys.argv[2])
dest_dir.mkdir(parents=True, exist_ok=True)
entries = []
with zipfile.ZipFile(zip_path) as zf:
    for idx, info in enumerate(zf.infolist()):
        name = info.filename
        if not name.lower().endswith(".json"):
            continue
        safe_name = pathlib.Path(name).name
        target = dest_dir / f"{idx:05d}__{safe_name}"
        with zf.open(info, "r") as src, open(target, "wb") as dst:
            dst.write(src.read())
        entries.append({
            "originalName": name,
            "path": str(target),
        })
print(json.dumps(entries))
`;
  return JSON.parse(
    execFileSync("python3", ["-c", script, zipPath, destDir], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 256,
    }),
  );
};

const nowIso = () => new Date().toISOString();

const sortBy = (rows, selector) =>
  [...rows].sort((left, right) => {
    const a = selector(left);
    const b = selector(right);
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  });

const buildMarkdownReport = (report) => {
  const lines = [
    "# Week 2 iHerb Overlay Staging Report",
    "",
    `- generatedAt: ${report.generatedAt}`,
    `- zipPath: ${report.inputs.zipPath}`,
    `- zipSha256: ${report.inputs.zipSha256}`,
    `- seedJsonCount: ${report.inputs.seedJsons.length}`,
    `- mergedProducts: ${report.summary.totalProducts}`,
    "",
    "## Status Summary",
    "",
  ];

  for (const [status, count] of Object.entries(report.summary.statusCounts)) {
    lines.push(`- ${status}: ${count}`);
  }

  lines.push("", "## Core Coverage", "");
  for (const field of CORE_COMPLETE_FIELDS) {
    const row = report.summary.coreCoverage[field];
    lines.push(`- ${field}: ${row.present}/${row.total} (${row.percent}%)`);
  }

  lines.push("", "## Overlay Readiness", "");
  lines.push(`- high_confidence_us_product_page_ready: ${report.summary.highConfidenceUsProductPageReadyCount}`);
  lines.push(`- us_iherb_products: ${report.summary.usIherbCount}`);
  lines.push(`- npn_ignored: ${report.summary.npnIgnoredCount}`);

  lines.push("", "## Secondary Coverage", "");
  for (const field of SECONDARY_COMPLETE_FIELDS) {
    const row = report.summary.secondaryCoverage[field];
    lines.push(`- ${field}: ${row.present}/${row.total} (${row.percent}%)`);
  }

  lines.push("", "## Brand Summary", "");
  for (const brand of report.brandSummary.slice(0, 25)) {
    lines.push(
      `- ${brand.brandName}: total=${brand.total}, full=${brand.statusCounts.full_overlay_ready}, partial=${brand.statusCounts.partial_overlay}, catalog=${brand.statusCounts.catalog_only}, conflicted=${brand.statusCounts.conflicted_or_non_us}`,
    );
  }

  if (report.patchQueue.length > 0) {
    lines.push("", "## Patch Queue Preview", "");
    for (const item of report.patchQueue.slice(0, 25)) {
      lines.push(
        `- ${item.brandName} | ${item.title} | ${item.barcode_gtin14 || "n/a"} | ${item.patchStrategy.preferredAction} | missing=${item.patchStrategy.missingFields.join(", ")}`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
};

const computeFieldCoverage = (rows, selector, fieldNames) => {
  const total = rows.length;
  const out = {};
  for (const field of fieldNames) {
    const present = rows.filter((row) => selector(row).includes(field)).length;
    out[field] = {
      present,
      total,
      percent: total > 0 ? Number(((present / total) * 100).toFixed(1)) : 0,
    };
  }
  return out;
};

const summarizeBrand = (rows) => {
  const byBrand = new Map();
  for (const row of rows) {
    const brandName = normalizeText(row.brandName) || "unknown";
    const bucket = byBrand.get(brandName) ?? {
      brandName,
      total: 0,
      statusCounts: {
        full_overlay_ready: 0,
        partial_overlay: 0,
        catalog_only: 0,
        conflicted_or_non_us: 0,
      },
      iherbUsCount: 0,
      productImageCount: 0,
    };
    bucket.total += 1;
    bucket.statusCounts[row.completeness.status] += 1;
    if (row.sourceSummary.hasUsIherbPage) bucket.iherbUsCount += 1;
    if (row.completeness.coreResolvedFields.includes("product_image")) bucket.productImageCount += 1;
    byBrand.set(brandName, bucket);
  }
  return sortBy([...byBrand.values()], (row) => row.brandName.toLowerCase());
};

const main = async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const zipSha256 = await sha256File(ZIP_PATH);
  const stagedByKey = new Map();
  const ingestLog = [];

  const extractedZipDir = path.join(OUT_DIR, "_zip_json");
  await fs.rm(extractedZipDir, { recursive: true, force: true });
  const zipEntries = extractZipJsonEntries(ZIP_PATH, extractedZipDir);
  for (const entry of zipEntries) {
    const parsed = JSON.parse(await fs.readFile(entry.path, "utf8"));
    const rows = collectProductsFromEntry(parsed);
    for (const row of rows) {
      const record = extractOverlayRecordFromZipRow(row, {
        entryName: entry.originalName,
        marketSource: "US",
      });
      const key = buildOverlayRecordKey(record);
      const merged = mergeOverlayRecords(stagedByKey.get(key), record);
      stagedByKey.set(key, merged);
    }
    ingestLog.push({
      sourceType: "zip_entry",
      entryName: entry.originalName,
      extractedPath: entry.path,
      rowCount: rows.length,
    });
  }

  for (const seedPath of SEED_JSON_PATHS) {
    const seedPayload = await readJson(seedPath);
    const products = Array.isArray(seedPayload?.products) ? seedPayload.products : [];
    for (const row of products) {
      const record = extractOverlayRecordFromSeedRow(row, {
        seedName: path.basename(seedPath),
      });
      const key = buildOverlayRecordKey(record);
      const merged = mergeOverlayRecords(stagedByKey.get(key), record);
      stagedByKey.set(key, merged);
    }
    ingestLog.push({ sourceType: "seed_json", path: seedPath, rowCount: products.length });
  }

  const stagedProducts = sortBy(
    [...stagedByKey.values()].map((row) => {
      const completeness = deriveCompleteness(row);
      const status = classifyOverlayStatus(row, completeness);
      const patchStrategy = buildPatchStrategy(row, completeness);
      const highConfidenceUsProductPageReady = qualifiesHighConfidenceUsProductPage(row, completeness);
      return {
        ...row,
        overlayRecordKey: buildOverlayRecordKey(row),
        completeness: {
          ...completeness,
          status,
        },
        readiness: {
          highConfidenceUsProductPageReady,
        },
        patchStrategy,
        overlaySha256: stableHash({
          brandName: row.brandName,
          title: row.title,
          barcode_gtin14: row.barcode_gtin14,
          supplementFacts: row.supplementFacts,
          descriptionSections: row.descriptionSections,
          sourceSummary: row.sourceSummary,
        }),
      };
    }),
    (row) => `${normalizeLower(row.brandName)}|${normalizeLower(row.title)}|${row.barcode_gtin14 || ""}`,
  );

  const patchQueue = stagedProducts
    .filter((row) => row.patchStrategy)
    .map((row) => ({
      overlayRecordKey: row.overlayRecordKey,
      brandName: row.brandName,
      title: row.title,
      barcode_gtin14: row.barcode_gtin14,
      upcCode: row.upcCode,
      productId: row.productId,
      link: row.link,
      status: row.completeness.status,
      patchStrategy: row.patchStrategy,
      sourceSummary: row.sourceSummary,
    }));

  const statusCounts = stagedProducts.reduce(
    (acc, row) => {
      acc[row.completeness.status] += 1;
      return acc;
    },
    {
      full_overlay_ready: 0,
      partial_overlay: 0,
      catalog_only: 0,
      conflicted_or_non_us: 0,
    },
  );

  const report = {
    schemaVersion: "iherb_overlay_staging.v1",
    generatedAt: nowIso(),
    inputs: {
      zipPath: ZIP_PATH,
      zipSha256,
      zipEntriesScanned: zipEntries.length,
      extractedZipDir,
      seedJsons: SEED_JSON_PATHS,
    },
    summary: {
      totalProducts: stagedProducts.length,
      statusCounts,
      coreCoverage: computeFieldCoverage(
        stagedProducts,
        (row) => row.completeness.coreResolvedFields,
        CORE_COMPLETE_FIELDS,
      ),
      secondaryCoverage: computeFieldCoverage(
        stagedProducts,
        (row) => row.completeness.secondaryResolvedFields,
        SECONDARY_COMPLETE_FIELDS,
      ),
      patchQueueCount: patchQueue.length,
      usIherbCount: stagedProducts.filter((row) => row.sourceSummary.hasUsIherbPage).length,
      npnIgnoredCount: stagedProducts.filter((row) => row.sourceSummary.npnIgnored).length,
      highConfidenceUsProductPageReadyCount: stagedProducts.filter(
        (row) => row.readiness.highConfidenceUsProductPageReady,
      ).length,
    },
    brandSummary: summarizeBrand(stagedProducts),
    ingestLog,
    patchQueue,
  };

  const stagingOut = path.join(OUT_DIR, "staging_products.json");
  const reportJsonOut = path.join(OUT_DIR, "coverage_report.json");
  const reportMdOut = path.join(OUT_DIR, "coverage_report.md");
  const patchQueueOut = path.join(OUT_DIR, "patch_queue.jsonl");

  await fs.writeFile(stagingOut, `${JSON.stringify({ products: stagedProducts }, null, 2)}\n`, "utf8");
  await fs.writeFile(reportJsonOut, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(reportMdOut, buildMarkdownReport(report), "utf8");
  await fs.writeFile(
    patchQueueOut,
    `${patchQueue.map((row) => JSON.stringify(row)).join("\n")}${patchQueue.length > 0 ? "\n" : ""}`,
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputs: {
          staging: stagingOut,
          coverageJson: reportJsonOut,
          coverageMd: reportMdOut,
          patchQueue: patchQueueOut,
        },
        summary: report.summary,
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
