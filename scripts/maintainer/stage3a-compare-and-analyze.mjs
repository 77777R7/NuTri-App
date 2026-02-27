#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs";
import path from "node:path";

const ROOT_DIR = process.cwd();
const STAGE3A_NO_TERMINAL_MODE_RAW = "raw";
const STAGE3A_NO_TERMINAL_MODE_PROBE = "probe";
const STAGE3A_NO_TERMINAL_MODE = (() => {
  const mode = String(process.env.STAGE3A_NO_TERMINAL_MODE || STAGE3A_NO_TERMINAL_MODE_RAW)
    .trim()
    .toLowerCase();
  return mode === STAGE3A_NO_TERMINAL_MODE_PROBE
    ? STAGE3A_NO_TERMINAL_MODE_PROBE
    : STAGE3A_NO_TERMINAL_MODE_RAW;
})();
const STAGE3A_NO_TERMINAL_MIGRATION_HEALTHY_ROUNDS = Number(
  process.env.STAGE3A_NO_TERMINAL_MIGRATION_HEALTHY_ROUNDS || 2,
);

const parseArgs = (argv) => {
  const args = {
    baseline: null,
    after: null,
    expanded: null,
    expandedResults: null,
    outDir: path.join(ROOT_DIR, "output", `stage3a-analysis-${Date.now()}`),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const next = argv[i + 1];
    if (token === "--baseline" && next) {
      args.baseline = next;
      i += 1;
    } else if (token === "--after" && next) {
      args.after = next;
      i += 1;
    } else if (token === "--expanded" && next) {
      args.expanded = next;
      i += 1;
    } else if (token === "--expanded-results" && next) {
      args.expandedResults = next;
      i += 1;
    } else if (token === "--out-dir" && next) {
      args.outDir = next;
      i += 1;
    }
  }
  return args;
};

const mustPath = (value, name) => {
  if (!value) throw new Error(`Missing required argument: --${name}`);
  return path.isAbsolute(value) ? value : path.join(ROOT_DIR, value);
};

const readJson = async (filePath) => JSON.parse(await fs.promises.readFile(filePath, "utf8"));

const percentile = (values, p) => {
  const nums = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const idx = Math.min(nums.length - 1, Math.max(0, Math.ceil((p / 100) * nums.length) - 1));
  return nums[idx];
};

const countBy = (rows, keyFn) => {
  const out = {};
  for (const row of rows) {
    const key = keyFn(row);
    if (!key) continue;
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
};

const pickString = (...values) => {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
};

const resolveRawTerminalCode = (row) => pickString(row?.terminalCode, row?.sse?.terminalCode);

const resolveDerivedTerminalCode = (row) =>
  pickString(row?.derivedTerminalCode, row?.sse?.derivedTerminalCode, resolveRawTerminalCode(row));

const pickNoTerminalCount = (rawNoTerminalCount, probeNoTerminalCount) =>
  STAGE3A_NO_TERMINAL_MODE === STAGE3A_NO_TERMINAL_MODE_PROBE
    ? probeNoTerminalCount
    : rawNoTerminalCount;

const toTop = (map, topN = 8) =>
  Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([key, count]) => ({ key, count }));

