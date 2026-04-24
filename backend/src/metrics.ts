import type { ScanSidecarPriority, ScanSidecarRoute } from "./scanSidecarPolicy.js";

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

export type SidecarCacheStatus = "hit" | "miss" | "stale" | "write" | "bypass";

export const SCAN_UX_METRIC_EVENTS = [
  "time_to_first_renderable_decision_template",
  "time_to_score_visible",
  "time_to_core_cards_visible",
] as const;

export type ScanUxMetricEvent = (typeof SCAN_UX_METRIC_EVENTS)[number];

type RecentTimingMetricSummary = TimingMetricSummary & {
  recentMs: number[];
};

type ScanUxMetricsState = Record<ScanUxMetricEvent, RecentTimingMetricSummary>;

type ClientDecisionSupportFetchSummary = {
  totalFetchEvents: number;
  duplicateFetchEvents: number;
  maxReportedFetchCountPerScan: number;
};

type StreamTerminalMetricsState = {
  total: number;
  terminalCounts: Record<string, number>;
  reasonCounts: Record<string, number>;
  degradedCount: number;
  sourceTypeCounts: Record<string, number>;
};

type SidecarMetricSummary = {
  priority: ScanSidecarPriority;
  fetchCount: number;
  cacheHitCount: number;
  cacheMissCount: number;
  cacheStaleCount: number;
  cacheWriteCount: number;
  cacheBypassCount: number;
  latency: TimingMetricSummary;
};

type SidecarMetricsState = Partial<Record<ScanSidecarRoute, SidecarMetricSummary>>;

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

const MAX_RECENT_TIMING_SAMPLES = 200;

const buildEmptyRecentTimingSummary = (): RecentTimingMetricSummary => ({
  ...buildEmptyTimingSummary(),
  recentMs: [],
});

const buildEmptyTimings = (): TimingMetricsState =>
  TIMING_METRIC_NAMES.reduce((acc, name) => {
    acc[name] = buildEmptyTimingSummary();
    return acc;
  }, {} as TimingMetricsState);

const buildEmptyScanUxMetrics = (): ScanUxMetricsState =>
  SCAN_UX_METRIC_EVENTS.reduce((acc, name) => {
    acc[name] = buildEmptyRecentTimingSummary();
    return acc;
  }, {} as ScanUxMetricsState);

const buildEmptyClientDecisionSupportFetchSummary = (): ClientDecisionSupportFetchSummary => ({
  totalFetchEvents: 0,
  duplicateFetchEvents: 0,
  maxReportedFetchCountPerScan: 0,
});

const buildEmptyStreamTerminalMetrics = (): StreamTerminalMetricsState => ({
  total: 0,
  terminalCounts: {},
  reasonCounts: {},
  degradedCount: 0,
  sourceTypeCounts: {},
});

const buildEmptySidecarSummary = (priority: ScanSidecarPriority): SidecarMetricSummary => ({
  priority,
  fetchCount: 0,
  cacheHitCount: 0,
  cacheMissCount: 0,
  cacheStaleCount: 0,
  cacheWriteCount: 0,
  cacheBypassCount: 0,
  latency: buildEmptyTimingSummary(),
});

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
const scanUxTotals = buildEmptyScanUxMetrics();
let scanUxWindow = buildEmptyScanUxMetrics();
const clientDecisionSupportFetchTotals = buildEmptyClientDecisionSupportFetchSummary();
let clientDecisionSupportFetchWindow = buildEmptyClientDecisionSupportFetchSummary();
const streamTerminalTotals = buildEmptyStreamTerminalMetrics();
let streamTerminalWindow = buildEmptyStreamTerminalMetrics();
const sidecarTotals: SidecarMetricsState = {};
let sidecarWindow: SidecarMetricsState = {};
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

const recordRecentTiming = (summary: RecentTimingMetricSummary, ms: number): void => {
  if (!Number.isFinite(ms) || ms < 0) return;
  const roundedMs = Math.round(ms * 10) / 10;
  summary.count += 1;
  summary.totalMs += roundedMs;
  summary.lastMs = roundedMs;
  summary.maxMs = Math.max(summary.maxMs, roundedMs);
  summary.minMs = summary.count === 1 ? roundedMs : Math.min(summary.minMs, roundedMs);
  summary.recentMs.push(roundedMs);
  if (summary.recentMs.length > MAX_RECENT_TIMING_SAMPLES) {
    summary.recentMs.splice(0, summary.recentMs.length - MAX_RECENT_TIMING_SAMPLES);
  }
};

const isScanUxMetricEvent = (event: string): event is ScanUxMetricEvent =>
  (SCAN_UX_METRIC_EVENTS as readonly string[]).includes(event);

const normalizeMetricKey = (value: unknown, fallback = "unknown"): string => {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized.slice(0, 80) : fallback;
};

const bumpKey = (record: Record<string, number>, key: string): void => {
  record[key] = (record[key] ?? 0) + 1;
};

