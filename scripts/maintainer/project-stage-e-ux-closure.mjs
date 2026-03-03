#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

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

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));

const writeJson = async (filePath, payload) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const writeText = async (filePath, body) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, body, "utf8");
};

const writeJsonl = async (filePath, rows) => {
  await ensureDir(path.dirname(filePath));
  const body = rows.map((row) => JSON.stringify(row)).join("\n");
  await fs.writeFile(filePath, `${body}${rows.length > 0 ? "\n" : ""}`, "utf8");
};

const normalizeText = (value) => String(value ?? "").trim();
const normalizeToken = (value) =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

const classifyRowToken = (row) => {
  const direct = normalizeToken(row?.ingredientToken ?? row?.ingredient_token ?? "");
  if (direct && direct !== "other") return direct;

  const name = normalizeText(row?.productName ?? row?.product_name ?? "").toLowerCase();
  if (!name) return direct || "other";
  if (/fish\s*oil|omega\s*-?\s*3|epa|dha/.test(name)) return "fish_oil_omega3";
  if (/vitamin\s*d|\bd3\b|\bd2\b|cholecalciferol|ergocalciferol/.test(name)) return "vitamin_d";
  if (/coenzyme\s*q\s*10|\bco\s*q\s*10\b|\bcoq10\b|\bubiquinol\b|\bubiquinone\b/.test(name)) return "coq10";
  if (/^c\s*\d+\s*mg\b|^vitamin\s*c\b|\bascorbic\b|\bascorbate\b/.test(name)) return "vitamin_c";
  if (/\bzinc\b/.test(name)) return "zinc";
  if (/\bmagnesium\b/.test(name)) return "magnesium";
  return direct || "other";
};

const asBool = (value) => value === true;

const evaluateAttempt = ({ fixableRows, activeTokens, baselineCounts }) => {
  let projectedBestForVisible = Number(baselineCounts.bestForVisible ?? 0);
  let projectedScienceSpecificVisible = Number(baselineCounts.scienceSpecific ?? 0);

  const selectedRows = [];
  for (const row of fixableRows) {
    const token = classifyRowToken(row);
    if (!activeTokens.has(token)) continue;
    const bestFor = asBool(row?.bestFor);
    const scienceSpecificity = asBool(row?.scienceSpecificity);
    if (!bestFor || !scienceSpecificity) {
      selectedRows.push({ ...row, projectedToken: token });
    }
    if (!bestFor) projectedBestForVisible += 1;
    if (!scienceSpecificity) projectedScienceSpecificVisible += 1;
  }

  return {
    selectedRows,
    projectedBestForVisible,
    projectedScienceSpecificVisible,
  };
};

const hashObject = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

