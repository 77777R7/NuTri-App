import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  buildGeneralizationCohortReport,
  extractCohortEntriesFromResidualReport,
  extractCohortEntriesFromRoundsSummary,
} from "../../scripts/maintainer/lib/generalization-cohorts.mjs";

test("cohort sampler prioritizes latest run entries before history backfill", () => {
  const latestRounds = {
    attempts: [
      {
        barcode: "00622082283258",
        consistencyWarningReasons: ["INFERRED_ONLY_COVER_GAP"],
        role: "lnhpd",
        sourceTypeFinal: true,
      },
    ],
  };
  const historyRounds = {
    attempts: Array.from({ length: 30 }, (_, idx) => ({
      barcode: String(90000000000000 + idx),
      consistencyWarningReasons: ["INFERRED_ONLY_COVER_GAP"],
      role: "lnhpd",
      sourceTypeFinal: true,
    })),
  };

  const report = buildGeneralizationCohortReport({
    latestRoundEntries: extractCohortEntriesFromRoundsSummary(latestRounds, "latest"),
    historyRoundEntries: extractCohortEntriesFromRoundsSummary(historyRounds, "history"),
    latestResidualEntries: [],
    historyResidualEntries: [],
    minSamples: 20,
  });

  const sampleCounts = report.cohortSampleCountByType as Record<string, number>;
  assert.equal(sampleCounts.inferred_only_consistency, 20);
  assert.equal(
    report.cohorts.inferred_only_consistency.sample[0]?.barcode,
    "00622082283258".padStart(14, "0"),
  );
});

test("cohort sampler flags insufficient pool when fewer than required samples", () => {
  const residual = {
    sampleResidualRows: [
      {
        barcodeGtin14: "00628747100212",
        barcodeRaw: "00628747100212",
        servedFrom: "lnhpd",
      },
    ],
  };
  const report = buildGeneralizationCohortReport({
    latestRoundEntries: { inferred_only_consistency: [], historical_dsld_web_fallback: [] },
    historyRoundEntries: { inferred_only_consistency: [], historical_dsld_web_fallback: [] },
    latestResidualEntries: extractCohortEntriesFromResidualReport(residual, "latest"),
    historyResidualEntries: [],
    minSamples: 20,
  });

  const insufficientByType = report.cohortInsufficientByType as Record<string, boolean>;
  assert.equal(insufficientByType.negative_cache_residual, true);
  assert.equal(report.cohorts.negative_cache_residual.sampleCount, 1);
  assert.equal(report.pass, false);
});

test("cohort sampler backfills with duplicate evidence rows when unique barcode pool is too small", () => {
  const repeatedRows = Array.from({ length: 25 }, (_, idx) => ({
    barcodeGtin14: "00628747100212",
    barcodeRaw: "00628747100212",
    servedFrom: "lnhpd",
    scanCreatedAt: `2026-02-27T00:00:${String(idx).padStart(2, "0")}Z`,
  }));
  const report = buildGeneralizationCohortReport({
    latestRoundEntries: { inferred_only_consistency: [], historical_dsld_web_fallback: [] },
    historyRoundEntries: { inferred_only_consistency: [], historical_dsld_web_fallback: [] },
    latestResidualEntries: extractCohortEntriesFromResidualReport(
      { sampleResidualRows: repeatedRows.slice(0, 5) },
      "latest",
    ),
    historyResidualEntries: extractCohortEntriesFromResidualReport(
      { sampleResidualRows: repeatedRows.slice(5) },
      "history",
    ),
    minSamples: 20,
  });

  assert.equal(report.cohorts.negative_cache_residual.sampleCount, 20);
  assert.equal(report.cohorts.negative_cache_residual.insufficientPool, false);
  assert.equal(report.pass, false);
});

test("cohort sampler uses seed backfill as third tier and reports source breakdown", () => {
  const report = buildGeneralizationCohortReport({
    latestRoundEntries: {
      inferred_only_consistency: [],
      historical_dsld_web_fallback: [],
      score_pending_timeout: [],
    },
    historyRoundEntries: {
      inferred_only_consistency: [],
      historical_dsld_web_fallback: [],
      score_pending_timeout: [],
    },
    latestResidualEntries: [],
    historyResidualEntries: [],
    seedEntriesByType: {
      inferred_only_consistency: Array.from({ length: 20 }, (_, idx) => ({
        barcode: String(60000000000000 + idx),
        source: "seed:test",
      })),
    },
    minSamples: 20,
  });

  assert.equal(report.cohorts.inferred_only_consistency.sampleCount, 20);
  assert.equal(report.cohorts.inferred_only_consistency.insufficientPool, false);
  assert.equal(report.cohorts.inferred_only_consistency.seedBackfillCount, 20);
  const breakdownByType = report.sampleSourceBreakdownByType as any;
  const seedBackfillByType = report.seedBackfillCountByType as any;
  assert.equal(breakdownByType.inferred_only_consistency.seeds, 20);
  assert.equal(seedBackfillByType.inferred_only_consistency, 20);
});

test("round extraction includes score pending timeout cohort rows", () => {
  const extracted = extractCohortEntriesFromRoundsSummary(
    {
      attempts: [
        {
          barcode: "00064642059000",
          scoreQueryInitiated: true,
          scoreTerminalSeen: false,
          scoreResponseStatus: "loading",
          terminalReason: "CLIENT_TIMEOUT",
          timeoutClass: "SSE_CONNECTED_BUT_NO_DONE",
        },
      ],
    },
    "latest",
  );

  assert.equal(Array.isArray(extracted.score_pending_timeout), true);
  assert.equal(extracted.score_pending_timeout.length, 1);
  assert.equal(extracted.score_pending_timeout[0]?.barcode, "00064642059000".padStart(14, "0"));
});

test("score_pending_timeout seed fixture has at least 20 unique barcodes", () => {
  const seedPath = path.join(
    process.cwd(),
    "scripts",
    "maintainer",
    "fixtures",
    "cohort_seeds",
    "score_pending_timeout.seeds.jsonl",
  );
  const raw = fs.readFileSync(seedPath, "utf8");
  const unique = new Set(
    raw
      .trim()
      .split(/\r?\n/)
      .map((line) => {
        try {
          return String(JSON.parse(line)?.barcode ?? "").replace(/\D/g, "").padStart(14, "0");
        } catch {
          return "";
        }
      })
      .filter(Boolean),
  );
  assert.ok(unique.size >= 20);
});
