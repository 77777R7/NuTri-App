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
  node scripts/maintainer/analyze-00084783891253-concurrency.mjs [options]

Options:
  --input <path>              Repro JSON path
  --out-file <path>           Output markdown path
  --out-json <path>           Optional analysis JSON path
`);
  process.exit(0);
}

const latencyStats = (values) => {
  const list = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!list.length) return { count: 0, p50: null, p90: null, p95: null, max: null, avg: null };
  const pick = (q) => list[Math.floor((list.length - 1) * q)] ?? null;
  const avg = list.reduce((acc, value) => acc + value, 0) / list.length;
  return {
    count: list.length,
    p50: pick(0.5),
    p90: pick(0.9),
    p95: pick(0.95),
    max: list[list.length - 1] ?? null,
    avg: Number(avg.toFixed(1)),
  };
};

const findLatestInput = async () => {
  const baseDir = path.join(ROOT_DIR, "output", "maintainer-gates");
  const entries = await fs.readdir(baseDir, { withFileTypes: true }).catch(() => []);
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const filePath = path.join(baseDir, entry.name, "00084783891253_concurrency_repro.json");
    try {
      const stat = await fs.stat(filePath);
      candidates.push({ filePath, mtimeMs: stat.mtimeMs });
    } catch {
      // ignore
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0]?.filePath ?? null;
};

const summarizeRows = (rows) => {
  const terminalBreakdown = rows.reduce((acc, row) => {
    const key = row?.terminal ?? "NO_TERMINAL";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const doneCount = terminalBreakdown.DONE ?? 0;
  const notFoundCount = terminalBreakdown.NOT_FOUND ?? 0;
  const identityNullCount = rows.filter(
    (row) => !row?.requestContext?.authoritativeIdentity?.value,
  ).length;
  const sourceTypeNullCount = rows.filter((row) => !row?.requestContext?.sourceType).length;
  const sourceTypeFinalTrueCount = rows.filter((row) => row?.requestContext?.sourceTypeFinal === true).length;
  const sourceTypeFinalFalseCount = rows.filter((row) => row?.requestContext?.sourceTypeFinal === false).length;
  const authoritativeCandidateFoundCount = rows.filter(
    (row) => row?.requestContext?.authoritativeCandidateFound === true,
  ).length;
  const stage0WinnerCounts = rows.reduce((acc, row) => {
    const key =
      typeof row?.requestContext?.stage0Winner === "string" && row.requestContext.stage0Winner.trim()
        ? row.requestContext.stage0Winner.trim()
        : "UNKNOWN";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const terminalReasonCounts = rows.reduce((acc, row) => {
    const key =
      typeof row?.requestContext?.terminalReason === "string" && row.requestContext.terminalReason.trim()
        ? row.requestContext.terminalReason.trim()
        : "null";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  return {
    total: rows.length,
    terminalBreakdown,
    doneRate: rows.length ? Number((doneCount / rows.length).toFixed(3)) : 0,
    notFoundRate: rows.length ? Number((notFoundCount / rows.length).toFixed(3)) : 0,
    identityNullRate: rows.length ? Number((identityNullCount / rows.length).toFixed(3)) : 0,
    sourceTypeNullRate: rows.length ? Number((sourceTypeNullCount / rows.length).toFixed(3)) : 0,
    sourceTypeFinalTrueRate: rows.length ? Number((sourceTypeFinalTrueCount / rows.length).toFixed(3)) : 0,
    sourceTypeFinalFalseRate: rows.length ? Number((sourceTypeFinalFalseCount / rows.length).toFixed(3)) : 0,
    authoritativeCandidateFoundRate: rows.length
      ? Number((authoritativeCandidateFoundCount / rows.length).toFixed(3))
      : 0,
    stage0WinnerCounts,
    terminalReasonCounts,
    latency: {
      doneMs: latencyStats(rows.map((row) => row?.doneMs)),
      rev1Ms: latencyStats(rows.map((row) => row?.rev1Ms)),
    },
  };
};

const classifyRootCauses = (groupedRows, groupedStats, crossEvidence, falseFinalRows) => {
  const single = groupedStats.single20 ?? null;
  const p5 = groupedStats.parallel5 ?? null;
  const p9 = groupedStats.parallel9 ?? null;
  const findings = [];

  const parallelRows = [...(groupedRows.parallel5 ?? []), ...(groupedRows.parallel9 ?? [])];
  const parallelNotFoundRows = parallelRows.filter((row) => row.terminal === "NOT_FOUND");
  const singleNotFoundRate = single?.notFoundRate ?? 0;
  const parallelNotFoundRate = Number(
    (((p5?.notFoundRate ?? 0) + (p9?.notFoundRate ?? 0)) / 2).toFixed(3),
  );
  const parallelIdentityNullRate = Number(
    (((p5?.identityNullRate ?? 0) + (p9?.identityNullRate ?? 0)) / 2).toFixed(3),
  );
  const singleIdentityNullRate = single?.identityNullRate ?? 0;

  if (single && parallelNotFoundRate > singleNotFoundRate + 0.05) {
    findings.push({
      id: "parallel_only_not_found",
      confidence: "high",
      description:
        "NOT_FOUND is materially higher in parallel runs than single-request baseline, indicating concurrency-path instability.",
      evidence: {
        singleNotFoundRate,
        parallelNotFoundRate,
      },
      likelyRootCauseClass: "resolution_cache_race_or_stage0_winner_conflict",
    });
  }

  if (parallelIdentityNullRate > singleIdentityNullRate + 0.05) {
    findings.push({
      id: "parallel_identity_drop",
      confidence: "medium",
      description:
        "Parallel failures are frequently missing authoritative identity/sourceType, suggesting branch-finalization or process-noise behavior.",
      evidence: {
        singleIdentityNullRate,
        parallelIdentityNullRate,
      },
      likelyRootCauseClass: "unfinalized_branch_or_finalize_order_issue",
    });
  }

  const parallelSourceTypeFinalFalseRate = Number(
    (((p5?.sourceTypeFinalFalseRate ?? 0) + (p9?.sourceTypeFinalFalseRate ?? 0)) / 2).toFixed(3),
  );
  if (crossEvidence.rate >= 0.05) {
    findings.push({
      id: "authoritative_candidate_present_but_not_final",
      confidence: "high",
      description:
        "Cross-row evidence confirms sourceTypeFinal=false while authoritativeCandidateFound=true, consistent with priority downgrade/race behavior.",
      evidence: {
        crossEvidenceCount: crossEvidence.count,
        crossEvidenceRate: crossEvidence.rate,
        parallelSourceTypeFinalFalseRate,
        falseFinalTotal: falseFinalRows.total,
      },
      likelyRootCauseClass: "winner_replace_priority_or_cache_override",
    });
  } else if (parallelSourceTypeFinalFalseRate > 0.1) {
    findings.push({
      id: "parallel_false_final_without_candidate",
      confidence: "medium",
      description:
        "Parallel runs show sourceTypeFinal=false, but cross-evidence lacks authoritativeCandidateFound=true rows; likely candidate-missing/resolution-path failure rather than winner override.",
      evidence: {
        crossEvidenceCount: crossEvidence.count,
        crossEvidenceRate: crossEvidence.rate,
        parallelSourceTypeFinalFalseRate,
        falseFinalTotal: falseFinalRows.total,
        withoutAuthoritativeCandidate: falseFinalRows.withoutAuthoritativeCandidate,
      },
      likelyRootCauseClass: "candidate_absent_or_resolution_path_failure",
    });
  }

  const withIdentityNotFound = parallelNotFoundRows.filter(
    (row) => row?.requestContext?.authoritativeIdentity?.value,
  );
  if (withIdentityNotFound.length > 0) {
    const byIdentity = withIdentityNotFound.reduce((acc, row) => {
      const identity = row?.requestContext?.authoritativeIdentity?.value ?? "unknown";
      acc[identity] = (acc[identity] ?? 0) + 1;
      return acc;
    }, {});
    findings.push({
      id: "parallel_not_found_with_identity",
      confidence: "medium",
      description:
        "Some parallel NOT_FOUND responses still carry identity, which can indicate negative-cache contamination rather than pure identity-resolution failure.",
      evidence: {
        count: withIdentityNotFound.length,
        identities: byIdentity,
      },
      likelyRootCauseClass: "negative_cache_miswrite_or_race",
    });
  }

  if (findings.length === 0) {
    findings.push({
      id: "no_strong_signal",
      confidence: "low",
      description:
        "No dominant concurrency-specific anomaly detected from this sample. Increase rounds or capture deeper server-side trace fields.",
      evidence: {},
      likelyRootCauseClass: "unknown",
    });
  }

  return findings;
};

const topFailRows = (rows, limit = 25) =>
  rows
    .filter((row) => row?.terminal !== "DONE")
    .sort((a, b) => (a?.elapsedMs ?? 0) - (b?.elapsedMs ?? 0))
    .slice(0, limit)
    .map((row) => ({
      scenario: row?.scenario ?? null,
      round: row?.round ?? null,
      slot: row?.slot ?? null,
      terminal: row?.terminal ?? null,
      elapsedMs: row?.elapsedMs ?? null,
      requestId: row?.requestContext?.requestId ?? null,
      sourceType: row?.requestContext?.sourceType ?? null,
      sourceTypeFinal: row?.requestContext?.sourceTypeFinal ?? null,
      stage0Winner: row?.requestContext?.stage0Winner ?? null,
      terminalReason: row?.requestContext?.terminalReason ?? null,
      degradedMode:
        typeof row?.requestContext?.degradedMode === "boolean"
          ? row.requestContext.degradedMode
          : null,
      authoritativeCandidateFound:
        row?.requestContext?.authoritativeCandidateFound === true,
      authoritativeCandidateEvidence:
        Array.isArray(row?.requestContext?.authoritativeCandidateEvidence)
          ? row.requestContext.authoritativeCandidateEvidence
          : [],
      identityValue: row?.requestContext?.authoritativeIdentity?.value ?? null,
      authorityFailureReason: row?.metaObservation?.authorityFailureReason ?? null,
      fallbackReason: row?.metaObservation?.fallbackReason ?? null,
      cache: row?.metaObservation?.cache ?? null,
      error: row?.error ?? null,
    }));

const toMarkdown = (analysis) => {
  const lines = [];
  lines.push("# 00084783891253 Concurrency Analysis");
  lines.push("");
  lines.push(`- Generated: ${analysis.generatedAt}`);
  lines.push(`- Input: ${analysis.input}`);
  lines.push(`- API Base: ${analysis.apiBaseUrl ?? "unknown"}`);
  lines.push("");

  lines.push("## Scenario Summary");
  lines.push("");
  for (const [name, summary] of Object.entries(analysis.summaryByScenario)) {
    lines.push(
      `- ${name}: total=${summary.total}, doneRate=${summary.doneRate}, notFoundRate=${summary.notFoundRate}, sourceTypeFinalTrueRate=${summary.sourceTypeFinalTrueRate}, sourceTypeFinalFalseRate=${summary.sourceTypeFinalFalseRate}, authoritativeCandidateFoundRate=${summary.authoritativeCandidateFoundRate}, identityNullRate=${summary.identityNullRate}, terminals=${JSON.stringify(summary.terminalBreakdown)}, stage0Winners=${JSON.stringify(summary.stage0WinnerCounts)}, terminalReasons=${JSON.stringify(summary.terminalReasonCounts)}`,
    );
  }
  lines.push("");

  lines.push("## False-Final Evidence");
  lines.push("");
  lines.push(
    `- falseFinalRows: total=${analysis.falseFinalRows.total}, withAuthoritativeCandidate=${analysis.falseFinalRows.withAuthoritativeCandidate}, withoutAuthoritativeCandidate=${analysis.falseFinalRows.withoutAuthoritativeCandidate}`,
  );
  lines.push(
    `- crossEvidence: count=${analysis.crossEvidence.count}, rate=${analysis.crossEvidence.rate}, scenarioBreakdown=${JSON.stringify(analysis.crossEvidence.scenarioBreakdown)}`,
  );
  lines.push("");

  lines.push("## Likely Root Causes");
  lines.push("");
  for (const finding of analysis.likelyRootCauses) {
    lines.push(`- [${finding.confidence}] ${finding.id}: ${finding.description}`);
    lines.push(`  evidence: ${JSON.stringify(finding.evidence)}`);
    lines.push(`  class: ${finding.likelyRootCauseClass}`);
  }
  lines.push("");

  lines.push("## Failure Samples");
  lines.push("");
  analysis.failureSamples.forEach((row) => {
    lines.push(
      `- ${row.scenario} r${row.round}#${row.slot} terminal=${row.terminal} sourceType=${row.sourceType ?? "null"} sourceTypeFinal=${row.sourceTypeFinal ?? "null"} stage0Winner=${row.stage0Winner ?? "null"} authoritativeCandidateFound=${row.authoritativeCandidateFound} terminalReason=${row.terminalReason ?? "null"} degradedMode=${row.degradedMode ?? "null"} identity=${row.identityValue ?? "null"} requestId=${row.requestId ?? "null"}`,
    );
  });
  lines.push("");

  return `${lines.join("\n").trim()}\n`;
};

