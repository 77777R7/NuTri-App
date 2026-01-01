export const METRIC_NAMES = [
  "snapshot_write_success",
  "snapshot_write_timeout",
  "snapshot_write_breaker_open",
  "scanlog_write_success",
  "scanlog_write_timeout",
  "scanlog_write_breaker_open",
  "deepseek_bundle_success",
  "deepseek_bundle_fail_degraded",
] as const;

export type MetricName = (typeof METRIC_NAMES)[number];

type MetricsState = Record<MetricName, number>;

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

export const incrementMetric = (name: MetricName, amount = 1): void => {
  totals[name] += amount;
  windowCounts[name] += amount;
};

export const getMetricsSnapshot = () => ({
  startedAt,
  lastFlushAt,
  totals: { ...totals },
  window: { ...windowCounts },
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
