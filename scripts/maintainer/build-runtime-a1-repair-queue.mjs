#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const getArg = (flag) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const requireArg = (flag) => {
  const value = getArg(flag);
  if (!value) {
    console.error(`[build-runtime-a1-repair-queue] missing --${flag}`);
    process.exit(1);
  }
  return value;
};
const hasFlag = (flag) => args.includes(`--${flag}`);

const normalizeNpn = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  return /^\d{8}$/.test(digits) ? digits : null;
};

const safeNum = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));
const readJsonl = (filePath) => {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf8").trim();
  if (!raw) return [];
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
};

const toMapByNpn = (rows) => {
  const map = new Map();
  for (const row of rows ?? []) {
    const npn = normalizeNpn(row?.npn);
    if (!npn) continue;
    if (!map.has(npn)) map.set(npn, []);
    map.get(npn).push(row);
  }
  return map;
};

const classifyPriority = ({ reason, existingRank, incomingRank, isTopMissBrand, timeoutHitCount, isHighScanNoFinal, hitCount, rankGapFallback }) => {
  const parsedExisting = safeNum(existingRank, null);
  const parsedIncoming = safeNum(incomingRank, null);
  const existingNum = parsedExisting === null ? null : Number(parsedExisting);
  const incomingNum = parsedIncoming === null ? null : Number(parsedIncoming);

  if (reason === "lower_rank_prefilter") {
    if (
      (typeof existingNum === "number" && typeof incomingNum === "number" && existingNum >= 350 && incomingNum <= 200) ||
      isTopMissBrand ||
      timeoutHitCount > 0 ||
      isHighScanNoFinal
    ) {
      return { priority: "high", priorityScore: 95 };
    }
    if ((existingNum ?? 0) >= 300 && hitCount >= 20) {
      return { priority: "medium", priorityScore: 70 };
    }
  }

  if ((timeoutHitCount ?? 0) >= 2) {
    return { priority: "high", priorityScore: 85 };
  }

  if (rankGapFallback > 100) {
    return { priority: "medium", priorityScore: 65 };
  }

  return { priority: "low", priorityScore: 30 };
};

const buildExecutionTag = ({
  reason,
  priority,
  isTopMissBrand,
  timeoutHitCount,
  hitCount,
  isHighScanNoFinal,
  rankGapFallback,
  existingRank,
  incomingRank,
  allowLowerRankRelease,
}) => {
  // Stage2: 标记决策。release 只做“可低风险补跑”前提；
  // retain/ manual 用于暂不放行，先走人工或补齐流程
  if (reason === "precision_gate_failed") {
    return {
      executionTag: "manual",
      executionRationale: "precision_gate_failed 无法安全放行入库",
      executionAction: "manual_review",
      executionNote: "优先补齐证据后人工确认。",
    };
  }

  const existing = Number(existingRank ?? 0);
  const incoming = Number(incomingRank ?? 0);
  const isRankConservative = existing > 0 && incoming > 0 && incoming >= existing;
  const timeoutBoost = Number(timeoutHitCount ?? 0) >= 2 || isHighScanNoFinal;
  const topBrandBoost = Boolean(isTopMissBrand);
  const evidenceBoost = Number(hitCount ?? 0) >= 10 || Number(rankGapFallback ?? 0) <= 40;

  if (
    allowLowerRankRelease &&
    reason === "lower_rank_prefilter" &&
    (topBrandBoost || timeoutBoost || evidenceBoost || isRankConservative) &&
    priority === "high"
  ) {
    return {
      executionTag: "release",
      executionRationale: "高优先级且命中可放行条件，优先小范围重跑验证",
      executionAction: "release_to_a1",
      executionNote: "限制只走 A1 重跑，仍受写保护与 rank 门控。",
    };
  }

  if (
    (timeoutBoost || topBrandBoost || Number(hitCount ?? 0) >= 5) &&
    priority !== "low"
  ) {
    return {
      executionTag: "retain",
      executionRationale: "具备较多修复信号，先留给二次观察/复核",
      executionAction: "retain_for_review_cycle",
      executionNote: "建议先观察第二轮收益后再放行。",
    };
  }

  return {
    executionTag: "manual",
    executionRationale: "当前证据不满足自动重跑条件",
    executionAction: "manual_review",
    executionNote: "先标记人工处理。",
  };
};

