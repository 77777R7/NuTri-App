#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const getArg = (flag) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const reportPath = getArg("report");
if (!reportPath) {
  console.error("Usage: node scripts/maintainer/build-identity-not-found-checklist.mjs --report <report.json> [--out-dir <dir>]");
  process.exit(1);
}

const resolvedReportPath = path.isAbsolute(reportPath) ? reportPath : path.join(process.cwd(), reportPath);
if (!fs.existsSync(resolvedReportPath)) {
  console.error(`[identity-not-found-checklist] report not found: ${resolvedReportPath}`);
  process.exit(1);
}

const defaultOutDir = path.dirname(resolvedReportPath);
const outDirArg = getArg("out-dir");
const outDir = outDirArg
  ? (path.isAbsolute(outDirArg) ? outDirArg : path.join(process.cwd(), outDirArg))
  : defaultOutDir;
fs.mkdirSync(outDir, { recursive: true });

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));
const writeJson = (filePath, payload) =>
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
const writeText = (filePath, text) => fs.writeFileSync(filePath, `${text}\n`, "utf8");

const pickString = (...values) => {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
};

const report = readJson(resolvedReportPath);
const rows = Array.isArray(report?.rows) ? report.rows : [];

const identityRows = rows.filter((row) => {
  const issue = pickString(row?.identityIssue);
  if (issue === "identity_not_found") return true;
  const responseStatus = pickString(row?.score?.responseStatus, row?.score?.statusText);
  if (responseStatus === "not_found") return true;
  return false;
});

const grouped = new Map();
identityRows.forEach((row) => {
  const source = pickString(row?.identity?.source, row?.sourceType, "unknown");
  const identityValue = pickString(row?.identity?.identityValue, row?.identity?.value);
  if (!identityValue) return;
  const key = `${source}:${identityValue}`;
  const bucket = grouped.get(key) ?? {
    source,
    identityValue,
    identityType: pickString(row?.identity?.identityType, "unknown"),
    barcodes: new Set(),
    mappingPaths: new Set(),
    signalZeroCauses: new Set(),
  };
  const barcode = pickString(row?.barcode);
  if (barcode) bucket.barcodes.add(barcode);
  const mappingPath = pickString(row?.identityResolution?.mappingPath?.label);
  if (mappingPath) bucket.mappingPaths.add(mappingPath);
  const zeroCause = pickString(row?.score?.signalZeroCause);
  if (zeroCause) bucket.signalZeroCauses.add(zeroCause);
  grouped.set(key, bucket);
});

const issues = Array.from(grouped.values()).map((item) => ({
  source: item.source,
  identityValue: item.identityValue,
  identityType: item.identityType,
  barcodes: Array.from(item.barcodes).sort((a, b) => a.localeCompare(b)),
  mappingPaths: Array.from(item.mappingPaths).sort((a, b) => a.localeCompare(b)),
  signalZeroCauses: Array.from(item.signalZeroCauses).sort((a, b) => a.localeCompare(b)),
}));

issues.sort((a, b) => {
  const sourceOrder = String(a.source).localeCompare(String(b.source));
  if (sourceOrder !== 0) return sourceOrder;
  return String(a.identityValue).localeCompare(String(b.identityValue));
});

const sourceIdFiles = {};
for (const source of ["lnhpd", "dsld"]) {
  const ids = issues
    .filter((item) => item.source === source)
    .map((item) => item.identityValue);
  if (!ids.length) continue;
  const outPath = path.join(outDir, `identity_not_found_source_ids_${source}.json`);
  writeJson(outPath, ids);
  sourceIdFiles[source] = path.relative(process.cwd(), outPath);
}

const checklist = {
  generatedAt: new Date().toISOString(),
  reportPath: path.relative(process.cwd(), resolvedReportPath),
  issueCount: issues.length,
  issues,
  sourceIdFiles,
  runbook: [
    {
      name: "Probe score endpoint",
      command: "curl -sS -H 'x-auth-disabled: 1' http://127.0.0.1:3001/api/score/v4/<source>/<identityValue>",
    },
    {
      name: "Probe identity only",
      command: "node scripts/maintainer/diagnose-reviewed-hit-rate.mjs --identity <source>:<identityValue>",
    },
    {
      name: "Check barcode metadata route",
      command: "curl -sS -H 'x-auth-disabled: 1' 'http://127.0.0.1:3001/api/barcode-metadata?barcode=<gtin14>'",
    },
    {
      name: "Check LNHPD facts coverage for source ids",
      command:
        "cd backend && npx tsx scripts/filter-source-ids-lnhpd-facts-exist.ts --input ../<identity_not_found_source_ids_lnhpd.json> --output ../<identity_not_found_lnhpd_valid.json> --invalid-output ../<identity_not_found_lnhpd_invalid.json>",
    },
    {
      name: "Diagnose LNHPD invalid source-id root causes",
      command:
        "cd backend && npx tsx scripts/diagnose-invalid-source-ids-lnhpd.ts --input ../<identity_not_found_source_ids_lnhpd.json> --output-dir ../<identity_not_found_invalid_source_diag>",
    },
    {
      name: "Recompute targeted scores",
      command:
        "cd backend && npx tsx scripts/backfill-v4-scores.ts --source <source> --source-ids-file ../<identity_not_found_source_ids_<source>.json> --summary-json ../<identity_not_found_backfill_<source>.json>",
    },
  ],
};

const jsonPath = path.join(outDir, "identity_not_found_checklist.json");
writeJson(jsonPath, checklist);

const mdLines = [];
mdLines.push("# identity_not_found Checklist");
mdLines.push("");
mdLines.push(`- Report: \`${checklist.reportPath}\``);
mdLines.push(`- Generated: \`${checklist.generatedAt}\``);
mdLines.push(`- Issues: **${checklist.issueCount}**`);
mdLines.push("");

if (issues.length === 0) {
  mdLines.push("No identity_not_found rows in this report.");
} else {
  issues.forEach((issue, idx) => {
    mdLines.push(`## ${idx + 1}. ${issue.source}:${issue.identityValue}`);
    mdLines.push(`- identityType: \`${issue.identityType}\``);
    mdLines.push(`- barcodes: ${issue.barcodes.length ? issue.barcodes.map((x) => `\`${x}\``).join(", ") : "(none)"}`);
    mdLines.push(`- mappingPaths: ${issue.mappingPaths.length ? issue.mappingPaths.map((x) => `\`${x}\``).join(", ") : "(none)"}`);
    mdLines.push(`- signalZeroCauses: ${issue.signalZeroCauses.length ? issue.signalZeroCauses.map((x) => `\`${x}\``).join(", ") : "(none)"}`);
    mdLines.push("");
  });
}

mdLines.push("## Runbook");
checklist.runbook.forEach((step, idx) => {
  mdLines.push(`${idx + 1}. ${step.name}`);
  mdLines.push(`   - \`${step.command}\``);
});

const mdPath = path.join(outDir, "identity_not_found_checklist.md");
writeText(mdPath, mdLines.join("\n"));

console.log(`[identity-not-found-checklist] report=${path.relative(process.cwd(), resolvedReportPath)}`);
console.log(`[identity-not-found-checklist] issues=${issues.length}`);
console.log(`[identity-not-found-checklist] json=${path.relative(process.cwd(), jsonPath)}`);
console.log(`[identity-not-found-checklist] md=${path.relative(process.cwd(), mdPath)}`);
Object.entries(sourceIdFiles).forEach(([source, filePath]) => {
  console.log(`[identity-not-found-checklist] ${source} ids=${filePath}`);
});
