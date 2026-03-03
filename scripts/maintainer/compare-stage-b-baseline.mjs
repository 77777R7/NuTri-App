#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";

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
  node scripts/maintainer/compare-stage-b-baseline.mjs --baseline-dir <path> [options]

Options:
  --stable-report <path>            Current stable gate_full_report.json
  --s50-summary <path>              Current s50 rounds_summary.json (default: s50-run2)
  --killer-summary <path>           Current killer rounds_summary.json
  --observability-report <path>     Current decision support observability report json
  --role-definition-version <value> Current role definition version
  --max-bucket-delta-pp <number>    default: 5
  --max-l1-distance-pp <number>     default: 10
  --max-unexpected409-rate <number> default: 0.001
  --min-retry-success-rate <number> default: 0.99
  --max-inline-fallback-rate <number> default: 0.001
  --out-dir <path>                  default: <stable-report-dir>
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

const toJsonl = (rows) =>
  (Array.isArray(rows) ? rows : [])
    .map((row) => JSON.stringify(row))
    .join("\n")
    .concat(Array.isArray(rows) && rows.length > 0 ? "\n" : "");

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

const normalizeVerdict = (value) => {
  const text = String(value ?? "").trim();
  return KNOWN_VERDICTS.includes(text) ? text : null;
};

