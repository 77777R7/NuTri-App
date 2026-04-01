export const METRIC_NAMES = [
  "snapshot_write_success",
  "snapshot_write_timeout",
  "snapshot_write_breaker_open",
  "snapshot_write_guard_blocked",
  "regulatory_write_policy_would_block",
  "regulatory_write_policy_would_upgrade",
  "regulatory_write_policy_would_replace_same_rank",
  "regulatory_write_policy_would_write_candidate_only",
  "regulatory_candidate_write_suppressed_low_signal",
  "scanlog_write_success",
  "scanlog_write_timeout",
  "scanlog_write_breaker_open",
  "training_write_success",
  "training_write_timeout",
  "training_write_breaker_open",
  "deepseek_bundle_success",
  "deepseek_bundle_fail_degraded",
  "decision_support_digest_mismatch",
  "decision_inputs_hash_mismatch",
  "decision_support_refetch_count_per_scan",
  "snapshot_bypass_missing_iherb_overlay_rate",
  "bundle_fast_cache_rejected_missing_overlay_rate",
  "stage0_dsld_recovery_rate",
  "product_overview_ai_closed_early_rate",
] as const;

export type MetricName = (typeof METRIC_NAMES)[number];

type MetricsState = Record<MetricName, number>;

export const TIMING_METRIC_NAMES = [
  "stage0_dsld_recovery_ms",
  "time_to_rev0_ms",
  "time_to_rev1_ms",
  "time_to_done_ms",
  "ingredient_overview_ms",
  "scientific_background_ms",
] as const;

export type TimingMetricName = (typeof TIMING_METRIC_NAMES)[number];

type TimingMetricSummary = {
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
  lastMs: number;
};

type TimingMetricsState = Record<TimingMetricName, TimingMetricSummary>;

type RegulatoryWritePolicyDecisionKind =
  | "wouldBlock"
  | "wouldUpgrade"
  | "wouldReplaceSameRank"
  | "wouldWriteCandidateOnly";

type RegulatoryWritePolicyMode = "off" | "shadow" | "enforce";

type RegulatoryWritePolicyRecentEvent = {
  at: string;
  mode: RegulatoryWritePolicyMode;
  decision: RegulatoryWritePolicyDecisionKind;
  sourceKind: string;
  incomingRank: number;
  reason: string;
};

type RegulatoryWritePolicyDecisionCounts = Record<RegulatoryWritePolicyDecisionKind, number>;

type RegulatoryWritePolicyBucket = Record<RegulatoryWritePolicyDecisionKind, Record<string, number>>;

const REGULATORY_POLICY_DECISIONS: RegulatoryWritePolicyDecisionKind[] = [
  "wouldBlock",
  "wouldUpgrade",
  "wouldReplaceSameRank",
  "wouldWriteCandidateOnly",
];

const buildEmptyCounts = (): MetricsState =>
  METRIC_NAMES.reduce((acc, name) => {
    acc[name] = 0;
    return acc;
  }, {} as MetricsState);

const buildEmptyTimingSummary = (): TimingMetricSummary => ({
  count: 0,
  totalMs: 0,
  minMs: Number.POSITIVE_INFINITY,
  maxMs: 0,
  lastMs: 0,
});

const buildEmptyTimings = (): TimingMetricsState =>
  TIMING_METRIC_NAMES.reduce((acc, name) => {
    acc[name] = buildEmptyTimingSummary();
    return acc;
  }, {} as TimingMetricsState);

const buildEmptyRegulatoryPolicyDecisionCounts = (): RegulatoryWritePolicyDecisionCounts =>
  REGULATORY_POLICY_DECISIONS.reduce((acc, decision) => {
    acc[decision] = 0;
    return acc;
  }, {} as RegulatoryWritePolicyDecisionCounts);

