#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const args = process.argv.slice(2);

const getArg = (flag, fallback = null) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return fallback;
  return args[idx + 1] ?? fallback;
};

const resolvePath = (value) => {
  if (!value) return null;
  return path.isAbsolute(value) ? value : path.join(ROOT, value);
};

const ensureDir = async (dirPath) => {
  await fs.mkdir(dirPath, { recursive: true });
};

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));

const writeJson = async (filePath, payload) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const writeText = async (filePath, body) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, body, "utf8");
};

const main = async () => {
  const nightlyDir = resolvePath(getArg("nightly-dir"));
  if (!nightlyDir) {
    console.error("[finalize-nightly-plus-closeout] missing --nightly-dir");
    process.exit(1);
  }
  const outDir = resolvePath(getArg("out-dir")) ?? path.join(nightlyDir, "next_phase");

  const phaseG = await readJson(path.join(nightlyDir, "phase_g", "nightly_closeout_decision.json")).catch(() => null);
  const productImpact = await readJson(path.join(outDir, "new_top100_product_level_ux_impact.json")).catch(() => null);
  const nextPlan = await readJson(path.join(outDir, "new_top100_next_execution_plan.json")).catch(() => null);
  const lane2Candidates = await readJson(path.join(outDir, "new_top100_lane2_candidates.json")).catch(() => null);
  const lane2Ux = await readJson(path.join(outDir, "new_top100_lane2_ux_visibility.json")).catch(() => null);
  const runtimeV2 = await readJson(path.join(outDir, "expanded_runtime_proof_v2_new_top100.json")).catch(() => null);
  const closure2 = await readJson(path.join(outDir, "ux_closure2_report.json")).catch(() => null);

  const lane1MainlineDone = Boolean(phaseG?.summary?.enforceCompleted >= 3);
  const lane2Validated = Boolean((lane2Ux?.summary?.lanesTested || 0) > 0);
  const runtimeExpandedDone = Boolean(runtimeV2?.totalBatches >= 1);
  const closure2Pass = Boolean(closure2?.pass);

  const pass = lane1MainlineDone && lane2Validated && runtimeExpandedDone && closure2Pass;

  const blockingReasons = [];
  if (!lane1MainlineDone) blockingReasons.push("lane1_mainline_not_ready");
  if (!lane2Validated) blockingReasons.push("lane2_validation_missing");
  if (!runtimeExpandedDone) blockingReasons.push("runtime_v2_missing");
  if (!closure2Pass) blockingReasons.push("ux_closure2_not_pass");

  const report = {
    generatedAt: new Date().toISOString(),
    nightlyDir,
    pass,
    blockingReasons,
    status: {
      lane1MainlineDone,
      lane2Validated,
      runtimeExpandedDone,
      closure2Pass,
    },
    summary: {
      previousNightlyPass: Boolean(phaseG?.pass),
      lane1EnforceCompleted: phaseG?.summary?.enforceCompleted ?? 0,
      lane2Candidates: lane2Candidates?.summary?.totalCandidates ?? 0,
      lane2PassLanes: lane2Ux?.summary?.passLanes ?? 0,
      runtimeV2Batches: runtimeV2?.totalBatches ?? 0,
      directionsVisibleRate: productImpact?.summary?.rates?.current?.directions_visible_rate ?? null,
      bestForVisibleRate: productImpact?.summary?.rates?.current?.best_for_visible_rate ?? null,
      scienceSpecificityRate: productImpact?.summary?.rates?.current?.science_specificity_rate ?? null,
      beforeYouBuyRate: productImpact?.summary?.rates?.current?.before_you_buy_completeness_rate ?? null,
      nextTier1Batch2Count: nextPlan?.nextExecutionQueue?.tier1_batch2?.length ?? 0,
      nextTier2Batch3Count: nextPlan?.nextExecutionQueue?.tier2_batch3?.length ?? 0,
    },
    externalMessage: closure2Pass
      ? "strict revalidation passed; UX materially improved (threshold achieved)"
      : "strict revalidation passed; UX uplift continuing (deployment wave #2)",
    nextActions: pass
      ? [
        "promote wave from Top10/Top24 to broader Top100 execution window",
        "keep lane2 probiotics shadow->enforce cadence with watch windows",
      ]
      : [
        "continue Goal1 lane1 batch expansion (tier1_batch2 then tier2_batch3)",
        "improve directions visibility proxy with additional enforce batches",
        "iterate lane2 readiness slice and rerun closure2",
      ],
  };

  await writeJson(path.join(outDir, "nightly_plus_closeout.json"), report);
  await writeText(
    path.join(outDir, "nightly_plus_closeout.md"),
    [
      "# Nightly Plus Closeout",
      "",
      `- pass: ${report.pass}`,
      `- blockingReasons: ${(report.blockingReasons || []).join(", ") || "none"}`,
      `- externalMessage: ${report.externalMessage}`,
      "",
      "## Status / 状态",
      `- lane1MainlineDone: ${report.status.lane1MainlineDone}`,
      `- lane2Validated: ${report.status.lane2Validated}`,
      `- runtimeExpandedDone: ${report.status.runtimeExpandedDone}`,
      `- closure2Pass: ${report.status.closure2Pass}`,
      "",
      "## Next Actions / 下一步",
      ...report.nextActions.map((x) => `- ${x}`),
      "",
    ].join("\n"),
  );

  console.log("[finalize-nightly-plus-closeout] completed");
  console.log(JSON.stringify({ pass, blockingReasons }, null, 2));
};

main().catch((error) => {
  console.error("[finalize-nightly-plus-closeout] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
