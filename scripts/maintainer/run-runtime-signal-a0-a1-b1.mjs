#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const getArg = (flag) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};
const hasFlag = (flag) => args.includes(`--${flag}`);
const asNumber = (value, fallback) => {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const now = new Date().toISOString().replace(/[:]/g, "-");
const outDir =
  getArg("out-dir") ??
  path.resolve(process.cwd(), "output/npn_webhunt/runtime_signal_pipeline", now);
const lookbackHours = Math.max(1, asNumber(getArg("lookback-hours"), 24 * 90));
const b1RunHours = Math.max(1, asNumber(getArg("b1-run-hours"), 6));
const b1BatchSize = Math.max(300, Math.min(500, asNumber(getArg("b1-batch-size"), 400)));
const b1MaxBatches = Math.max(1, asNumber(getArg("b1-max-batches"), 2));
const b1StoplossYield = Math.max(0, asNumber(getArg("b1-stoploss-yield"), 1));
const b1StoplossHours = Math.max(1, asNumber(getArg("b1-stoploss-hours"), 2));
const b1FallbackLimit = Math.max(100, asNumber(getArg("b1-fallback-limit"), b1BatchSize * b1MaxBatches));
const b1Phase3QueuePath = getArg("b1-phase3-queue");
const b1FallbackMinYield = Math.max(0, asNumber(getArg("b1-fallback-min-yield"), 5));
const b1FallbackSkipOnPrevZero = !hasFlag("b1-fallback-no-skip-on-prev-zero");
const b1MinHighValueQueueCount = Math.max(1, asNumber(getArg("b1-min-high-value-queue-count"), 20));
const b1DomainZeroYieldStreak = Math.max(1, asNumber(getArg("b1-domain-zero-yield-streak"), 2));
const b1DomainAutofilterRuns = Math.max(1, asNumber(getArg("b1-domain-autofilter-runs"), 6));
const b1DomainMinKeep = Math.max(1, asNumber(getArg("b1-domain-min-keep"), 3));
const b1MaxDomainsPerBatch = Math.max(3, asNumber(getArg("b1-max-domains-per-batch"), 12));
const b1SitemapMaxPagesPerDomain = Math.max(50, asNumber(getArg("b1-sitemap-max-pages-per-domain"), 120));
const b1EnrichCseTimeoutMs = Math.max(1500, asNumber(getArg("b1-enrich-cse-timeout-ms"), 3200));
const b1EnrichHtmlTimeoutMs = Math.max(1500, asNumber(getArg("b1-enrich-html-timeout-ms"), 5000));
const b1StageTimeoutSitemapSec = Math.max(120, asNumber(getArg("b1-stage-timeout-sitemap-sec"), 420));
const b1StageTimeoutEnrichSec = Math.max(120, asNumber(getArg("b1-stage-timeout-enrich-sec"), 2400));
const b1StageTimeoutCompareSec = Math.max(120, asNumber(getArg("b1-stage-timeout-compare-sec"), 900));
const dryRun = hasFlag("dry-run");
const skipB1 = hasFlag("skip-b1");
const skipA1RepairLoop = hasFlag("skip-a1-repair-loop");
const a1RepairManifestTags = (getArg("a1-repair-manifest-tags") ?? "release")
  .split(",")
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);
const a1RepairReplayMaxRows = Math.max(0, asNumber(getArg("a1-repair-replay-max-rows"), 0));
const skipBaseline = hasFlag("skip-baseline");
const requireBaseline = hasFlag("require-baseline");

const ensureDir = (dirPath) => fs.mkdirSync(dirPath, { recursive: true });
const readJsonSafe = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
};
const writeJsonl = (filePath, rows) => {
  ensureDir(path.dirname(filePath));
  const body = rows.map((row) => JSON.stringify(row)).join("\n");
  fs.writeFileSync(filePath, rows.length ? `${body}\n` : "", "utf8");
};
const writeJson = (filePath, payload) => {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};
const readJsonlSafe = (filePath) => {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf8").trim();
  if (!raw) return [];
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
};

const buildQueueDedupKey = (row) => {
  const npn = String(row?.npn ?? "").replace(/\D/g, "");
  const barcode = String(row?.barcode_gtin14 ?? row?.barcode ?? "").replace(/\D/g, "");
  const brand = String(row?.brandName ?? "").trim().toLowerCase();
  const product = String(row?.productName ?? "").trim().toLowerCase();
  return `${npn || "na"}|${barcode || "na"}|${brand || "na"}|${product || "na"}`;
};

