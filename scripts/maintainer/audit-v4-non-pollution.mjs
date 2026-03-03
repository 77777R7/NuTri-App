#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT_DIR = process.cwd();
const args = process.argv.slice(2);

const getArg = (flag, fallback = null) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return fallback;
  return args[idx + 1] ?? fallback;
};

const resolvePath = (value) => {
  if (!value) return null;
  return path.isAbsolute(value) ? value : path.join(ROOT_DIR, value);
};

const ensureDir = async (dirPath) => {
  await fs.mkdir(dirPath, { recursive: true });
};

const writeJson = async (filePath, payload) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const writeText = async (filePath, body) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, body, "utf8");
};

const listJsonlFiles = async (dirPath) => {
  const out = [];
  const walk = async (current) => {
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".jsonl")) continue;
      if (!/(patch|candidate|enforce|postfilter|queue)/i.test(entry.name)) continue;
      out.push(abs);
    }
  };
  await walk(dirPath);
  return out;
};

const main = async () => {
  const scanDir = resolvePath(getArg("scan-dir", path.join(ROOT_DIR, "output")));
  const outDir =
    resolvePath(getArg("out-dir")) ??
    path.join(
      ROOT_DIR,
      "output",
      `v1.6.14-e-plus-${new Date().toISOString().replace(/[:.]/g, "-")}`,
      "strict",
    );

  if (!scanDir) {
    console.error("[audit-v4-non-pollution] missing --scan-dir");
    process.exit(1);
  }

  const candidateFiles = await listJsonlFiles(scanDir);
  const pollutionHits = [];
  const pollutantPattern = /\b(best_for_bullets?|form_impact_line|before_you_buy_line|safe_science|v4_safe|needs_capture|needs_edit)\b/i;

  for (const filePath of candidateFiles) {
    const raw = await fs.readFile(filePath, "utf8").catch(() => "");
    if (!raw.trim()) continue;
    const lines = raw.split("\n").filter(Boolean);
    for (let i = 0; i < lines.length; i += 1) {
      let row;
      try {
        row = JSON.parse(lines[i]);
      } catch {
        continue;
      }
      const patchedValue = row?.patchedValue;
      const asText = typeof patchedValue === "string" ? patchedValue : JSON.stringify(patchedValue ?? "");
      if (!pollutantPattern.test(asText)) continue;
      pollutionHits.push({
        filePath,
        line: i + 1,
        patchBatchId: row?.patchBatchId ?? null,
        fieldKey: row?.fieldKey ?? null,
        matchedSnippet: asText.slice(0, 240),
      });
    }
  }

  const patchPipelineFiles = [
    path.join(ROOT_DIR, "backend", "src", "patchShadowOverlay.ts"),
    path.join(ROOT_DIR, "scripts", "maintainer", "run-stage-c-final.mjs"),
    path.join(ROOT_DIR, "scripts", "maintainer", "run_top100_lane1_orchestrator.mjs"),
  ];
  const pipelineReferenceHits = [];
  const forbiddenSourcePattern = /SAFE_SCIENCE_SUBSET_PATH|SAFE_SCIENCE_FALLBACKS_PATH|v4_safe_science_subset|safe_science_fallbacks/i;

  for (const filePath of patchPipelineFiles) {
    const raw = await fs.readFile(filePath, "utf8").catch(() => "");
    if (!raw) continue;
    if (forbiddenSourcePattern.test(raw)) {
      pipelineReferenceHits.push(filePath);
    }
  }

  const pass = pollutionHits.length === 0 && pipelineReferenceHits.length === 0;
  const report = {
    generatedAt: new Date().toISOString(),
    scanDir,
    scannedJsonlFiles: candidateFiles.length,
    pass,
    nonPollutionPass: pass,
    pollutionHitCount: pollutionHits.length,
    pipelineReferenceHitCount: pipelineReferenceHits.length,
    pollutionHits,
    pipelineReferenceHits,
    blockingReasons: [
      ...(pollutionHits.length > 0 ? ["v4_pollution_in_patch_value"] : []),
      ...(pipelineReferenceHits.length > 0 ? ["patch_pipeline_reads_safe_science_sources"] : []),
    ],
  };

  await writeJson(path.join(outDir, "v4_non_pollution_audit.json"), report);
  await writeText(
    path.join(outDir, "v4_non_pollution_audit.md"),
    [
      "# V4 Non-Pollution Audit",
      "",
      `- pass: ${pass}`,
      `- scannedJsonlFiles: ${candidateFiles.length}`,
      `- pollutionHitCount: ${pollutionHits.length}`,
      `- pipelineReferenceHitCount: ${pipelineReferenceHits.length}`,
      `- blockingReasons: ${report.blockingReasons.length > 0 ? report.blockingReasons.join(", ") : "none"}`,
      "",
    ].join("\n"),
  );

  console.log("[audit-v4-non-pollution] completed");
  console.log(JSON.stringify({ outDir, pass }, null, 2));
  if (!pass) process.exit(2);
};

main().catch((error) => {
  console.error("[audit-v4-non-pollution] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