const summarizeBulk = (rows) => {
  const valid = rows.filter((row) => row && !row.error);
  const authoritativeHits = valid.filter((row) => row.sourceType === "lnhpd" || row.sourceType === "dsld").length;
  const webHits = valid.filter((row) => row.sourceType === "web").length;
  const unknownHits = valid.filter((row) => !["lnhpd", "dsld", "web"].includes(String(row.sourceType))).length;
  const rawNoTerminalCount = valid.filter((row) => !resolveRawTerminalCode(row)).length;
  const probeNoTerminalCount = valid.filter((row) => !resolveDerivedTerminalCode(row)).length;
  const noTerminalCount = pickNoTerminalCount(rawNoTerminalCount, probeNoTerminalCount);
  const timeouts = valid.filter((row) => resolveRawTerminalCode(row) === "STREAM_TIMEOUT").length;
  const busy = valid.filter((row) => resolveRawTerminalCode(row) === "STREAM_BUSY").length;
  const revision1Values = valid.map((row) => Number(row.revision1Ms)).filter((v) => Number.isFinite(v));

  return {
    total: rows.length,
    valid: valid.length,
    authoritativeHits,
    authoritativeHitRate: valid.length > 0 ? authoritativeHits / valid.length : 0,
    webHits,
    webRate: valid.length > 0 ? webHits / valid.length : 0,
    unknownHits,
    unknownRate: valid.length > 0 ? unknownHits / valid.length : 0,
    noTerminalCount,
    noTerminalCountSemantics: STAGE3A_NO_TERMINAL_MODE,
    rawNoTerminalCount,
    probeNoTerminalCount,
    noTerminalCountProbe: probeNoTerminalCount,
    timeoutCount: timeouts,
    streamBusyCount: busy,
    rev1P50Ms: percentile(revision1Values, 50),
    rev1P95Ms: percentile(revision1Values, 95),
    fallbackReasonTop: toTop(countBy(valid, (row) => row.fallbackReason || null)),
    authorityFailureReasonTop: toTop(countBy(valid, (row) => row.authorityFailureReason || null)),
    terminalCodeTop: toTop(countBy(valid, (row) => resolveRawTerminalCode(row) || null)),
    derivedTerminalCodeTop: toTop(countBy(valid, (row) => resolveDerivedTerminalCode(row) || null)),
  };
};

const summarizeExpanded = (rows) => {
  const total = rows.length;
  const sourceKnown = rows.filter((row) => ["lnhpd", "dsld", "web"].includes(String(row?.sse?.sourceType))).length;
  const unknownSource = total - sourceKnown;
  const authorityFailureReasonFieldPresentCount = rows.filter(
    (row) => row?.sse && Object.prototype.hasOwnProperty.call(row.sse, "authorityFailureReason"),
  ).length;
  const fallbackReasonFieldPresentCount = rows.filter(
    (row) => row?.sse && Object.prototype.hasOwnProperty.call(row.sse, "fallbackReason"),
  ).length;
  const terminalCodeFieldPresentCount = rows.filter(
    (row) => row?.sse && Object.prototype.hasOwnProperty.call(row.sse, "terminalCode"),
  ).length;

  const withExpected = rows.filter((row) => typeof row?.input?.expectedSourceType === "string");
  const expectedMatched = withExpected.filter(
    (row) => row?.sse?.sourceType === row?.input?.expectedSourceType,
  ).length;

  const expectedAuthority = withExpected.filter(
    (row) => row?.input?.expectedSourceType === "lnhpd" || row?.input?.expectedSourceType === "dsld",
  );
  const expectedAuthorityMatched = expectedAuthority.filter(
    (row) => row?.sse?.sourceType === row?.input?.expectedSourceType,
  ).length;

  const rawNoTerminalCount = rows.filter(
    (row) => !row?.sse?.terminalCode && !row?.sse?.doneSeen && !row?.sse?.terminalErrorType,
  ).length;
  const probeNoTerminalCount = rows.filter(
    (row) => !resolveDerivedTerminalCode(row) && !row?.sse?.doneSeen && !row?.sse?.terminalErrorType,
  ).length;
  const noTerminalCount = pickNoTerminalCount(rawNoTerminalCount, probeNoTerminalCount);
  const revision1Values = rows
    .map((row) => Number(row?.sse?.revision1Ms))
    .filter((value) => Number.isFinite(value));

  return {
    total,
    expectedTotal: withExpected.length,
    expectedMatched,
    expectedMatchRate: withExpected.length > 0 ? expectedMatched / withExpected.length : 0,
    expectedAuthorityTotal: expectedAuthority.length,
    expectedAuthorityMatched,
    expectedAuthorityMatchRate:
      expectedAuthority.length > 0 ? expectedAuthorityMatched / expectedAuthority.length : 0,
    unknownSourceCount: unknownSource,
    unknownSourceRate: total > 0 ? unknownSource / total : 0,
    noTerminalCount,
    noTerminalCountSemantics: STAGE3A_NO_TERMINAL_MODE,
    rawNoTerminalCount,
    probeNoTerminalCount,
    noTerminalCountProbe: probeNoTerminalCount,
    authorityFailureReasonFieldPresentCount,
    fallbackReasonFieldPresentCount,
    terminalCodeFieldPresentCount,
    rev1P50Ms: percentile(revision1Values, 50),
    rev1P95Ms: percentile(revision1Values, 95),
    sourceTypeTop: toTop(countBy(rows, (row) => row?.sse?.sourceType || null)),
    terminalCodeTop: toTop(
      countBy(rows, (row) => row?.sse?.terminalCode || (row?.sse?.doneSeen ? "DONE" : null)),
    ),
    derivedTerminalCodeTop: toTop(
      countBy(rows, (row) => resolveDerivedTerminalCode(row) || (row?.sse?.doneSeen ? "DONE" : null)),
    ),
    errorReasonCodeTop: toTop(countBy(rows, (row) => row?.sse?.errorReasonCode || null)),
    fallbackReasonTop: toTop(
      countBy(rows, (row) => row?.sse?.fallbackReason || row?.sse?.fallback?.code || null),
    ),
    authorityFailureReasonTop: toTop(
      countBy(
        rows,
        (row) =>
          row?.sse?.authorityFailureReason ||
          row?.sse?.authority_failure_reason ||
          null,
      ),
    ),
    errorTop: toTop(
      countBy(rows.flatMap((row) => (Array.isArray(row?.errors) ? row.errors : [])), (value) => value || null),
    ),
  };
};

