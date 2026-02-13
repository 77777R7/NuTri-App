#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const HOURS = Number.parseInt(process.env.LABEL_SCAN_SCORECARD_HOURS ?? "24", 10);
const MAX_ROWS = Number.parseInt(process.env.LABEL_SCAN_SCORECARD_MAX_ROWS ?? "5000", 10);
const MIN_VARIANT_SAMPLE_SIZE = Number.parseInt(process.env.LABEL_SCAN_SCORECARD_MIN_VARIANT_N ?? "200", 10);
const QUERY_TIMEOUT_MS = Number.parseInt(process.env.LABEL_SCAN_SCORECARD_QUERY_TIMEOUT_MS ?? "12000", 10);
const QUERY_MAX_ATTEMPTS = Number.parseInt(process.env.LABEL_SCAN_SCORECARD_QUERY_MAX_ATTEMPTS ?? "3", 10);
const QUERY_RETRY_BASE_MS = Number.parseInt(process.env.LABEL_SCAN_SCORECARD_QUERY_RETRY_BASE_MS ?? "800", 10);

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((p / 100) * (sorted.length - 1))));
  return sorted[idx] ?? null;
}

function ratio(numerator, denominator) {
  if (!denominator) return 0;
  return numerator / denominator;
}

function toNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toCountMap(rows, selector) {
  const counts = new Map();
  for (const row of rows) {
    const key = selector(row) ?? "unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => Number(b[1]) - Number(a[1])));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarizeError(error) {
  const raw = String(error instanceof Error ? error.message : error ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return "unknown_error";
  return raw.length > 320 ? `${raw.slice(0, 320)}...` : raw;
}

function isInfraTransientError(error) {
  const message = summarizeError(error).toLowerCase();
  return [
    "error 522",
    "cloudflare",
    "timed out",
    "timeout",
    "fetch failed",
    "econn",
    "etimedout",
    "enotfound",
    "eai_again",
    "network",
    "connection",
  ].some((token) => message.includes(token));
}

function createTimeoutFetch(timeoutMs) {
  return async (input, init = {}) => {
    const controller = new AbortController();
    const upstreamSignal = init?.signal;
    const onAbort = () => controller.abort(upstreamSignal?.reason ?? new Error("upstream_aborted"));

    if (upstreamSignal) {
      if (upstreamSignal.aborted) onAbort();
      else upstreamSignal.addEventListener("abort", onAbort, { once: true });
    }

    const timeoutHandle = setTimeout(() => {
      controller.abort(new Error(`scorecard_fetch_timeout_${timeoutMs}ms`));
    }, timeoutMs);

    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted && !upstreamSignal?.aborted) {
        throw new Error(`scorecard_fetch_timeout_${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutHandle);
      if (upstreamSignal) {
        upstreamSignal.removeEventListener("abort", onAbort);
      }
    }
  };
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_READONLY_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_READONLY_KEY) are required.");
  }

  const client = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
    global: { fetch: createTimeoutFetch(QUERY_TIMEOUT_MS) },
  });
  const since = new Date(Date.now() - HOURS * 60 * 60 * 1000).toISOString();
  let rows = [];
  let queryAttempts = 0;

  try {
    for (let attempt = 1; attempt <= QUERY_MAX_ATTEMPTS; attempt += 1) {
      queryAttempts = attempt;
      try {
        const { data, error } = await client
          .from("label_scan_metrics")
          .select("*")
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(MAX_ROWS);

        if (error) {
          throw new Error(`label_scan_metrics query failed: ${error.message}`);
        }

        rows = data ?? [];
        break;
      } catch (error) {
        if (attempt >= QUERY_MAX_ATTEMPTS || !isInfraTransientError(error)) {
          throw error;
        }
        await sleep(Math.max(250, QUERY_RETRY_BASE_MS * attempt));
      }
    }
  } catch (error) {
    if (!isInfraTransientError(error)) {
      throw error;
    }

    const outputDir = path.join(process.cwd(), "output", `label-scan-scorecard-${Date.now()}`);
    await fs.mkdir(outputDir, { recursive: true });

    const degradedSummary = {
      generatedAt: new Date().toISOString(),
      status: "infra_degraded",
      infraError: summarizeError(error),
      windowHours: HOURS,
      sampleSize: 0,
      query: {
        since,
        timeoutMs: QUERY_TIMEOUT_MS,
        maxAttempts: QUERY_MAX_ATTEMPTS,
        retryBaseMs: QUERY_RETRY_BASE_MS,
        attempts: queryAttempts || QUERY_MAX_ATTEMPTS,
      },
    };

    await fs.writeFile(
      path.join(outputDir, "label_scan_scorecard.json"),
      JSON.stringify(degradedSummary, null, 2),
    );
    await fs.writeFile(
      path.join(outputDir, "label_scan_scorecard.md"),
      [
        "# Label Scan Nightly Scorecard",
        "",
        "- status: infra_degraded",
        `- generatedAt: ${degradedSummary.generatedAt}`,
        `- reason: ${degradedSummary.infraError}`,
        `- query attempts: ${degradedSummary.query.attempts}/${degradedSummary.query.maxAttempts}`,
        `- timeoutMs: ${degradedSummary.query.timeoutMs}`,
        "",
        "Nightly marked as infra degraded. Treat as platform/network incident, not product regression.",
      ].join("\n"),
    );

    console.warn(`[label-scan-scorecard] infra_degraded wrote ${outputDir}`);
    return;
  }
  const tFirstDraftProxy = rows.map((row) => toNumber(row.t_client_roundtrip_ms)).filter((v) => v != null);
  const tDraftRender = rows.map((row) => toNumber(row.t_click_to_draft_render_ms)).filter((v) => v != null);
  const tCompleteRender = rows.map((row) => toNumber(row.t_click_to_analysis_complete_render_ms)).filter((v) => v != null);
  const tDraftResponse = rows.map((row) => toNumber(row.t_click_to_draft_response_ms)).filter((v) => v != null);
  const tDecode = rows.map((row) => toNumber(row.t_decode_ms)).filter((v) => v != null);
  const tOcr = rows.map((row) => toNumber(row.t_ocr_ms)).filter((v) => v != null);
  const tParse = rows.map((row) => toNumber(row.t_parse_ms)).filter((v) => v != null);
  const tLlm = rows.map((row) => toNumber(row.t_llm_ms)).filter((v) => v != null);
  const tFirstDraftServer = rows.map((row) => toNumber(row.t_first_draft_server_ms)).filter((v) => v != null);
  const parseCoverage = rows.map((row) => toNumber(row.parse_coverage)).filter((v) => v != null);
  const ocrCallCount = rows.map((row) => toNumber(row.ocr_call_count)).filter((v) => v != null);
  const analysisCacheRows = rows.filter((row) => typeof row.analysis_cache_hit === "boolean");
  const analysisCacheHitCount = analysisCacheRows.filter((row) => row.analysis_cache_hit === true).length;

  let laneSplitTriggeredCount = 0;
  let laneSplitRows = 0;
  let rowsWithLockedConflict = 0;
  let lockedFieldConflictTotal = 0;
  const issueCounts = new Map();
  for (const row of rows) {
    const laneApplied = row.lane_split_chosen === "lane_split";
    laneSplitRows += 1;
    if (laneApplied || row.lane_split_triggered === true) laneSplitTriggeredCount += 1;
    const conflicts = toNumber(row.locked_field_conflict_count) ?? 0;
    lockedFieldConflictTotal += conflicts;
    if (conflicts > 0) rowsWithLockedConflict += 1;
    const issues = Array.isArray(row.issue_types) ? row.issue_types : [];
    for (const issue of issues) {
      issueCounts.set(issue, (issueCounts.get(issue) ?? 0) + 1);
    }
  }

  const pendingCount = rows.filter((row) => row.analysis_status === "pending").length;
  const completeCount = rows.filter((row) => row.analysis_status === "complete" || row.analysis_status === "partial").length;
  const failedCount = rows.filter((row) => row.response_status === "failed").length;
  const needsConfirmCount = rows.filter((row) => row.needs_confirmation === true).length;
  const ocrCacheHitCount = rows.filter((row) => row.ocr_cache_hit === true).length;
  const parseCacheRows = rows.filter((row) => typeof row.parse_cache_hit === "boolean");
  const parseCacheHitCount = parseCacheRows.filter((row) => row.parse_cache_hit === true).length;
  const variantRows = {
    control: rows.filter((row) => row.flag_variant === "control"),
    draft_first_async: rows.filter((row) => row.flag_variant === "draft_first_async"),
  };
  const variantStats = Object.fromEntries(
    Object.entries(variantRows).map(([variant, variantSubset]) => {
      const variantDraftRender = variantSubset
        .map((row) => toNumber(row.t_click_to_draft_render_ms))
        .filter((v) => v != null);
      const variantFailed = variantSubset.filter((row) => row.response_status === "failed").length;
      const variantConflicts = variantSubset.reduce(
        (sum, row) => sum + (toNumber(row.locked_field_conflict_count) ?? 0),
        0,
      );
      return [
        variant,
        {
          count: variantSubset.length,
          draftRenderP95: percentile(variantDraftRender, 95),
          failedRatio: ratio(variantFailed, variantSubset.length),
          lockedFieldConflictTotal: variantConflicts,
        },
      ];
    }),
  );
  const variantEligible =
    (variantStats.control?.count ?? 0) >= MIN_VARIANT_SAMPLE_SIZE
    && (variantStats.draft_first_async?.count ?? 0) >= MIN_VARIANT_SAMPLE_SIZE;
  const controlP95 = variantStats.control?.draftRenderP95 ?? null;
  const draftP95 = variantStats.draft_first_async?.draftRenderP95 ?? null;
  const p95RelativeDelta =
    typeof controlP95 === "number" && controlP95 > 0 && typeof draftP95 === "number"
      ? (draftP95 - controlP95) / controlP95
      : null;
  const failedRatioDelta =
    typeof variantStats.control?.failedRatio === "number" && typeof variantStats.draft_first_async?.failedRatio === "number"
      ? variantStats.draft_first_async.failedRatio - variantStats.control.failedRatio
      : null;
  const onlineGateFailures = [];
  if (variantEligible) {
    if (typeof p95RelativeDelta === "number" && p95RelativeDelta > 0.15) {
      onlineGateFailures.push(`p95_relative_regression_gt_15pct(${(p95RelativeDelta * 100).toFixed(1)}%)`);
    }
    if (typeof failedRatioDelta === "number" && failedRatioDelta > 0.005) {
      onlineGateFailures.push(`failed_ratio_delta_gt_0_5pct(${(failedRatioDelta * 100).toFixed(2)}%)`);
    }
    if ((variantStats.draft_first_async?.lockedFieldConflictTotal ?? 0) > 0) {
      onlineGateFailures.push(`locked_field_conflict_gt_0(${variantStats.draft_first_async.lockedFieldConflictTotal})`);
    }
  }

  const dimensionGroups = new Map();
  for (const row of rows) {
    const keyParts = [
      row.flag_variant ?? "unknown",
      row.parser_version ?? "unknown",
      row.preprocess_profile ?? "unknown",
      row.lane_split_chosen ?? "unknown",
    ];
    const key = keyParts.join("::");
    const existing = dimensionGroups.get(key) ?? { rows: [], keyParts };
    existing.rows.push(row);
    dimensionGroups.set(key, existing);
  }

  const dimensionSummary = [...dimensionGroups.values()].map(({ rows: groupedRows, keyParts }) => {
    const groupedCoverage = groupedRows.map((row) => toNumber(row.parse_coverage)).filter((v) => v != null);
    const groupedDraftRender = groupedRows.map((row) => toNumber(row.t_click_to_draft_render_ms)).filter((v) => v != null);
    const groupedNeedsConfirm = groupedRows.filter((row) => row.needs_confirmation === true).length;
    return {
      flagVariant: keyParts[0],
      parserVersion: keyParts[1],
      preprocessProfile: keyParts[2],
      laneSplitChosen: keyParts[3],
      count: groupedRows.length,
      draftRenderP95: percentile(groupedDraftRender, 95),
      parseCoverageP50: percentile(groupedCoverage, 50),
      needsConfirmationRatio: ratio(groupedNeedsConfirm, groupedRows.length),
    };
  }).sort((a, b) => b.count - a.count);

  const summary = {
    generatedAt: new Date().toISOString(),
    status: "ok",
    query: {
      since,
      timeoutMs: QUERY_TIMEOUT_MS,
      maxAttempts: QUERY_MAX_ATTEMPTS,
      retryBaseMs: QUERY_RETRY_BASE_MS,
      attempts: queryAttempts,
    },
    windowHours: HOURS,
    sampleSize: rows.length,
    northStar: {
      metric: "t_click_to_draft_render_ms",
      sourceField: "t_click_to_draft_render_ms",
      p50: percentile(tDraftRender, 50),
      p90: percentile(tDraftRender, 90),
      p95: percentile(tDraftRender, 95),
      proxyRoundtrip: {
        p50: percentile(tFirstDraftProxy, 50),
        p90: percentile(tFirstDraftProxy, 90),
        p95: percentile(tFirstDraftProxy, 95),
      },
    },
    clientTiming: {
      t_click_to_draft_render_ms: {
        p50: percentile(tDraftRender, 50),
        p90: percentile(tDraftRender, 90),
        p95: percentile(tDraftRender, 95),
      },
      t_click_to_analysis_complete_render_ms: {
        p50: percentile(tCompleteRender, 50),
        p90: percentile(tCompleteRender, 90),
        p95: percentile(tCompleteRender, 95),
      },
      t_click_to_draft_response_ms: {
        p50: percentile(tDraftResponse, 50),
        p90: percentile(tDraftResponse, 90),
        p95: percentile(tDraftResponse, 95),
      },
    },
    serverTiming: {
      t_first_draft_server_ms: { p50: percentile(tFirstDraftServer, 50), p90: percentile(tFirstDraftServer, 90), p95: percentile(tFirstDraftServer, 95) },
      t_decode_ms: { p50: percentile(tDecode, 50), p90: percentile(tDecode, 90), p95: percentile(tDecode, 95) },
      t_ocr_ms: { p50: percentile(tOcr, 50), p90: percentile(tOcr, 90), p95: percentile(tOcr, 95) },
      t_parse_ms: { p50: percentile(tParse, 50), p90: percentile(tParse, 90), p95: percentile(tParse, 95) },
      t_llm_ms: { p50: percentile(tLlm, 50), p90: percentile(tLlm, 90), p95: percentile(tLlm, 95) },
    },
    quality: {
      parseCoverage: {
        p50: percentile(parseCoverage, 50),
        p90: percentile(parseCoverage, 90),
        p95: percentile(parseCoverage, 95),
      },
      needsConfirmationRatio: ratio(needsConfirmCount, rows.length),
      pendingRatio: ratio(pendingCount, rows.length),
      completeRatio: ratio(completeCount, rows.length),
      failedRatio: ratio(failedCount, rows.length),
    },
    buckets: {
      laneSplitTriggeredRatio: laneSplitRows ? laneSplitTriggeredCount / laneSplitRows : 0,
      flagVariantCounts: toCountMap(rows, (row) => row.flag_variant),
      laneSplitChosenCounts: toCountMap(rows, (row) => row.lane_split_chosen ?? "unknown"),
      laneSplitRevertedReasonCounts: toCountMap(rows, (row) => row.lane_split_reverted_reason ?? "none"),
      cacheModeCounts: toCountMap(rows, (row) => row.cache_mode),
    },
    cache: {
      ocrCacheHitRatio: ratio(ocrCacheHitCount, rows.length),
      parseCacheHitRatio: ratio(parseCacheHitCount, parseCacheRows.length),
      analysisCacheHitRatio: ratio(analysisCacheHitCount, analysisCacheRows.length),
      ocrCallCount: {
        p50: percentile(ocrCallCount, 50),
        p90: percentile(ocrCallCount, 90),
        p95: percentile(ocrCallCount, 95),
      },
    },
    conflicts: {
      lockedFieldConflictTotal,
      rowsWithLockedConflict,
      rowsWithLockedConflictRatio: ratio(rowsWithLockedConflict, rows.length),
    },
    issueCounts: Object.fromEntries(
      [...issueCounts.entries()].sort((a, b) => Number(b[1]) - Number(a[1])),
    ),
    dimensions: {
      byVariantParserProfileLane: dimensionSummary.slice(0, 100),
    },
    onlineGate: {
      mode: "traffic_monitoring_non_blocking",
      minVariantSampleSize: MIN_VARIANT_SAMPLE_SIZE,
      eligible: variantEligible,
      failures: onlineGateFailures,
      pass: variantEligible ? onlineGateFailures.length === 0 : null,
      notes: variantEligible
        ? []
        : ["insufficient_variant_samples_for_blocking_decision"],
      variantStats,
      comparisons: {
        p95RelativeDelta,
        failedRatioDelta,
      },
    },
  };

  const outputDir = path.join(
    process.cwd(),
    "output",
    `label-scan-scorecard-${Date.now()}`,
  );
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, "label_scan_scorecard.json"), JSON.stringify(summary, null, 2));

  const md = [
    "# Label Scan Nightly Scorecard",
    ``,
    `- Status: ${summary.status}`,
    `- Generated: ${summary.generatedAt}`,
    `- Window: last ${HOURS}h`,
    `- Sample size: ${rows.length}`,
    `- Query attempts: ${summary.query.attempts}/${summary.query.maxAttempts} (timeout=${summary.query.timeoutMs}ms)`,
    ``,
    "## North Star (Proxy)",
    `- p50: ${summary.northStar.p50 ?? "n/a"} ms`,
    `- p90: ${summary.northStar.p90 ?? "n/a"} ms`,
    `- p95: ${summary.northStar.p95 ?? "n/a"} ms`,
    `- proxy roundtrip p95: ${summary.northStar.proxyRoundtrip.p95 ?? "n/a"} ms`,
    ``,
    "## Client Timing p95",
    `- draft render: ${summary.clientTiming.t_click_to_draft_render_ms.p95 ?? "n/a"} ms`,
    `- draft response: ${summary.clientTiming.t_click_to_draft_response_ms.p95 ?? "n/a"} ms`,
    `- analysis complete render: ${summary.clientTiming.t_click_to_analysis_complete_render_ms.p95 ?? "n/a"} ms`,
    ``,
    "## Server Timing p95",
    `- first draft server: ${summary.serverTiming.t_first_draft_server_ms.p95 ?? "n/a"} ms`,
    `- decode: ${summary.serverTiming.t_decode_ms.p95 ?? "n/a"} ms`,
    `- ocr: ${summary.serverTiming.t_ocr_ms.p95 ?? "n/a"} ms`,
    `- parse: ${summary.serverTiming.t_parse_ms.p95 ?? "n/a"} ms`,
    `- llm: ${summary.serverTiming.t_llm_ms.p95 ?? "n/a"} ms`,
    ``,
    "## Quality",
    `- parseCoverage p50/p90/p95: ${summary.quality.parseCoverage.p50 ?? "n/a"} / ${summary.quality.parseCoverage.p90 ?? "n/a"} / ${summary.quality.parseCoverage.p95 ?? "n/a"}`,
    `- needsConfirmation ratio: ${(summary.quality.needsConfirmationRatio * 100).toFixed(1)}%`,
    `- complete ratio: ${(summary.quality.completeRatio * 100).toFixed(1)}%`,
    `- failed ratio: ${(summary.quality.failedRatio * 100).toFixed(1)}%`,
    `- laneSplit triggered ratio: ${(summary.buckets.laneSplitTriggeredRatio * 100).toFixed(1)}%`,
    `- locked conflict rows ratio: ${(summary.conflicts.rowsWithLockedConflictRatio * 100).toFixed(2)}%`,
    ``,
    "## Cache",
    `- ocr cache hit ratio: ${(summary.cache.ocrCacheHitRatio * 100).toFixed(1)}%`,
    `- parse cache hit ratio: ${(summary.cache.parseCacheHitRatio * 100).toFixed(1)}%`,
    `- analysis cache hit ratio: ${(summary.cache.analysisCacheHitRatio * 100).toFixed(1)}%`,
    `- ocr call count p95: ${summary.cache.ocrCallCount.p95 ?? "n/a"}`,
    ``,
    "## Online Gate (Non-Blocking)",
    `- eligible: ${summary.onlineGate.eligible}`,
    `- pass: ${summary.onlineGate.pass === null ? "n/a" : summary.onlineGate.pass}`,
    `- failures: ${summary.onlineGate.failures.length ? summary.onlineGate.failures.join(", ") : "none"}`,
    `- variant stats: ${JSON.stringify(summary.onlineGate.variantStats)}`,
    `- comparisons: ${JSON.stringify(summary.onlineGate.comparisons)}`,
    ``,
    "## Buckets",
    `- flag variants: ${JSON.stringify(summary.buckets.flagVariantCounts)}`,
    `- lane chosen: ${JSON.stringify(summary.buckets.laneSplitChosenCounts)}`,
    `- lane revert reasons: ${JSON.stringify(summary.buckets.laneSplitRevertedReasonCounts)}`,
    `- cache modes: ${JSON.stringify(summary.buckets.cacheModeCounts)}`,
    ``,
    "## Issue Top List",
    ...Object.entries(summary.issueCounts).slice(0, 10).map(([issue, count]) => `- ${issue}: ${count}`),
  ].join("\n");
  await fs.writeFile(path.join(outputDir, "label_scan_scorecard.md"), md);

  console.log(`[label-scan-scorecard] wrote ${outputDir}`);
}

main().catch((error) => {
  console.error("[label-scan-scorecard] failed", error);
  process.exit(1);
});
