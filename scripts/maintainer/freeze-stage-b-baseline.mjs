#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT_DIR = process.cwd();
const OUTPUT_ROOT = path.join(ROOT_DIR, "output");
const args = process.argv.slice(2);

const KNOWN_VERDICTS = [
  "strong_candidate",
  "reasonable_but_incomplete",
  "hard_to_recommend_until_label_verified",
];

const nowTag = new Date().toISOString().replace(/[:.]/g, "-");

const hasFlag = (flag) => args.includes(`--${flag}`);
const getArg = (flag) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

if (hasFlag("help")) {
  console.log(`Usage:
  node scripts/maintainer/freeze-stage-b-baseline.mjs [options]

Options:
  --seq-dir <path>                  Sequence output dir (stable/s50/killer/reconcile)
  --full-stable-dir <path>          Full-stable output dir (for observability baseline)
  --stable-report <path>            stable gate_full_report.json
  --s50-run1-summary <path>         s50 run1 rounds_summary.json
  --s50-run2-summary <path>         s50 run2 rounds_summary.json
  --killer-summary <path>           killer10 rounds_summary.json
  --reconcile-report <path>         gate-reconcile gate_full_report.json
  --observability-report <path>     decision support observability report json
  --cohort-fixture <path>           fixed cohort fixture path
  --role-definition-version <value> role definition version for by-role drift
  --metric-formula-version <value>  metric formula version tag
  --out-dir <path>                  output dir (default: output/v1.6.12-stage-b-baseline-<timestamp>)
`);
  process.exit(0);
}

const resolvePath = (value) => {
  if (!value) return null;
  return path.isAbsolute(value) ? value : path.join(ROOT_DIR, value);
};

const asNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const ensureDir = async (dirPath) => {
  await fs.mkdir(dirPath, { recursive: true });
};

const readJson = async (filePath) => {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const toRate = (count, total) => {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Number((Number(count || 0) / total).toFixed(6));
};

const normalizeVerdict = (value) => {
  const text = String(value ?? "").trim();
  return KNOWN_VERDICTS.includes(text) ? text : null;
};

const listOutputDirsByPrefix = async (prefix) => {
  try {
    const names = await fs.readdir(OUTPUT_ROOT);
    return names.filter((name) => name.startsWith(prefix)).sort();
  } catch {
    return [];
  }
};

const newestOutputDirByPrefix = async (prefix) => {
  const names = await listOutputDirsByPrefix(prefix);
  if (names.length === 0) return null;
  return path.join(OUTPUT_ROOT, names[names.length - 1]);
};

const gitRead = (argsList) => {
  try {
    const result = spawnSync("git", argsList, { cwd: ROOT_DIR, encoding: "utf8" });
    if (result.status !== 0) return null;
    const value = String(result.stdout ?? "").trim();
    return value || null;
  } catch {
    return null;
  }
};

const extractRoleSetFromFixture = async (fixturePath) => {
  const payload = await readJson(fixturePath);
  const roles = new Set();
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.barcodes)
      ? payload.barcodes
      : [];
  for (const row of rows) {
    const role = typeof row?.role === "string" ? row.role.trim() : "";
    if (role) roles.add(role);
  }
  return [...roles].sort();
};

const coerceCountMap = (raw) => {
  const counts = Object.fromEntries(KNOWN_VERDICTS.map((key) => [key, 0]));
  if (!raw || typeof raw !== "object") return counts;
  for (const key of KNOWN_VERDICTS) {
    const value = raw[key];
    if (Number.isFinite(Number(value))) {
      counts[key] = Number(value);
      continue;
    }
    if (value && typeof value === "object" && Number.isFinite(Number(value.count))) {
      counts[key] = Number(value.count);
    }
  }
  return counts;
};

const buildDistribution = (countsInput) => {
  const counts = coerceCountMap(countsInput);
  const total = KNOWN_VERDICTS.reduce((sum, key) => sum + Number(counts[key] || 0), 0);
  const rates = Object.fromEntries(
    KNOWN_VERDICTS.map((key) => [key, toRate(counts[key], total)]),
  );
  return {
    total,
    counts,
    rates,
  };
};

const extractDistributionFromAttempts = (attempts) => {
  const counts = Object.fromEntries(KNOWN_VERDICTS.map((key) => [key, 0]));
  const byRole = {};
  const rows = Array.isArray(attempts) ? attempts : [];
  for (const row of rows) {
    const verdict = normalizeVerdict(row?.decisionSupportVerdict);
    if (!verdict) continue;
    counts[verdict] += 1;
    const role = String(row?.role ?? "unknown");
    byRole[role] ||= Object.fromEntries(KNOWN_VERDICTS.map((key) => [key, 0]));
    byRole[role][verdict] += 1;
  }
  const byRoleDist = {};
  for (const [role, roleCounts] of Object.entries(byRole)) {
    byRoleDist[role] = buildDistribution(roleCounts);
  }
  return {
    overall: buildDistribution(counts),
    byRole: byRoleDist,
  };
};