const toPct = (value) => `${(Number(value ?? 0) * 100).toFixed(1)}%`;

const buildOptimizations = ({ baseline, after, expanded }) => {
  const points = [];
  const topAuthorityFailure = expanded.authorityFailureReasonTop[0];
  const topFallback = expanded.fallbackReasonTop[0];
  const rev1P95 = expanded.rev1P95Ms ?? after.rev1P95Ms ?? null;
  if (after.authoritativeHitRate < 1) {
    points.push({
      priority: "P0",
      reasonCode: "authority_hit_gap",
      impact: `权威命中率 ${toPct(after.authoritativeHitRate)}，目标 100%`,
      rootCause: "权威候选在部分样本仍被 web 回退路径吞掉。",
      evidence: `after authoritativeHits=${after.authoritativeHits}/${after.valid}, webHits=${after.webHits}`,
      fix: "/Users/howard07/NuTriApp/nutri-app/backend/src/server.ts：在 Stage0 map/snapshot 候选失败后增加 strict authority retry window，done 前禁止 web 覆盖。",
      benefit: "提高 authoritative 命中率并减少用户看到 web 低质量结果。",
    });
  } else {
    points.push({
      priority: "P0",
      reasonCode: "web_expectation_mismatch",
      impact: `扩展集 expectedSourceType match=${toPct(expanded.expectedMatchRate)}（目标 >=94%）`,
      rootCause: "web 样本在当前链路被提升到 lnhpd/dsld，导致“预期 web”与实际不一致。",
      evidence: `expanded sourceTypeTop=${JSON.stringify(expanded.sourceTypeTop.slice(0, 3))}`,
      fix: "/Users/howard07/NuTriApp/nutri-app/scripts/maintainer/build-stage3a-fixed50-fixture.mjs：筛选 web 样本时增加“近3次均为web”稳定性约束。",
      benefit: "扩展集评估口径稳定，避免样本标签噪声干扰结论。",
    });
  }
  points.push({
    priority: "P0",
    reasonCode: "unknown_or_no_terminal",
    impact: `unknownSource=${expanded.unknownSourceCount}, noTerminal=${expanded.noTerminalCount}`,
    rootCause: "终态/来源标记在部分异常链路没有稳定落盘。",
    evidence: `expanded unknownRate=${toPct(expanded.unknownSourceRate)}`,
    fix: "/Users/howard07/NuTriApp/nutri-app/backend/src/server.ts：统一 sourceTypeFinal 与 terminal telemetry 在 finalize 前写入。",
    benefit: "避免用户可见“有流程无结论”的体感。",
  });
  if (topAuthorityFailure) {
    points.push({
      priority: "P1",
      reasonCode: topAuthorityFailure.key,
      impact: `authorityFailure hotspot: ${topAuthorityFailure.key} (${topAuthorityFailure.count})`,
      rootCause: "LNHPD 查询超时/查询失败在高峰期放大。",
      evidence: `top authorityFailureReason = ${JSON.stringify(expanded.authorityFailureReasonTop.slice(0, 3))}`,
      fix: "/Users/howard07/NuTriApp/nutri-app/backend/src/server.ts：按 reasonCode 对 second-chance timeout 做分段配置（CA/US）+ 观测告警。",
      benefit: "降低 lnhpd_timeout_first/second 噪声并提升稳定性。",
    });
  } else if (expanded.authorityFailureReasonFieldPresentCount === 0) {
    points.push({
      priority: "P1",
      reasonCode: "authority_reason_observability_gap",
      impact: "authorityFailureReason TopN 为空，无法定位二次机会失败热点。",
      rootCause: "诊断字段未透传到扩展 E2E 产物。",
      evidence: `authorityFailureReasonTop=${JSON.stringify(expanded.authorityFailureReasonTop)}`,
      fix: "/Users/howard07/NuTriApp/nutri-app/scripts/maintainer/website-barcode-e2e.mjs：追加 authorityFailureReason/fallbackReason 抽取与汇总。",
      benefit: "让阶段3B优化基于可归因数据而不是人工日志。",
    });
  } else {
    points.push({
      priority: "P2",
      reasonCode: "authority_reason_not_triggered",
      impact: "authorityFailureReason 字段已透传，但本轮样本未触发非空原因码。",
      rootCause: "当前 fixed50 样本以稳定命中和单一 web fallback 为主，未覆盖 authority 失败分支。",
      evidence: `authorityFailureReasonFieldPresent=${expanded.authorityFailureReasonFieldPresentCount}/${expanded.total}, top=${JSON.stringify(expanded.authorityFailureReasonTop)}`,
      fix: "/Users/howard07/NuTriApp/nutri-app/scripts/maintainer/fixtures/stage3a_fixed50.json：在下一轮加入可控 authority-fail 样本（如 LNHPD second-chance timeout/not_found）。",
      benefit: "让 Stage3B 能直接量化 authorityFailureReason 热点，而不是空样本。",
    });
  }
  if (topFallback) {
    points.push({
      priority: "P1",
      reasonCode: topFallback.key,
      impact: `fallback hotspot: ${topFallback.key} (${topFallback.count})`,
      rootCause: "web 证据链可提取性不足，导致 fallback 原因集中。",
      evidence: `top fallbackReason = ${JSON.stringify(expanded.fallbackReasonTop.slice(0, 3))}`,
      fix: "/Users/howard07/NuTriApp/nutri-app/backend/src/webIdentityProviders.ts 与 /Users/howard07/NuTriApp/nutri-app/backend/src/webEvidenceGate.ts：增强 authoritative domain 预筛和 needs_js 处理策略。",
      benefit: "减少空内容 fallback，提高阶段3B的真实可读性。",
    });
  } else {
    points.push({
      priority: "P1",
      reasonCode: "fallback_reason_observability_gap",
      impact: "fallbackReason TopN 为空，无法区分 watchdog/证据门槛/ownership 问题。",
      rootCause: "fallbackReason 未落入扩展测试汇总。",
      evidence: `fallbackReasonTop=${JSON.stringify(expanded.fallbackReasonTop)}`,
      fix: "/Users/howard07/NuTriApp/nutri-app/scripts/maintainer/website-barcode-e2e.mjs：在 row.sse 里输出 fallbackReason 并写入 summary。",
      benefit: "能快速锁定 web 质量问题的主导原因。",
    });
  }
  points.push({
    priority: "P2",
    reasonCode: "latency_p95",
    impact: `rev1 p95=${rev1P95 ?? "n/a"}ms`,
    rootCause: "深链路抓取 + LLM 聚合在尾延迟样本上叠加。",
    evidence: `baseline rev1P95=${baseline.rev1P95Ms ?? "n/a"}ms -> after rev1P95=${after.rev1P95Ms ?? "n/a"}ms`,
    fix: "/Users/howard07/NuTriApp/nutri-app/scripts/maintainer/website-barcode-e2e.mjs 与 /Users/howard07/NuTriApp/nutri-app/backend/src/server.ts：按域名分层 timeout/budget。",
    benefit: "收窄 p95，改善弱网与高并发体验。",
  });

  return points;
};