const buildEmptyRegulatoryPolicyBucket = (): RegulatoryWritePolicyBucket =>
  REGULATORY_POLICY_DECISIONS.reduce((acc, decision) => {
    acc[decision] = {};
    return acc;
  }, {} as RegulatoryWritePolicyBucket);

const totals = buildEmptyCounts();
let windowCounts = buildEmptyCounts();
const timingTotals = buildEmptyTimings();
let timingWindow = buildEmptyTimings();
const startedAt = new Date().toISOString();
let lastFlushAt = startedAt;
let flushStarted = false;
const regulatoryWritePolicyTotals = buildEmptyRegulatoryPolicyDecisionCounts();
const regulatoryWritePolicyBySourceKind = buildEmptyRegulatoryPolicyBucket();
const regulatoryWritePolicyByIncomingRank = buildEmptyRegulatoryPolicyBucket();
const regulatoryWritePolicyByReason = buildEmptyRegulatoryPolicyBucket();
const regulatoryWritePolicyRecent: RegulatoryWritePolicyRecentEvent[] = [];
const METRICS_WINDOW_LOG_ENABLED = (() => {
  const raw = String(process.env.METRICS_WINDOW_LOG_ENABLED ?? "").trim().toLowerCase();
  if (!raw) return false;
  if (raw === "1" || raw === "true" || raw === "yes") return true;
  if (raw === "0" || raw === "false" || raw === "no") return false;
  return false;
})();

const redactForInternalMetrics = (input: string): string => {
  let value = String(input ?? "").trim();
  if (!value) return "";

  const replacements: Array<[RegExp, string]> = [
    [/Authorization:\s*Bearer\s+[A-Za-z0-9\-._]+/gi, "Authorization: Bearer [REDACTED]"],
    [/eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g, "[REDACTED_JWT]"],
    [/sb_secret_[A-Za-z0-9_-]{10,}/g, "sb_secret_[REDACTED]"],
    [/AIza[0-9A-Za-z\-_]{10,}/g, "AIza[REDACTED]"],
  ];

  for (const [pattern, replacement] of replacements) {
    value = value.replace(pattern, replacement);
  }

  // Hard truncate: /internal/metrics is unauthenticated in some environments.
  const MAX_LEN = 600;
  if (value.length > MAX_LEN) {
    value = `${value.slice(0, MAX_LEN)}…`;
  }

  return value;
};

export const incrementMetric = (name: MetricName, amount = 1): void => {
  totals[name] += amount;
  windowCounts[name] += amount;
};

export const recordMetricTiming = (name: TimingMetricName, ms: number): void => {
  if (!Number.isFinite(ms) || ms < 0) return;
  const roundedMs = Math.round(ms * 10) / 10;
  for (const bucket of [timingTotals, timingWindow]) {
    const current = bucket[name];
    current.count += 1;
    current.totalMs += roundedMs;
    current.lastMs = roundedMs;
    current.maxMs = Math.max(current.maxMs, roundedMs);
    current.minMs = current.count === 1 ? roundedMs : Math.min(current.minMs, roundedMs);
  }
};

const bumpRegulatoryPolicyBucket = (
  bucket: RegulatoryWritePolicyBucket,
  decision: RegulatoryWritePolicyDecisionKind,
  key: string,
): void => {
  const normalized = String(key ?? "").trim() || "unknown";
  const current = bucket[decision][normalized] ?? 0;
  bucket[decision][normalized] = current + 1;
};

