#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const zipPath = getArg(
  "zip",
  "/Users/howard07/.codex/worktrees/f971/nutri-app/data/iherb_products_09e814d1b48847f7be1e38b52eb5e0b3_20260303_115845.zip",
);
const demoRoot = getArg("demo-root", path.join(ROOT, "output", "demo5"));
const overlayOutDir = getArg("overlay-out-dir", path.join(ROOT, "output", "demo5_iherb"));
const controlBaseUrl = String(getArg("control-base-url", "http://127.0.0.1:3101")).replace(/\/+$/, "");
const patchBaseUrl = String(getArg("patch-base-url", "http://127.0.0.1:3102")).replace(/\/+$/, "");

const samples = [
  { brand: "Sports Research", key: "sports_research_omega3", barcode: "00023249011835" },
  { brand: "Sports Research", key: "sports_research_vitamin_c", barcode: "00023249090021" },
  { brand: "Life Extension", key: "life_extension_florassist_gi", barcode: "00737870212539" },
  { brand: "Sports Research", key: "sports_research_astaxanthin", barcode: "00023249012566" },
  { brand: "Codeage", key: "codeage_adk", barcode: "00853919008236" },
];

const runNode = (argv, cwd = ROOT) =>
  new Promise((resolve, reject) => {
    execFile("node", argv, { cwd, maxBuffer: 1024 * 1024 * 64 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${error.message}\n${stderr || stdout}`));
        return;
      }
      resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  });

const readJson = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const safeText = (value) => String(value ?? "").trim();

const parseLastJson = (text) => {
  const lines = String(text ?? "").trim().split(/\r?\n/).reverse();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      return JSON.parse(trimmed);
    } catch {
      // ignore
    }
  }
  try {
    return JSON.parse(String(text ?? "").trim());
  } catch {
    return null;
  }
};

const buildInvestorSummary = ({ perSample, batchLint, mergeReport }) => {
  const lines = [];
  lines.push("# Demo5 Investor Summary");
  lines.push("");
  lines.push("## Coverage Table");
  lines.push("");
  lines.push("| Brand | Barcode | Source | Overall | Confidence | Unknown Items | Lint |");
  lines.push("|---|---:|---|---:|---:|---:|---|");
  for (const row of perSample) {
    const trace = row.trace ?? {};
    const v2 = trace.nutriScoreCardV2 ?? {};
    const modules = Array.isArray(v2.modules) ? v2.modules : [];
    const unknownCount = modules.reduce(
      (sum, module) =>
        sum +
        (Array.isArray(module?.checklist)
          ? module.checklist.filter((item) => String(item?.state) === "unknown").length
          : 0),
      0,
    );
    const overall = Number.isFinite(Number(v2.overallScore)) ? Math.round(Number(v2.overallScore)) : 0;
    const confidence = Number.isFinite(Number(v2.confidencePct)) ? Math.round(Number(v2.confidencePct)) : 0;
    lines.push(`| ${row.brand} | ${row.barcode} | ${safeText(trace.sourceTypeFinal) || "unknown"} | ${overall} | ${confidence}% | ${unknownCount} | ${row.lintOk ? "PASS" : "FAIL"} |`);
  }

  lines.push("");
  lines.push("## Investor Highlights");
  lines.push("");
  for (const row of perSample) {
    const trace = row.trace ?? {};
    const lanes = Array.isArray(trace.usedPatchLanes) ? trace.usedPatchLanes.join(", ") : "none";
    lines.push(`- ${row.brand} (${row.barcode}): Scorecard now explains decisions with 6 concrete modules; provenance keeps claims explicit (${lanes}).`);
  }

  lines.push("");
  lines.push("## Risks and Next Steps");
  lines.push("");
  lines.push("- Overlay claims are pilot-scored in v2; keep independent cert-page verification separate and cautious.");
  lines.push("- Unknown items should remain for fields without verifiable evidence; avoid forced certainty.");
  lines.push("- Next: broaden GTIN match coverage and run the same lint gate before wider rollout.");

  lines.push("");
  lines.push("## Merge / Lint Status");
  lines.push("");
  lines.push(`- Overlay matched: ${mergeReport?.summary?.matched ?? 0}/${mergeReport?.summary?.total ?? 0}`);
  lines.push(`- Batch lint: ${batchLint?.ok ? "PASS" : "FAIL"} (${batchLint?.passCount ?? 0}/${batchLint?.total ?? 0})`);

  return `${lines.join("\n")}\n`;
};

const buildPilotCloseout = ({ perSample, mergeReport, unmatchedQueuePath }) => {
  const products = perSample.map((row) => {
    const trace = row.trace ?? {};
    const v2 = trace.nutriScoreCardV2 ?? {};
    const modules = Array.isArray(v2.modules) ? v2.modules : [];

    const postUnknownByModule = {};
    const preUnknownByModuleEstimate = {};
    const sourceTierDistribution = {};

    for (const module of modules) {
      const checklist = Array.isArray(module?.checklist) ? module.checklist : [];
      const moduleId = String(module?.id ?? "unknown");
      postUnknownByModule[moduleId] = checklist.filter((item) => String(item?.state) === "unknown").length;
      preUnknownByModuleEstimate[moduleId] = checklist.filter((item) => {
        const state = String(item?.state);
        const sourceTier = String(item?.sourceTier);
        const evidenceStrength = String(item?.evidenceStrength);
        return state === "unknown" || (state === "verified" && sourceTier === "overlay_iherb" && evidenceStrength === "overlay_claim");
      }).length;

      for (const item of checklist) {
        const tier = String(item?.sourceTier || "unknown");
        sourceTierDistribution[tier] = (sourceTierDistribution[tier] ?? 0) + 1;
      }
    }

    const labelClarity = modules.find((module) => String(module?.id) === "label_clarity");
    const directionItem = Array.isArray(labelClarity?.checklist)
      ? labelClarity.checklist.find((item) => String(item?.key) === "label_clarity:directions_present")
      : null;
    const warningItem = Array.isArray(labelClarity?.checklist)
      ? labelClarity.checklist.find((item) => String(item?.key) === "label_clarity:warnings_present")
      : null;

    const postDirectionsVisible = String(directionItem?.state) === "verified";
    const postWarningsVisible = String(warningItem?.state) === "verified";
    const preDirectionsVisibleEstimate = postDirectionsVisible && String(directionItem?.sourceTier) !== "overlay_iherb";
    const preWarningsVisibleEstimate = postWarningsVisible && String(warningItem?.sourceTier) !== "overlay_iherb";

    return {
      brand: row.brand,
      barcode: row.barcode,
      sourceTypeFinal: trace.sourceTypeFinal ?? null,
      lintOk: row.lintOk,
      unknownCounts: {
        preEstimateByModule: preUnknownByModuleEstimate,
        postByModule: postUnknownByModule,
      },
      visibility: {
        preDirectionsVisibleEstimate,
        postDirectionsVisible,
        preWarningsVisibleEstimate,
        postWarningsVisible,
      },
      sourceTierDistribution,
    };
  });

  return {
    schemaVersion: "demo5_iherb_pilot_closeout.v1",
    generatedAt: new Date().toISOString(),
    summary: {
      totalSamples: perSample.length,
      lintPassCount: perSample.filter((row) => row.lintOk).length,
      overlayMatchedCount: Number(mergeReport?.summary?.matched ?? 0),
      overlayUnmatchedCount: Number(mergeReport?.summary?.unmatched ?? 0),
    },
    products,
    unresolved: {
      unmatchedQueuePath,
      mergeUnmatched: Array.isArray(mergeReport?.unmatched) ? mergeReport.unmatched : [],
    },
  };
};

const main = async () => {
  await fs.mkdir(demoRoot, { recursive: true });
  await fs.mkdir(overlayOutDir, { recursive: true });

  const extractArgs = [
    path.join("scripts", "maintainer", "extract-iherb-demo5.mjs"),
    "--zip",
    zipPath,
    "--out-dir",
    overlayOutDir,
  ];
  const mergeArgs = [
    path.join("scripts", "maintainer", "merge-iherb-overlay-demo5-to-supabase.mjs"),
    "--input-json",
    path.join(overlayOutDir, "extracted_demo5_overlay.json"),
    "--out-dir",
    overlayOutDir,
  ];

  await runNode(extractArgs);
  await runNode(mergeArgs);

  const perSample = [];
  for (const sample of samples) {
    const outDir = path.join(demoRoot, sample.key);
    await fs.mkdir(outDir, { recursive: true });

    const genResult = await runNode([
      path.join("scripts", "maintainer", "generate-demo-ui-example.mjs"),
      "--barcode-only",
      "--barcode",
      sample.barcode,
      "--out-dir",
      outDir,
      "--control-base-url",
      controlBaseUrl,
      "--patch-base-url",
      patchBaseUrl,
      "--auth-disabled-header",
      "1",
    ]);
    const parsedGen = parseLastJson(genResult.stdout) ?? {};
    const mdPath = parsedGen?.output?.md;
    const tracePath = parsedGen?.output?.trace;
    if (!mdPath || !tracePath) {
      throw new Error(`Demo generation failed for ${sample.barcode}: missing output paths`);
    }

    await runNode([
      path.join("scripts", "maintainer", "lint-demo-ui-example.mjs"),
      "--demo-md",
      mdPath,
      "--trace",
      tracePath,
      "--out-dir",
      outDir,
    ]);

    const lintReport = await readJson(path.join(outDir, "ux_demo_lint_report.json"));
    const trace = await readJson(tracePath);

    perSample.push({
      brand: sample.brand,
      key: sample.key,
      barcode: sample.barcode,
      mdPath,
      tracePath,
      lintOk: Boolean(lintReport?.ok),
      lintIssueCount: Number(lintReport?.issueCount ?? 0),
      trace,
    });
  }

  await runNode([
    path.join("scripts", "maintainer", "lint-demo-ui-example-batch.mjs"),
    "--demo-root",
    demoRoot,
    "--out-json",
    path.join(demoRoot, "ux_demo_lint_report.json"),
    "--out-md",
    path.join(demoRoot, "ux_demo_lint_report.md"),
  ]);

  const batchLint = await readJson(path.join(demoRoot, "ux_demo_lint_report.json"));
  const mergeReport = await readJson(path.join(overlayOutDir, "merge_report.json"));
  const unmatchedQueuePath = path.join(overlayOutDir, "unmatched_queue.jsonl");

  const investorSummaryMd = buildInvestorSummary({ perSample, batchLint, mergeReport });
  const investorSummaryPath = path.join(demoRoot, "investor_demo_summary.md");
  await fs.writeFile(investorSummaryPath, investorSummaryMd, "utf8");

  const closeout = buildPilotCloseout({ perSample, mergeReport, unmatchedQueuePath });
  const closeoutJsonPath = path.join(overlayOutDir, "pilot_closeout.json");
  const closeoutMdPath = path.join(overlayOutDir, "pilot_closeout.md");
  await fs.writeFile(closeoutJsonPath, `${JSON.stringify(closeout, null, 2)}\n`, "utf8");
  const closeoutMdLines = [
    "# Demo5 iHerb Overlay Pilot Closeout",
    "",
    `- generatedAt: ${closeout.generatedAt}`,
    `- totalSamples: ${closeout.summary.totalSamples}`,
    `- lintPassCount: ${closeout.summary.lintPassCount}`,
    `- overlayMatchedCount: ${closeout.summary.overlayMatchedCount}`,
    `- overlayUnmatchedCount: ${closeout.summary.overlayUnmatchedCount}`,
    "",
    "## Products",
    ...closeout.products.map(
      (p, idx) => `${idx + 1}. ${p.brand} | ${p.barcode} | directions pre/post: ${p.visibility.preDirectionsVisibleEstimate} -> ${p.visibility.postDirectionsVisible}`,
    ),
    "",
    "## Unresolved",
    `- unmatchedQueuePath: ${unmatchedQueuePath}`,
    `- mergeUnmatchedCount: ${Array.isArray(closeout.unresolved.mergeUnmatched) ? closeout.unresolved.mergeUnmatched.length : 0}`,
  ];
  await fs.writeFile(closeoutMdPath, `${closeoutMdLines.join("\n")}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        ok: batchLint.ok,
        output: {
          demoRoot,
          lintJson: path.join(demoRoot, "ux_demo_lint_report.json"),
          lintMd: path.join(demoRoot, "ux_demo_lint_report.md"),
          investorSummary: investorSummaryPath,
          pilotCloseoutJson: closeoutJsonPath,
          pilotCloseoutMd: closeoutMdPath,
        },
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
