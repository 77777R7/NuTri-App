#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT_DIR = process.cwd();
const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(`--${flag}`);
const getArg = (flag) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

if (hasFlag("help")) {
  console.log(`Usage:
  node scripts/maintainer/ods-ul-coverage-gate.mjs --report <ods_ul_visibility_report.json> [options]

Options:
  --report <path>           Visibility report JSON path
  --out-dir <path>          Gate output dir (default: report dir)
  --enforce                 Exit non-zero when gate fails
  --min-guidance-rate <n>   Default 0.30
  --max-uncertain-rate <n>  Default 0.40
  --min-scope-non-total <n> Default 1
  --infra-unavailable-rate-min <n> Default 0.80
`);
  process.exit(0);
}

const reportArg = getArg("report");
if (!reportArg) {
  console.error("[ods-ul-coverage-gate] Missing --report");
  process.exit(1);
}

const reportPath = path.isAbsolute(reportArg) ? reportArg : path.join(ROOT_DIR, reportArg);
const outDirArg = getArg("out-dir") || path.dirname(reportPath);
const outDir = path.isAbsolute(outDirArg) ? outDirArg : path.join(ROOT_DIR, outDirArg);
const enforce = hasFlag("enforce");

const minGuidanceRate = Number(getArg("min-guidance-rate") || process.env.ODS_UL_GUIDANCE_RATE_MIN || 0.3);
const maxUncertainRate = Number(getArg("max-uncertain-rate") || process.env.ODS_UL_UNCERTAIN_RATE_MAX || 0.4);
const minScopeNonTotal = Number(getArg("min-scope-non-total") || process.env.ODS_UL_SCOPE_NON_TOTAL_MIN || 1);
const infraUnavailableRateMin = Number(
  getArg("infra-unavailable-rate-min") || process.env.ODS_UL_INFRA_UNAVAILABLE_RATE_MIN || 0.8,
);

const safeJson = async (filePath) => {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
};

const has503Signal = (value) => {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return false;
  return text.includes("http_503") || text.includes("status_503") || /\b503\b/.test(text);
};

const hasInfraSignal = (value) => {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return false;
  return (
    text.includes("operation was aborted")
    || text.includes("request aborted")
    || text.includes("aborted")
    || text.includes("timeout")
    || text.includes("timed out")
    || text.includes("fetch failed")
    || text.includes("network")
    || text.includes("econnreset")
    || text.includes("socket hang up")
    || text.includes("ecanceled")
  );
};

const toMarkdown = (gate) => {
  const lines = [];
  lines.push("# ODS UL Coverage Gate");
  lines.push("");
  lines.push(`- Generated: ${gate.generatedAt}`);
  lines.push(`- Report: ${gate.reportPath}`);
  lines.push(`- Pass: ${gate.pass}`);
  lines.push(`- Enforce: ${gate.enforce}`);
  lines.push(`- Inconclusive: ${gate.inconclusive ? "yes" : "no"}`);
  lines.push(`- Infra unavailable: ${gate.infraUnavailable ? "yes" : "no"}`);
  if (gate.infraReason) lines.push(`- Infra reason: ${gate.infraReason}`);
  lines.push("");
  lines.push("## Metrics");
  lines.push("");
  lines.push(`- ul_guidance_rate: ${(gate.metrics.ulGuidanceRate * 100).toFixed(1)}% (min ${(gate.thresholds.ulGuidanceRateMin * 100).toFixed(1)}%)`);
  lines.push(`- unit_conversion_uncertain_rate: ${(gate.metrics.unitConversionUncertainRate * 100).toFixed(1)}% (max ${(gate.thresholds.unitConversionUncertainRateMax * 100).toFixed(1)}%)`);
  lines.push(`- scope_non_total_count: ${gate.metrics.scopeNonTotalCount} (min ${gate.thresholds.scopeNonTotalCountMin})`);
  lines.push(`- web_unverified_entries_shown_count: ${gate.metrics.webUnverifiedEntriesShownCount} (must be 0)`);
  lines.push(`- infra_error_rate: ${(gate.metrics.infraErrorRate * 100).toFixed(1)}% (inconclusive when >= ${(gate.thresholds.infraUnavailableRateMin * 100).toFixed(1)}%)`);
  lines.push("");
  if (gate.failures.length > 0) {
    lines.push("## Failures");
    lines.push("");
    gate.failures.forEach((failure) => {
      lines.push(`- ${failure}`);
    });
    lines.push("");
  }
  if (Array.isArray(gate.warnings) && gate.warnings.length > 0) {
    lines.push("## Warnings");
    lines.push("");
    gate.warnings.forEach((warning) => {
      lines.push(`- ${warning}`);
    });
    lines.push("");
  }
  return `${lines.join("\n").trim()}\n`;
};