const extractDistributionFromSummary = (summary) => {
  const stats = summary?.stats && typeof summary.stats === "object" ? summary.stats : {};
  const directOverall = stats?.decisionSupportVerdictDistribution;
  const directByRole = stats?.decisionSupportVerdictDistributionByRole;
  const fromAttempts = extractDistributionFromAttempts(summary?.attempts);

  const overall = (() => {
    if (directOverall && typeof directOverall === "object") {
      const dist = buildDistribution(directOverall);
      if (dist.total > 0) return dist;
    }
    return fromAttempts.overall;
  })();

  const byRole = (() => {
    if (directByRole && typeof directByRole === "object") {
      const out = {};
      for (const [role, roleValue] of Object.entries(directByRole)) {
        out[role] = buildDistribution(roleValue);
      }
      if (Object.keys(out).length > 0) return out;
    }
    return fromAttempts.byRole;
  })();

  return { overall, byRole };
};

const pickDecisionSourceSummary = (run2Summary, run1Summary) => {
  const run2 = extractDistributionFromSummary(run2Summary);
  if (run2.overall.total > 0) {
    return {
      selected: "s50_run2",
      summary: run2Summary,
      distribution: run2,
    };
  }
  const run1 = extractDistributionFromSummary(run1Summary);
  return {
    selected: "s50_run1_fallback",
    summary: run1Summary,
    distribution: run1,
  };
};

const pickStats = (summary) => {
  const stats = summary?.stats && typeof summary.stats === "object" ? summary.stats : {};
  return {
    attemptsTotal: asNumber(summary?.attempts?.length ?? stats?.attemptsTotal ?? 0, 0),
    doneSeenRate: asNumber(stats?.doneSeenRate, 0),
    scoreVisibleRate: asNumber(stats?.scoreVisibleRate, 0),
    regulatoryRichRateUniqueBarcode: asNumber(stats?.regulatoryRichRate_uniqueBarcode ?? stats?.regulatoryRichRate, 0),
    killerProductClientTimeoutCount: asNumber(stats?.killerProductClientTimeoutCount, 0),
    killerProductClientTimeoutRate: asNumber(stats?.killerProductClientTimeoutRate, 0),
    killerProductSseConnectedButNoDoneCount: asNumber(stats?.killerProductSseConnectedButNoDoneCount, 0),
    authoritativeExpectedButNotFinalCount: asNumber(
      summary?.authoritativeExpectedButNotFinalCount
      ?? summary?.stats?.authoritativeExpectedButNotFinalCount
      ?? 0,
      0,
    ),
  };
};

const buildRoleSetFixed = ({ selectedSummary, fixtureRoles }) => {
  if (Array.isArray(fixtureRoles) && fixtureRoles.length > 0) {
    return [...new Set(fixtureRoles)].sort();
  }
  const summaryRoles = new Set();
  const barcodes = Array.isArray(selectedSummary?.barcodes) ? selectedSummary.barcodes : [];
  for (const row of barcodes) {
    const role = typeof row?.role === "string" ? row.role.trim() : "";
    if (role) summaryRoles.add(role);
  }
  const attempts = Array.isArray(selectedSummary?.attempts) ? selectedSummary.attempts : [];
  for (const row of attempts) {
    const role = typeof row?.role === "string" ? row.role.trim() : "";
    if (role) summaryRoles.add(role);
  }
  return [...summaryRoles].sort();
};

const filterByFixedRoles = (byRoleDistribution, roleSetFixed) => {
  const out = {};
  for (const role of roleSetFixed) {
    if (!byRoleDistribution?.[role]) {
      out[role] = buildDistribution({});
      continue;
    }
    out[role] = byRoleDistribution[role];
  }
  return out;
};

const detectEnv = (stableReport) => {
  const explicit = String(stableReport?.baseline_context?.env ?? "").trim().toLowerCase();
  if (["local", "staging", "prod", "unknown"].includes(explicit)) return explicit;
  return "unknown";
};

const defaultOutDir = resolvePath(
  getArg("out-dir") || path.join("output", `v1.6.12-stage-b-baseline-${nowTag}`),
);

