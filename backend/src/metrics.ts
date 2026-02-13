export const METRIC_NAMES = [
  "snapshot_write_success",
  "snapshot_write_timeout",
  "snapshot_write_breaker_open",
  "scanlog_write_success",
  "scanlog_write_timeout",
  "scanlog_write_breaker_open",
  "training_write_success",
  "training_write_timeout",
  "training_write_breaker_open",
  "deepseek_bundle_success",
  "deepseek_bundle_fail_degraded",
  "label_scan_metrics_write_success",
  "label_scan_metrics_write_rejected",
  "label_scan_metrics_write_timeout",
] as const;

export type MetricName = (typeof METRIC_NAMES)[number];

type MetricsState = Record<MetricName, number>;

type LabelScanMetricsWriteRejectedDebug = {
  at: string;
  code: string | null;
  message: string;
};

const buildEmptyCounts = (): MetricsState =>
  METRIC_NAMES.reduce((acc, name) => {
    acc[name] = 0;
    return acc;
  }, {} as MetricsState);

const totals = buildEmptyCounts();
let windowCounts = buildEmptyCounts();
const startedAt = new Date().toISOString();
let lastFlushAt = startedAt;
let flushStarted = false;
const labelScanMetricsWriteRejectedRecent: LabelScanMetricsWriteRejectedDebug[] = [];

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

export const recordLabelScanMetricsWriteRejected = (message: string, code?: string | null): void => {
  const cleaned = redactForInternalMetrics(message);
  if (!cleaned) return;

  labelScanMetricsWriteRejectedRecent.unshift({
    at: new Date().toISOString(),
    code: code ?? null,
    message: cleaned,
  });

  // Keep a tiny ring buffer for diagnosis without leaking large payloads.
  labelScanMetricsWriteRejectedRecent.length = Math.min(labelScanMetricsWriteRejectedRecent.length, 5);
};

export const getMetricsSnapshot = () => ({
  startedAt,
  lastFlushAt,
  totals: { ...totals },
  window: { ...windowCounts },
  debug: {
    labelScanMetricsWriteRejectedRecent: [...labelScanMetricsWriteRejectedRecent],
  },
});

const formatCounts = (counts: MetricsState): string =>
  METRIC_NAMES.map((name) => `${name}=${counts[name]}`).join(" ");

export const startMetricsFlush = (): void => {
  if (flushStarted) return;
  flushStarted = true;

  setInterval(() => {
    const hasActivity = METRIC_NAMES.some((name) => windowCounts[name] > 0);
    if (hasActivity) {
      console.log(`[metrics] window ${formatCounts(windowCounts)}`);
    }
    windowCounts = buildEmptyCounts();
    lastFlushAt = new Date().toISOString();
  }, 60_000);
};