const main = async () => {
  const defaultBaseDir = path.join(ROOT_DIR, "output", "v1.6.14-e-plus-20260302T081059Z");
  const baselineReportPath = resolvePath(
    getArg("baseline-report-json", path.join(defaultBaseDir, "ux", "visibility", "ux_visibility_report.json")),
  );
  const fixableQueuePath = resolvePath(
    getArg("fixable-queue-json", path.join(defaultBaseDir, "ux", "visibility", "ux_visibility_fixable_queue.json")),
  );
  const safeSubsetPath = resolvePath(getArg("safe-science-subset-json", path.join(defaultBaseDir, "ux", "v4_safe_science_subset.json")));
  const safeFallbackPath = resolvePath(getArg("safe-fallback-json", path.join(ROOT_DIR, "data", "kb", "safe_science_fallbacks.v1.json")));
  const outDir =
    resolvePath(getArg("out-dir")) ??
    path.join(
      ROOT_DIR,
      "output",
      `v1.6.14-e-plus-${new Date().toISOString().replace(/[:.]/g, "-")}`,
      "ux_closure",
      "projection",
    );

  const baselineReport = await readJson(baselineReportPath);
  const fixableRows = await readJson(fixableQueuePath);
  const subset = await readJson(safeSubsetPath);
  const fallbacks = await readJson(safeFallbackPath);

  if (!Array.isArray(fixableRows)) {
    console.error("[project-stage-e-ux-closure] fixable queue must be an array");
    process.exit(1);
  }

  const totalRows = Number(baselineReport?.evaluatedRows ?? 53);
  const bestForTarget = Math.ceil(totalRows * 0.7);
  const scienceTarget = Math.ceil(totalRows * 0.65);

  const primaryTokens = new Set(["vitamin_d", "fish_oil_omega3"]);
  const secondaryTokens = new Set(["coq10", "vitamin_c", "zinc", "magnesium"]);

  const subsetTokens = new Set(Object.keys(subset?.signalsByIngredient ?? {}).map((token) => normalizeToken(token)));
  const fallbackTokens = new Set(Object.keys(fallbacks?.signalsByIngredient ?? {}).map((token) => normalizeToken(token)));

  const round1 = evaluateAttempt({
    fixableRows,
    activeTokens: new Set([...primaryTokens].filter((token) => subsetTokens.has(token) || fallbackTokens.has(token))),
    baselineCounts: baselineReport?.counts ?? {},
  });

  const round1Pass = round1.projectedBestForVisible >= bestForTarget && round1.projectedScienceSpecificVisible >= scienceTarget;
  let chosen = {
    round: 1,
    activeTokens: Array.from(primaryTokens),
    ...round1,
    pass: round1Pass,
  };

  if (!round1Pass) {
    const mergedTokens = new Set([...primaryTokens, ...secondaryTokens].filter((token) => subsetTokens.has(token) || fallbackTokens.has(token)));
    const round2 = evaluateAttempt({
      fixableRows,
      activeTokens: mergedTokens,
      baselineCounts: baselineReport?.counts ?? {},
    });
    const round2Pass = round2.projectedBestForVisible >= bestForTarget && round2.projectedScienceSpecificVisible >= scienceTarget;
    chosen = {
      round: 2,
      activeTokens: Array.from(mergedTokens),
      ...round2,
      pass: round2Pass,
    };
  }

  const projection = {
    generatedAt: new Date().toISOString(),
    baselineReportPath,
    fixableQueuePath,
    safeSubsetPath,
    safeFallbackPath,
    totals: {
      evaluatedRows: totalRows,
      baselineBestForVisible: Number(baselineReport?.counts?.bestForVisible ?? 0),
      baselineScienceSpecificVisible: Number(baselineReport?.counts?.scienceSpecific ?? 0),
      bestForTarget,
      scienceSpecificTarget: scienceTarget,
    },
    attempts: [
      {
        round: 1,
        activeTokens: Array.from(primaryTokens),
        projectedBestForVisible: round1.projectedBestForVisible,
        projectedScienceSpecificVisible: round1.projectedScienceSpecificVisible,
        selectedCount: round1.selectedRows.length,
        pass: round1Pass,
      },
      ...(chosen.round === 2
        ? [
            {
              round: 2,
              activeTokens: chosen.activeTokens,
              projectedBestForVisible: chosen.projectedBestForVisible,
              projectedScienceSpecificVisible: chosen.projectedScienceSpecificVisible,
              selectedCount: chosen.selectedRows.length,
              pass: chosen.pass,
            },
          ]
        : []),
    ],
    selectedRound: chosen.round,
    projectionPass: chosen.pass,
    projected_best_for_visible: chosen.projectedBestForVisible,
    projected_science_specific_visible: chosen.projectedScienceSpecificVisible,
    selectedCandidates: chosen.selectedRows.length,
    selectedTokenCoverage: Object.fromEntries(
      chosen.activeTokens.map((token) => [
        token,
        chosen.selectedRows.filter((row) => row.projectedToken === token).length,
      ]),
    ),
  };

  const candidateRows = chosen.selectedRows.map((row) => ({
    ...row,
    projectionRound: chosen.round,
    projectionPass: chosen.pass,
  }));

  await writeJson(path.join(outDir, "ux_closure_projection.json"), projection);
  await writeText(
    path.join(outDir, "ux_closure_projection.md"),
    [
      "# UX Closure Projection",
      "",
      `- projectionPass: ${projection.projectionPass}`,
      `- selectedRound: ${projection.selectedRound}`,
      `- projected_best_for_visible: ${projection.projected_best_for_visible}/${totalRows}`,
      `- projected_science_specific_visible: ${projection.projected_science_specific_visible}/${totalRows}`,
      `- bestForTarget: ${bestForTarget}`,
      `- scienceSpecificTarget: ${scienceTarget}`,
      `- selectedCandidates: ${projection.selectedCandidates}`,
      `- projectionHash: ${hashObject(projection)}`,
      "",
    ].join("\n"),
  );
  await writeJsonl(path.join(outDir, "ux_closure_projection_candidates.jsonl"), candidateRows);

  console.log("[project-stage-e-ux-closure] completed");
  console.log(JSON.stringify({ outDir, projectionPass: projection.projectionPass }, null, 2));
  if (!projection.projectionPass) process.exit(2);
};

main().catch((error) => {
  console.error("[project-stage-e-ux-closure] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
