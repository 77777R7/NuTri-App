#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const arg = (name, fallback = "") => {
  const inline = args.find((entry) => entry.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const idx = args.indexOf(name);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return fallback;
};

const summaryPathRaw = arg("--summary", "");
if (!summaryPathRaw) {
  console.error("Usage: node scripts/maintainer/mobile-soak-report.mjs --summary <rounds_summary.json> [--out <rounds_report.md>]");
  process.exit(2);
}

const summaryPath = path.isAbsolute(summaryPathRaw) ? summaryPathRaw : path.join(process.cwd(), summaryPathRaw);
const outArg = arg("--out", "");
const outPath = outArg
  ? path.isAbsolute(outArg)
    ? outArg
    : path.join(process.cwd(), outArg)
  : path.join(path.dirname(summaryPath), "rounds_report.md");

const pct = (value) => (Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : "n/a");
const ms = (value) => (Number.isFinite(value) ? `${Number(value).toFixed(0)}ms` : "n/a");

const groupCount = (rows, keySelector) => {
  const map = new Map();
  for (const row of rows) {
    const key = keySelector(row);
    map.set(key, (map.get(key) || 0) + 1);
  }
  return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
};

const uniquePhases = (attempts) => Array.from(new Set(attempts.map((row) => row.phase))).sort();

const moduleKeyForFailReason = (reason) => {
  const normalized = String(reason || "").toUpperCase();
  if (normalized.startsWith("OVERVIEW_")) return "overview";
  if (normalized.startsWith("SCIENCE_")) return "science";
  if (normalized.startsWith("USAGE_")) return "usage";
  if (normalized.startsWith("SAFETY_")) return "safety";
  if (normalized.startsWith("UL_")) return "usage";
  if (normalized.startsWith("DEGRADED_")) return "overview";
  return "overview";
};

