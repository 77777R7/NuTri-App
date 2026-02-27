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
  node scripts/maintainer/gate-report-diff.mjs --before-report <path> --after-report <path> [--out-dir <path>]

Options:
  --before-report <path>      Baseline gate_full_report.json
  --after-report <path>       New gate_full_report.json
  --out-dir <path>            Output directory (default: output/maintainer-gates-diff/<timestamp>)
`);
  process.exit(0);
}

const beforePathArg = getArg("before-report");
const afterPathArg = getArg("after-report");
if (!beforePathArg || !afterPathArg) {
  console.error("[gate-report-diff] --before-report and --after-report are required.");
  process.exit(1);
}

const nowTag = new Date().toISOString().replace(/[:.]/g, "-");
const outArg = getArg("out-dir") || path.join("output", "maintainer-gates-diff", nowTag);
const outDir = path.isAbsolute(outArg) ? outArg : path.join(ROOT_DIR, outArg);
const outJsonPath = path.join(outDir, "gate_diff.json");
const outMdPath = path.join(outDir, "gate_diff.md");

const resolvePath = (value) => (path.isAbsolute(value) ? value : path.join(ROOT_DIR, value));
const beforePath = resolvePath(beforePathArg);
const afterPath = resolvePath(afterPathArg);

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const readJson = async (filePath) => {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
};

const sumMap = (map) =>
  Object.values(map && typeof map === "object" ? map : {}).reduce((acc, value) => acc + toNumber(value), 0);

const diffMap = (before, after) => {
  const keys = new Set([
    ...Object.keys(before && typeof before === "object" ? before : {}),
    ...Object.keys(after && typeof after === "object" ? after : {}),
  ]);
  const diff = {};
  [...keys].sort().forEach((key) => {
    const b = toNumber(before?.[key]);
    const a = toNumber(after?.[key]);
    diff[key] = {
      before: b,
      after: a,
      delta: a - b,
    };
  });
  return diff;
};

const summarizeTerminalReasonQuality = (report) => {
  const quality = report?.terminalReasonQuality ?? {};
  const reasonCounts = report?.terminalReasonCounts ?? {};
  const denominator =
    toNumber(quality?.denominator) ||
    toNumber(report?.sourceTypeFinalCounts?.all?.total) ||
    sumMap(report?.terminalBreakdown);
  const nullCount =
    toNumber(quality?.terminalReasonNullCount) +
    (reasonCounts?.null != null ? toNumber(reasonCounts.null) : 0);
  const unknownCount =
    toNumber(quality?.terminalReasonUnknownCount) +
    (reasonCounts?.UNKNOWN != null ? toNumber(reasonCounts.UNKNOWN) : 0);
  const mergedNullCount = Math.max(
    toNumber(quality?.terminalReasonNullCount),
    reasonCounts?.null != null ? toNumber(reasonCounts.null) : 0,
  );
  const mergedUnknownCount = Math.max(
    toNumber(quality?.terminalReasonUnknownCount),
    reasonCounts?.UNKNOWN != null ? toNumber(reasonCounts.UNKNOWN) : 0,
  );
  const nullLikeCount = mergedNullCount + mergedUnknownCount;
  const nullLikeRate =
    quality?.terminalReasonNullLikeRate != null
      ? Number(quality.terminalReasonNullLikeRate)
      : denominator > 0
        ? Number((nullLikeCount / denominator).toFixed(4))
        : null;
  return {
    denominator,
    terminalReasonNullCount: mergedNullCount,
    terminalReasonUnknownCount: mergedUnknownCount,
    terminalReasonNullLikeCount: nullLikeCount,
    terminalReasonNullLikeRate: nullLikeRate,
  };
};

const summarizeRole = (rows, role) => {
  const roleRows = (Array.isArray(rows) ? rows : []).filter((row) => row?.role === role);
  const total = roleRows.length;
  const doneCount = roleRows.filter((row) => row?.terminal === "DONE").length;
  const doneRate = total > 0 ? Number((doneCount / total).toFixed(4)) : null;
  const terminalReasonCounts = roleRows.reduce((acc, row) => {
    const key = String(row?.terminalReason ?? "null");
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  return {
    total,
    doneCount,
    doneRate,
    terminalReasonCounts,
  };
};

const summarizeProductIdentityStats = (report) => {
  const stats = report?.productIdentityStats ?? {};
  return {
    totalRows: toNumber(stats?.totalRows),
    presentCount: toNumber(stats?.presentCount),
    presentRate: Number(stats?.presentRate ?? 0),
    namePresentCount: toNumber(stats?.namePresentCount),
    namePresentRate: Number(stats?.namePresentRate ?? 0),
    trustedStableCount: toNumber(stats?.trustedStableCount),
    trustedStableRate: Number(stats?.trustedStableRate ?? 0),
    verifiedRegulatoryStableCount: toNumber(stats?.verifiedRegulatoryStableCount),
    verifiedRegulatoryStableRate: Number(stats?.verifiedRegulatoryStableRate ?? 0),
    sourceAttributionCounts: stats?.sourceAttributionCounts ?? {},
    identityStableCounts: stats?.identityStableCounts ?? {},
  };
};

const summarizeTerminalReasonSemantics = (report) => {
  const stats = report?.terminalReasonSemanticStats ?? {};
  const counts = stats?.counts ?? {};
  return {
    bundleOnlyNoAuthoritativeMatch: toNumber(counts?.bundleOnlyNoAuthoritativeMatch),
    degradedWebBudget: toNumber(counts?.degradedWebBudget),
    degradedEventloop: toNumber(counts?.degradedEventloop),
    doneOk: toNumber(counts?.doneOk),
    contractMismatchCount: toNumber(stats?.contractMismatchCount),
  };
};

const buildFocusDelta = (beforeRows, afterRows) => {
  const roles = new Set([
    ...(Array.isArray(beforeRows) ? beforeRows.map((row) => row?.role).filter(Boolean) : []),
    ...(Array.isArray(afterRows) ? afterRows.map((row) => row?.role).filter(Boolean) : []),
  ]);
  const byRole = [...roles].sort().map((role) => {
    const before = summarizeRole(beforeRows, role);
    const after = summarizeRole(afterRows, role);
    return {
      role,
      before,
      after,
      delta: {
        total: after.total - before.total,
        doneCount: after.doneCount - before.doneCount,
        doneRate:
          before.doneRate == null || after.doneRate == null
            ? null
            : Number((after.doneRate - before.doneRate).toFixed(4)),
      },
    };
  });
  const killerBefore = summarizeRole(beforeRows, "killer");
  const killerAfter = summarizeRole(afterRows, "killer");
  return {
    byRole,
    killer: {
      before: killerBefore,
      after: killerAfter,
      delta: {
        total: killerAfter.total - killerBefore.total,
        doneCount: killerAfter.doneCount - killerBefore.doneCount,
        doneRate:
          killerBefore.doneRate == null || killerAfter.doneRate == null
            ? null
            : Number((killerAfter.doneRate - killerBefore.doneRate).toFixed(4)),
      },
    },
  };
};

const toMarkdown = (diff) => {
  const lines = [];
  lines.push("# Gate Report Diff");
  lines.push("");
  lines.push(`- Generated: ${diff.generatedAt}`);
  lines.push(`- Before: ${diff.before.path}`);
  lines.push(`- After: ${diff.after.path}`);
  lines.push("");

  lines.push("## Terminal Delta");
  lines.push("");
  Object.entries(diff.terminalDelta).forEach(([key, value]) => {
    lines.push(`- ${key}: ${value.before} -> ${value.after} (delta ${value.delta})`);
  });
  lines.push("");

  lines.push("## TerminalReason Delta");
  lines.push("");
  lines.push(
    `- null-like rate: ${diff.terminalReasonDelta.before.terminalReasonNullLikeRate ?? "n/a"} -> ${diff.terminalReasonDelta.after.terminalReasonNullLikeRate ?? "n/a"} (delta ${diff.terminalReasonDelta.delta.terminalReasonNullLikeRate ?? "n/a"})`,
  );
  lines.push(
    `- null count: ${diff.terminalReasonDelta.before.terminalReasonNullCount} -> ${diff.terminalReasonDelta.after.terminalReasonNullCount} (delta ${diff.terminalReasonDelta.delta.terminalReasonNullCount})`,
  );
  lines.push(
    `- unknown count: ${diff.terminalReasonDelta.before.terminalReasonUnknownCount} -> ${diff.terminalReasonDelta.after.terminalReasonUnknownCount} (delta ${diff.terminalReasonDelta.delta.terminalReasonUnknownCount})`,
  );
  lines.push("");

  lines.push("## Stage0 Winner Delta");
  lines.push("");
  Object.entries(diff.stage0WinnerDelta).forEach(([key, value]) => {
    lines.push(`- ${key}: ${value.before} -> ${value.after} (delta ${value.delta})`);
  });
  lines.push("");

  lines.push("## Degraded Mode Delta");
  lines.push("");
  Object.entries(diff.degradedModeDelta).forEach(([key, value]) => {
    lines.push(`- ${key}: ${value.before} -> ${value.after} (delta ${value.delta})`);
  });
  lines.push("");

  lines.push("## Focus/Killer Delta");
  lines.push("");
  lines.push(
    `- killer doneRate: ${diff.focusDelta.killer.before.doneRate ?? "n/a"} -> ${diff.focusDelta.killer.after.doneRate ?? "n/a"} (delta ${diff.focusDelta.killer.delta.doneRate ?? "n/a"})`,
  );
  Object.entries(diff.focusDelta.killer.after.terminalReasonCounts ?? {}).forEach(([reason, count]) => {
    const beforeCount = diff.focusDelta.killer.before.terminalReasonCounts?.[reason] ?? 0;
    lines.push(`- killer reason ${reason}: ${beforeCount} -> ${count} (delta ${count - beforeCount})`);
  });
  lines.push("");

  lines.push("## ProductIdentity Delta");
  lines.push("");
  lines.push(
    `- presentRate: ${diff.productIdentityDelta.before.presentRate} -> ${diff.productIdentityDelta.after.presentRate} (delta ${diff.productIdentityDelta.delta.presentRate})`,
  );
  lines.push(
    `- trustedStableRate: ${diff.productIdentityDelta.before.trustedStableRate} -> ${diff.productIdentityDelta.after.trustedStableRate} (delta ${diff.productIdentityDelta.delta.trustedStableRate})`,
  );
  lines.push(
    `- verifiedRegulatoryStableRate: ${diff.productIdentityDelta.before.verifiedRegulatoryStableRate} -> ${diff.productIdentityDelta.after.verifiedRegulatoryStableRate} (delta ${diff.productIdentityDelta.delta.verifiedRegulatoryStableRate})`,
  );
  lines.push(
    `- sourceAttribution delta: \`${JSON.stringify(diff.productIdentityDelta.sourceAttributionDelta)}\``,
  );
  lines.push(
    `- identityStable delta: \`${JSON.stringify(diff.productIdentityDelta.identityStableDelta)}\``,
  );
  lines.push("");

  lines.push("## TerminalReason Semantic Delta");
  lines.push("");
  Object.entries(diff.terminalReasonSemanticDelta).forEach(([key, value]) => {
    lines.push(`- ${key}: ${value.before} -> ${value.after} (delta ${value.delta})`);
  });
  lines.push("");

  lines.push("## Verdict Delta");
  lines.push("");
  lines.push(`- pass: ${diff.verdictDelta.beforePass} -> ${diff.verdictDelta.afterPass}`);
  if (diff.verdictDelta.reasonsAdded.length > 0) {
    lines.push(`- reasons added: ${diff.verdictDelta.reasonsAdded.join(", ")}`);
  }
  if (diff.verdictDelta.reasonsRemoved.length > 0) {
    lines.push(`- reasons removed: ${diff.verdictDelta.reasonsRemoved.join(", ")}`);
  }
  if (diff.verdictDelta.warningsAdded.length > 0) {
    lines.push(`- warnings added: ${diff.verdictDelta.warningsAdded.join(", ")}`);
  }
  if (diff.verdictDelta.warningsRemoved.length > 0) {
    lines.push(`- warnings removed: ${diff.verdictDelta.warningsRemoved.join(", ")}`);
  }
  lines.push("");
  return `${lines.join("\n").trim()}\n`;
};

