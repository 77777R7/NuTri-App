#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const args = process.argv.slice(2);

const getArg = (flag, fallback = null) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return fallback;
  return args[idx + 1] ?? fallback;
};

const resolvePath = (value) => {
  if (!value) return null;
  return path.isAbsolute(value) ? value : path.join(ROOT, value);
};

const ensureDir = async (dirPath) => {
  await fs.mkdir(dirPath, { recursive: true });
};

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));

const readJsonl = async (filePath) => {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
};

const writeJson = async (filePath, payload) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const writeText = async (filePath, body) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, body, "utf8");
};

const asNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const normalizeBrand = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const main = async () => {
  const nightlyDir = resolvePath(getArg("nightly-dir"));
  if (!nightlyDir) {
    console.error("[build-new-top100-next-execution-plan] missing --nightly-dir");
    process.exit(1);
  }

  const outDir = resolvePath(getArg("out-dir")) ?? path.join(nightlyDir, "next_phase");

  const batchPlanJson =
    resolvePath(getArg("batch-plan-json"))
    ?? path.join(nightlyDir, "phase_d", "step2_batch_plan", "batch_plan.json");
  const scoreJson =
    resolvePath(getArg("priority-scoreboard-json"))
    ?? path.join(nightlyDir, "phase_c", "new_top100_priority_scoreboard.json");
  const batchesDir =
    resolvePath(getArg("batches-dir"))
    ?? path.join(nightlyDir, "phase_d", "batches");

  const batchPlan = await readJson(batchPlanJson);
  const batchRows = Array.isArray(batchPlan?.batches) ? batchPlan.batches : [];
  const score = await readJson(scoreJson);
  const scoreRows = Array.isArray(score?.rows) ? score.rows : [];

  const scoreByBrandNorm = new Map();
  for (const row of scoreRows) {
    scoreByBrandNorm.set(normalizeBrand(row?.brandName), row);
  }

  const completedBatchIds = new Set();
  const failedBatchIds = new Set();
  for (const batch of batchRows) {
    const bid = String(batch?.batchId ?? "");
    if (!bid) continue;
    const report = await readJson(path.join(batchesDir, bid, "batch_gate_report.json")).catch(() => null);
    const enforce = await readJson(path.join(batchesDir, bid, "enforce", "enforce_report.json")).catch(() => null);
    const pass = Boolean(report?.gates?.pass) && Boolean(enforce?.enforceApplied);
    if (pass) completedBatchIds.add(bid);
    else if (report || enforce) failedBatchIds.add(bid);
  }

  const remaining = batchRows.filter((row) => !completedBatchIds.has(String(row?.batchId ?? "")));

  const enhanceBatch = async (batch) => {
    const bid = String(batch?.batchId ?? "");
    const candidatesPath = String(batch?.candidatesPath ?? "");
    const candidates = await readJsonl(candidatesPath);
    const candidateCount = candidates.length;
    const evidenceCount = candidates.filter((row) => Boolean(row?.evidenceRef)).length;
    const evidenceRate = candidateCount > 0 ? evidenceCount / candidateCount : 0;

    const brandScores = (Array.isArray(batch?.brandsIncluded) ? batch.brandsIncluded : [])
      .map((b) => scoreByBrandNorm.get(normalizeBrand(b?.brandNorm || b?.brand)) || scoreByBrandNorm.get(normalizeBrand(b?.brand)) || null)
      .filter(Boolean);

    const avg = (arr, key, fallback = 0) => {
      if (!arr.length) return fallback;
      return arr.reduce((sum, row) => sum + asNumber(row?.[key], 0), 0) / arr.length;
    };

    const sourceDiversity = avg(brandScores, "source_diversity_score", 0.4);
    const caPresence = avg(brandScores, "ca_presence_strength", 0.4);
    const conflictLow = avg(brandScores, "low_conflict_factor", 0.8);
    const candidateDensity = avg(brandScores, "lane1_candidate_density", 0.5);
    const fixableCoverage = avg(brandScores, "lane1_fixable_coverage", 0.5);

    const scoreFinal =
      0.30 * Math.min(1, candidateDensity) +
      0.30 * Math.min(1, fixableCoverage) +
      0.15 * Math.min(1, evidenceRate) +
      0.10 * Math.min(1, conflictLow) +
      0.10 * Math.min(1, sourceDiversity) +
      0.05 * Math.min(1, caPresence);

    return {
      batchId: bid,
      candidateCount,
      missing_directions_count: candidateCount,
      scanned_label_evidence_rate: Number(evidenceRate.toFixed(6)),
      conflict_risk_low: Number(conflictLow.toFixed(6)),
      source_diversity_score: Number(sourceDiversity.toFixed(6)),
      ca_presence_strength: Number(caPresence.toFixed(6)),
      lane1_candidate_density: Number(candidateDensity.toFixed(6)),
      lane1_fixable_coverage: Number(fixableCoverage.toFixed(6)),
      planning_priority_score: Number(scoreFinal.toFixed(6)),
      candidatesPath,
      candidatesHash: batch?.candidatesHash ?? null,
      candidateScopeId: batch?.candidateScopeId ?? null,
      brandsIncluded: batch?.brandsIncluded ?? [],
    };
  };

  const enrichedRemaining = [];
  for (const row of remaining) {
    enrichedRemaining.push(await enhanceBatch(row));
  }

  enrichedRemaining.sort((a, b) => b.planning_priority_score - a.planning_priority_score || b.candidateCount - a.candidateCount || a.batchId.localeCompare(b.batchId));

  const tier1Batch2 = enrichedRemaining.slice(0, 3);
  const tier2Batch3 = enrichedRemaining.slice(3, 6);
  const backlog = enrichedRemaining.slice(6);

  const report = {
    generatedAt: new Date().toISOString(),
    source: {
      nightlyDir,
      batchPlanJson,
      scoreJson,
      batchesDir,
    },
    summary: {
      totalBatchesInPlan: batchRows.length,
      completedBatches: [...completedBatchIds].sort(),
      failedBatches: [...failedBatchIds].sort(),
      remainingBatchCount: enrichedRemaining.length,
      executionWaveRecommendation: {
        tier1_batch2_count: tier1Batch2.length,
        tier2_batch3_count: tier2Batch3.length,
        backlog_count: backlog.length,
      },
    },
    rankingMethod: {
      keys: [
        "missing_directions_count",
        "scanned_label_evidence_rate",
        "conflict_risk_low",
        "source_diversity_score",
        "ca_presence_strength",
        "lane1_candidate_density",
        "lane1_fixable_coverage",
      ],
      scoreFormula: "0.30*candidate_density + 0.30*fixable_coverage + 0.15*evidence_rate + 0.10*low_conflict + 0.10*source_diversity + 0.05*ca_presence",
    },
    nextExecutionQueue: {
      tier1_batch2: tier1Batch2,
      tier2_batch3: tier2Batch3,
      backlog,
    },
  };

  const outJson = path.join(outDir, "new_top100_next_execution_plan.json");
  const outMd = path.join(outDir, "new_top100_next_execution_plan.md");
  await writeJson(outJson, report);

  await writeText(
    outMd,
    [
      "# New Top100 Next Execution Plan",
      "",
      "## Summary / 摘要",
      `- Total batches in plan: ${report.summary.totalBatchesInPlan}`,
      `- Completed batches: ${report.summary.completedBatches.length}`,
      `- Failed batches: ${report.summary.failedBatches.length}`,
      `- Remaining batches: ${report.summary.remainingBatchCount}`,
      "",
      "## Tier1 Batch2 (Immediate) / 立即执行",
      ...tier1Batch2.map((row, idx) => `- ${idx + 1}. ${row.batchId}: score=${row.planning_priority_score.toFixed(3)}, candidates=${row.candidateCount}`),
      "",
      "## Tier2 Batch3 (Next) / 下一梯队",
      ...tier2Batch3.map((row, idx) => `- ${idx + 1}. ${row.batchId}: score=${row.planning_priority_score.toFixed(3)}, candidates=${row.candidateCount}`),
      "",
      "## Notes / 说明",
      "- low_ca_presence audit pass brands can enter Tier2 only.",
      "- Enforce remains serialized with rollback manifest per batch.",
      "",
    ].join("\n"),
  );

  console.log("[build-new-top100-next-execution-plan] completed");
  console.log(JSON.stringify({
    outJson,
    remaining: report.summary.remainingBatchCount,
    tier1Batch2: tier1Batch2.map((r) => r.batchId),
  }, null, 2));
};

main().catch((error) => {
  console.error("[build-new-top100-next-execution-plan] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