const main = async () => {
  const inputArg = getArg("input");
  const inputPath = inputArg
    ? path.isAbsolute(inputArg)
      ? inputArg
      : path.join(ROOT_DIR, inputArg)
    : await findLatestInput();
  if (!inputPath) {
    throw new Error("No input provided and no latest repro file found under output/maintainer-gates.");
  }

  const raw = await fs.readFile(inputPath, "utf8");
  const repro = JSON.parse(raw);
  const rows = Array.isArray(repro?.runs) ? repro.runs : [];
  const groupedRows = rows.reduce((acc, row) => {
    const key = row?.scenario ?? "unknown";
    if (!acc[key]) acc[key] = [];
    acc[key].push(row);
    return acc;
  }, {});
  const groupedStats = Object.fromEntries(
    Object.entries(groupedRows).map(([name, list]) => [name, summarizeRows(list)]),
  );

  const parallelRows = [...(groupedRows.parallel5 ?? []), ...(groupedRows.parallel9 ?? [])];
  const falseFinalList = parallelRows.filter((row) => row?.requestContext?.sourceTypeFinal === false);
  const crossEvidenceList = falseFinalList.filter(
    (row) => row?.requestContext?.authoritativeCandidateFound === true,
  );
  const crossEvidence = {
    count: crossEvidenceList.length,
    rate:
      falseFinalList.length > 0
        ? Number((crossEvidenceList.length / falseFinalList.length).toFixed(4))
        : 0,
    scenarioBreakdown: crossEvidenceList.reduce((acc, row) => {
      const key = row?.scenario ?? "unknown";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
  };
  const falseFinalRows = {
    total: falseFinalList.length,
    withAuthoritativeCandidate: crossEvidenceList.length,
    withoutAuthoritativeCandidate: falseFinalList.length - crossEvidenceList.length,
  };

  const likelyRootCauses = classifyRootCauses(
    groupedRows,
    groupedStats,
    crossEvidence,
    falseFinalRows,
  );
  const analysis = {
    generatedAt: new Date().toISOString(),
    input: inputPath,
    apiBaseUrl: repro?.apiBaseUrl ?? null,
    config: repro?.config ?? null,
    summaryByScenario: groupedStats,
    crossEvidence,
    falseFinalRows,
    likelyRootCauses,
    failureSamples: topFailRows(rows, 25),
  };

  const outFileArg = getArg("out-file");
  const outFile = outFileArg
    ? path.isAbsolute(outFileArg)
      ? outFileArg
      : path.join(ROOT_DIR, outFileArg)
    : path.join(path.dirname(inputPath), "00084783891253_analysis.md");
  const outJsonArg = getArg("out-json");
  const outJson = outJsonArg
    ? path.isAbsolute(outJsonArg)
      ? outJsonArg
      : path.join(ROOT_DIR, outJsonArg)
    : path.join(path.dirname(inputPath), "00084783891253_analysis.json");

  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, toMarkdown(analysis), "utf8");
  await fs.writeFile(outJson, JSON.stringify(analysis, null, 2), "utf8");

  console.log(`[analyze-000847] wrote ${outFile}`);
  console.log(`[analyze-000847] wrote ${outJson}`);
};

main().catch((error) => {
  console.error("[analyze-000847] failed", error instanceof Error ? error.message : error);
  process.exit(1);
});