const main = async () => {
  await fs.mkdir(outDir, { recursive: true });
  const report = await safeJson(reportPath);
  const summary = report?.summary ?? {};
  const rows = Array.isArray(report?.rows) ? report.rows : [];
  const isInfraErrorRow = (row) => {
    const scoreHttpStatus = Number(row?.score?.httpStatus);
    const scoreIs503 = Number.isFinite(scoreHttpStatus) && scoreHttpStatus === 503;
    const scoreError = row?.score?.error;
    const enrichTerminalCode = String(row?.enrich?.terminalCode ?? "").trim().toUpperCase();
    const enrichError = row?.enrich?.error;
    return (
      scoreIs503
      || has503Signal(scoreError)
      || enrichTerminalCode === "REQUEST_ERROR"
      || hasInfraSignal(scoreError)
      || hasInfraSignal(enrichError)
    );
  };
  const infraErrorCount = rows.filter((row) => isInfraErrorRow(row)).length;
  const infraErrorRate = rows.length > 0 ? infraErrorCount / rows.length : 0;

  const metrics = {
    ulGuidanceRate:
      typeof summary.ulGuidanceRate === "number" && Number.isFinite(summary.ulGuidanceRate)
        ? summary.ulGuidanceRate
        : rows.length > 0
          ? rows.filter((row) => row?.hasUlEntries).length / rows.length
          : 0,
    unitConversionUncertainRate:
      typeof summary.unitConversionUncertainRate === "number" && Number.isFinite(summary.unitConversionUncertainRate)
        ? summary.unitConversionUncertainRate
        : 0,
    scopeNonTotalCount:
      typeof summary.scopeNonTotalCount === "number" && Number.isFinite(summary.scopeNonTotalCount)
        ? summary.scopeNonTotalCount
        : rows.filter((row) => row?.scopeNonTotal).length,
    webUnverifiedEntriesShownCount:
      typeof summary.webUnverifiedEntriesShownCount === "number" &&
      Number.isFinite(summary.webUnverifiedEntriesShownCount)
        ? summary.webUnverifiedEntriesShownCount
        : rows.filter((row) => row?.webUnverifiedEntriesShown).length,
    scoreRowsCount: rows.length,
    scoreHttp503Count: rows.filter((row) => {
      if (Number.isFinite(Number(row?.score?.httpStatus)) && Number(row.score.httpStatus) === 503) {
        return true;
      }
      return has503Signal(row?.score?.error);
    }).length,
    infraErrorCount,
    infraErrorRate,
  };

  const failures = [];
  const warnings = [];
  const infraUnavailable =
    metrics.scoreRowsCount > 0 && metrics.infraErrorRate >= infraUnavailableRateMin;
  const inconclusive = infraUnavailable;
  const infraReason = infraUnavailable
    ? `infra_error_rate_${Number(metrics.infraErrorRate.toFixed(3))}_gte_${infraUnavailableRateMin}`
    : null;
  if (infraUnavailable) {
    warnings.push(infraReason);
  } else {
    if (metrics.ulGuidanceRate < minGuidanceRate) {
      failures.push(
        `ul_guidance_rate ${(metrics.ulGuidanceRate * 100).toFixed(1)}% < ${(minGuidanceRate * 100).toFixed(1)}%`,
      );
    }
    if (metrics.unitConversionUncertainRate > maxUncertainRate) {
      failures.push(
        `unit_conversion_uncertain_rate ${(metrics.unitConversionUncertainRate * 100).toFixed(1)}% > ${(maxUncertainRate * 100).toFixed(1)}%`,
      );
    }
    if (metrics.scopeNonTotalCount < minScopeNonTotal) {
      failures.push(`scope_non_total_count ${metrics.scopeNonTotalCount} < ${minScopeNonTotal}`);
    }
    if (metrics.webUnverifiedEntriesShownCount > 0) {
      failures.push(`web_unverified_entries_shown_count ${metrics.webUnverifiedEntriesShownCount} > 0`);
    }
  }

  const gate = {
    generatedAt: new Date().toISOString(),
    reportPath,
    outDir,
    enforce,
    pass: inconclusive ? true : failures.length === 0,
    inconclusive,
    infraUnavailable,
    infraReason,
    thresholds: {
      ulGuidanceRateMin: minGuidanceRate,
      unitConversionUncertainRateMax: maxUncertainRate,
      scopeNonTotalCountMin: minScopeNonTotal,
      webUnverifiedEntriesShownCountMax: 0,
      infraUnavailableRateMin,
    },
    metrics,
    failures,
    warnings,
  };

  const gateJsonPath = path.join(outDir, "gate.json");
  const gateMdPath = path.join(outDir, "gate.md");
  await fs.writeFile(gateJsonPath, `${JSON.stringify(gate, null, 2)}\n`, "utf8");
  await fs.writeFile(gateMdPath, toMarkdown(gate), "utf8");
  console.log(`[ods-ul-coverage-gate] wrote ${gateJsonPath}`);
  console.log(`[ods-ul-coverage-gate] wrote ${gateMdPath}`);
  console.log(`[ods-ul-coverage-gate] pass=${gate.pass}`);

  if (enforce && !gate.pass) {
    process.exit(1);
  }
};

main().catch((error) => {
  console.error("[ods-ul-coverage-gate] failed", error instanceof Error ? error.message : error);
  process.exit(1);
});