const buildAction = ({ reason }) => {
  if (reason === "lower_rank_prefilter") {
    return {
      actionCode: "manual_rank_override_review",
      action: "人工确认低优先级映射",
      actionNotes:
        "现有映射 rank 更高，需核验 runtime_signal 证据是否足够后再决定是否放宽入库或保留现有高优先级映射。",
    };
  }
  if (reason === "precision_gate_failed") {
    return {
      actionCode: "precision_review_required",
      action: "精度复核",
      actionNotes: "冲突/证据质量不达标，先补齐证据后再提审。",
    };
  }
  return {
    actionCode: "manual_followup",
    action: "待定",
    actionNotes: "请按阻断详情补齐来源与证据后决策。",
  };
};

const ensureDir = (dirPath) => fs.mkdirSync(dirPath, { recursive: true });
const writeJson = (filePath, payload) => {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};
const writeJsonl = (filePath, rows) => {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(
    filePath,
    rows.length ? `${rows.map((row) => JSON.stringify(row)).join("\n")}\n` : "",
    "utf8",
  );
};

const main = async () => {
  const a1ImportRowsPath = requireArg("a1-import-rows");
  const a0TieredQueuePath = getArg("a0-tiered-queue");
  const outDir = path.resolve(
    process.cwd(),
    getArg("out-dir") || `output/npn_webhunt/runtime_signal_pipeline/${new Date().toISOString().replace(/[:.]/g, "-")}-a1-repair`,
  );
  const allowLowerRankRelease = hasFlag("allow-lower-rank-release");

  const a1ImportRows = readJson(a1ImportRowsPath);
  const blockedRows = Array.isArray(a1ImportRows)
    ? a1ImportRows.filter((row) => String(row?.status ?? "").toLowerCase() === "blocked")
    : [];

  const byNpn = a0TieredQueuePath && fs.existsSync(a0TieredQueuePath)
    ? toMapByNpn(readJson(a0TieredQueuePath))
    : new Map();

  const reasonDistribution = new Map();
  const priorityDistribution = new Map();
  const actionDistribution = new Map();

  const queueRows = blockedRows
    .map((row) => {
      const npn = normalizeNpn(row.npn);
      const brandRows = npn ? byNpn.get(npn) : [];
      const best = Array.isArray(brandRows) && brandRows.length > 0 ? brandRows[0] : {};
      const timeoutHitCount = safeNum(best.timeoutHitCount, 0);
      const isTopMissBrand = Boolean(best.isTopMissBrand);
      const isHighScanNoFinal = Boolean(best.isHighScanNoFinal);
      const hitCount = safeNum(best.hitCount, 0);
      const reason = String(row.reason ?? "unknown");
      const existingRank = row.existingRank == null ? null : safeNum(row.existingRank, null);
      const incomingRank = row.incomingRank == null ? null : safeNum(row.incomingRank, null);
      const rankGapFallback =
        existingRank != null && incomingRank != null ? Math.abs(safeNum(existingRank, 0) - safeNum(incomingRank, 0)) : 0;

      const { priority, priorityScore } = classifyPriority({
        reason,
        existingRank,
        incomingRank,
        isTopMissBrand,
        timeoutHitCount,
        isHighScanNoFinal,
        hitCount,
        rankGapFallback,
      });

      const action = buildAction({ reason });
      const execution = buildExecutionTag({
        reason,
        priority,
        isTopMissBrand,
        timeoutHitCount,
        hitCount,
        isHighScanNoFinal,
        rankGapFallback,
        existingRank,
        incomingRank,
        allowLowerRankRelease,
      });

      reasonDistribution.set(reason, (reasonDistribution.get(reason) || 0) + 1);
      priorityDistribution.set(priority, (priorityDistribution.get(priority) || 0) + 1);
      actionDistribution.set(action.actionCode, (actionDistribution.get(action.actionCode) || 0) + 1);
      // execution tag统计
      // eslint-disable-next-line no-unused-vars
      // 结构化输出中会补齐该分发

      return {
        queueIndex: 0,
        source: "a1_blocked",
        npn: npn,
        brandName: best.brandName ?? null,
        productName: best.productName ?? null,
        twoHopHint: best.twoHopHint ?? null,
        reason,
        status: "blocked_pending_repair",
        priority,
        priorityScore,
        actionCode: action.actionCode,
        action: action.action,
        actionNotes: action.actionNotes,
        executionTag: execution.executionTag,
        executionAction: execution.executionAction,
        executionRationale: execution.executionRationale,
        executionNote: execution.executionNote,
        timeoutHitCount,
        hitCount,
        isTopMissBrand,
        isHighScanNoFinal,
        existingRank,
        incomingRank,
        barcode_gtin14: row.barcode_gtin14,
        sourceTier: best.tier ?? null,
        sourceStrong: Boolean(best.sourceStrong),
        distinctUserCount: safeNum(best.distinctUserCount ?? best.distinctDeviceCount ?? best.distinctRequestCount, 0),
        rejectReason: best.rejectReason ?? null,
      };
    })
    .filter((row) => Boolean(row.npn));

  queueRows.sort((a, b) => {
    const pRank = { high: 0, medium: 1, low: 2 };
    if (pRank[a.priority] !== pRank[b.priority]) return pRank[a.priority] - pRank[b.priority];
    if (a.priorityScore !== b.priorityScore) return b.priorityScore - a.priorityScore;
    if ((a.hitCount || 0) !== (b.hitCount || 0)) return (b.hitCount || 0) - (a.hitCount || 0);
    if (a.isTopMissBrand !== b.isTopMissBrand) return a.isTopMissBrand ? -1 : 1;
    return String(a.npn).localeCompare(String(b.npn));
  });

  const dedup = new Map();
  for (const row of queueRows) {
    const key = `${row.npn}|${String(row.barcode_gtin14 ?? "").replace(/\D/g, "")}`;
    if (dedup.has(key)) continue;
    dedup.set(key, row);
  }
  const deduped = Array.from(dedup.values()).map((row, idx) => ({
    ...row,
    queueIndex: idx + 1,
  }));

  const dist = {
    reason: Array.from(reasonDistribution.entries()).map(([reason, count]) => ({ reason, count })),
    priority: Array.from(priorityDistribution.entries()).map(([priority, count]) => ({ priority, count })),
    action: Array.from(actionDistribution.entries()).map(([actionCode, count]) => ({ actionCode, count })),
  };
  const executionDistribution = { release: 0, retain: 0, manual: 0 };
  for (const row of deduped) {
    const tag = String(row.executionTag ?? "manual");
    executionDistribution[tag] = (executionDistribution[tag] || 0) + 1;
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    inputs: {
      a1ImportRowsPath,
      a0TieredQueuePath: a0TieredQueuePath ?? null,
      allowLowerRankRelease,
    },
    totals: {
      a1Blocked: blockedRows.length,
      repairQueue: deduped.length,
      withContext: deduped.filter((row) => row.brandName || row.productName || row.twoHopHint).length,
      highPriority: deduped.filter((row) => row.priority === "high").length,
      mediumPriority: deduped.filter((row) => row.priority === "medium").length,
      lowPriority: deduped.filter((row) => row.priority === "low").length,
      executionRelease: deduped.filter((row) => row.executionTag === "release").length,
      executionRetain: deduped.filter((row) => row.executionTag === "retain").length,
      executionManual: deduped.filter((row) => row.executionTag === "manual").length,
    },
    reasonDistribution: dist.reason
      .sort((a, b) => b.count - a.count)
      .map((item) => item),
    priorityDistribution: dist.priority
      .sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.priority] - { high: 0, medium: 1, low: 2 }[b.priority]))
      .map((item) => item),
    actionDistribution: dist.action,
    executionDistribution: [
      { tag: "release", count: executionDistribution.release },
      { tag: "retain", count: executionDistribution.retain },
      { tag: "manual", count: executionDistribution.manual },
    ],
  };

  const jsonPath = path.join(outDir, "runtime_a1_blocked_reason_distribution.json");
  const queueJsonPath = path.join(outDir, "runtime_a1_repair_queue.json");
  const queueJsonlPath = path.join(outDir, "runtime_a1_repair_queue.jsonl");
  const manifestJsonPath = path.join(outDir, "runtime_a1_repair_manifest.json");
  const manifestJsonlPath = path.join(outDir, "runtime_a1_repair_manifest.jsonl");
  const mdPath = path.join(outDir, "runtime_a1_repair_queue.md");

  writeJson(jsonPath, {
    ...summary,
    repairQueuePath: queueJsonPath,
    queueCount: deduped.length,
    manifestPath: manifestJsonPath,
    rows: [],
  });
  writeJson(manifestJsonPath, {
    generatedAt: summary.generatedAt,
    counts: {
      total: deduped.length,
      release: executionDistribution.release,
      retain: executionDistribution.retain,
      manual: executionDistribution.manual,
    },
    rows: deduped.map((row) => ({
      npn: row.npn,
      brandName: row.brandName ?? null,
      productName: row.productName ?? null,
      executionTag: row.executionTag,
      executionAction: row.executionAction,
      executionRationale: row.executionRationale,
      executionNote: row.executionNote,
      reason: row.reason,
      priority: row.priority,
      existingRank: row.existingRank,
      incomingRank: row.incomingRank,
      barcode_gtin14: row.barcode_gtin14,
      actionCode: row.actionCode,
      action: row.action,
    })),
  });
  writeJsonl(manifestJsonlPath, deduped.map((row) => ({
    npn: row.npn,
    brandName: row.brandName ?? null,
    productName: row.productName ?? null,
    twoHopHint: row.twoHopHint ?? null,
    executionTag: row.executionTag,
    executionAction: row.executionAction,
    executionRationale: row.executionRationale,
    executionNote: row.executionNote,
    reason: row.reason,
    priority: row.priority,
    existingRank: row.existingRank,
    incomingRank: row.incomingRank,
    barcode_gtin14: row.barcode_gtin14,
    timeoutHitCount: row.timeoutHitCount,
    hitCount: row.hitCount,
    isTopMissBrand: row.isTopMissBrand,
    isHighScanNoFinal: row.isHighScanNoFinal,
    sourceTier: row.sourceTier,
    sourceStrong: row.sourceStrong,
    distinctUserCount: row.distinctUserCount,
    actionCode: row.actionCode,
  })));

  const previewRows = deduped.slice(0, 200);
  writeJson(queueJsonPath, {
    generatedAt: summary.generatedAt,
    totals: summary.totals,
    distribution: {
      reason: summary.reasonDistribution,
      priority: summary.priorityDistribution,
      action: summary.actionDistribution,
    },
    rows: previewRows,
  });
  writeJsonl(queueJsonlPath, deduped);

  const md = [
    "# A1 Blocked Repair Queue",
    `- generatedAt: ${summary.generatedAt}`,
    `- a1Blocked: ${summary.totals.a1Blocked}`,
    `- repairQueue: ${summary.totals.repairQueue}`,
    `- withContext: ${summary.totals.withContext}`,
    `- priority: high=${summary.totals.highPriority}, medium=${summary.totals.mediumPriority}, low=${summary.totals.lowPriority}`,
    "",
    "## reasonDistribution",
    ...summary.reasonDistribution.map((row) => `- ${row.reason}: ${row.count}`),
    "",
    "## priorityDistribution",
    ...summary.priorityDistribution.map((row) => `- ${row.priority}: ${row.count}`),
    "",
    "## actionDistribution",
    ...summary.actionDistribution.map((row) => `- ${row.actionCode}: ${row.count}`),
    "",
    "## executionDistribution",
    ...summary.executionDistribution.map((row) => `- ${row.tag}: ${row.count}`),
    "",
    "## executionManifestTop",
    ...previewRows.slice(0, 20).map((row, idx) =>
      `- #${idx + 1} npn=${row.npn} executionTag=${row.executionTag} reason=${row.reason} priority=${row.priority} action=${row.action} note=${row.executionNote}`,
    ),
    "",
    "## topRepairItems",
    ...(previewRows.slice(0, 20).map((row, idx) =>
      `- #${idx + 1} npn=${row.npn} reason=${row.reason} priority=${row.priority} action=${row.action} hit=${row.hitCount} brand=${row.brandName ?? "-"}`,
    )),
  ].join("\n");
  ensureDir(path.dirname(mdPath));
  fs.writeFileSync(mdPath, `${md}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        outDir,
        blocked: summary.totals.a1Blocked,
        repairQueue: summary.totals.repairQueue,
        reasonDistribution: summary.reasonDistribution,
        priorityDistribution: summary.priorityDistribution,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error("[build-runtime-a1-repair-queue] fatal:", error?.message ?? error);
  process.exit(1);
});