const dedupeQueueRows = (rows) => {
  const seen = new Set();
  const out = [];
  for (const row of rows ?? []) {
    const key = buildQueueDedupKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
};

const findLatestPhase3Queue = () => {
  const root = path.resolve(process.cwd(), "output/npn_webhunt/phase3_low_yield");
  if (!fs.existsSync(root)) return null;
  const stack = [root];
  const files = [];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name === "low_yield_phase3_queue.jsonl") {
        files.push(fullPath);
      }
    }
  }
  if (files.length === 0) return null;
  files.sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs);
  return files.at(-1) ?? null;
};

const normalizeDomain = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");

const listCompletedRuntimeB1Runs = (excludeOutDir) => {
  const root = path.resolve(process.cwd(), "output/npn_webhunt/runtime_signal_pipeline");
  if (!fs.existsSync(root)) return [];
  const excludeResolved = excludeOutDir ? path.resolve(excludeOutDir) : null;
  const stack = [root];
  const entries = [];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile() || entry.name !== "progress_report.json") continue;
      const runDir = path.dirname(fullPath);
      if (!runDir.endsWith(`${path.sep}b1_full_hunt`)) continue;
      const pipelineDir = path.dirname(runDir);
      if (excludeResolved && pipelineDir === excludeResolved) continue;
      let report = null;
      try {
        report = JSON.parse(fs.readFileSync(fullPath, "utf8"));
      } catch {
        report = null;
      }
      if (!report || report.status !== "completed") continue;
      const batchReports = Array.isArray(report.batchReports) ? report.batchReports : [];
      const lastBatch = batchReports.at(-1) ?? null;
      entries.push({
        progressPath: fullPath,
        runDir,
        pipelineDir,
        mtimeMs: fs.statSync(fullPath).mtimeMs,
        report,
        lastBatch,
      });
    }
  }
  entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return entries;
};

const loadPreviousB1YieldSignal = (excludeOutDir) => {
  const previous = listCompletedRuntimeB1Runs(excludeOutDir);
  if (previous.length === 0) return null;
  const top = previous[0];
  const yieldPer1000NetNewPairs = Number(top.lastBatch?.quality?.yieldPer1000NetNewPairs ?? 0);
  const netNewPairs = Number(top.lastBatch?.compareStats?.netNewPairs ?? 0);
  return {
    runDir: top.runDir,
    progressPath: top.progressPath,
    batchId: top.lastBatch?.batchId ?? null,
    yieldPer1000NetNewPairs,
    netNewPairs,
  };
};