export const recordRegulatoryWritePolicyDecision = (params: {
  mode: RegulatoryWritePolicyMode;
  decision: RegulatoryWritePolicyDecisionKind;
  sourceKind: string;
  incomingRank: number;
  reason: string;
}): void => {
  regulatoryWritePolicyTotals[params.decision] += 1;
  bumpRegulatoryPolicyBucket(regulatoryWritePolicyBySourceKind, params.decision, params.sourceKind);
  bumpRegulatoryPolicyBucket(
    regulatoryWritePolicyByIncomingRank,
    params.decision,
    Number.isFinite(params.incomingRank) ? String(params.incomingRank) : "unknown",
  );
  bumpRegulatoryPolicyBucket(regulatoryWritePolicyByReason, params.decision, params.reason);
  regulatoryWritePolicyRecent.unshift({
    at: new Date().toISOString(),
    mode: params.mode,
    decision: params.decision,
    sourceKind: String(params.sourceKind || "unknown"),
    incomingRank: Number.isFinite(params.incomingRank) ? params.incomingRank : -1,
    reason: String(params.reason || "unknown"),
  });
  regulatoryWritePolicyRecent.length = Math.min(regulatoryWritePolicyRecent.length, 50);

  if (params.decision === "wouldBlock") {
    incrementMetric("regulatory_write_policy_would_block");
  } else if (params.decision === "wouldUpgrade") {
    incrementMetric("regulatory_write_policy_would_upgrade");
  } else if (params.decision === "wouldReplaceSameRank") {
    incrementMetric("regulatory_write_policy_would_replace_same_rank");
  } else if (params.decision === "wouldWriteCandidateOnly") {
    incrementMetric("regulatory_write_policy_would_write_candidate_only");
  }
};

export const getMetricsSnapshot = () => ({
  startedAt,
  lastFlushAt,
  totals: { ...totals },
  window: { ...windowCounts },
  timingTotals: Object.fromEntries(
    TIMING_METRIC_NAMES.map((name) => [
      name,
      {
        ...timingTotals[name],
        minMs: timingTotals[name].count ? timingTotals[name].minMs : 0,
        avgMs: timingTotals[name].count
          ? Math.round((timingTotals[name].totalMs / timingTotals[name].count) * 10) / 10
          : 0,
      },
    ]),
  ),
  timingWindow: Object.fromEntries(
    TIMING_METRIC_NAMES.map((name) => [
      name,
      {
        ...timingWindow[name],
        minMs: timingWindow[name].count ? timingWindow[name].minMs : 0,
        avgMs: timingWindow[name].count
          ? Math.round((timingWindow[name].totalMs / timingWindow[name].count) * 10) / 10
          : 0,
      },
    ]),
  ),
  debug: {
    regulatoryWritePolicy: {
      totals: { ...regulatoryWritePolicyTotals },
      bySourceKind: { ...regulatoryWritePolicyBySourceKind },
      byIncomingRank: { ...regulatoryWritePolicyByIncomingRank },
      byReason: { ...regulatoryWritePolicyByReason },
      recent: [...regulatoryWritePolicyRecent],
    },
  },
});

const formatCounts = (counts: MetricsState): string =>
  METRIC_NAMES.map((name) => `${name}=${counts[name]}`).join(" ");

const formatTimingCounts = (counts: TimingMetricsState): string =>
  TIMING_METRIC_NAMES.map((name) => {
    const metric = counts[name];
    const avg = metric.count ? Math.round((metric.totalMs / metric.count) * 10) / 10 : 0;
    return `${name}={count:${metric.count},avgMs:${avg},lastMs:${metric.lastMs}}`;
  }).join(" ");

export const startMetricsFlush = (): void => {
  if (flushStarted) return;
  flushStarted = true;

  setInterval(() => {
    const hasActivity = METRIC_NAMES.some((name) => windowCounts[name] > 0);
    const hasTimingActivity = TIMING_METRIC_NAMES.some((name) => timingWindow[name].count > 0);
    if ((hasActivity || hasTimingActivity) && METRICS_WINDOW_LOG_ENABLED) {
      console.log(`[metrics] window ${formatCounts(windowCounts)} timings=${formatTimingCounts(timingWindow)}`);
    }
    windowCounts = buildEmptyCounts();
    timingWindow = buildEmptyTimings();
    lastFlushAt = new Date().toISOString();
  }, 60_000);
};
