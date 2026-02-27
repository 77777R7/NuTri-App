#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs";
import path from "node:path";

const ROOT_DIR = process.cwd();
const OUTPUT_DIR = path.join(ROOT_DIR, "output");
const FIXTURE_DIR = path.join(ROOT_DIR, "scripts", "maintainer", "fixtures");
const OUT_FIXTURE_PATH = path.join(FIXTURE_DIR, "authority_fail_samples.json");
const OUT_REPORT_PATH = path.join(FIXTURE_DIR, "authority_fail_samples_report.json");

const SOURCE_BARCODE_TARGET = Math.max(3, Number(process.env.AUTH_FAIL_SOURCE_COUNT || 6));

const toDigits = (value) => String(value ?? "").replace(/\D/g, "");
const toGtin14 = (value) => {
  const digits = toDigits(value);
  if (!digits || digits.length < 8 || digits.length > 14) return null;
  return digits.padStart(14, "0");
};

const readJson = async (filePath) => JSON.parse(await fs.promises.readFile(filePath, "utf8"));

const pickLatestBulkSummary = async () => {
  let entries = [];
  try {
    entries = await fs.promises.readdir(OUTPUT_DIR, { withFileTypes: true });
  } catch {
    return null;
  }
  const dirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("bulk-barcode-e2e-"))
    .map((entry) => path.join(OUTPUT_DIR, entry.name))
    .sort();
  for (let i = dirs.length - 1; i >= 0; i -= 1) {
    const summaryPath = path.join(dirs[i], "summary.json");
    try {
      // eslint-disable-next-line no-await-in-loop
      const summary = await readJson(summaryPath);
      if (Array.isArray(summary) && summary.length > 0) {
        return { dir: dirs[i], summary };
      }
    } catch {
      // keep scanning older runs
    }
  }
  return null;
};

const main = async () => {
  const latestBulk = await pickLatestBulkSummary();
  if (!latestBulk) {
    throw new Error("No bulk-barcode-e2e summary found. Run bulk regression first.");
  }

  const selectedBase = [];
  const seen = new Set();
  for (const row of latestBulk.summary) {
    if (selectedBase.length >= SOURCE_BARCODE_TARGET) break;
    if (row?.sourceType !== "lnhpd") continue;
    const barcode = toGtin14(row?.barcode);
    if (!barcode || seen.has(barcode)) continue;
    seen.add(barcode);
    selectedBase.push({
      barcode,
      region: row?.country ?? "CA",
      sourceTypeHint: row?.sourceType ?? "lnhpd",
      sourceUrl: "bulk-barcode-e2e",
      verifiedAt: new Date().toISOString().slice(0, 10),
      notes: "authority candidate baseline from bulk summary",
    });
  }

  if (selectedBase.length < SOURCE_BARCODE_TARGET) {
    throw new Error(
      `Need ${SOURCE_BARCODE_TARGET} lnhpd baseline barcodes but only found ${selectedBase.length} in latest bulk summary.`,
    );
  }

  const fixture = [];
  for (const base of selectedBase) {
    fixture.push({
      ...base,
      mode: "timeout",
      expectedAuthorityFailureReason: "lnhpd_timeout_second",
      notes: `${base.notes}; forced_mode=timeout`,
    });
    fixture.push({
      ...base,
      mode: "not_found",
      expectedAuthorityFailureReason: "lnhpd_not_found",
      notes: `${base.notes}; forced_mode=not_found`,
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    latestBulkDir: latestBulk.dir,
    sourceBarcodeTarget: SOURCE_BARCODE_TARGET,
    sourceBarcodeCount: selectedBase.length,
    sampleCount: fixture.length,
    sourceBarcodes: selectedBase.map((row) => row.barcode),
  };

  await fs.promises.mkdir(FIXTURE_DIR, { recursive: true });
  await fs.promises.writeFile(OUT_FIXTURE_PATH, JSON.stringify(fixture, null, 2), "utf8");
  await fs.promises.writeFile(OUT_REPORT_PATH, JSON.stringify(report, null, 2), "utf8");

  console.log(`[authority-fail-fixture] wrote ${OUT_FIXTURE_PATH}`);
  console.log(`[authority-fail-fixture] wrote ${OUT_REPORT_PATH}`);
  console.log(`[authority-fail-fixture] samples=${fixture.length}`);
};

main().catch((error) => {
  console.error("[authority-fail-fixture] failed:", error);
  process.exit(1);
});