const main = async () => {
  const [beforeReport, afterReport] = await Promise.all([readJson(beforePath), readJson(afterPath)]);

  const beforeTerminalReason = summarizeTerminalReasonQuality(beforeReport);
  const afterTerminalReason = summarizeTerminalReasonQuality(afterReport);
  const beforeProductIdentity = summarizeProductIdentityStats(beforeReport);
  const afterProductIdentity = summarizeProductIdentityStats(afterReport);
  const beforeReasonSemantic = summarizeTerminalReasonSemantics(beforeReport);
  const afterReasonSemantic = summarizeTerminalReasonSemantics(afterReport);
  const beforeFocusRows = Array.isArray(beforeReport?.focusRows) ? beforeReport.focusRows : [];
  const afterFocusRows = Array.isArray(afterReport?.focusRows) ? afterReport.focusRows : [];

  const diff = {
    generatedAt: new Date().toISOString(),
    before: {
      path: beforePath,
      reportGeneratedAt: beforeReport?.generatedAt ?? null,
    },
    after: {
      path: afterPath,
      reportGeneratedAt: afterReport?.generatedAt ?? null,
    },
    terminalDelta: diffMap(beforeReport?.terminalBreakdown ?? {}, afterReport?.terminalBreakdown ?? {}),
    terminalReasonDelta: {
      before: beforeTerminalReason,
      after: afterTerminalReason,
      delta: {
        terminalReasonNullCount:
          afterTerminalReason.terminalReasonNullCount - beforeTerminalReason.terminalReasonNullCount,
        terminalReasonUnknownCount:
          afterTerminalReason.terminalReasonUnknownCount - beforeTerminalReason.terminalReasonUnknownCount,
        terminalReasonNullLikeCount:
          afterTerminalReason.terminalReasonNullLikeCount - beforeTerminalReason.terminalReasonNullLikeCount,
        terminalReasonNullLikeRate:
          beforeTerminalReason.terminalReasonNullLikeRate == null || afterTerminalReason.terminalReasonNullLikeRate == null
            ? null
            : Number(
                (
                  afterTerminalReason.terminalReasonNullLikeRate -
                  beforeTerminalReason.terminalReasonNullLikeRate
                ).toFixed(4),
              ),
      },
    },
    stage0WinnerDelta: diffMap(beforeReport?.stage0WinnerCounts ?? {}, afterReport?.stage0WinnerCounts ?? {}),
    degradedModeDelta: diffMap(beforeReport?.degradedModeCounts ?? {}, afterReport?.degradedModeCounts ?? {}),
    focusDelta: buildFocusDelta(beforeFocusRows, afterFocusRows),
    productIdentityDelta: {
      before: beforeProductIdentity,
      after: afterProductIdentity,
      delta: {
        presentCount: afterProductIdentity.presentCount - beforeProductIdentity.presentCount,
        presentRate: Number((afterProductIdentity.presentRate - beforeProductIdentity.presentRate).toFixed(4)),
        namePresentCount: afterProductIdentity.namePresentCount - beforeProductIdentity.namePresentCount,
        namePresentRate: Number((afterProductIdentity.namePresentRate - beforeProductIdentity.namePresentRate).toFixed(4)),
        trustedStableCount: afterProductIdentity.trustedStableCount - beforeProductIdentity.trustedStableCount,
        trustedStableRate: Number((afterProductIdentity.trustedStableRate - beforeProductIdentity.trustedStableRate).toFixed(4)),
        verifiedRegulatoryStableCount:
          afterProductIdentity.verifiedRegulatoryStableCount - beforeProductIdentity.verifiedRegulatoryStableCount,
        verifiedRegulatoryStableRate: Number(
          (
            afterProductIdentity.verifiedRegulatoryStableRate -
            beforeProductIdentity.verifiedRegulatoryStableRate
          ).toFixed(4),
        ),
      },
      sourceAttributionDelta: diffMap(
        beforeProductIdentity.sourceAttributionCounts ?? {},
        afterProductIdentity.sourceAttributionCounts ?? {},
      ),
      identityStableDelta: diffMap(
        beforeProductIdentity.identityStableCounts ?? {},
        afterProductIdentity.identityStableCounts ?? {},
      ),
    },
    terminalReasonSemanticDelta: {
      bundleOnlyNoAuthoritativeMatch: {
        before: beforeReasonSemantic.bundleOnlyNoAuthoritativeMatch,
        after: afterReasonSemantic.bundleOnlyNoAuthoritativeMatch,
        delta:
          afterReasonSemantic.bundleOnlyNoAuthoritativeMatch -
          beforeReasonSemantic.bundleOnlyNoAuthoritativeMatch,
      },
      degradedWebBudget: {
        before: beforeReasonSemantic.degradedWebBudget,
        after: afterReasonSemantic.degradedWebBudget,
        delta: afterReasonSemantic.degradedWebBudget - beforeReasonSemantic.degradedWebBudget,
      },
      degradedEventloop: {
        before: beforeReasonSemantic.degradedEventloop,
        after: afterReasonSemantic.degradedEventloop,
        delta: afterReasonSemantic.degradedEventloop - beforeReasonSemantic.degradedEventloop,
      },
      doneOk: {
        before: beforeReasonSemantic.doneOk,
        after: afterReasonSemantic.doneOk,
        delta: afterReasonSemantic.doneOk - beforeReasonSemantic.doneOk,
      },
      contractMismatchCount: {
        before: beforeReasonSemantic.contractMismatchCount,
        after: afterReasonSemantic.contractMismatchCount,
        delta:
          afterReasonSemantic.contractMismatchCount -
          beforeReasonSemantic.contractMismatchCount,
      },
    },
    verdictDelta: {
      beforePass: Boolean(beforeReport?.verdict?.pass),
      afterPass: Boolean(afterReport?.verdict?.pass),
      changed: Boolean(beforeReport?.verdict?.pass) !== Boolean(afterReport?.verdict?.pass),
      reasonsAdded: (afterReport?.verdict?.reasons ?? []).filter(
        (item) => !(beforeReport?.verdict?.reasons ?? []).includes(item),
      ),
      reasonsRemoved: (beforeReport?.verdict?.reasons ?? []).filter(
        (item) => !(afterReport?.verdict?.reasons ?? []).includes(item),
      ),
      warningsAdded: (afterReport?.verdict?.warnings ?? []).filter(
        (item) => !(beforeReport?.verdict?.warnings ?? []).includes(item),
      ),
      warningsRemoved: (beforeReport?.verdict?.warnings ?? []).filter(
        (item) => !(afterReport?.verdict?.warnings ?? []).includes(item),
      ),
    },
  };

  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(outJsonPath, JSON.stringify(diff, null, 2), "utf8");
  await fs.writeFile(outMdPath, toMarkdown(diff), "utf8");
  console.log(`[gate-report-diff] wrote ${outJsonPath}`);
  console.log(`[gate-report-diff] wrote ${outMdPath}`);
};

main().catch((error) => {
  console.error("[gate-report-diff] failed", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