const buildMarkdown = ({ baselinePath, afterPath, expandedPath, expandedResultsPath, baseline, after, expanded, delta, optimizations }) => {
  const lines = [];
  lines.push("# Stage3A Compare & Analyze");
  lines.push("");
  lines.push("## Inputs");
  lines.push(`- baseline: ${baselinePath}`);
  lines.push(`- after: ${afterPath}`);
  lines.push(`- expanded summary: ${expandedPath}`);
  lines.push(`- expanded results: ${expandedResultsPath}`);
  lines.push("");
  lines.push("## Key Metrics");
  lines.push("| metric | baseline | after | delta |");
  lines.push("|---|---:|---:|---:|");
  lines.push(`| authoritative_hit_rate | ${toPct(baseline.authoritativeHitRate)} | ${toPct(after.authoritativeHitRate)} | ${toPct(delta.authoritativeHitRate)} |`);
  lines.push(`| web_rate | ${toPct(baseline.webRate)} | ${toPct(after.webRate)} | ${toPct(delta.webRate)} |`);
  lines.push(`| rev1_p50_ms | ${baseline.rev1P50Ms ?? "n/a"} | ${after.rev1P50Ms ?? "n/a"} | ${delta.rev1P50Ms ?? "n/a"} |`);
  lines.push(`| rev1_p95_ms | ${baseline.rev1P95Ms ?? "n/a"} | ${after.rev1P95Ms ?? "n/a"} | ${delta.rev1P95Ms ?? "n/a"} |`);
  lines.push(`| timeout_count | ${baseline.timeoutCount} | ${after.timeoutCount} | ${delta.timeoutCount} |`);
  lines.push(`| no_terminal_count (${after.noTerminalCountSemantics}) | ${baseline.noTerminalCount} | ${after.noTerminalCount} | ${delta.noTerminalCount} |`);
  lines.push(`| raw_no_terminal_count | ${baseline.rawNoTerminalCount} | ${after.rawNoTerminalCount} | ${delta.rawNoTerminalCount} |`);
  lines.push(`| probe_no_terminal_count | ${baseline.probeNoTerminalCount} | ${after.probeNoTerminalCount} | ${delta.probeNoTerminalCount} |`);
  lines.push("");
  lines.push("## Expanded 50");
  lines.push(`- expectedSourceType match: ${expanded.expectedMatched}/${expanded.expectedTotal} (${toPct(expanded.expectedMatchRate)})`);
  lines.push(
    `- authority subset match: ${expanded.expectedAuthorityMatched}/${expanded.expectedAuthorityTotal} (${toPct(expanded.expectedAuthorityMatchRate)})`,
  );
  lines.push(`- unknown source ratio: ${toPct(expanded.unknownSourceRate)} (${expanded.unknownSourceCount}/${expanded.total})`);
  lines.push(`- no terminal count (${expanded.noTerminalCountSemantics}): ${expanded.noTerminalCount}`);
  lines.push(`- raw no terminal count: ${expanded.rawNoTerminalCount}`);
  lines.push(`- probe no terminal count: ${expanded.probeNoTerminalCount}`);
  lines.push(`- migration window default (healthy rounds): ${STAGE3A_NO_TERMINAL_MIGRATION_HEALTHY_ROUNDS}`);
  lines.push(
    `- diagnostics field presence: terminalCode=${expanded.terminalCodeFieldPresentCount}/${expanded.total}, fallbackReason=${expanded.fallbackReasonFieldPresentCount}/${expanded.total}, authorityFailureReason=${expanded.authorityFailureReasonFieldPresentCount}/${expanded.total}`,
  );
  lines.push(`- rev1 latency: p50=${expanded.rev1P50Ms ?? "n/a"}ms, p95=${expanded.rev1P95Ms ?? "n/a"}ms`);
  lines.push("");
  lines.push("## Failure Hotspots");
  lines.push(`- authorityFailureReason top: ${JSON.stringify(expanded.authorityFailureReasonTop.slice(0, 5))}`);
  lines.push(`- fallbackReason top: ${JSON.stringify(expanded.fallbackReasonTop.slice(0, 5))}`);
  lines.push(`- terminalCode top: ${JSON.stringify(expanded.terminalCodeTop.slice(0, 5))}`);
  lines.push(`- derivedTerminalCode top: ${JSON.stringify(expanded.derivedTerminalCodeTop.slice(0, 5))}`);
  lines.push(`- errorReasonCode top: ${JSON.stringify(expanded.errorReasonCodeTop.slice(0, 5))}`);
  lines.push(`- terminalCode top(after): ${JSON.stringify(after.terminalCodeTop.slice(0, 5))}`);
  lines.push(`- derivedTerminalCode top(after): ${JSON.stringify(after.derivedTerminalCodeTop.slice(0, 5))}`);
  lines.push("");
  lines.push("## Optimization Candidates");
  for (const item of optimizations) {
    lines.push(`### ${item.priority} ${item.reasonCode}`);
    lines.push(`1. 问题：${item.impact}`);
    lines.push(`2. 根因假设：${item.rootCause}`);
    lines.push(`3. 证据：${item.evidence}`);
    lines.push(`4. 修复建议：${item.fix}`);
    lines.push(`5. 预期收益：${item.benefit}`);
    lines.push("");
  }

  return lines.join("\n");
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const baselinePath = mustPath(args.baseline, "baseline");
  const afterPath = mustPath(args.after, "after");
  const expandedPath = mustPath(args.expanded, "expanded");
  const expandedResultsPath = mustPath(args.expandedResults, "expanded-results");
  const outDir = path.isAbsolute(args.outDir) ? args.outDir : path.join(ROOT_DIR, args.outDir);

  const [baselineRows, afterRows, expandedSummaryRaw, expandedRows] = await Promise.all([
    readJson(baselinePath),
    readJson(afterPath),
    readJson(expandedPath),
    readJson(expandedResultsPath),
  ]);

  if (!Array.isArray(baselineRows) || !Array.isArray(afterRows) || !Array.isArray(expandedRows)) {
    throw new Error("baseline/after/expanded-results must be JSON arrays");
  }
  if (!expandedSummaryRaw || typeof expandedSummaryRaw !== "object") {
    throw new Error("expanded summary must be a JSON object");
  }

  const baseline = summarizeBulk(baselineRows);
  const after = summarizeBulk(afterRows);
  const expanded = summarizeExpanded(expandedRows);
  const delta = {
    authoritativeHitRate: after.authoritativeHitRate - baseline.authoritativeHitRate,
    webRate: after.webRate - baseline.webRate,
    rev1P50Ms:
      Number.isFinite(after.rev1P50Ms) && Number.isFinite(baseline.rev1P50Ms)
        ? after.rev1P50Ms - baseline.rev1P50Ms
        : null,
    rev1P95Ms:
      Number.isFinite(after.rev1P95Ms) && Number.isFinite(baseline.rev1P95Ms)
        ? after.rev1P95Ms - baseline.rev1P95Ms
        : null,
    timeoutCount: after.timeoutCount - baseline.timeoutCount,
    noTerminalCount: after.noTerminalCount - baseline.noTerminalCount,
    rawNoTerminalCount: after.rawNoTerminalCount - baseline.rawNoTerminalCount,
    probeNoTerminalCount: after.probeNoTerminalCount - baseline.probeNoTerminalCount,
  };

  const optimizations = buildOptimizations({ baseline, after, expanded });

  const deltaJson = {
    baseline,
    after,
    expanded,
    delta,
    expandedSummaryRaw,
    generatedAt: new Date().toISOString(),
  };

  await fs.promises.mkdir(outDir, { recursive: true });
  const deltaPath = path.join(outDir, "stage3a_delta.json");
  const mdPath = path.join(outDir, "stage3a_analysis.md");
  await fs.promises.writeFile(deltaPath, JSON.stringify(deltaJson, null, 2), "utf8");
  await fs.promises.writeFile(
    mdPath,
    buildMarkdown({
      baselinePath,
      afterPath,
      expandedPath,
      expandedResultsPath,
      baseline,
      after,
      expanded,
      delta,
      optimizations,
    }),
    "utf8",
  );

  console.log(`[stage3a-analysis] wrote ${deltaPath}`);
  console.log(`[stage3a-analysis] wrote ${mdPath}`);
};

main().catch((error) => {
  console.error("[stage3a-analysis] failed:", error);
  process.exit(1);
});