const recordClientDecisionSupportFetchInto = (
  summary: ClientDecisionSupportFetchSummary,
  reportedFetchCount: number,
): void => {
  summary.totalFetchEvents += 1;
  if (reportedFetchCount > 1) summary.duplicateFetchEvents += 1;
  summary.maxReportedFetchCountPerScan = Math.max(
    summary.maxReportedFetchCountPerScan,
    reportedFetchCount,
  );
};

export const recordScanUxMetric = (params: {
  event: string;
  elapsedMs?: number;
  count?: number;
}): void => {
  const event = String(params.event ?? "").trim();
  if (isScanUxMetricEvent(event)) {
    const elapsedMs = Number(params.elapsedMs);
    if (Number.isFinite(elapsedMs) && elapsedMs >= 0) {
      recordRecentTiming(scanUxTotals[event], elapsedMs);
      recordRecentTiming(scanUxWindow[event], elapsedMs);
    }
  }

  if (event === "decision_support_fetch") {
    const rawFetchCount = Number(params.count ?? 1);
    const reportedFetchCount = Number.isFinite(rawFetchCount) && rawFetchCount > 0
      ? Math.max(1, Math.floor(rawFetchCount))
      : 1;
    recordClientDecisionSupportFetchInto(clientDecisionSupportFetchTotals, reportedFetchCount);
    recordClientDecisionSupportFetchInto(clientDecisionSupportFetchWindow, reportedFetchCount);
  }
};

const recordScanStreamTerminalInto = (
  state: StreamTerminalMetricsState,
  params: {
    terminal: string;
    reason?: string | null;
    degradedMode?: boolean;
    sourceType?: string | null;
  },
): void => {
  state.total += 1;
  bumpKey(state.terminalCounts, normalizeMetricKey(params.terminal, "UNKNOWN"));
  bumpKey(state.reasonCounts, normalizeMetricKey(params.reason, "none"));
  if (params.degradedMode) state.degradedCount += 1;
  bumpKey(state.sourceTypeCounts, normalizeMetricKey(params.sourceType, "unknown"));
};

export const recordScanStreamTerminal = (params: {
  terminal: string;
  reason?: string | null;
  degradedMode?: boolean;
  sourceType?: string | null;
}): void => {
  recordScanStreamTerminalInto(streamTerminalTotals, params);
  recordScanStreamTerminalInto(streamTerminalWindow, params);
};

const getSidecarSummary = (
  state: SidecarMetricsState,
  route: ScanSidecarRoute,
  priority: ScanSidecarPriority,
): SidecarMetricSummary => {
  const existing = state[route];
  if (existing) {
    existing.priority = priority;
    return existing;
  }
  const created = buildEmptySidecarSummary(priority);
  state[route] = created;
  return created;
};

const recordSidecarLatency = (summary: SidecarMetricSummary, ms: number): void => {
  if (!Number.isFinite(ms) || ms < 0) return;
  const roundedMs = Math.round(ms * 10) / 10;
  const current = summary.latency;
  current.count += 1;
  current.totalMs += roundedMs;
  current.lastMs = roundedMs;
  current.maxMs = Math.max(current.maxMs, roundedMs);
  current.minMs = current.count === 1 ? roundedMs : Math.min(current.minMs, roundedMs);
};

const recordSidecarMetricInto = (
  state: SidecarMetricsState,
  params: {
    route: ScanSidecarRoute;
    priority: ScanSidecarPriority;
    latencyMs?: number;
    cacheStatus?: SidecarCacheStatus;
    fetched?: boolean;
    amount?: number;
  },
): void => {
  const summary = getSidecarSummary(state, params.route, params.priority);
  const amount = Number.isFinite(params.amount) && Number(params.amount) > 0
    ? Math.floor(Number(params.amount))
    : 1;
  if (params.fetched) summary.fetchCount += amount;
  if (params.cacheStatus === "hit") summary.cacheHitCount += amount;
  if (params.cacheStatus === "miss") summary.cacheMissCount += amount;
  if (params.cacheStatus === "stale") summary.cacheStaleCount += amount;
  if (params.cacheStatus === "write") summary.cacheWriteCount += amount;
  if (params.cacheStatus === "bypass") summary.cacheBypassCount += amount;
  if (typeof params.latencyMs === "number") recordSidecarLatency(summary, params.latencyMs);
};

export const recordSidecarMetric = (params: {
  route: ScanSidecarRoute;
  priority: ScanSidecarPriority;
  latencyMs?: number;
  cacheStatus?: SidecarCacheStatus;
  fetched?: boolean;
  amount?: number;
}): void => {
  recordSidecarMetricInto(sidecarTotals, params);
  recordSidecarMetricInto(sidecarWindow, params);
};

const serializeTimingSummary = (summary: TimingMetricSummary) => ({
  ...summary,
  minMs: summary.count ? summary.minMs : 0,
  avgMs: summary.count
    ? Math.round((summary.totalMs / summary.count) * 10) / 10
    : 0,
});

const percentile = (values: number[], ratio: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index] ?? 0;
};