const buildTierADomainAutofilter = (params) => {
  const { outDir: currentOutDir, streakThreshold, maxRuns, minKeep } = params;
  const seedPath = path.resolve(process.cwd(), "backend/config/domains_seed.v1.json");
  if (!fs.existsSync(seedPath)) {
    return {
      applied: false,
      reason: "seed_missing",
      selectedDomains: [],
      culledDomains: [],
      domainsFile: null,
      inspectedRuns: 0,
      minKeep,
      skipB1Recommended: false,
    };
  }
  let seed = null;
  try {
    seed = JSON.parse(fs.readFileSync(seedPath, "utf8"));
  } catch {
    seed = null;
  }
  const seedRows = Array.isArray(seed?.domains) ? seed.domains : [];
  const tierA = seedRows
    .filter((row) => String(row?.status ?? "active").toLowerCase() === "active")
    .filter((row) => String(row?.priorityTier ?? "").toUpperCase() === "A")
    .map((row) => normalizeDomain(row?.domain))
    .filter(Boolean);
  const baseDomains = Array.from(new Set(tierA));
  if (baseDomains.length === 0) {
    return {
      applied: false,
      reason: "no_tier_a_seed",
      selectedDomains: [],
      culledDomains: [],
      domainsFile: null,
      inspectedRuns: 0,
      minKeep,
      skipB1Recommended: false,
    };
  }

  const recentRuns = listCompletedRuntimeB1Runs(currentOutDir).slice(0, maxRuns);
  if (recentRuns.length === 0) {
    const filePath = path.join(currentOutDir, "a0", "b1_domains_tier_a_autofilter.txt");
    fs.writeFileSync(filePath, `${baseDomains.join("\n")}\n`, "utf8");
    return {
      applied: true,
      reason: "no_history",
      selectedDomains: baseDomains,
      culledDomains: [],
      domainsFile: filePath,
      inspectedRuns: 0,
      minKeep,
      skipB1Recommended: false,
    };
  }

  const perRunDomainYield = recentRuns.map((run) => {
    const batchesDir = path.join(run.runDir, "batches");
    const domainYield = new Map();
    if (fs.existsSync(batchesDir)) {
      for (const batchName of fs.readdirSync(batchesDir)) {
        const domainStatsPath = path.join(batchesDir, batchName, "sitemap", "domain_stats.json");
        if (!fs.existsSync(domainStatsPath)) continue;
        let rows = [];
        try {
          rows = JSON.parse(fs.readFileSync(domainStatsPath, "utf8"));
        } catch {
          rows = [];
        }
        for (const row of rows) {
          const domain = normalizeDomain(row?.domain);
          if (!domain) continue;
          const pairCount = Number(row?.pairCountDedup ?? row?.pairCount ?? 0);
          const pagesScanned = Number(row?.pagesScanned ?? 0);
          const current = domainYield.get(domain) ?? { pairCount: 0, pagesScanned: 0 };
          current.pairCount += Number.isFinite(pairCount) ? pairCount : 0;
          current.pagesScanned += Number.isFinite(pagesScanned) ? pagesScanned : 0;
          domainYield.set(domain, current);
        }
      }
    }
    return domainYield;
  });

  const historicalStats = new Map();
  for (const domain of baseDomains) {
    historicalStats.set(domain, { pairCount: 0, pagesScanned: 0, runsSeen: 0 });
  }
  for (const runMap of perRunDomainYield) {
    for (const [domain, stats] of runMap.entries()) {
      if (!historicalStats.has(domain)) continue;
      const current = historicalStats.get(domain);
      current.pairCount += Number(stats?.pairCount ?? 0);
      current.pagesScanned += Number(stats?.pagesScanned ?? 0);
      current.runsSeen += 1;
      historicalStats.set(domain, current);
    }
  }

  const rankedHighYieldDomains = baseDomains
    .map((domain) => {
      const stats = historicalStats.get(domain) ?? { pairCount: 0, pagesScanned: 0, runsSeen: 0 };
      const pairCount = Number(stats.pairCount ?? 0);
      const pagesScanned = Number(stats.pagesScanned ?? 0);
      const yieldPer1000 = pagesScanned > 0 ? (pairCount / pagesScanned) * 1000 : 0;
      return { domain, pairCount, pagesScanned, yieldPer1000 };
    })
    .filter((entry) => entry.pairCount > 0 && entry.pagesScanned > 0)
    .sort((a, b) => {
      if (b.yieldPer1000 !== a.yieldPer1000) return b.yieldPer1000 - a.yieldPer1000;
      if (b.pairCount !== a.pairCount) return b.pairCount - a.pairCount;
      return b.pagesScanned - a.pagesScanned;
    });

  const culledDomains = [];
  for (const domain of baseDomains) {
    let zeroStreak = 0;
    for (const runMap of perRunDomainYield) {
      const stats = runMap.get(domain);
      if (!stats) break;
      if (stats.pairCount > 0) break;
      if (stats.pagesScanned > 0) {
        zeroStreak += 1;
      } else {
        break;
      }
      if (zeroStreak >= streakThreshold) {
        culledDomains.push(domain);
        break;
      }
    }
  }

  let selectedDomains = baseDomains.filter((domain) => !culledDomains.includes(domain));
  if (selectedDomains.length < minKeep) {
    const keepSet = new Set();
    for (const entry of rankedHighYieldDomains) {
      keepSet.add(entry.domain);
      if (keepSet.size >= minKeep) break;
    }
    selectedDomains = Array.from(keepSet);
  }

  if (selectedDomains.length < minKeep) {
    return {
      applied: false,
      reason: "insufficient_high_yield_domains",
      selectedDomains,
      culledDomains,
      domainsFile: null,
      inspectedRuns: recentRuns.length,
      minKeep,
      skipB1Recommended: true,
      rankedHighYieldDomains: rankedHighYieldDomains.map((entry) => ({
        domain: entry.domain,
        pairCount: entry.pairCount,
        yieldPer1000: Number(entry.yieldPer1000.toFixed(3)),
      })),
    };
  }

  const filePath = path.join(currentOutDir, "a0", "b1_domains_tier_a_autofilter.txt");
  fs.writeFileSync(filePath, `${selectedDomains.join("\n")}\n`, "utf8");
  return {
    applied: true,
    reason: "zero_yield_cull_applied",
    selectedDomains,
    culledDomains,
    domainsFile: filePath,
    inspectedRuns: recentRuns.length,
    minKeep,
    skipB1Recommended: false,
    rankedHighYieldDomains: rankedHighYieldDomains.map((entry) => ({
      domain: entry.domain,
      pairCount: entry.pairCount,
      yieldPer1000: Number(entry.yieldPer1000.toFixed(3)),
    })),
  };
};

