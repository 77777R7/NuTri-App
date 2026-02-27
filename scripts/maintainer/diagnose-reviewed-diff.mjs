#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT_DIR = process.cwd();
const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(`--${flag}`);
const getArg = (flag) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

if (hasFlag("help")) {
  console.log(`Usage:
  node scripts/maintainer/diagnose-reviewed-diff.mjs --before-report <path> --after-report <path> [--out-dir <path>]

Options:
  --before-report <path>      Baseline report.json
  --after-report <path>       New report.json
  --out-dir <path>            Output directory (default: output/reviewed_diff/<timestamp>)
`);
  process.exit(0);
}

const nowTag = new Date().toISOString().replace(/[:.]/g, "-");
const beforePathArg = getArg("before-report");
const afterPathArg = getArg("after-report");
if (!beforePathArg || !afterPathArg) {
  console.error("[reviewed-diff] --before-report and --after-report are required.");
  process.exit(1);
}

const resolvePath = (value) => (path.isAbsolute(value) ? value : path.join(ROOT_DIR, value));
const beforePath = resolvePath(beforePathArg);
const afterPath = resolvePath(afterPathArg);
const outDirArg = getArg("out-dir") || path.join("output", "reviewed_diff", nowTag);
const outDir = path.isAbsolute(outDirArg) ? outDirArg : path.join(ROOT_DIR, outDirArg);
const outJsonPath = path.join(outDir, "diff.json");
const outMdPath = path.join(outDir, "diff.md");

const toNumberOrNull = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
const toCount = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
};
const pctDelta = (before, after) =>
  before == null || after == null ? null : Number((after - before).toFixed(4));

const normalizeMissReasons = (value) => {
  if (!value || typeof value !== "object") return {};
  return Object.entries(value).reduce((acc, [key, raw]) => {
    const count = toCount(raw);
    if (count > 0) acc[key] = count;
    return acc;
  }, {});
};

