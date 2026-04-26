#!/usr/bin/env node
/* eslint-disable no-console */

import path from "node:path";
import {
  countBy,
  ensureDir,
  latencyStats,
  parseArgs,
  productKey,
  readJson,
  readJsonl,
  safeText,
  writeCsv,
  writeJson,
  writeText,
} from "./lib/scan-result-full-corpus-audit.mjs";

const p0p1Rows = (coreRows, sidecarRows, aiRows, contentRows) => {
  const out = [];
  for (const row of coreRows) {
    if (row.pass === false) out.push({ severity: row.failureClass === "server_5xx" || row.failureClass === "client_timeout" ? "P0" : "P1", productKey: row.productKey, productId: row.productId, barcode: row.barcode, family: row.family, area: "core", issue: row.failureClass, failureSubtype: row.failureSubtype ?? null, serviceWindowId: row.serviceWindowId ?? null, runOrder: row.runOrder ?? null, route: row.barcode ? "/api/enrich-stream" : "/api/search/product-detail", detail: row.serverError ?? row.terminal });
  }
  for (const row of sidecarRows) {
    if (row.visibleUnavailableText) out.push({ severity: "P0", productKey: row.productKey, productId: row.productId, barcode: row.barcode, family: row.family, area: "sidecar", issue: "visible_unavailable", route: row.route, detail: row.fallbackReason ?? row.error });
    else if (row.pass === false) out.push({ severity: "P1", productKey: row.productKey, productId: row.productId, barcode: row.barcode, family: row.family, area: "sidecar", issue: "contract_fail", route: row.route, detail: row.fallbackReason ?? row.error });
  }
  for (const row of aiRows) {
    if (row.severity === "P0" || row.severity === "P1") out.push({ severity: row.severity, productKey: row.productKey, productId: row.productId, barcode: row.barcode, family: row.family, area: "ai_summary", issue: `${row.type}_${row.severity}`, route: row.type, detail: row.preview });
  }
  for (const row of contentRows) {
    if (Number(row.overall_scan_result_value_score) < 45) out.push({ severity: "P1", productKey: row.productKey, productId: row.productId, barcode: row.barcode, family: row.family, area: "content_value", issue: "low_overall_content_value", route: "view_model", detail: `score=${row.overall_scan_result_value_score}` });
  }
  return out.sort((a, b) => a.severity.localeCompare(b.severity));
};