const npxBin = process.platform === "win32" ? "npx.cmd" : "npx";

const runStep = (label, commandArgs, cwd = process.cwd()) => {
  const startedAt = new Date().toISOString();
  const result = spawnSync(npxBin, ["-y", "tsx", ...commandArgs], {
    cwd,
    stdio: "inherit",
  });
  const finishedAt = new Date().toISOString();
  return {
    label,
    command: [npxBin, "-y", "tsx", ...commandArgs],
    startedAt,
    finishedAt,
    status: result.status ?? 1,
    signal: result.signal ?? null,
    ok: result.status === 0,
  };
};

const buildB1FallbackQueue = (tieredRows, limit) => {
  const candidates = Array.isArray(tieredRows)
    ? tieredRows
        .filter((row) => {
          const tier = String(row?.tier ?? "");
          if (tier !== "P1_review" && tier !== "P2_reject") return false;
          const npn = String(row?.npn ?? "").replace(/\D/g, "");
          return /^\d{8}$/.test(npn);
        })
        .map((row) => {
          const hitCount = Number(row?.hitCount ?? 0);
          const timeoutHitCount = Number(row?.timeoutHitCount ?? 0);
          const isTopMissBrand = Boolean(row?.isTopMissBrand);
          const isP1 = String(row?.tier ?? "") === "P1_review";
          return {
            npn: String(row?.npn ?? "").replace(/\D/g, ""),
            brandName: row?.brandName ?? null,
            productName: row?.productName ?? null,
            twoHopHint: row?.twoHopHint ?? null,
            reason: isTopMissBrand
              ? "b1_fallback_top_miss_brand"
              : isP1
                ? "b1_fallback_p1_review"
                : "b1_fallback_p2_reject",
            hitCount,
            timeoutHitCount,
            isTopMissBrand,
            tier: row?.tier ?? null,
            _sort: [
              isTopMissBrand ? 0 : 1,
              timeoutHitCount > 0 ? 0 : 1,
              isP1 ? 0 : 1,
              -hitCount,
              -timeoutHitCount,
            ],
          };
        })
    : [];

  candidates.sort((a, b) => {
    for (let i = 0; i < Math.min(a._sort.length, b._sort.length); i += 1) {
      if (a._sort[i] !== b._sort[i]) return a._sort[i] - b._sort[i];
    }
    return a.npn.localeCompare(b.npn);
  });

  const dedup = new Map();
  for (const row of candidates) {
    const key = `${row.npn}`;
    if (!dedup.has(key)) dedup.set(key, row);
    if (dedup.size >= limit) break;
  }

  return Array.from(dedup.values()).map((row, idx) => ({
    queueIndex: idx + 1,
    npn: row.npn,
    brandName: row.brandName,
    productName: row.productName,
    twoHopHint: row.twoHopHint,
    reason: row.reason,
    hitCount: row.hitCount,
    timeoutHitCount: row.timeoutHitCount,
    sourceTier: row.tier,
  }));
};

const extendFallbackWithPhase3Queue = (fallbackRows, phase3Rows, limit) => {
  const dedup = new Map();
  for (const row of fallbackRows) {
    const npn = String(row?.npn ?? "").replace(/\D/g, "");
    if (/^\d{8}$/.test(npn) && !dedup.has(npn)) dedup.set(npn, row);
  }
  if (dedup.size >= limit) {
    return Array.from(dedup.values()).slice(0, limit);
  }
  const normalizedPhase3 = phase3Rows
    .map((row) => {
      const npn = String(row?.npn ?? "").replace(/\D/g, "");
      if (!/^\d{8}$/.test(npn)) return null;
      return {
        npn,
        brandName: row?.brandName ?? null,
        productName: row?.productName ?? null,
        twoHopHint: row?.twoHopHint ?? null,
        reason: row?.reason ?? "b1_fallback_phase3",
        hitCount: Number(row?.hitCount ?? row?.score ?? 0),
        timeoutHitCount: Number(row?.timeoutHitCount ?? 0),
        sourceTier: "phase3_queue",
      };
    })
    .filter(Boolean);

  for (const row of normalizedPhase3) {
    if (!dedup.has(row.npn)) dedup.set(row.npn, row);
    if (dedup.size >= limit) break;
  }
  return Array.from(dedup.values()).slice(0, limit).map((row, idx) => ({
    queueIndex: idx + 1,
    npn: row.npn,
    brandName: row.brandName ?? null,
    productName: row.productName ?? null,
    twoHopHint: row.twoHopHint ?? null,
    reason: row.reason ?? "b1_fallback_phase3",
    hitCount: Number(row.hitCount ?? 0),
    timeoutHitCount: Number(row.timeoutHitCount ?? 0),
    sourceTier: row.sourceTier ?? "phase3_queue",
  }));
};

