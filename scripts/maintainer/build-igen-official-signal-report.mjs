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

const REFRESH_REPORT_PATH = getArg(
  "refresh-report",
  path.join(ROOT, "output", "quality_marks", `nutrasource_promotion_refresh_full_v2_canonical_${TODAY}`, "week2_iherb_quality_mark_refresh_report.json"),
);
const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", "quality_marks", `igen_official_signal_${TODAY}`),
);
const OUT_JSON = getArg("out-json", path.join(OUT_DIR, "igen_official_signal_report.json"));
const OUT_MD = getArg("out-md", path.join(OUT_DIR, "igen_official_signal_report.md"));
const SEED_JSON = getArg("seed-json", path.join(OUT_DIR, "igen_official_signal_seed.json"));

const safeText = (value) => String(value ?? "").trim();
const nowIso = () => new Date().toISOString();

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

const getIgenMatches = (row) =>
  (Array.isArray(row?.programMatches) ? row.programMatches : [])
    .filter((match) => safeText(match?.programId).toLowerCase() === "igen")
    .filter((match) => safeText(match?.evidenceType).toLowerCase() === "official_registry");

const classifyIgenSignal = (row) => {
  const matches = getIgenMatches(row);
  const productLevelVerified = matches.find(
    (match) =>
      safeText(match?.status) === "verified_registry_match" &&
      Boolean(match?.brandMatched) &&
      Boolean(match?.productMatched),
  );
  if (productLevelVerified) {
    return {
      state: "product_level_official_signal",
      strongestMatch: productLevelVerified,
    };
  }

  const brandLevelOnly = matches.find(
    (match) =>
      safeText(match?.status) === "ambiguous_match" &&
      safeText(match?.matchLevel) === "brand" &&
      Boolean(match?.brandMatched) &&
      !Boolean(match?.productMatched),
  );
  if (brandLevelOnly) {
    return {
      state: "brand_level_only_signal",
      strongestMatch: brandLevelOnly,
    };
  }

  const checkedNotFound = matches.find((match) => safeText(match?.status) === "not_found_in_registry");
  if (checkedNotFound) {
    return {
      state: "checked_not_found",
      strongestMatch: checkedNotFound,
    };
  }

  const registryAmbiguous = matches.find((match) => safeText(match?.status) === "ambiguous_match");
  if (registryAmbiguous) {
    return {
      state: "registry_ambiguous",
      strongestMatch: registryAmbiguous,
    };
  }

  return {
    state: "no_official_signal",
    strongestMatch: null,
  };
};

const buildSeedRow = (row, signal) => ({
  key: row.key ?? null,
  productId: row.productId ?? null,
  barcode: row.barcode ?? null,
  brandName: row.brandName ?? null,
  productName: row.productName ?? null,
  iherbUrl: row.iherbUrl ?? null,
  officialSignalProgramId: "igen",
  officialSignalProgramLabel: "iGEN",
  officialSignalState: signal.state,
  officialRegistryEvidenceUrl: signal.strongestMatch?.evidenceUrl ?? row.evidenceRef ?? null,
  officialRegistryMatchStatus: signal.strongestMatch?.status ?? null,
  officialRegistryMatchLevel: signal.strongestMatch?.matchLevel ?? null,
  brandMatched: Boolean(signal.strongestMatch?.brandMatched),
  productMatched: Boolean(signal.strongestMatch?.productMatched),
  confidence: signal.strongestMatch?.confidence ?? row.confidence ?? null,
  warnings: Array.isArray(row?.verificationSummary?.warnings) ? row.verificationSummary.warnings : [],
  directRegistryEvidenceUsed: Boolean(row.directRegistryEvidenceUsed),
  sourcesTried: Array.isArray(row.sourcesTried) ? row.sourcesTried : [],
  checkedAt: row.checkedAt ?? null,
  expiresAt: row.expiresAt ?? null,
});