const main = async () => {
  const seqDir = resolvePath(getArg("seq-dir")) || await newestOutputDirByPrefix("v1.6.12-r2d-seq-");
  const fullStableDir =
    resolvePath(getArg("full-stable-dir")) || await newestOutputDirByPrefix("v1.6.12-r2d-full-stable");

  const stableReportPath =
    resolvePath(getArg("stable-report"))
    || (seqDir ? path.join(seqDir, "stable", "gate_full_report.json") : null)
    || (fullStableDir ? path.join(fullStableDir, "gate_full_report.json") : null);
  const s50Run1SummaryPath =
    resolvePath(getArg("s50-run1-summary"))
    || (seqDir ? path.join(seqDir, "s50-run1", "rounds_summary.json") : null);
  const s50Run2SummaryPath =
    resolvePath(getArg("s50-run2-summary"))
    || (seqDir ? path.join(seqDir, "s50-run2", "rounds_summary.json") : null);
  const killerSummaryPath =
    resolvePath(getArg("killer-summary"))
    || (seqDir ? path.join(seqDir, "killer10", "rounds_summary.json") : null);
  const reconcileReportPath =
    resolvePath(getArg("reconcile-report"))
    || (seqDir ? path.join(seqDir, "gate-reconcile", "gate_full_report.json") : null);
  const observabilityReportPath =
    resolvePath(getArg("observability-report"))
    || (fullStableDir ? path.join(fullStableDir, "phase_a_decision_support_observability_report.json") : null);
  const cohortFixturePath =
    resolvePath(getArg("cohort-fixture"))
    || (seqDir ? path.join(seqDir, "stratified50.barcodes.json") : null)
    || path.join(ROOT_DIR, "scripts", "maintainer", "fixtures", "stage3a_fixed50.json");

  const roleDefinitionVersion =
    String(
      getArg("role-definition-version")
      || process.env.STAGE_B_ROLE_DEFINITION_VERSION
      || "stage-b-role-v1",
    ).trim();
  const metricFormulaVersion =
    String(
      getArg("metric-formula-version")
      || process.env.STAGE_B_METRIC_FORMULA_VERSION
      || "stage-b-compare-v1",
    ).trim();

  const outDir = defaultOutDir;
  await ensureDir(outDir);

  const stableReport = stableReportPath ? await readJson(stableReportPath) : null;
  const s50Run1Summary = s50Run1SummaryPath ? await readJson(s50Run1SummaryPath) : null;
  const s50Run2Summary = s50Run2SummaryPath ? await readJson(s50Run2SummaryPath) : null;
  const killerSummary = killerSummaryPath ? await readJson(killerSummaryPath) : null;
  const reconcileReport = reconcileReportPath ? await readJson(reconcileReportPath) : null;
  const observabilityReport = observabilityReportPath ? await readJson(observabilityReportPath) : null;
  const fixtureRoles = cohortFixturePath ? await extractRoleSetFromFixture(cohortFixturePath) : [];

  if (!stableReport || !s50Run1Summary || !s50Run2Summary || !killerSummary || !reconcileReport) {
    console.error("[freeze-stage-b-baseline] missing required source artifacts");
    console.error(
      JSON.stringify(
        {
          stableReportPath,
          s50Run1SummaryPath,
          s50Run2SummaryPath,
          killerSummaryPath,
          reconcileReportPath,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  const picked = pickDecisionSourceSummary(s50Run2Summary, s50Run1Summary);
  const roleSetFixed = buildRoleSetFixed({
    selectedSummary: picked.summary,
    fixtureRoles,
  });
  const fixedRoleDistribution = filterByFixedRoles(
    picked.distribution.byRole,
    roleSetFixed,
  );

  const baselineManifest = {
    generatedAt: new Date().toISOString(),
    gitCommit: stableReport?.baseline_context?.gitCommit || gitRead(["rev-parse", "--short", "HEAD"]),
    branch: stableReport?.baseline_context?.branch || gitRead(["rev-parse", "--abbrev-ref", "HEAD"]),
    env: detectEnv(stableReport),
    flagsSnapshot:
      (stableReport?.baseline_context?.flagsSnapshot && typeof stableReport.baseline_context.flagsSnapshot === "object")
        ? stableReport.baseline_context.flagsSnapshot
        : {},
    sourceArtifacts: {
      seqDir: seqDir ?? null,
      fullStableDir: fullStableDir ?? null,
      stableReportPath,
      s50Run1SummaryPath,
      s50Run2SummaryPath,
      killerSummaryPath,
      reconcileReportPath,
      observabilityReportPath: observabilityReportPath ?? null,
    },
    roleDefinitionVersion,
    roleSetFixed,
    cohortFixturePath: cohortFixturePath ?? null,
    metricFormulaVersion,
  };

  const verdictDistributionBaseline = {
    generatedAt: new Date().toISOString(),
    selectedFrom: picked.selected,
    buckets: KNOWN_VERDICTS,
    overall: picked.distribution.overall,
    byRoleFixed: fixedRoleDistribution,
  };

  const s50KillerBaselineStats = {
    generatedAt: new Date().toISOString(),
    s50Run1: pickStats(s50Run1Summary),
    s50Run2: pickStats(s50Run2Summary),
    killer10: pickStats(killerSummary),
    stable: {
      systemHealthVerdict: stableReport?.systemHealthVerdict ?? null,
      authoritativeExpectedButNotFinalCount: asNumber(stableReport?.authoritativeExpectedButNotFinalCount ?? 0, 0),
      parallel9DoneP95Ms: asNumber(stableReport?.latencyStats?.parallel9DoneP95Ms ?? 0, 0),
      healthReasons: Array.isArray(stableReport?.healthReasons) ? stableReport.healthReasons : [],
    },
    reconcile: {
      systemHealthVerdict: reconcileReport?.systemHealthVerdict ?? null,
      authoritativeExpectedButNotFinalCount: asNumber(reconcileReport?.authoritativeExpectedButNotFinalCount ?? 0, 0),
      webFallbackCount: asNumber(reconcileReport?.webFallbackCount ?? 0, 0),
      healthReasons: Array.isArray(reconcileReport?.healthReasons) ? reconcileReport.healthReasons : [],
    },
  };

  const decisionSupportObservabilityBaseline = {
    generatedAt: new Date().toISOString(),
    sourceReportPath: observabilityReportPath ?? null,
    metrics: {
      sampleCount: asNumber(observabilityReport?.metrics?.sampleCount ?? 0, 0),
      stableDigestUnexpected409Rate: asNumber(observabilityReport?.metrics?.stableDigestUnexpected409Rate ?? 0, 0),
      forced409RetrySuccessRate: asNumber(observabilityReport?.metrics?.forced409RetrySuccessRate ?? 0, 0),
      inlineFallbackProxyRate: asNumber(observabilityReport?.metrics?.inlineFallbackProxyRate ?? 0, 0),
    },
  };

  const baselineLockMd = [
    "# Stage B Baseline Lock",
    "",
    `- Generated: ${baselineManifest.generatedAt}`,
    `- gitCommit: ${baselineManifest.gitCommit ?? "n/a"}`,
    `- branch: ${baselineManifest.branch ?? "n/a"}`,
    `- env: ${baselineManifest.env ?? "unknown"}`,
    `- roleDefinitionVersion: ${roleDefinitionVersion}`,
    `- metricFormulaVersion: ${metricFormulaVersion}`,
    `- selected verdict source: ${picked.selected}`,
    "",
    "## Stage C Entry Conditions",
    "",
    "1. B0 baseline artifacts are present and reproducible.",
    "2. B1 semantic contract and tests are green.",
    "3. Staging passes B2 sequence twice consecutively.",
    "4. No unowned breach items remain in Stage B repair queue.",
    "",
    "## Threshold Snapshot",
    "",
    "- bucket delta <= 5pp",
    "- L1 distance <= 10pp",
    "- stableDigestUnexpected409Rate <= 0.1%",
    "- forced409RetrySuccessRate >= 99%",
    "- inlineFallbackProxyRate <= 0.1%",
    "",
  ].join("\n");

  const baselineManifestPath = path.join(outDir, "baseline_manifest.json");
  const verdictDistributionPath = path.join(outDir, "verdict_distribution_baseline.json");
  const s50KillerStatsPath = path.join(outDir, "s50_killer_baseline_stats.json");
  const observabilityBaselinePath = path.join(outDir, "decision_support_observability_baseline.json");
  const baselineLockPath = path.join(outDir, "baseline_lock.md");

  await fs.writeFile(baselineManifestPath, `${JSON.stringify(baselineManifest, null, 2)}\n`, "utf8");
  await fs.writeFile(verdictDistributionPath, `${JSON.stringify(verdictDistributionBaseline, null, 2)}\n`, "utf8");
  await fs.writeFile(s50KillerStatsPath, `${JSON.stringify(s50KillerBaselineStats, null, 2)}\n`, "utf8");
  await fs.writeFile(
    observabilityBaselinePath,
    `${JSON.stringify(decisionSupportObservabilityBaseline, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(baselineLockPath, baselineLockMd, "utf8");

  console.log(`[freeze-stage-b-baseline] wrote ${baselineManifestPath}`);
  console.log(`[freeze-stage-b-baseline] wrote ${verdictDistributionPath}`);
  console.log(`[freeze-stage-b-baseline] wrote ${s50KillerStatsPath}`);
  console.log(`[freeze-stage-b-baseline] wrote ${observabilityBaselinePath}`);
  console.log(`[freeze-stage-b-baseline] wrote ${baselineLockPath}`);
};

main().catch((error) => {
  console.error("[freeze-stage-b-baseline] failed", error instanceof Error ? error.message : String(error));
  process.exit(1);
});