const main = async () => {
  ensureDir(outDir);
  const steps = [];

  const baselineOutDir = path.join(outDir, "baseline");
  const a0OutDir = path.join(outDir, "a0");
  const a1OutDir = path.join(outDir, "a1");
  const a1RepairOutDir = path.join(outDir, "a1_repair");
  const a1ReplayOutDir = path.join(outDir, "a1_replay_release");
  const b1OutDir = path.join(outDir, "b1_full_hunt");

  if (!skipBaseline) {
    steps.push(
      runStep("M0_freeze_baseline", [
        "backend/scripts/freeze-npn-baseline-snapshot.ts",
        "--out-dir",
        baselineOutDir,
        "--label",
        "runtime_signal_a0_a1_b1",
      ]),
    );
    if (!steps.at(-1)?.ok && requireBaseline) {
      throw new Error("baseline_freeze_failed");
    }
  }

  steps.push(
    runStep("A0_build_runtime_queue", [
      "backend/scripts/build-runtime-signal-candidate-queue.ts",
      "--out-dir",
      a0OutDir,
      "--lookback-hours",
      String(lookbackHours),
    ]),
  );
  if (!steps.at(-1)?.ok) {
    throw new Error("a0_build_queue_failed");
  }

  steps.push(
    runStep("A0_classify_runtime_queue", [
      "backend/scripts/classify-runtime-signal-candidates.ts",
      "--input",
      path.join(a0OutDir, "runtime_signal_candidate_queue.jsonl"),
      "--out-dir",
      a0OutDir,
    ]),
  );
  if (!steps.at(-1)?.ok) {
    throw new Error("a0_classify_failed");
  }

  const previewStatsPath = path.join(a0OutDir, "runtime_p0_preview_stats.json");
  const previewStats = readJsonSafe(previewStatsPath) ?? {};
  const p0ConflictCount = Number(previewStats?.p0_conflict_count ?? 0);
  const a1WriteEnabled = p0ConflictCount === 0;

  steps.push(
    runStep("A1_import_p0", [
      "backend/scripts/import-runtime-signal-p0.ts",
      "--tiered-queue",
      path.join(a0OutDir, "runtime_tiered_queue.json"),
      "--preview-stats",
      previewStatsPath,
      "--out-dir",
      a1OutDir,
      ...(dryRun || !a1WriteEnabled ? ["--dry-run"] : []),
    ]),
  );
  if (!steps.at(-1)?.ok) {
    throw new Error("a1_import_failed");
  }
  const a1ImportRowsPath = path.join(a1OutDir, "runtime_p0_import_rows.json");
  const a1ImportReportPath = path.join(a1OutDir, "runtime_p0_import_report.json");
  const a1ImportReport = readJsonSafe(a1ImportReportPath);

  let a1RepairExecuted = false;
  let a1RepairSummary = null;
  let a1RepairManifestPath = null;
  let a1RepairReleaseManifestPath = null;
  let a1RepairReleaseCount = 0;
  let a1RepairReplayExecuted = false;
  let a1RepairReplayMode = "skipped";
  let a1RepairReplayReportPath = null;
  let a1RepairReplayReport = null;
  if (!skipA1RepairLoop && fs.existsSync(a1ImportRowsPath)) {
    steps.push(
      runStep("A1_build_repair_queue", [
        "scripts/maintainer/build-runtime-a1-repair-queue.mjs",
        "--a1-import-rows",
        a1ImportRowsPath,
        "--a0-tiered-queue",
        path.join(a0OutDir, "runtime_tiered_queue.json"),
        "--out-dir",
        a1RepairOutDir,
      ]),
    );
    if (!steps.at(-1)?.ok) {
      throw new Error("a1_build_repair_queue_failed");
    }
    a1RepairExecuted = true;
    a1RepairSummary = readJsonSafe(path.join(a1RepairOutDir, "runtime_a1_blocked_reason_distribution.json"));
    const manifest = readJsonSafe(path.join(a1RepairOutDir, "runtime_a1_repair_manifest.json"));
    const manifestRows = Array.isArray(manifest?.rows) ? manifest.rows : [];
    a1RepairManifestPath = path.join(a1RepairOutDir, "runtime_a1_repair_manifest.json");
    const releaseRows = manifestRows.filter((row) => {
      const tag = String(row?.executionTag ?? "").trim().toLowerCase();
      return a1RepairManifestTags.includes(tag);
    });
    a1RepairReleaseCount = releaseRows.length;
    if (releaseRows.length > 0) {
      a1RepairReleaseManifestPath = path.join(a1RepairOutDir, "runtime_a1_repair_manifest.release.json");
      writeJson(a1RepairReleaseManifestPath, {
        generatedAt: new Date().toISOString(),
        sourceManifest: a1RepairManifestPath,
        manifestTags: a1RepairManifestTags,
        counts: {
          total: releaseRows.length,
        },
        rows: releaseRows,
      });
      writeJsonl(path.join(a1RepairOutDir, "runtime_a1_repair_manifest.release.jsonl"), releaseRows);

      const replayArgs = [
        "backend/scripts/import-runtime-signal-p0.ts",
        "--tiered-queue",
        path.join(a0OutDir, "runtime_tiered_queue.json"),
        "--preview-stats",
        previewStatsPath,
        "--out-dir",
        a1ReplayOutDir,
        "--manifest-path",
        a1RepairReleaseManifestPath,
        "--manifest-tags",
        a1RepairManifestTags.join(","),
      ];
      if (a1RepairReplayMaxRows > 0) {
        replayArgs.push("--max-rows", String(a1RepairReplayMaxRows));
      }
      if (dryRun || !a1WriteEnabled) {
        replayArgs.push("--dry-run");
        a1RepairReplayMode = "dry_run";
      } else {
        a1RepairReplayMode = "write_enabled";
      }
      steps.push(runStep("A1_replay_release_manifest", replayArgs));
      if (!steps.at(-1)?.ok) {
        throw new Error("a1_replay_release_manifest_failed");
      }
      a1RepairReplayExecuted = true;
      a1RepairReplayReportPath = path.join(a1ReplayOutDir, "runtime_p0_import_report.json");
      a1RepairReplayReport = readJsonSafe(a1RepairReplayReportPath);
    } else {
      a1RepairReplayMode = "no_release_rows";
    }
  } else if (skipA1RepairLoop) {
    a1RepairReplayMode = "skipped_by_flag";
  } else {
    a1RepairReplayMode = "missing_a1_import_rows";
  }

  let b1Executed = false;
  let b1QueueSource = null;
  let b1QueuePath = null;
  let b1QueueCount = 0;
  let b1EffectiveMaxBatches = b1MaxBatches;
  let b1AutoGate = {
    applied: false,
    action: "none",
    reason: null,
    previousRun: null,
    minYieldThreshold: b1FallbackMinYield,
  };
  let b1DomainAutofilter = {
    applied: false,
    reason: "not_evaluated",
    inspectedRuns: 0,
    minKeep: b1DomainMinKeep,
    selectedDomainCount: 0,
    culledDomainCount: 0,
    skipB1Recommended: false,
    domainsFile: null,
    rankedHighYieldDomains: [],
  };
  if (!skipB1) {
    const p1QueuePath = path.join(a0OutDir, "runtime_p1_high_value_queue.jsonl");
    const fallbackQueuePath = path.join(a0OutDir, "runtime_b1_fallback_queue.jsonl");
    const tieredQueuePath = path.join(a0OutDir, "runtime_tiered_queue.json");
    const phase3QueuePath = b1Phase3QueuePath ?? findLatestPhase3Queue();

    let selectedQueuePath = null;
    const p1Rows =
      fs.existsSync(p1QueuePath) && fs.statSync(p1QueuePath).size > 0
        ? readJsonlSafe(p1QueuePath)
        : [];
    if (p1Rows.length >= b1MinHighValueQueueCount) {
      selectedQueuePath = p1QueuePath;
      b1QueueSource = "p1_high_value";
      b1QueueCount = p1Rows.length;
    } else if (fs.existsSync(tieredQueuePath)) {
      const tieredRows = readJsonSafe(tieredQueuePath) ?? [];
      const fallbackRowsRaw = buildB1FallbackQueue(tieredRows, b1FallbackLimit);
      const fallbackRowsWithP1 = p1Rows.length > 0 ? dedupeQueueRows([...p1Rows, ...fallbackRowsRaw]) : fallbackRowsRaw;
      const mergedFallbackRows =
        fallbackRowsWithP1.length < b1FallbackLimit && phase3QueuePath
          ? extendFallbackWithPhase3Queue(
              fallbackRowsWithP1,
              readJsonlSafe(phase3QueuePath),
              b1FallbackLimit,
            )
          : fallbackRowsWithP1;
      writeJsonl(fallbackQueuePath, mergedFallbackRows);
      if (mergedFallbackRows.length > 0) {
        const previousYield = loadPreviousB1YieldSignal(outDir);
        if (previousYield && previousYield.yieldPer1000NetNewPairs < b1FallbackMinYield) {
          b1AutoGate = {
            applied: true,
            action: "limit_to_one_batch",
            reason: "previous_yield_below_threshold",
            previousRun: previousYield,
            minYieldThreshold: b1FallbackMinYield,
          };
          b1EffectiveMaxBatches = 1;
          if (
            b1FallbackSkipOnPrevZero &&
            previousYield.yieldPer1000NetNewPairs <= 0 &&
            previousYield.netNewPairs <= 0
          ) {
            b1AutoGate = {
              ...b1AutoGate,
              action: "skip_b1",
              reason: "previous_zero_yield",
            };
          }
        }

        if (b1AutoGate.action === "skip_b1") {
          b1QueueSource = "skipped_low_roi_prev_run";
          b1QueueCount = mergedFallbackRows.length;
          selectedQueuePath = null;
        } else {
          selectedQueuePath = fallbackQueuePath;
          b1QueueSource = p1Rows.length > 0
            ? phase3QueuePath
              ? "expanded_p1_high_value_plus_fallback_plus_phase3"
              : "expanded_p1_high_value_plus_fallback"
            : phase3QueuePath
              ? "fallback_top_miss_p1_p2_plus_phase3"
              : "fallback_top_miss_p1_p2";
          b1QueueCount = mergedFallbackRows.length;
        }
      }
    }

    if (selectedQueuePath) {
      const domainAutofilter = buildTierADomainAutofilter({
        outDir,
        streakThreshold: b1DomainZeroYieldStreak,
        maxRuns: b1DomainAutofilterRuns,
        minKeep: b1DomainMinKeep,
      });
      b1DomainAutofilter = {
        applied: Boolean(domainAutofilter.applied),
        reason: String(domainAutofilter.reason ?? "unknown"),
        inspectedRuns: Number(domainAutofilter.inspectedRuns ?? 0),
        minKeep: Number(domainAutofilter.minKeep ?? b1DomainMinKeep),
        selectedDomainCount: Array.isArray(domainAutofilter.selectedDomains)
          ? domainAutofilter.selectedDomains.length
          : 0,
        culledDomainCount: Array.isArray(domainAutofilter.culledDomains)
          ? domainAutofilter.culledDomains.length
          : 0,
        skipB1Recommended: Boolean(domainAutofilter.skipB1Recommended),
        domainsFile: domainAutofilter.domainsFile ?? null,
        rankedHighYieldDomains: Array.isArray(domainAutofilter.rankedHighYieldDomains)
          ? domainAutofilter.rankedHighYieldDomains
          : [],
      };
      const fallbackMode = String(b1QueueSource ?? "").startsWith("fallback_");
      if (fallbackMode && domainAutofilter.skipB1Recommended) {
        b1AutoGate = {
          ...b1AutoGate,
          applied: true,
          action: "skip_b1",
          reason: "insufficient_high_yield_domains",
        };
        b1QueueSource = "skipped_insufficient_high_yield_domains";
        b1QueuePath = selectedQueuePath;
        b1QueueCount = b1QueueCount || 0;
        selectedQueuePath = null;
      }
    }

    if (selectedQueuePath) {
      b1Executed = true;
      b1QueuePath = selectedQueuePath;
      if (b1QueueCount === 0) {
        const raw = fs.readFileSync(selectedQueuePath, "utf8").trim();
        b1QueueCount = raw ? raw.split(/\r?\n/).length : 0;
      }
      steps.push(
        runStep("B1_tier_a_two_hop_patch", [
          "backend/scripts/run-npn-full-hunt-supervisor.ts",
          "--queue-file",
          selectedQueuePath,
          "--run-dir",
          b1OutDir,
          "--batch-size",
          String(b1BatchSize),
          "--max-batches",
          String(b1EffectiveMaxBatches),
          "--run-hours",
          String(b1RunHours),
          "--max-attempts-per-npn",
          "1",
          "--token-strictness",
          "low",
          "--strict-brand-token-gate",
          "--strict-product-token-gate",
          "--enable-upc-fallback-query",
          "--tier-a-only",
          ...(b1DomainAutofilter.domainsFile ? ["--domains-file", b1DomainAutofilter.domainsFile] : []),
          "--max-domains-per-batch",
          String(b1MaxDomainsPerBatch),
          "--sitemap-max-pages-per-domain",
          String(b1SitemapMaxPagesPerDomain),
          "--enrich-cse-timeout-ms",
          String(b1EnrichCseTimeoutMs),
          "--enrich-html-timeout-ms",
          String(b1EnrichHtmlTimeoutMs),
          "--stage-timeout-sitemap-sec",
          String(b1StageTimeoutSitemapSec),
          "--stage-timeout-enrich-sec",
          String(b1StageTimeoutEnrichSec),
          "--stage-timeout-compare-sec",
          String(b1StageTimeoutCompareSec),
          "--stoploss-netnew-yield-threshold",
          String(b1StoplossYield),
          "--stoploss-hours",
          String(b1StoplossHours),
          "--stoploss-repair-delta-nonnegative",
        ]),
      );
      if (!steps.at(-1)?.ok) {
        throw new Error("b1_supervisor_failed");
      }
    }
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    outDir,
    config: {
      lookbackHours,
      b1RunHours,
      b1BatchSize,
      b1MaxBatches,
      b1StoplossYield,
      b1StoplossHours,
      b1FallbackLimit,
      b1Phase3QueuePath,
      b1FallbackMinYield,
      b1FallbackSkipOnPrevZero,
      b1MinHighValueQueueCount,
      b1DomainZeroYieldStreak,
      b1DomainAutofilterRuns,
      b1DomainMinKeep,
      b1MaxDomainsPerBatch,
      b1SitemapMaxPagesPerDomain,
      b1EnrichCseTimeoutMs,
      b1EnrichHtmlTimeoutMs,
      b1StageTimeoutSitemapSec,
      b1StageTimeoutEnrichSec,
      b1StageTimeoutCompareSec,
      dryRun,
      skipB1,
      skipA1RepairLoop,
      a1RepairManifestTags,
      a1RepairReplayMaxRows,
      skipBaseline,
      requireBaseline,
    },
    a0: {
      previewStatsPath,
      previewStats,
      writeGateOpen: a1WriteEnabled,
    },
    a1: {
      importReportPath: a1ImportReportPath,
      importStats: a1ImportReport?.stats ?? null,
      repair: {
        executed: a1RepairExecuted,
        outDir: a1RepairExecuted ? a1RepairOutDir : null,
        summaryPath: a1RepairExecuted ? path.join(a1RepairOutDir, "runtime_a1_blocked_reason_distribution.json") : null,
        manifestPath: a1RepairManifestPath,
        releaseManifestPath: a1RepairReleaseManifestPath,
        releaseCount: a1RepairReleaseCount,
        totals: a1RepairSummary?.totals ?? null,
        executionDistribution: a1RepairSummary?.executionDistribution ?? null,
      },
      replay: {
        executed: a1RepairReplayExecuted,
        mode: a1RepairReplayMode,
        outDir: a1RepairReplayExecuted ? a1ReplayOutDir : null,
        reportPath: a1RepairReplayReportPath,
        stats: a1RepairReplayReport?.stats ?? null,
        gates: a1RepairReplayReport?.gates ?? null,
      },
    },
    b1: {
      executed: b1Executed,
      runDir: b1Executed ? b1OutDir : null,
      queueSource: b1QueueSource,
      queuePath: b1QueuePath,
      queueCount: b1QueueCount,
      effectiveMaxBatches: b1EffectiveMaxBatches,
      autoGate: b1AutoGate,
      domainAutofilter: b1DomainAutofilter,
    },
    steps,
  };

  writeJson(path.join(outDir, "pipeline_summary.json"), summary);
  console.log(JSON.stringify({ ok: true, outDir, writeGateOpen: a1WriteEnabled, b1Executed }, null, 2));
};

main().catch((error) => {
  console.error("[run-runtime-signal-a0-a1-b1] fatal:", error?.message ?? error);
  process.exit(1);
});