const compactModuleSnippet = (row, moduleKey) => {
  const lines = Array.isArray(row?.moduleValue?.[moduleKey]?.lines) ? row.moduleValue[moduleKey].lines : [];
  if (!lines.length) return "no_module_lines";
  return lines
    .slice(0, 3)
    .map((line) => String(line || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" | ")
    .slice(0, 280);
};

const buildFailReasonTop = (attempts, limit = 10) => {
  const map = new Map();
  for (const row of attempts) {
    const reasons = Array.isArray(row.contentValueFailReasons) ? row.contentValueFailReasons : [];
    for (const reason of reasons) {
      const key = String(reason || "UNKNOWN");
      const entry = map.get(key) || { reason: key, count: 0, samples: [], seen: new Set() };
      entry.count += 1;
      const barcode = String(row.barcode || "");
      if (entry.samples.length < 3 && !entry.seen.has(barcode)) {
        entry.seen.add(barcode);
        const moduleKey = moduleKeyForFailReason(key);
        entry.samples.push({
          barcode,
          role: row.role || "unknown",
          phase: row.phase || "unknown",
          module: moduleKey,
          snippet: compactModuleSnippet(row, moduleKey),
        });
      }
      map.set(key, entry);
    }
  }
  return Array.from(map.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((entry) => ({
      reason: entry.reason,
      count: entry.count,
      samples: entry.samples,
    }));
};

const safeMdCell = (value) => String(value ?? "").replace(/\|/g, "\\|");

const analyzeScreenshots = (attempts, captureEnabled) => {
  if (!captureEnabled) {
    return {
      skipped: true,
      coverage: {},
      anomalies: [],
    };
  }
  const checkpoints = ["launch", "result_rev0", "result_rev1", "final_done", "failure_popup_or_stuck"];
  const coverage = {};
  for (const key of checkpoints) coverage[key] = { present: 0, missing: 0 };

  const anomalies = [];
  for (const row of attempts) {
    const shots = row.screenshots || {};
    for (const key of checkpoints) {
      if (shots[key]) coverage[key].present += 1;
      else coverage[key].missing += 1;
    }

    if (row.doneSeen && !shots.final_done) {
      anomalies.push({
        type: "missing_final_done_screenshot",
        phase: row.phase,
        round: row.round,
        role: row.role,
        barcode: row.barcode,
      });
    }
    if (!row.doneSeen && !shots.failure_popup_or_stuck) {
      anomalies.push({
        type: "missing_failure_checkpoint",
        phase: row.phase,
        round: row.round,
        role: row.role,
        barcode: row.barcode,
      });
    }
    if (row.screenshotRejected) {
      const rejectedPath =
        shots.final_done
        || shots.result_rev1
        || shots.result_rev0
        || shots.failure_popup_or_stuck
        || null;
      anomalies.push({
        type: "screenshot_rejected_noise",
        phase: row.phase,
        round: row.round,
        role: row.role,
        barcode: row.barcode,
        noiseFlags: Array.isArray(row.screenshotNoiseFlags) ? row.screenshotNoiseFlags : [],
        screenshotPath: rejectedPath,
      });
    }
  }

  return { skipped: false, coverage, anomalies };
};

const buildPhaseRows = (attempts) => {
  const phases = uniquePhases(attempts);
  return phases.map((phase) => {
    const rows = attempts.filter((row) => row.phase === phase);
    const doneCount = rows.filter((row) => row.doneSeen).length;
    const degradedCount = rows.filter((row) => row.degradedMode).length;
    const watchdogCount = rows.filter((row) => row.watchdogTriggered).length;
    const popupCount = rows.filter((row) => row.popupBlocked).length;
    const refreshingCount = rows.filter((row) => row.refreshingBannerDetected).length;
    const debugToastCount = rows.filter((row) => row.debugToastDetected).length;
    const screenshotRejectedCount = rows.filter((row) => row.screenshotRejected).length;
    const contentAppliedRows = rows.filter((row) => row.contentValueApplied === true);
    const contentPassCount = contentAppliedRows.filter((row) => row.contentValuePass === true).length;
    return {
      phase,
      total: rows.length,
      doneRate: rows.length ? doneCount / rows.length : 0,
      contentPassRate: contentAppliedRows.length ? contentPassCount / contentAppliedRows.length : null,
      degradedCount,
      watchdogCount,
      popupCount,
      refreshingCount,
      debugToastCount,
      screenshotRejectedCount,
    };
  });
};

const buildBarcodeRows = (attempts, barcodes) =>
  barcodes.map((entry) => {
    const rows = attempts.filter((row) => row.barcode === entry.barcode);
    const doneCount = rows.filter((row) => row.doneSeen).length;
    return {
      role: entry.role,
      barcode: entry.barcode,
      total: rows.length,
      doneRate: rows.length ? doneCount / rows.length : 0,
      failCount: rows.length - doneCount,
    };
  });

const main = async () => {
  const raw = await fs.readFile(summaryPath, "utf8");
  const summary = JSON.parse(raw);
  const attempts = Array.isArray(summary.attempts) ? summary.attempts : [];
  const barcodes = Array.isArray(summary.barcodes) ? summary.barcodes : [];
  const stats = summary.stats || {};

  const serialAttempts = attempts.filter((row) => row.phase === "serial");
  const failedAttempts = attempts.filter((row) => row.status !== "pass");
  const failureReasons = groupCount(failedAttempts, (row) => row.terminalReason || "UNKNOWN");
  const contentFailReasons = groupCount(
    attempts.flatMap((row) =>
      Array.isArray(row.contentValueFailReasons)
        ? row.contentValueFailReasons.map((reason) => ({ reason, row }))
        : [],
    ),
    (entry) => entry.reason || "UNKNOWN",
  );
  const contentFailReasonTop =
    Array.isArray(stats.contentValueFailReasonTop) && stats.contentValueFailReasonTop.length
      ? stats.contentValueFailReasonTop
      : buildFailReasonTop(attempts, 10);
  const regulatoryRichFailReasonTop =
    Array.isArray(stats.regulatoryRichFailReasonTop) && stats.regulatoryRichFailReasonTop.length
      ? stats.regulatoryRichFailReasonTop
      : [];
  const regulatoryRichFailReasons =
    stats.regulatoryRichFailReasonCounts && typeof stats.regulatoryRichFailReasonCounts === "object"
      ? Object.entries(stats.regulatoryRichFailReasonCounts).sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
      : [];
  const phaseRows = buildPhaseRows(attempts);
  const barcodeRows = buildBarcodeRows(serialAttempts.length ? serialAttempts : attempts, barcodes);
  const screenshotCaptureEnabled = Boolean(summary?.config?.captureScreenshots);
  const screenshotAnalysis = analyzeScreenshots(attempts, screenshotCaptureEnabled);

  const lines = [];
  lines.push("# Mobile Soak Report");
  lines.push("");
  lines.push(`- generatedAt: ${summary.generatedAt || new Date().toISOString()}`);
  lines.push(`- summaryPath: ${summaryPath}`);
  lines.push(`- apiBaseUrl: ${summary.apiBaseUrl || "n/a"}`);
  lines.push(`- attemptsTotal: ${stats.attemptsTotal ?? attempts.length}`);
  lines.push(`- serialAttempts: ${stats.serialAttempts ?? serialAttempts.length}`);
  lines.push("");

  lines.push("## Headline Metrics");
  lines.push("");
  lines.push(`- doneSeenRate(serial): ${pct(stats.doneSeenRate)}`);
  lines.push(`- deadEndRate(serial): ${pct(stats.deadEndRate)}`);
  lines.push(`- tFirstBundle P95(serial): ${ms(stats.tFirstBundleP95)}`);
  lines.push(`- tDone P95(serial): ${ms(stats.tDoneP95)}`);
  lines.push(`- eventLoopLag P95(serial): ${ms(stats.eventLoopLagP95)}`);
  lines.push(`- popupBlockedCount(all): ${stats.popupBlockedCount ?? 0}`);
  lines.push(`- watchdogTriggeredCount(all): ${stats.watchdogTriggeredCount ?? 0}`);
  lines.push(`- firstFramePollutionCount(serial): ${stats.firstFramePollutionCount ?? 0}`);
  lines.push(`- firstFrameRenameCount(serial): ${stats.firstFrameRenameCount ?? 0}`);
  lines.push(`- firstFramePendingRate(serial): ${pct(stats.firstFramePendingRate)}`);
  lines.push(`- firstFrameTrustedRate(serial): ${pct(stats.firstFrameTrustedRate)}`);
  lines.push(`- firstFrameTrustedRateRegulatory(serial): ${pct(stats.firstFrameTrustedRateRegulatory)}`);
  lines.push(`- firstFrameUnverifiedRate(serial): ${pct(stats.firstFrameUnverifiedRate)}`);
  lines.push(`- contentValuePassRate(serial dashboard): ${pct(stats.contentValuePassRate)}`);
  lines.push(`- verifiedContentPassRate(serial): ${pct(stats.verifiedContentPassRate)}`);
  lines.push(`- verifiedFinalContentPassRate(serial): ${pct(stats.verifiedFinalContentPassRate)}`);
  lines.push(`- webHintContentPassRate(serial): ${pct(stats.webHintContentPassRate)}`);
  lines.push(`- degradedContentPassRate(serial): ${pct(stats.degradedContentPassRate)}`);
  lines.push(`- ulVisibilityPassRate(serial): ${pct(stats.ulVisibilityPassRate)}`);
  lines.push(`- regulatoryRichRate(serial verified-final, attemptWeighted): ${pct(stats.regulatoryRichRate_attemptWeighted ?? stats.regulatoryRichRate)}`);
  lines.push(`- regulatoryRichRate(serial verified-final, uniqueBarcode): ${pct(stats.regulatoryRichRate_uniqueBarcode ?? stats.regulatoryRichRate)}`);
  lines.push(`- scoreVisibleRate(serial verified-final): ${pct(stats.scoreVisibleRate)}`);
  lines.push(`- scoreNumericVisibleRate(serial verified-final): ${pct(stats.scoreNumericVisibleRate)}`);
  lines.push(`- ulEntriesCoverageVerified(serial verified-final): ${pct(stats.ulEntriesCoverageVerified)}`);
  lines.push(`- ulReferenceCoverageVerified(serial verified-final): ${pct(stats.ulReferenceCoverageVerified)}`);
  lines.push(`- ulComparableCoverageVerified(serial verified-final): ${pct(stats.ulComparableCoverageVerified)}`);
  lines.push(`- ulEligibleRateVerified(serial verified-final): ${pct(stats.ulEligibleRateVerified)}`);
  lines.push(`- coverDetailConsistencyFailCount(serial verified-final): ${Number(stats.coverDetailConsistencyFailCount ?? 0)}`);
  lines.push(`- esterCoreRate_all(serial verified-final): ${pct(stats.esterCoreRate_all)}`);
  lines.push(`- esterCoreRate_fixable(serial verified-final): ${pct(stats.esterCoreRate_fixable)}`);
  lines.push(`- esterUlReferenceReadyRate_eligible(serial verified-final): ${pct(stats.esterUlReferenceReadyRate_eligible ?? stats.esterUlReadyRate_eligible)}`);
  lines.push(`- esterUlComparableReadyRate_eligible(serial verified-final): ${pct(stats.esterUlComparableReadyRate_eligible)}`);
  lines.push(`- esterUlReadyRate_eligible(legacy alias): ${pct(stats.esterUlReadyRate_eligible)}`);
  lines.push(`- scoreNotFoundTargetedCount(serial): ${Number(stats.scoreNotFoundTargetedCount ?? 0)}`);
  lines.push(`- scoreNotFoundTargetedByReason(serial): ${JSON.stringify(stats.scoreNotFoundTargetedByReason || {})}`);
  lines.push(`- refreshingBannerCount(all): ${stats.refreshingBannerCount ?? 0}`);
  lines.push(`- debugToastCount(all): ${stats.debugToastCount ?? 0}`);
  lines.push(`- screenshotNoiseBlockedCount(all): ${stats.screenshotNoiseBlockedCount ?? 0}`);
  lines.push(`- expoStaticHintCount(all): ${stats.expoStaticHintCount ?? 0}`);
  lines.push(`- timeoutClassCounts(all): ${JSON.stringify(stats.timeoutClassCounts || {})}`);
  lines.push(`- killerTimeoutClassCounts: ${JSON.stringify(stats.killerTimeoutClassCounts || {})}`);
  lines.push(`- killerConfiguredAttempts: ${stats.killerConfiguredAttempts ?? 0}`);
  lines.push(`- killerProductAttempts: ${stats.killerProductAttempts ?? 0}`);
  lines.push(`- killerInfraUnavailableRate: ${pct(stats.killerInfraUnavailableRate)}`);
  lines.push(`- killerInconclusive: ${stats.killerInconclusive ? "yes" : "no"}`);
  lines.push(
    `- killerProductTimeoutClassCounts: ${JSON.stringify(stats.killerProductTimeoutClassCounts || {})}`,
  );
  lines.push(
    `- killerProductTerminalReasonCounts: ${JSON.stringify(stats.killerProductTerminalReasonCounts || {})}`,
  );
  lines.push(`- ceilingSuite: ${safeMdCell(JSON.stringify(stats.ceilingSuite || {}))}`);
  lines.push("");

  lines.push("## DoD Evaluation");
  lines.push("");
  const dod = stats.dod || {};
  lines.push(`- doneSeenRate >= 95%: ${dod.doneSeenRate ? "PASS" : "FAIL"}`);
  lines.push(`- perBarcodePassRate >= 90%: ${dod.perBarcodePassRate ? "PASS" : "FAIL"}`);
  lines.push(`- deadEndRate = 0: ${dod.deadEndRate ? "PASS" : "FAIL"}`);
  lines.push(`- tFirstBundle P95 <= 1500ms: ${dod.tFirstBundleP95 ? "PASS" : "FAIL"}`);
  lines.push(`- tDone P95 <= 12s: ${dod.tDoneP95 ? "PASS" : "FAIL"}`);
  lines.push(`- eventLoopLag P95 <= 100ms: ${dod.eventLoopLagP95 ? "PASS" : "FAIL"}`);
  lines.push(`- popupBlockedCount = 0: ${dod.popupBlocked ? "PASS" : "FAIL"}`);
  lines.push(`- firstFramePollutionCount = 0: ${dod.firstFramePollution ? "PASS" : "FAIL"}`);
  lines.push(`- firstFrameRenameCount = 0: ${dod.firstFrameRename ? "PASS" : "FAIL"}`);
  lines.push(`- firstFramePendingRate > 0: ${dod.firstFramePending ? "PASS" : "FAIL"}`);
  lines.push(`- firstFrameTrustedRateRegulatory >= threshold: ${dod.firstFrameTrustedRegulatory ? "PASS" : "FAIL"}`);
  lines.push(`- contentValuePassRate >= threshold: ${dod.contentValuePassRate ? "PASS" : "FAIL"}`);
  lines.push(`- verifiedContentPassRate >= threshold: ${dod.verifiedContentPassRate ? "PASS" : "FAIL"}`);
  lines.push(`- verifiedFinalContentPassRate >= threshold: ${dod.verifiedFinalContentPassRate ? "PASS" : "FAIL"}`);
  lines.push(`- webHintContentPassRate >= threshold: ${dod.webHintContentPassRate ? "PASS" : "FAIL"}`);
  lines.push(`- degradedContentPassRate >= threshold: ${dod.degradedContentPassRate ? "PASS" : "FAIL"}`);
  lines.push(`- ulVisibilityPassRate >= threshold: ${dod.ulVisibilityPassRate ? "PASS" : "FAIL"}`);
  lines.push(`- regulatoryRichRate(uniqueBarcode) >= threshold: ${dod.regulatoryRichRate ? "PASS" : "FAIL"}`);
  lines.push(`- scoreVisibleRate >= threshold: ${dod.scoreVisibleRate ? "PASS" : "FAIL"}`);
  lines.push(`- coverDetailConsistencyFailCount = 0 (authoritative): ${dod.coverDetailConsistency ? "PASS" : "FAIL"}`);
  lines.push(`- ceiling suite (done/consistency/score terminal/conflict): ${dod.ceilingSuite ? "PASS" : "FAIL"}`);
  lines.push(`- refreshingBannerCount = 0: ${dod.refreshingBanner ? "PASS" : "FAIL"}`);
  lines.push(`- debugToastCount = 0: ${dod.debugToast ? "PASS" : "FAIL"}`);
  lines.push(`- screenshotNoiseBlockedCount (informational): ${stats.screenshotNoiseBlockedCount ?? 0}`);
  lines.push(`- expoStaticHintCount = 0 (prod): ${dod.expoStaticHint ? "PASS" : "FAIL"}`);
  lines.push("");

  lines.push("## Per Barcode (Serial Sample)");
  lines.push("");
  lines.push("| role | barcode | total | doneRate | failCount |");
  lines.push("|---|---|---:|---:|---:|");
  for (const row of barcodeRows) {
    lines.push(`| ${row.role} | ${row.barcode} | ${row.total} | ${pct(row.doneRate)} | ${row.failCount} |`);
  }
  lines.push("");

  lines.push("## Per Phase");
  lines.push("");
  lines.push("| phase | total | doneRate | contentPassRate | degraded | watchdog | popupBlocked | refreshing | debugToast | screenshotRejected |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const row of phaseRows) {
    lines.push(
      `| ${row.phase} | ${row.total} | ${pct(row.doneRate)} | ${row.contentPassRate == null ? "n/a" : pct(row.contentPassRate)} | ${row.degradedCount} | ${row.watchdogCount} | ${row.popupCount} | ${row.refreshingCount} | ${row.debugToastCount} | ${row.screenshotRejectedCount} |`,
    );
  }
  lines.push("");

  lines.push("## First-Frame Identity");
  lines.push("");
  lines.push(`- firstFramePendingRate: ${pct(stats.firstFramePendingRate)}`);
  lines.push(`- firstFrameTrustedRate: ${pct(stats.firstFrameTrustedRate)}`);
  lines.push(`- firstFrameTrustedRateRegulatory: ${pct(stats.firstFrameTrustedRateRegulatory)}`);
  lines.push(`- firstFrameUnverifiedRate: ${pct(stats.firstFrameUnverifiedRate)}`);
  lines.push(`- firstFramePollutionCount: ${stats.firstFramePollutionCount ?? 0}`);
  lines.push(`- firstFrameRenameCount: ${stats.firstFrameRenameCount ?? 0}`);
  lines.push("");

  lines.push("## Content Value Gate");
  lines.push("");
  lines.push(`- contentValuePassRate (serial dashboard): ${pct(stats.contentValuePassRate)}`);
  lines.push(`- verifiedContentPassRate: ${pct(stats.verifiedContentPassRate)}`);
  lines.push(`- verifiedFinalContentPassRate: ${pct(stats.verifiedFinalContentPassRate)}`);
  lines.push(`- webHintContentPassRate: ${pct(stats.webHintContentPassRate)}`);
  lines.push(`- degradedContentPassRate: ${pct(stats.degradedContentPassRate)}`);
  lines.push(`- ulVisibilityPassRate: ${pct(stats.ulVisibilityPassRate)}`);
  lines.push(`- regulatoryRichRate (attemptWeighted): ${pct(stats.regulatoryRichRate_attemptWeighted ?? stats.regulatoryRichRate)}`);
  lines.push(`- regulatoryRichRate (uniqueBarcode, gate): ${pct(stats.regulatoryRichRate_uniqueBarcode ?? stats.regulatoryRichRate)}`);
  lines.push(`- scoreVisibleRate: ${pct(stats.scoreVisibleRate)}`);
  lines.push(`- scoreNumericVisibleRate: ${pct(stats.scoreNumericVisibleRate)}`);
  lines.push(`- ulEntriesCoverageVerified: ${pct(stats.ulEntriesCoverageVerified)}`);
  lines.push(`- ulReferenceCoverageVerified: ${pct(stats.ulReferenceCoverageVerified)}`);
  lines.push(`- ulComparableCoverageVerified: ${pct(stats.ulComparableCoverageVerified)}`);
  lines.push(`- ulEligibleRateVerified: ${pct(stats.ulEligibleRateVerified)}`);
  lines.push(`- esterCoreRate_all: ${pct(stats.esterCoreRate_all)}`);
  lines.push(`- esterCoreRate_fixable: ${pct(stats.esterCoreRate_fixable)}`);
  lines.push(`- esterUlReferenceReadyRate_eligible: ${pct(stats.esterUlReferenceReadyRate_eligible ?? stats.esterUlReadyRate_eligible)}`);
  lines.push(`- esterUlComparableReadyRate_eligible: ${pct(stats.esterUlComparableReadyRate_eligible)}`);
  lines.push(`- esterUlReadyRate_eligible(legacy alias): ${pct(stats.esterUlReadyRate_eligible)}`);
  lines.push(`- scoreNotFoundTargetedCount: ${Number(stats.scoreNotFoundTargetedCount ?? 0)}`);
  lines.push(`- scoreNotFoundTargetedByReason: ${safeMdCell(JSON.stringify(stats.scoreNotFoundTargetedByReason || {}))}`);
  lines.push("");
  lines.push("### Degraded Rate By Role");
  lines.push("");
  if (stats.degradedRateByRole && typeof stats.degradedRateByRole === "object") {
    lines.push("| role | total | degradedRate | terminalReasons |");
    lines.push("|---|---:|---:|---|");
    for (const [role, row] of Object.entries(stats.degradedRateByRole)) {
      lines.push(
        `| ${safeMdCell(role)} | ${Number(row?.total ?? 0)} | ${pct(row?.degradedRate)} | ${safeMdCell(JSON.stringify(row?.terminalReasonCounts || {}))} |`,
      );
    }
  } else {
    lines.push("- no degraded role breakdown available");
  }
  lines.push("");
  lines.push("### FailReason TopN");
  lines.push("");
  if (contentFailReasons.length === 0) {
    lines.push("- no content-value failures recorded");
  } else {
    for (const [reason, count] of contentFailReasons.slice(0, 10)) {
      lines.push(`- ${reason}: ${count}`);
    }
  }
  lines.push("");

  lines.push("### FailReason Sample Snippets");
  lines.push("");
  if (!contentFailReasonTop.length) {
    lines.push("- no fail reason sample snippets available");
  } else {
    lines.push("| reason | count | sample barcodes + module snippets |");
    lines.push("|---|---:|---|");
    for (const entry of contentFailReasonTop) {
      const sampleText = Array.isArray(entry.samples) && entry.samples.length
        ? entry.samples
          .slice(0, 3)
          .map((sample) => {
            const barcode = safeMdCell(sample?.barcode || "unknown");
            const moduleKey = safeMdCell(sample?.module || "unknown");
            const snippet = safeMdCell(sample?.snippet || "no_module_lines");
            return `${barcode} (${moduleKey}): ${snippet}`;
          })
          .join(" <br/> ")
        : "no_samples";
      lines.push(`| ${safeMdCell(entry.reason)} | ${entry.count} | ${sampleText} |`);
    }
  }
  lines.push("");

  lines.push("## Regulatory Richness");
  lines.push("");
  lines.push(`- regulatoryRichRate_attemptWeighted (verified-final): ${pct(stats.regulatoryRichRate_attemptWeighted ?? stats.regulatoryRichRate)}`);
  lines.push(`- regulatoryRichRate_uniqueBarcode (verified-final; gate): ${pct(stats.regulatoryRichRate_uniqueBarcode ?? stats.regulatoryRichRate)}`);
  lines.push(`- scoreVisibleRate (verified-final): ${pct(stats.scoreVisibleRate)}`);
  lines.push(`- scoreNumericVisibleRate (verified-final): ${pct(stats.scoreNumericVisibleRate)}`);
  lines.push(`- ulEntriesCoverageVerified (verified-final): ${pct(stats.ulEntriesCoverageVerified)}`);
  lines.push(`- ulReferenceCoverageVerified (verified-final): ${pct(stats.ulReferenceCoverageVerified)}`);
  lines.push(`- ulComparableCoverageVerified (verified-final): ${pct(stats.ulComparableCoverageVerified)}`);
  lines.push(`- ulEligibleRateVerified (verified-final): ${pct(stats.ulEligibleRateVerified)}`);
  lines.push("");
  lines.push("### Richness By Role");
  lines.push("");
  if (stats.regulatoryRichRateByRole && typeof stats.regulatoryRichRateByRole === "object") {
    lines.push("| role | total | passRate | scoreVisibleRate |");
    lines.push("|---|---:|---:|---:|");
    for (const [role, row] of Object.entries(stats.regulatoryRichRateByRole)) {
      lines.push(
        `| ${safeMdCell(role)} | ${Number(row?.total ?? 0)} | ${pct(row?.passRate)} | ${pct(row?.scoreVisibleRate)} |`,
      );
    }
  } else {
    lines.push("- no regulatory richness role breakdown available");
  }
  lines.push("");
  lines.push("### LNHPD Thin Bucket");
  lines.push("");
  lines.push(`- total: ${Number(stats?.regulatoryRichLnhpdThin?.total ?? 0)}`);
  lines.push(`- passCount: ${Number(stats?.regulatoryRichLnhpdThin?.passCount ?? 0)}`);
  lines.push(`- passRate: ${pct(stats?.regulatoryRichLnhpdThin?.passRate)}`);
  lines.push(
    `- failReasonCounts: ${safeMdCell(JSON.stringify(stats?.regulatoryRichLnhpdThin?.failReasonCounts || {}))}`,
  );
  lines.push("");
  lines.push("### FailReason TopN");
  lines.push("");
  if (regulatoryRichFailReasons.length === 0) {
    lines.push("- no regulatory-rich failures recorded");
  } else {
    for (const [reason, count] of regulatoryRichFailReasons.slice(0, 10)) {
      lines.push(`- ${reason}: ${count}`);
    }
  }
  lines.push("");
  lines.push("### FailReason Sample Snippets");
  lines.push("");
  if (!regulatoryRichFailReasonTop.length) {
    lines.push("- no regulatory-rich fail reason sample snippets available");
  } else {
    lines.push("| reason | count | sample barcodes + module snippets |");
    lines.push("|---|---:|---|");
    for (const entry of regulatoryRichFailReasonTop) {
      const sampleText = Array.isArray(entry.samples) && entry.samples.length
        ? entry.samples
          .slice(0, 3)
          .map((sample) => {
            const barcode = safeMdCell(sample?.barcode || "unknown");
            const moduleKey = safeMdCell(sample?.module || "unknown");
            const snippet = safeMdCell(sample?.snippet || "no_module_lines");
            return `${barcode} (${moduleKey}): ${snippet}`;
          })
          .join(" <br/> ")
        : "no_samples";
      lines.push(`| ${safeMdCell(entry.reason)} | ${entry.count} | ${sampleText} |`);
    }
  }
  lines.push("");

  lines.push("### Cover/Detail Consistency");
  lines.push("");
  lines.push(`- failCount: ${Number(stats.coverDetailConsistencyFailCount ?? 0)}`);
  lines.push(`- failReasonCounts: ${safeMdCell(JSON.stringify(stats.consistencyFailReasonCounts || {}))}`);
  lines.push("");
  const consistencyFailTop = Array.isArray(stats.consistencyFailTop) ? stats.consistencyFailTop : [];
  if (!consistencyFailTop.length) {
    lines.push("- no consistency failures recorded");
  } else {
    lines.push("| reason | count | sample barcodes + module snippets |");
    lines.push("|---|---:|---|");
    for (const entry of consistencyFailTop) {
      const sampleText = Array.isArray(entry.samples) && entry.samples.length
        ? entry.samples
          .slice(0, 3)
          .map((sample) => {
            const barcode = safeMdCell(sample?.barcode || "unknown");
            const moduleKey = safeMdCell(sample?.module || "unknown");
            const snippet = safeMdCell(sample?.snippet || "no_module_lines");
            return `${barcode} (${moduleKey}): ${snippet}`;
          })
          .join(" <br/> ")
        : "no_samples";
      lines.push(`| ${safeMdCell(entry.reason)} | ${entry.count} | ${sampleText} |`);
    }
  }
  lines.push("");

  lines.push("### UL Coverage Diagnostics");
  lines.push("");
  lines.push(`- eligible attempts: ${Number(stats.ulCoverageDiagnosticsEligibleCount ?? 0)}`);
  lines.push(`- skipped attempts: ${Number(stats.ulCoverageDiagnosticsSkippedCount ?? 0)}`);
  lines.push(`- ulReferenceCoverageVerified: ${pct(stats.ulReferenceCoverageVerified)}`);
  lines.push(`- ulComparableCoverageVerified: ${pct(stats.ulComparableCoverageVerified)}`);
  lines.push(`- ulEligibleRateVerified: ${pct(stats.ulEligibleRateVerified)}`);
  lines.push(`- missReasonCounts: ${safeMdCell(JSON.stringify(stats.ulCoverageMissReasonCounts || {}))}`);
  lines.push(`- missSubReasonCounts: ${safeMdCell(JSON.stringify(stats.ulCoverageMissReasonSubCounts || {}))}`);
  lines.push(`- ulCandidateSourceCounts: ${safeMdCell(JSON.stringify(stats.ulCandidateSourceCounts || {}))}`);
  lines.push(`- ulNoCandidateClassCounts: ${safeMdCell(JSON.stringify(stats.ulNoCandidateClassCounts || {}))}`);
  lines.push(`- ulReferenceFromDeterministicCount: ${Number(stats.ulReferenceFromDeterministicCount ?? 0)}`);
  lines.push("");
  if (Array.isArray(stats.ulCoverageMissReasonTop) && stats.ulCoverageMissReasonTop.length > 0) {
    lines.push("| reason | count | sample barcodes |");
    lines.push("|---|---:|---|");
    for (const row of stats.ulCoverageMissReasonTop.slice(0, 10)) {
      const samples = Array.isArray(row?.samples)
        ? row.samples
          .slice(0, 5)
          .map((sample) => {
            const barcode = safeMdCell(sample?.barcode || "unknown");
            const role = safeMdCell(sample?.role || "unknown");
            const candidate = Number(sample?.ulCandidateCount ?? 0);
            const produced = Number(sample?.ulProducedCount ?? 0);
            return `${barcode} (${role}) c=${candidate} p=${produced}`;
          })
          .join(" <br/> ")
        : "none";
      lines.push(`| ${safeMdCell(row?.reason || "UNKNOWN")} | ${Number(row?.count ?? 0)} | ${samples} |`);
    }
  } else {
    lines.push("- no UL miss reason diagnostics available");
  }
  lines.push("");

  lines.push("### Data Ceiling Bucket");
  lines.push("");
  if (stats.dataCeilingRateByRole && typeof stats.dataCeilingRateByRole === "object") {
    lines.push("| role | total | dataCeilingCount | dataCeilingRate |");
    lines.push("|---|---:|---:|---:|");
    for (const [role, row] of Object.entries(stats.dataCeilingRateByRole)) {
      lines.push(
        `| ${safeMdCell(role)} | ${Number(row?.total ?? 0)} | ${Number(row?.dataCeilingCount ?? 0)} | ${pct(row?.dataCeilingRate)} |`,
      );
    }
  } else {
    lines.push("- no data ceiling breakdown available");
  }
  lines.push("");

  lines.push("### EsterCore By Role");
  lines.push("");
  if (stats.esterCoreRateByRole && typeof stats.esterCoreRateByRole === "object") {
    lines.push("| role | total | passRate |");
    lines.push("|---|---:|---:|");
    for (const [role, row] of Object.entries(stats.esterCoreRateByRole)) {
      lines.push(`| ${safeMdCell(role)} | ${Number(row?.total ?? 0)} | ${pct(row?.passRate)} |`);
    }
  } else {
    lines.push("- no EsterCore role breakdown available");
  }
  lines.push("");

  lines.push("### Score not_found Targeted Subset");
  lines.push("");
  lines.push(`- targetedCount: ${Number(stats.scoreNotFoundTargetedCount ?? 0)}`);
  lines.push(`- byReason: ${safeMdCell(JSON.stringify(stats.scoreNotFoundTargetedByReason || {}))}`);
  lines.push("");

  lines.push("## Killer Infra vs Product");
  lines.push("");
  lines.push(`- configured attempts: ${Number(stats.killerConfiguredAttempts ?? 0)}`);
  lines.push(`- infra unavailable count: ${Number(stats.killerInfraUnavailableCount ?? 0)}`);
  lines.push(`- infra unavailable rate: ${pct(stats.killerInfraUnavailableRate)}`);
  lines.push(`- product attempts (gate denominator): ${Number(stats.killerProductAttempts ?? 0)}`);
  lines.push(`- product doneSeenRate: ${pct(stats.killerProductDoneSeenRate)}`);
  lines.push(`- killer inconclusive: ${stats.killerInconclusive ? "yes" : "no"}`);
  lines.push(
    `- product timeout classes: ${JSON.stringify(stats.killerProductTimeoutClassCounts || {})}`,
  );
  lines.push(
    `- product terminal reasons: ${JSON.stringify(stats.killerProductTerminalReasonCounts || {})}`,
  );
  lines.push(
    `- product client timeout rate: ${pct(stats.killerProductClientTimeoutRate)}`,
  );
  lines.push(
    `- product SSE_CONNECTED_BUT_NO_DONE count: ${Number(stats.killerProductSseConnectedButNoDoneCount ?? 0)}`,
  );
  lines.push("");

  lines.push("## Ceiling Suite");
  lines.push("");
  if (stats.ceilingSuite && typeof stats.ceilingSuite === "object" && Number(stats.ceilingSuite.total ?? 0) > 0) {
    lines.push(`- total: ${Number(stats.ceilingSuite.total ?? 0)}`);
    lines.push(`- doneSeenRate: ${pct(stats.ceilingSuite.doneSeenRate)}`);
    lines.push(`- coverDetailConsistencyFailCount: ${Number(stats.ceilingSuite.coverDetailConsistencyFailCount ?? 0)}`);
    lines.push(`- scoreTerminalSeenRate: ${pct(stats.ceilingSuite.scoreTerminalSeenRate)}`);
    lines.push(`- verifiedUnverifiedConflictCount: ${Number(stats.ceilingSuite.verifiedUnverifiedConflictCount ?? 0)}`);
    lines.push(`- pass: ${stats.ceilingSuite.pass ? "yes" : "no"}`);
  } else {
    lines.push("- no ceiling suite rows found in this run");
  }
  lines.push("");

  const killer = stats.killerConfidence || {};
  lines.push("## Killer Confidence");
  lines.push("");
  lines.push(`- total: ${killer.total ?? 0}`);
  lines.push(`- doneSeenRate: ${pct(killer.doneSeenRate)}`);
  lines.push(`- degradedRate: ${pct(killer.degradedRate)}`);
  lines.push(`- tDone P95: ${ms(killer?.tDoneDistribution?.p95)}`);
  lines.push(`- terminalReasonCounts: ${JSON.stringify(killer.terminalReasonCounts || {})}`);
  lines.push(`- timeoutClassCounts: ${JSON.stringify(killer.timeoutClassCounts || {})}`);
  lines.push("");
  lines.push("| phase | total | doneRate | degradedRate | tDoneP95 | terminalReasons | timeoutClasses |");
  lines.push("|---|---:|---:|---:|---:|---|---|");
  for (const phaseName of ["killer_cold", "killer_hot"]) {
    const row = killer?.phases?.[phaseName] || {};
    lines.push(
      `| ${phaseName} | ${row.total ?? 0} | ${pct(row.doneSeenRate)} | ${pct(row.degradedRate)} | ${ms(row?.tDoneDistribution?.p95)} | ${JSON.stringify(row.terminalReasonCounts || {})} | ${JSON.stringify(row.timeoutClassCounts || {})} |`,
    );
  }
  lines.push("");

  lines.push("## Failure Breakdown");
  lines.push("");
  if (failureReasons.length === 0) {
    lines.push("- no failed attempts");
  } else {
    for (const [reason, count] of failureReasons.slice(0, 15)) {
      lines.push(`- ${reason}: ${count}`);
    }
  }
  lines.push("");

  lines.push("## Screenshot Analysis");
  lines.push("");
  if (screenshotAnalysis.skipped) {
    lines.push("- screenshot capture disabled for this run; screenshot noise gates were not sampled.");
  } else {
    lines.push("### Checkpoint Coverage");
    lines.push("");
    lines.push("| checkpoint | present | missing |");
    lines.push("|---|---:|---:|");
    for (const [checkpoint, info] of Object.entries(screenshotAnalysis.coverage)) {
      lines.push(`| ${checkpoint} | ${info.present} | ${info.missing} |`);
    }
    lines.push("");

    lines.push("### Screenshot Anomalies");
    lines.push("");
    if (screenshotAnalysis.anomalies.length === 0) {
      lines.push("- no screenshot anomalies detected by checkpoint rules");
    } else {
      for (const anomaly of screenshotAnalysis.anomalies.slice(0, 30)) {
        const noise =
          Array.isArray(anomaly.noiseFlags) && anomaly.noiseFlags.length > 0
            ? ` noise=${anomaly.noiseFlags.join(",")}`
            : "";
        const screenshotPath = anomaly.screenshotPath ? ` screenshot=${anomaly.screenshotPath}` : "";
        lines.push(
          `- ${anomaly.type} | phase=${anomaly.phase} round=${anomaly.round} role=${anomaly.role} barcode=${anomaly.barcode}${noise}${screenshotPath}`,
        );
      }
    }
  }
  lines.push("");

  lines.push("## Notes");
  lines.push("");
  lines.push("- popupBlocked is sourced from preflight or run-time flags.");
  lines.push("- refreshing_banner/debug_toast are treated as screenshot noise gates, not backend done-failure.");
  lines.push("- terminalReason / degradedMode / stage0 counters come from `analysis_bundle.meta` when available.");
  lines.push("- Treat this report as the run-level QA ledger for go/no-go decisions.");
  lines.push("");

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${lines.join("\n")}\n`);

  console.log(`[mobile-soak-report] wrote ${outPath}`);
};

main().catch((error) => {
  console.error("[mobile-soak-report] failed", error instanceof Error ? error.message : error);
  process.exit(1);
});