const toMarkdown = (report) => {
  const lines = [];
  lines.push("# iGEN Official Signal Report");
  lines.push("");
  lines.push(`Generated at: ${report.generatedAt}`);
  lines.push(`Refresh report: ${report.inputs.refreshReportPath}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- iGEN rows refreshed: ${report.summary.igenRows}`);
  lines.push(`- product-level official signals: ${report.summary.productLevelOfficialSignalCount}`);
  lines.push(`- brand-level only signals: ${report.summary.brandLevelOnlyCount}`);
  lines.push(`- checked not found: ${report.summary.checkedNotFoundCount}`);
  lines.push(`- registry ambiguous: ${report.summary.registryAmbiguousCount}`);
  lines.push(`- promotion-ready official signal seed rows: ${report.summary.seedRowCount}`);
  lines.push("");
  lines.push("## Brand Coverage");
  lines.push("");
  for (const [brand, count] of Object.entries(report.brandCounts).slice(0, 20)) {
    lines.push(`- ${brand}: ${count}`);
  }
  lines.push("");
  lines.push("## Signal States");
  lines.push("");
  for (const [state, count] of Object.entries(report.signalStateCounts)) {
    lines.push(`- ${state}: ${count}`);
  }
  lines.push("");
  lines.push("## Sample Seed Rows");
  lines.push("");
  for (const row of report.seedRows.slice(0, 20)) {
    lines.push(`- ${row.brandName} | ${row.productName} | evidence=${row.officialRegistryEvidenceUrl ?? "none"}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const refreshReport = JSON.parse(await fs.readFile(REFRESH_REPORT_PATH, "utf8"));
  const rows = Array.isArray(refreshReport?.rows) ? refreshReport.rows : [];
  const igenRows = rows.filter((row) => getIgenMatches(row).length > 0 || safeText(row?.strongestProgramId).toLowerCase() === "igen");

  const signalStateCounts = {};
  const brandCounts = {};
  const warningCounts = {};

  const decoratedRows = igenRows.map((row) => {
    const signal = classifyIgenSignal(row);
    increment(signalStateCounts, signal.state);
    increment(brandCounts, safeText(row?.brandName) || "unknown");
    for (const warning of row?.verificationSummary?.warnings ?? []) increment(warningCounts, warning);
    return {
      ...row,
      igenOfficialSignal: signal,
    };
  });

  const seedRows = decoratedRows
    .filter((row) => row.igenOfficialSignal?.state === "product_level_official_signal")
    .map((row) => buildSeedRow(row, row.igenOfficialSignal))
    .sort((a, b) => `${a.brandName ?? ""}|${a.productName ?? ""}`.localeCompare(`${b.brandName ?? ""}|${b.productName ?? ""}`));

  const report = {
    schemaVersion: "igen_official_signal_report.v1",
    generatedAt: nowIso(),
    inputs: {
      refreshReportPath: REFRESH_REPORT_PATH,
    },
    summary: {
      igenRows: igenRows.length,
      productLevelOfficialSignalCount: signalStateCounts.product_level_official_signal ?? 0,
      brandLevelOnlyCount: signalStateCounts.brand_level_only_signal ?? 0,
      checkedNotFoundCount: signalStateCounts.checked_not_found ?? 0,
      registryAmbiguousCount: signalStateCounts.registry_ambiguous ?? 0,
      seedRowCount: seedRows.length,
    },
    signalStateCounts: sortCounts(signalStateCounts),
    brandCounts: sortCounts(brandCounts),
    warningCounts: sortCounts(warningCounts),
    rows: decoratedRows,
    seedRows,
  };

  await fs.writeFile(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(SEED_JSON, `${JSON.stringify({
    schemaVersion: "igen_official_signal_seed.v1",
    generatedAt: report.generatedAt,
    refreshReportPath: REFRESH_REPORT_PATH,
    rowCount: seedRows.length,
    rows: seedRows,
  }, null, 2)}\n`, "utf8");
  await fs.writeFile(OUT_MD, toMarkdown(report), "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        igenRows: igenRows.length,
        productLevelOfficialSignalCount: report.summary.productLevelOfficialSignalCount,
        brandLevelOnlyCount: report.summary.brandLevelOnlyCount,
        seedRowCount: seedRows.length,
        outJson: OUT_JSON,
        outMd: OUT_MD,
        seedJson: SEED_JSON,
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