const renderFinalReport = ({ manifest, coreRows, sidecarRows, aiRows, contentRows, familyRows, failures }) => {
  const coreFailures = coreRows.filter((row) => row.pass === false);
  const p0 = failures.filter((row) => row.severity === "P0").length;
  const p1 = failures.filter((row) => row.severity === "P1").length;
  const contentScores = contentRows.map((row) => Number(row.overall_scan_result_value_score)).filter(Number.isFinite);
  const avgContent = contentScores.length ? Number((contentScores.reduce((sum, value) => sum + value, 0) / contentScores.length).toFixed(1)) : null;
  return [
    "# Scan Result Full-Corpus Audit Final Report",
    "",
    `- overall status: ${p0 === 0 ? "PASS_WITHOUT_P0" : "FAIL_P0_PRESENT"}`,
    `- corpus size: ${manifest.products?.length ?? 0}`,
    `- core rows: ${coreRows.length}`,
    `- sidecar rows: ${sidecarRows.length}`,
    `- AI summary rows: ${aiRows.length}`,
    `- content value rows: ${contentRows.length}`,
    `- P0 failures: ${p0}`,
    `- P1 failures: ${p1}`,
    "",
    "## Core Scan Stability",
    `- pass: ${coreRows.filter((row) => row.pass === true).length}`,
    `- fail: ${coreFailures.length}`,
    `- failure classes: ${JSON.stringify(countBy(coreFailures, "failureClass"))}`,
    `- rev1 p50/p95/p99: ${latencyStats(coreRows.map((row) => row.rev1Ms)).p50}/${latencyStats(coreRows.map((row) => row.rev1Ms)).p95}/${latencyStats(coreRows.map((row) => row.rev1Ms)).p99}`,
    `- done p50/p95/p99: ${latencyStats(coreRows.map((row) => row.doneMs)).p50}/${latencyStats(coreRows.map((row) => row.doneMs)).p95}/${latencyStats(coreRows.map((row) => row.doneMs)).p99}`,
    "",
    "## AI Summary Fallback / Unavailable",
    `- fallback reasons: ${JSON.stringify(countBy(aiRows.filter((row) => row.fallbackReason), "fallbackReason"))}`,
    `- unavailable rows: ${aiRows.filter((row) => row.visibleUnavailableText).length}`,
    `- by type: ${JSON.stringify(countBy(aiRows, "type"))}`,
    "",
    "## Family Coverage",
    `- families observed: ${familyRows.filter((row) => row.product_count > 0).length}`,
    `- top gaps: ${familyRows.filter((row) => row.product_count > 0 && (!row.dedicated_plan_exists || !row.reviewed_evidence_exists)).slice(0, 12).map((row) => row.family).join(", ")}`,
    "",
    "## Content Value",
    `- average score: ${avgContent}`,
    `- low value <45: ${contentRows.filter((row) => Number(row.overall_scan_result_value_score) < 45).length}`,
    "",
    "## UX Issue Summary",
    `- visible unavailable sidecars: ${sidecarRows.filter((row) => row.visibleUnavailableText).length}`,
    `- low-value products: ${contentRows.filter((row) => Number(row.overall_scan_result_value_score) < 60).length}`,
    "",
    "## P0/P1 Failures",
    ...failures.slice(0, 80).map((row) => `- ${row.severity} | ${row.area} | ${row.family} | ${row.productKey} | ${row.issue} | ${safeText(row.detail)}`),
    "",
    "## What Should Be Fixed First",
    "- Fix P0 visible unavailable/blank/core crashes before any copy polish.",
    "- Then fix P1 supported-family generic fallbacks and scientific evidence-boundary gaps.",
    "- Then improve source/factsStatus data gaps that depress whole families.",
    "",
    "## What Should Not Be Mixed Into This Release",
    "- Expo camera upgrade.",
    "- Express 5 migration.",
    "- Frozen scan frontend redesign or navigation changes.",
    "",
    "## Recommended Next PRs",
    "- PR 1: fix P0 audit failures only.",
    "- PR 2: family-specific content/evidence fixes for largest P1 buckets.",
    "- PR 3: data-quality backfill for missing active/dose/form/warning fields.",
    "",
  ].join("\n");
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2), { mode: "finalize", concurrency: 1 });
  await ensureDir(args.runDir);
  const manifest = await readJson(args.manifestPath);
  const coreRows = await readJsonl(path.join(args.runDir, "core-results.jsonl"));
  const sidecarRows = await readJsonl(path.join(args.runDir, "sidecar-results.jsonl"));
  const aiRows = await readJsonl(path.join(args.runDir, "ai-summary-audit.jsonl"));
  let contentRows = [];
  try {
    contentRows = (await readJson(path.join(args.runDir, "content-value-scores.json"))).rows ?? [];
  } catch {}
  let familyRows = [];
  try {
    familyRows = (await readJson(path.join(args.runDir, "family-coverage-matrix.json"))).rows ?? [];
  } catch {}
  const failures = p0p1Rows(coreRows, sidecarRows, aiRows, contentRows);
  await writeCsv(path.join(args.runDir, "p0-p1-failure-list.csv"), failures);
  await writeCsv(path.join(args.runDir, "product-level-audit.csv"), buildProductLevelRows(manifest.products ?? [], coreRows, sidecarRows, aiRows, contentRows));
  await writeCsv(path.join(args.runDir, "family-level-audit.csv"), familyRows);
  await writeCsv(path.join(args.runDir, "ai-summary-fallback-matrix.csv"), aiRows.map((row) => ({ productKey: row.productKey, productId: row.productId, barcode: row.barcode, family: row.family, type: row.type, source: row.source, fallbackUsed: row.fallbackUsed, fallbackReason: row.fallbackReason, severity: row.severity, unavailable: row.visibleUnavailableText })));
  const finalJson = {
    reportType: "scan_result_full_corpus_final_report",
    generatedAt: new Date().toISOString(),
    runId: args.runId,
    configuredTarget: manifest.configuredTarget ?? args.stagingUrl,
    corpusSize: manifest.products?.length ?? 0,
    core: { total: coreRows.length, pass: coreRows.filter((row) => row.pass === true).length, fail: coreRows.filter((row) => row.pass === false).length },
    sidecars: { total: sidecarRows.length, unavailable: sidecarRows.filter((row) => row.visibleUnavailableText).length },
    ai: { total: aiRows.length, p0: aiRows.filter((row) => row.severity === "P0").length, p1: aiRows.filter((row) => row.severity === "P1").length },
    failures,
  };
  await writeJson(path.join(args.runDir, "FINAL_REPORT.json"), finalJson);
  await writeText(path.join(args.runDir, "FINAL_REPORT.md"), renderFinalReport({ manifest, coreRows, sidecarRows, aiRows, contentRows, familyRows, failures }));
  console.log(`[scan-result-finalize] complete runId=${args.runId} failures=${failures.length}`);
};

const buildProductLevelRows = (products, coreRows, sidecarRows, aiRows, contentRows) => products.map((product) => {
  const key = productKey(product);
  const core = coreRows.find((row) => row.productKey === key) ?? {};
  const content = contentRows.find((row) => row.productKey === key) ?? {};
  const productSidecars = sidecarRows.filter((row) => row.productKey === key);
  const productAi = aiRows.filter((row) => row.productKey === key);
  return {
    productKey: key,
    productId: product.productId,
    barcode: product.barcode,
    productName: product.productName,
    brand: product.brand,
    family: product.family,
    sourceTier: product.sourceTier,
    factsStatus: product.factsStatus,
    corePass: core.pass ?? null,
    runOrder: core.runOrder ?? null,
    observedLine: core.observedLine ?? null,
    batchId: core.batchId ?? null,
    terminal: core.terminal ?? null,
    failureClass: core.failureClass ?? null,
    failureSubtype: core.failureSubtype ?? null,
    serviceWindowId: core.serviceWindowId ?? null,
    retryCount: core.retryCount ?? null,
    initialHttpStatus: core.initialHttpStatus ?? core.httpStatus ?? null,
    finalHttpStatus: core.finalHttpStatus ?? core.httpStatus ?? null,
    healthcheckStatus: core.healthcheckStatus ?? null,
    scoreAvailable: core.scoreAvailable ?? null,
    scorePath: core.scorePath ?? null,
    scoreOverall: core.scoreOverall ?? null,
    coreCardsAvailable: core.coreCardsAvailable ?? null,
    sidecarUnavailableCount: productSidecars.filter((row) => row.visibleUnavailableText).length,
    aiP0P1Count: productAi.filter((row) => row.severity === "P0" || row.severity === "P1").length,
    overallContentValueScore: content.overall_scan_result_value_score ?? null,
  };
});

main().catch((error) => {
  console.error("[scan-result-finalize] failed", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