const serializeRecentTimingSummary = (summary: RecentTimingMetricSummary) => {
  const { recentMs: _recentMs, ...timingSummary } = summary;
  const base = serializeTimingSummary(timingSummary);
  return {
    ...base,
    recentCount: summary.recentMs.length,
    recentP50Ms: percentile(summary.recentMs, 0.5),
    recentP90Ms: percentile(summary.recentMs, 0.9),
    recentP95Ms: percentile(summary.recentMs, 0.95),
  };
};

const serializeScanUxMetrics = (state: ScanUxMetricsState) =>
  Object.fromEntries(
    SCAN_UX_METRIC_EVENTS.map((event) => [
      event,
      serializeRecentTimingSummary(state[event]),
    ]),
  );

const serializeSidecarMetrics = (state: SidecarMetricsState) =>
  Object.fromEntries(
    Object.entries(state).map(([route, summary]) => [
      route,
      {
        ...summary,
        latency: serializeTimingSummary(summary.latency),
      },
    ]),
  );

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
  scanUx: {
    totals: serializeScanUxMetrics(scanUxTotals),
    window: serializeScanUxMetrics(scanUxWindow),
    decisionSupportFetch: {
      totals: { ...clientDecisionSupportFetchTotals },
      window: { ...clientDecisionSupportFetchWindow },
    },
  },
  streamTerminals: {
    totals: {
      ...streamTerminalTotals,
      terminalCounts: { ...streamTerminalTotals.terminalCounts },
      reasonCounts: { ...streamTerminalTotals.reasonCounts },
      sourceTypeCounts: { ...streamTerminalTotals.sourceTypeCounts },
    },
    window: {
      ...streamTerminalWindow,
      terminalCounts: { ...streamTerminalWindow.terminalCounts },
      reasonCounts: { ...streamTerminalWindow.reasonCounts },
      sourceTypeCounts: { ...streamTerminalWindow.sourceTypeCounts },
    },
  },
  sidecars: {
    totals: serializeSidecarMetrics(sidecarTotals),
    window: serializeSidecarMetrics(sidecarWindow),
  },
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

const hasSidecarActivity = (state: SidecarMetricsState): boolean =>
  Object.values(state).some((summary) =>
    Boolean(summary && (
      summary.fetchCount > 0
      || summary.cacheHitCount > 0
      || summary.cacheMissCount > 0
      || summary.cacheStaleCount > 0
      || summary.cacheWriteCount > 0
      || summary.cacheBypassCount > 0
      || summary.latency.count > 0
    )),
  );

const hasScanUxActivity = (state: ScanUxMetricsState): boolean =>
  SCAN_UX_METRIC_EVENTS.some((name) => state[name].count > 0);

const hasStreamTerminalActivity = (state: StreamTerminalMetricsState): boolean =>
  state.total > 0;

const formatSidecarCounts = (state: SidecarMetricsState): string =>
  Object.entries(state)
    .map(([route, summary]) => {
      const avg = summary.latency.count
        ? Math.round((summary.latency.totalMs / summary.latency.count) * 10) / 10
        : 0;
      return `${route}={priority:${summary.priority},fetch:${summary.fetchCount},hit:${summary.cacheHitCount},miss:${summary.cacheMissCount},write:${summary.cacheWriteCount},avgMs:${avg}}`;
    })
    .join(" ");

const formatScanUxCounts = (state: ScanUxMetricsState): string =>
  SCAN_UX_METRIC_EVENTS
    .map((event) => {
      const summary = state[event];
      return `${event}={count:${summary.count},p95Ms:${percentile(summary.recentMs, 0.95)},lastMs:${summary.lastMs}}`;
    })
    .join(" ");

export const startMetricsFlush = (): void => {
  if (flushStarted) return;
  flushStarted = true;

  setInterval(() => {
    const hasActivity = METRIC_NAMES.some((name) => windowCounts[name] > 0);
    const hasTimingActivity = TIMING_METRIC_NAMES.some((name) => timingWindow[name].count > 0);
    const hasSidecars = hasSidecarActivity(sidecarWindow);
    const hasScanUx = hasScanUxActivity(scanUxWindow);
    const hasStreamTerminals = hasStreamTerminalActivity(streamTerminalWindow);
    if ((hasActivity || hasTimingActivity || hasSidecars || hasScanUx || hasStreamTerminals) && METRICS_WINDOW_LOG_ENABLED) {
      console.log(
        `[metrics] window ${formatCounts(windowCounts)} timings=${formatTimingCounts(timingWindow)} sidecars=${formatSidecarCounts(sidecarWindow)} scanUx=${formatScanUxCounts(scanUxWindow)} streamTerminals=${JSON.stringify(streamTerminalWindow.terminalCounts)}`,
      );
    }
    windowCounts = buildEmptyCounts();
    timingWindow = buildEmptyTimings();
    scanUxWindow = buildEmptyScanUxMetrics();
    clientDecisionSupportFetchWindow = buildEmptyClientDecisionSupportFetchSummary();
    streamTerminalWindow = buildEmptyStreamTerminalMetrics();
    sidecarWindow = {};
    lastFlushAt = new Date().toISOString();
  }, 60_000);
};