const toRate = (count, total) => {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Number((Number(count || 0) / total).toFixed(6));
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

const computeBucketDeltaPp = (baselineRates, currentRates) => {
  const delta = {};
  for (const bucket of KNOWN_VERDICTS) {
    const baseline = asNumber(baselineRates?.[bucket] ?? 0, 0);
    const current = asNumber(currentRates?.[bucket] ?? 0, 0);
    delta[bucket] = Number(((current - baseline) * 100).toFixed(4));
  }
  return delta;
};

const computeL1DistancePp = (bucketDeltaPp) => {
  const sumAbs = KNOWN_VERDICTS.reduce((sum, bucket) => sum + Math.abs(asNumber(bucketDeltaPp?.[bucket] ?? 0, 0)), 0);
  return Number((0.5 * sumAbs).toFixed(4));
};

const valuesWithinBucketThreshold = (bucketDeltaPp, thresholdPp) =>
  KNOWN_VERDICTS.every((bucket) => Math.abs(asNumber(bucketDeltaPp?.[bucket] ?? 0, 0)) <= thresholdPp);

const deriveObservabilityBarcodeLists = (observabilityReport) => {
  const explicit = observabilityReport?.breachBarcodeLists;
  if (explicit && typeof explicit === "object") {
    return {
      unexpected409: Array.isArray(explicit.unexpected409) ? explicit.unexpected409 : [],
      retryFailure: Array.isArray(explicit.retryFailure) ? explicit.retryFailure : [],
      inlineFallbackProxy: Array.isArray(explicit.inlineFallbackProxy) ? explicit.inlineFallbackProxy : [],
    };
  }

  const rows = Array.isArray(observabilityReport?.rows) ? observabilityReport.rows : [];
  const unexpected409 = [];
  const retryFailure = [];
  const inlineFallbackProxy = [];
  for (const row of rows) {
    const barcode = String(row?.barcode ?? "").trim();
    if (!barcode) continue;
    if (Number(row?.stableRead?.status ?? 0) === 409) {
      unexpected409.push(barcode);
    }
    const forcedMismatchStatus = Number(row?.forcedMismatch?.status ?? 0);
    const has409Contract = forcedMismatchStatus === 409 && typeof row?.forcedMismatch?.json?.latestDigest === "string";
    if (has409Contract && !Boolean(row?.forcedRetry?.ok)) {
      retryFailure.push(barcode);
    }
    const initialFailed = !Boolean(row?.initial?.ok);
    const retryFailed = has409Contract && !Boolean(row?.forcedRetry?.ok);
    if (initialFailed || retryFailed) {
      inlineFallbackProxy.push(barcode);
    }
  }
  return {
    unexpected409: [...new Set(unexpected409)],
    retryFailure: [...new Set(retryFailure)],
    inlineFallbackProxy: [...new Set(inlineFallbackProxy)],
  };
};

const pickNoRegressionStats = (summary) => {
  const stats = summary?.stats && typeof summary.stats === "object" ? summary.stats : {};
  return {
    doneSeenRate: asNumber(stats?.doneSeenRate, 0),
    killerProductClientTimeoutCount: asNumber(stats?.killerProductClientTimeoutCount, 0),
    killerProductClientTimeoutRate: asNumber(stats?.killerProductClientTimeoutRate, 0),
    killerProductSseConnectedButNoDoneCount: asNumber(stats?.killerProductSseConnectedButNoDoneCount, 0),
  };
};

const buildBreachRows = ({ barcodeLists, metricRows, targetRelease }) => {
  const out = [];
  const pushRows = (barcodes, payload) => {
    const unique = [...new Set((Array.isArray(barcodes) ? barcodes : []).map((value) => String(value || "").trim()).filter(Boolean))];
    if (unique.length === 0) return;
    for (const barcode of unique) {
      out.push({
        generatedAt: new Date().toISOString(),
        barcode,
        breachType: payload.breachType,
        metric: payload.metric,
        currentValue: payload.currentValue,
        threshold: payload.threshold,
        owner: "unassigned",
        status: "open",
        targetRelease,
      });
    }
  };

  for (const row of metricRows) {
    pushRows(barcodeLists[row.listKey], row);
  }
  return out;
};

const toMarkdown = (report) => {
  const lines = [];
  lines.push("# Stage B Baseline Compare");
  lines.push("");
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Baseline: ${report.baselineDir}`);
  lines.push(`- Verdict: ${report.pass ? "PASS" : "FAIL"}`);
  lines.push("");

  lines.push("## Verdict Drift");
  lines.push("");
  lines.push(`- bucketDeltaThresholdPp: ${report.thresholds.maxBucketDeltaPp}`);
  lines.push(`- l1DistanceThresholdPp: ${report.thresholds.maxL1DistancePp}`);
  lines.push(`- bucketWithinThreshold: ${report.verdictDrift.bucketWithinThreshold ? "yes" : "no"}`);
  lines.push(`- l1DistancePp: ${report.verdictDrift.l1DistancePp}`);
  lines.push(`- l1WithinThreshold: ${report.verdictDrift.l1WithinThreshold ? "yes" : "no"}`);
  lines.push(`- bucketDeltaPp: \`${JSON.stringify(report.verdictDrift.bucketDeltaPp)}\``);
  lines.push("");

  lines.push("## Digest/409");
  lines.push("");
  lines.push(`- stableDigestUnexpected409Rate: ${report.digest409Metrics.stableDigestUnexpected409Rate}`);
  lines.push(`- forced409RetrySuccessRate: ${report.digest409Metrics.forced409RetrySuccessRate}`);
  lines.push(`- inlineFallbackProxyRate: ${report.digest409Metrics.inlineFallbackProxyRate}`);
  lines.push(`- pass: ${report.digest409Metrics.pass ? "yes" : "no"}`);
  lines.push("");

  lines.push("## By Role");
  lines.push("");
  lines.push(`- roleDefinitionVersion baseline/current: ${report.byRole.baselineRoleDefinitionVersion} / ${report.byRole.currentRoleDefinitionVersion}`);
  lines.push(`- roleDefinitionMatch: ${report.byRole.roleDefinitionMatch ? "yes" : "no"}`);
  lines.push(`- fixedRoles: ${JSON.stringify(report.byRole.roleSetFixed)}`);
  lines.push("");

  lines.push("## No Regression");
  lines.push("");
  lines.push(`- doneSeenRate current/baseline: ${report.noRegression.current.doneSeenRate} / ${report.noRegression.baseline.doneSeenRate}`);
  lines.push(`- killerProductClientTimeoutCount current/baseline: ${report.noRegression.current.killerProductClientTimeoutCount} / ${report.noRegression.baseline.killerProductClientTimeoutCount}`);
  lines.push(`- authoritativeExpectedButNotFinalCount: ${report.noRegression.current.authoritativeExpectedButNotFinalCount}`);
  lines.push(`- pass: ${report.noRegression.pass ? "yes" : "no"}`);
  lines.push("");

  if (report.reasons.length > 0) {
    lines.push("## Fail Reasons");
    lines.push("");
    for (const reason of report.reasons) {
      lines.push(`- ${reason}`);
    }
    lines.push("");
  }

  if (report.warnings.length > 0) {
    lines.push("## Warnings");
    lines.push("");
    for (const warning of report.warnings) {
      lines.push(`- ${warning}`);
    }
    lines.push("");
  }

  lines.push(`- repairQueuePath: ${report.stageBRepairQueuePath}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  const baselineDir = resolvePath(getArg("baseline-dir"));
  if (!baselineDir) {
    console.error("[compare-stage-b-baseline] --baseline-dir is required");
    process.exit(1);
  }

  const inferredSeqDir = await newestOutputDirByPrefix("v1.6.12-r2d-seq-");
  const stableReportPath =
    resolvePath(getArg("stable-report"))
    || (inferredSeqDir ? path.join(inferredSeqDir, "stable", "gate_full_report.json") : null);
  const s50SummaryPath =
    resolvePath(getArg("s50-summary"))
    || (inferredSeqDir ? path.join(inferredSeqDir, "s50-run2", "rounds_summary.json") : null);
  const killerSummaryPath =
    resolvePath(getArg("killer-summary"))
    || (inferredSeqDir ? path.join(inferredSeqDir, "killer10", "rounds_summary.json") : null);
  const observabilityReportPath =
    resolvePath(getArg("observability-report"))
    || (stableReportPath ? path.join(path.dirname(stableReportPath), "phase_a_decision_support_observability_report.json") : null);

  const maxBucketDeltaPp = asNumber(getArg("max-bucket-delta-pp") ?? process.env.STAGE_B_MAX_BUCKET_DELTA_PP, 5);
  const maxL1DistancePp = asNumber(getArg("max-l1-distance-pp") ?? process.env.STAGE_B_MAX_L1_DISTANCE_PP, 10);
  const maxUnexpected409Rate = asNumber(getArg("max-unexpected409-rate") ?? process.env.STAGE_B_MAX_UNEXPECTED_409_RATE, 0.001);
  const minRetrySuccessRate = asNumber(getArg("min-retry-success-rate") ?? process.env.STAGE_B_MIN_RETRY_SUCCESS_RATE, 0.99);
  const maxInlineFallbackRate = asNumber(getArg("max-inline-fallback-rate") ?? process.env.STAGE_B_MAX_INLINE_FALLBACK_RATE, 0.001);
  const explicitRoleDefinitionVersion = getArg("role-definition-version") ?? process.env.STAGE_B_ROLE_DEFINITION_VERSION ?? null;
  const targetRelease = String(process.env.STAGE_B_REPAIR_TARGET_RELEASE || "v1.6.12-stage-b").trim();

  const outDir = resolvePath(getArg("out-dir")) || (stableReportPath ? path.dirname(stableReportPath) : path.join(OUTPUT_ROOT, `stage-b-compare-${nowTag}`));
  await ensureDir(outDir);

  const baselineManifestPath = path.join(baselineDir, "baseline_manifest.json");
  const baselineVerdictPath = path.join(baselineDir, "verdict_distribution_baseline.json");
  const baselineStatsPath = path.join(baselineDir, "s50_killer_baseline_stats.json");
  const baselineManifest = await readJson(baselineManifestPath);
  const baselineVerdict = await readJson(baselineVerdictPath);
  const baselineStats = await readJson(baselineStatsPath);
  const stableReport = stableReportPath ? await readJson(stableReportPath) : null;
  const s50Summary = s50SummaryPath ? await readJson(s50SummaryPath) : null;
  const killerSummary = killerSummaryPath ? await readJson(killerSummaryPath) : null;
  const observabilityReport = observabilityReportPath ? await readJson(observabilityReportPath) : null;

  const reasons = [];
  const warnings = [];
  if (!baselineManifest || !baselineVerdict || !baselineStats) {
    reasons.push("baseline_artifacts_missing");
  }
  if (!stableReport) reasons.push("stable_report_missing");
  if (!s50Summary) reasons.push("s50_summary_missing");
  if (!killerSummary) reasons.push("killer_summary_missing");
  if (!observabilityReport) reasons.push("observability_report_missing");

  const currentDist = extractDistributionFromSummary(s50Summary ?? {});
  const baselineOverallRates = baselineVerdict?.overall?.rates ?? {};
  const currentOverallRates = currentDist?.overall?.rates ?? {};
  const bucketDeltaPp = computeBucketDeltaPp(baselineOverallRates, currentOverallRates);
  const l1DistancePp = computeL1DistancePp(bucketDeltaPp);
  const bucketWithinThreshold = valuesWithinBucketThreshold(bucketDeltaPp, maxBucketDeltaPp);
  const l1WithinThreshold = l1DistancePp <= maxL1DistancePp;
  const verdictDriftPass = bucketWithinThreshold && l1WithinThreshold;
  if (!verdictDriftPass) {
    reasons.push("verdict_distribution_drift_exceeded");
  }

  const roleSetFixed = Array.isArray(baselineManifest?.roleSetFixed) ? baselineManifest.roleSetFixed : [];
  const baselineRoleVersion = String(baselineManifest?.roleDefinitionVersion ?? "").trim();
  const inferredCurrentRoleVersion =
    String(
      explicitRoleDefinitionVersion
      ?? s50Summary?.config?.roleDefinitionVersion
      ?? s50Summary?.stats?.roleDefinitionVersion
      ?? "",
    ).trim();
  const roleDefinitionMatch = Boolean(
    baselineRoleVersion
    && inferredCurrentRoleVersion
    && baselineRoleVersion === inferredCurrentRoleVersion,
  );
  if (!roleDefinitionMatch) {
    reasons.push(
      `role_definition_version_mismatch_${baselineRoleVersion || "missing"}_vs_${inferredCurrentRoleVersion || "missing"}`,
    );
  }

  const byRoleRows = [];
  for (const role of roleSetFixed) {
    const baselineRates = baselineVerdict?.byRoleFixed?.[role]?.rates ?? {};
    const currentRates = currentDist?.byRole?.[role]?.rates ?? {};
    const baselineTotal = asNumber(baselineVerdict?.byRoleFixed?.[role]?.total ?? 0, 0);
    const currentTotal = asNumber(currentDist?.byRole?.[role]?.total ?? 0, 0);
    if (baselineTotal > 0 && currentTotal === 0) {
      reasons.push(`fixed_role_missing_${role}`);
    }
    const roleDeltaPp = computeBucketDeltaPp(baselineRates, currentRates);
    const roleL1DistancePp = computeL1DistancePp(roleDeltaPp);
    const roleBucketPass = valuesWithinBucketThreshold(roleDeltaPp, maxBucketDeltaPp);
    const roleL1Pass = roleL1DistancePp <= maxL1DistancePp;
    if (!roleBucketPass || !roleL1Pass) {
      reasons.push(`fixed_role_drift_exceeded_${role}`);
    }
    byRoleRows.push({
      role,
      baselineTotal,
      currentTotal,
      bucketDeltaPp: roleDeltaPp,
      l1DistancePp: roleL1DistancePp,
      pass: roleBucketPass && roleL1Pass,
    });
  }

  const obsMetrics = observabilityReport?.metrics ?? {};
  const stableDigestUnexpected409Rate = asNumber(obsMetrics?.stableDigestUnexpected409Rate, Number.POSITIVE_INFINITY);
  const forced409RetrySuccessRate = asNumber(obsMetrics?.forced409RetrySuccessRate, Number.NEGATIVE_INFINITY);
  const inlineFallbackProxyRate = asNumber(obsMetrics?.inlineFallbackProxyRate, Number.POSITIVE_INFINITY);
  const digest409Pass =
    stableDigestUnexpected409Rate <= maxUnexpected409Rate
    && forced409RetrySuccessRate >= minRetrySuccessRate
    && inlineFallbackProxyRate <= maxInlineFallbackRate;
  if (!digest409Pass) {
    reasons.push("digest_409_metrics_threshold_breach");
  }

  const noRegressionCurrent = {
    ...pickNoRegressionStats(killerSummary),
    doneSeenRate: asNumber(s50Summary?.stats?.doneSeenRate, 0),
    authoritativeExpectedButNotFinalCount: asNumber(stableReport?.authoritativeExpectedButNotFinalCount ?? 0, 0),
  };
  const noRegressionBaseline = {
    doneSeenRate: asNumber(baselineStats?.s50Run2?.doneSeenRate, 0),
    killerProductClientTimeoutCount: asNumber(baselineStats?.killer10?.killerProductClientTimeoutCount, 0),
  };
  const noRegressionPass =
    noRegressionCurrent.doneSeenRate >= noRegressionBaseline.doneSeenRate
    && noRegressionCurrent.killerProductClientTimeoutCount <= noRegressionBaseline.killerProductClientTimeoutCount
    && noRegressionCurrent.authoritativeExpectedButNotFinalCount === 0;
  if (!noRegressionPass) {
    reasons.push("no_regression_guard_failed");
  }

  const barcodeLists = deriveObservabilityBarcodeLists(observabilityReport ?? {});
  const breachMetricRows = [];
  if (stableDigestUnexpected409Rate > maxUnexpected409Rate) {
    breachMetricRows.push({
      breachType: "digest_409",
      metric: "stableDigestUnexpected409Rate",
      currentValue: stableDigestUnexpected409Rate,
      threshold: `<=${maxUnexpected409Rate}`,
      listKey: "unexpected409",
    });
  }
  if (forced409RetrySuccessRate < minRetrySuccessRate) {
    breachMetricRows.push({
      breachType: "digest_409",
      metric: "forced409RetrySuccessRate",
      currentValue: forced409RetrySuccessRate,
      threshold: `>=${minRetrySuccessRate}`,
      listKey: "retryFailure",
    });
  }
  if (inlineFallbackProxyRate > maxInlineFallbackRate) {
    breachMetricRows.push({
      breachType: "inline_fallback",
      metric: "inlineFallbackProxyRate",
      currentValue: inlineFallbackProxyRate,
      threshold: `<=${maxInlineFallbackRate}`,
      listKey: "inlineFallbackProxy",
    });
  }
  const repairQueue = buildBreachRows({
    barcodeLists,
    metricRows: breachMetricRows,
    targetRelease,
  });

  if (breachMetricRows.length > 0 && repairQueue.length === 0) {
    warnings.push("digest_409_breach_without_barcode_list");
  }

  const stageBBaselineComparePath = path.join(outDir, "stage_b_baseline_compare.json");
  const stageBBaselineCompareMdPath = path.join(outDir, "stage_b_baseline_compare.md");
  const stageBRepairQueuePath = path.join(outDir, "stage_b_repair_queue.jsonl");

  const report = {
    generatedAt: new Date().toISOString(),
    baselineDir,
    currentArtifacts: {
      stableReportPath,
      s50SummaryPath,
      killerSummaryPath,
      observabilityReportPath,
    },
    thresholds: {
      maxBucketDeltaPp,
      maxL1DistancePp,
      maxUnexpected409Rate,
      minRetrySuccessRate,
      maxInlineFallbackRate,
    },
    verdictDrift: {
      buckets: KNOWN_VERDICTS,
      baselineRates: baselineOverallRates,
      currentRates: currentOverallRates,
      bucketDeltaPp,
      bucketWithinThreshold,
      l1DistancePp,
      l1WithinThreshold,
      pass: verdictDriftPass,
    },
    byRole: {
      roleSetFixed,
      baselineRoleDefinitionVersion: baselineRoleVersion || null,
      currentRoleDefinitionVersion: inferredCurrentRoleVersion || null,
      roleDefinitionMatch,
      rows: byRoleRows,
      pass: roleDefinitionMatch && byRoleRows.every((row) => row.pass),
    },
    digest409Metrics: {
      sampleCount: asNumber(obsMetrics?.sampleCount ?? 0, 0),
      stableDigestUnexpected409Rate,
      forced409RetrySuccessRate,
      inlineFallbackProxyRate,
      thresholdBreachMetrics: breachMetricRows.map((row) => row.metric),
      barcodeLists,
      pass: digest409Pass,
    },
    noRegression: {
      baseline: noRegressionBaseline,
      current: noRegressionCurrent,
      pass: noRegressionPass,
    },
    stageBRepairQueuePath,
    pass: reasons.length === 0,
    reasons,
    warnings,
  };

  await fs.writeFile(stageBBaselineComparePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(stageBBaselineCompareMdPath, toMarkdown(report), "utf8");
  await fs.writeFile(stageBRepairQueuePath, toJsonl(repairQueue), "utf8");

  console.log(`[compare-stage-b-baseline] wrote ${stageBBaselineComparePath}`);
  console.log(`[compare-stage-b-baseline] wrote ${stageBBaselineCompareMdPath}`);
  console.log(`[compare-stage-b-baseline] wrote ${stageBRepairQueuePath}`);
  if (!report.pass) {
    console.error(`[compare-stage-b-baseline] failed: ${report.reasons.join(", ")}`);
    process.exit(1);
  }
};

main().catch((error) => {
  console.error("[compare-stage-b-baseline] failed", error instanceof Error ? error.message : String(error));
  process.exit(1);
});