const collectTopMissIngredients = (rows, limit = 20) => {
  const bucket = new Map();
  const push = (key, reason, count) => {
    if (!count) return;
    if (!bucket.has(key)) {
      bucket.set(key, {
        key,
        total: 0,
        reasons: {},
      });
    }
    const item = bucket.get(key);
    item.total += count;
    item.reasons[reason] = (item.reasons[reason] ?? 0) + count;
  };

  for (const row of Array.isArray(rows) ? rows : []) {
    const key =
      row?.mappingQuality?.matchedCanonicalKey ??
      row?.identity?.identityValue ??
      row?.barcode ??
      "unknown";
    const withName = normalizeMissReasons(row?.kbWithName?.missReasons);
    const withoutName = normalizeMissReasons(row?.kbWithoutName?.missReasons);
    Object.entries(withName).forEach(([reason, count]) => push(key, `withName:${reason}`, count));
    Object.entries(withoutName).forEach(([reason, count]) => push(key, `withoutName:${reason}`, count));
  }

  return [...bucket.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
};

const summarizeReport = (report) => {
  const rows = Array.isArray(report?.rows) ? report.rows : [];
  const reviewed = report?.summary?.reviewed ?? report?.metrics?.reviewed ?? {};
  const withNameHitRate =
    toNumberOrNull(reviewed?.withNameHitRate) ??
    toNumberOrNull(report?.metrics?.whyReviewedHitRateWithName);
  const withoutNameHitRate =
    toNumberOrNull(reviewed?.withoutNameHitRate) ??
    toNumberOrNull(report?.metrics?.whyReviewedHitRateWithoutName);
  const ingredientNotSupportedCount = toCount(
    reviewed?.ingredientNotSupportedCount ?? report?.metrics?.reviewed?.ingredientNotSupportedCount,
  );
  const noEntryForFormKeyCount = toCount(
    reviewed?.noEntryForFormKeyCount ?? report?.metrics?.reviewed?.noEntryForFormKeyCount,
  );
  const noFormRowsCount = toCount(
    report?.summary?.guard?.noFormRowsCount ?? report?.metrics?.noFormRowsCount,
  );
  const signalZeroCauseCounts = rows.reduce((acc, row) => {
    const key = typeof row?.score?.signalZeroCause === "string" ? row.score.signalZeroCause : "NONE";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  return {
    generatedAt: report?.generatedAt ?? null,
    baseUrl: report?.baseUrl ?? null,
    rows: rows.length,
    kpiPrimary: report?.summary?.kpiPrimary ?? report?.metrics?.kpiPrimary ?? null,
    reviewed: {
      withNameHitRate,
      withoutNameHitRate,
      ingredientNotSupportedCount,
      noEntryForFormKeyCount,
    },
    guard: {
      noFormRowsCount,
    },
    signalZeroCauseCounts,
    topMissIngredients: collectTopMissIngredients(rows),
  };
};

const buildTopMissDelta = (before, after, limit = 20) => {
  const byKey = new Map();
  before.forEach((item) => {
    byKey.set(item.key, {
      key: item.key,
      beforeTotal: item.total,
      afterTotal: 0,
      delta: -item.total,
    });
  });
  after.forEach((item) => {
    if (!byKey.has(item.key)) {
      byKey.set(item.key, {
        key: item.key,
        beforeTotal: 0,
        afterTotal: item.total,
        delta: item.total,
      });
      return;
    }
    const current = byKey.get(item.key);
    current.afterTotal = item.total;
    current.delta = item.total - current.beforeTotal;
  });
  return [...byKey.values()]
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, limit);
};

const toMarkdown = (diff) => {
  const lines = [];
  lines.push("# Reviewed KPI Diff");
  lines.push("");
  lines.push(`- Generated: ${diff.generatedAt}`);
  lines.push(`- Before: ${diff.before.path}`);
  lines.push(`- After: ${diff.after.path}`);
  lines.push("");

  lines.push("## KPI Delta");
  lines.push("");
  lines.push(`- withNameHitRate: ${diff.kpi.withNameHitRate.before ?? "n/a"} -> ${diff.kpi.withNameHitRate.after ?? "n/a"} (delta ${diff.kpi.withNameHitRate.delta ?? "n/a"})`);
  lines.push(`- withoutNameHitRate: ${diff.kpi.withoutNameHitRate.before ?? "n/a"} -> ${diff.kpi.withoutNameHitRate.after ?? "n/a"} (delta ${diff.kpi.withoutNameHitRate.delta ?? "n/a"})`);
  lines.push(`- ingredientNotSupportedCount: ${diff.kpi.ingredientNotSupportedCount.before} -> ${diff.kpi.ingredientNotSupportedCount.after} (delta ${diff.kpi.ingredientNotSupportedCount.delta})`);
  lines.push(`- noEntryForFormKeyCount: ${diff.kpi.noEntryForFormKeyCount.before} -> ${diff.kpi.noEntryForFormKeyCount.after} (delta ${diff.kpi.noEntryForFormKeyCount.delta})`);
  lines.push(`- NO_FORM_ROWS: ${diff.kpi.noFormRowsCount.before} -> ${diff.kpi.noFormRowsCount.after} (delta ${diff.kpi.noFormRowsCount.delta})`);
  lines.push("");

  lines.push("## Top Miss Delta");
  lines.push("");
  diff.topMissDelta.forEach((item) => {
    lines.push(`- ${item.key}: before=${item.beforeTotal}, after=${item.afterTotal}, delta=${item.delta}`);
  });
  lines.push("");

  lines.push("## Signal Zero Cause Delta");
  lines.push("");
  const allKeys = new Set([
    ...Object.keys(diff.before.summary.signalZeroCauseCounts ?? {}),
    ...Object.keys(diff.after.summary.signalZeroCauseCounts ?? {}),
  ]);
  [...allKeys].sort().forEach((key) => {
    const beforeCount = diff.before.summary.signalZeroCauseCounts?.[key] ?? 0;
    const afterCount = diff.after.summary.signalZeroCauseCounts?.[key] ?? 0;
    lines.push(`- ${key}: ${beforeCount} -> ${afterCount} (delta ${afterCount - beforeCount})`);
  });
  lines.push("");

  return `${lines.join("\n").trim()}\n`;
};

const main = async () => {
  const [beforeRaw, afterRaw] = await Promise.all([
    fs.readFile(beforePath, "utf8"),
    fs.readFile(afterPath, "utf8"),
  ]);
  const beforeReport = JSON.parse(beforeRaw);
  const afterReport = JSON.parse(afterRaw);

  const beforeSummary = summarizeReport(beforeReport);
  const afterSummary = summarizeReport(afterReport);

  const diff = {
    generatedAt: new Date().toISOString(),
    kpiPrimary: "reviewed_hit_rate",
    before: {
      path: beforePath,
      summary: beforeSummary,
    },
    after: {
      path: afterPath,
      summary: afterSummary,
    },
    kpi: {
      withNameHitRate: {
        before: beforeSummary.reviewed.withNameHitRate,
        after: afterSummary.reviewed.withNameHitRate,
        delta: pctDelta(beforeSummary.reviewed.withNameHitRate, afterSummary.reviewed.withNameHitRate),
      },
      withoutNameHitRate: {
        before: beforeSummary.reviewed.withoutNameHitRate,
        after: afterSummary.reviewed.withoutNameHitRate,
        delta: pctDelta(beforeSummary.reviewed.withoutNameHitRate, afterSummary.reviewed.withoutNameHitRate),
      },
      ingredientNotSupportedCount: {
        before: beforeSummary.reviewed.ingredientNotSupportedCount,
        after: afterSummary.reviewed.ingredientNotSupportedCount,
        delta:
          afterSummary.reviewed.ingredientNotSupportedCount -
          beforeSummary.reviewed.ingredientNotSupportedCount,
      },
      noEntryForFormKeyCount: {
        before: beforeSummary.reviewed.noEntryForFormKeyCount,
        after: afterSummary.reviewed.noEntryForFormKeyCount,
        delta:
          afterSummary.reviewed.noEntryForFormKeyCount -
          beforeSummary.reviewed.noEntryForFormKeyCount,
      },
      noFormRowsCount: {
        before: beforeSummary.guard.noFormRowsCount,
        after: afterSummary.guard.noFormRowsCount,
        delta: afterSummary.guard.noFormRowsCount - beforeSummary.guard.noFormRowsCount,
      },
    },
    topMissDelta: buildTopMissDelta(
      beforeSummary.topMissIngredients,
      afterSummary.topMissIngredients,
      20,
    ),
  };

  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(outJsonPath, JSON.stringify(diff, null, 2), "utf8");
  await fs.writeFile(outMdPath, toMarkdown(diff), "utf8");
  console.log(`[reviewed-diff] wrote ${outJsonPath}`);
  console.log(`[reviewed-diff] wrote ${outMdPath}`);
};

main().catch((error) => {
  console.error("[reviewed-diff] failed", error instanceof Error ? error.message : error);
  process.exit(1);
});

