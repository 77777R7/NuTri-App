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

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));

const readJsonl = async (filePath) => {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
};

const writeJson = async (filePath, payload) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const writeJsonl = async (filePath, rows) => {
  await ensureDir(path.dirname(filePath));
  const body = (Array.isArray(rows) ? rows : []).map((row) => JSON.stringify(row)).join("\n");
  await fs.writeFile(filePath, body ? `${body}\n` : "", "utf8");
};

const asNumber = (value, fallback = 0) => {
  if (value == null) return fallback;
  if (typeof value === "string" && value.trim().length === 0) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const normalizeBrand = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokenize = (value) => normalizeBrand(value).split(" ").filter(Boolean);

const jaccard = (a, b) => {
  const sa = new Set(tokenize(a));
  const sb = new Set(tokenize(b));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const token of sa) {
    if (sb.has(token)) inter += 1;
  }
  const union = new Set([...sa, ...sb]).size;
  return union > 0 ? inter / union : 0;
};

const scoreAliasMatch = (alias, canonical) => {
  const a = normalizeBrand(alias);
  const c = normalizeBrand(canonical);
  if (!a || !c) return 0;
  if (a === c) return 1;
  if (a.includes(c) || c.includes(a)) return 0.92;
  const jac = jaccard(a, c);
  if (jac >= 0.7) return 0.82 + (jac - 0.7) * 0.2;
  return jac * 0.8;
};

const loadPlanBrands = (plan) => {
  const rows = [];
  const us = Array.isArray(plan?.brand_priority_lists?.us?.brands) ? plan.brand_priority_lists.us.brands : [];
  const ca = Array.isArray(plan?.brand_priority_lists?.canada?.brands) ? plan.brand_priority_lists.canada.brands : [];
  for (const row of us) {
    const brand = String(row?.brand ?? "").trim();
    if (!brand) continue;
    rows.push({ market: "US", brand, brandNorm: normalizeBrand(brand) });
  }
  for (const row of ca) {
    const brand = String(row?.brand ?? "").trim();
    if (!brand) continue;
    rows.push({ market: "CA", brand, brandNorm: normalizeBrand(brand) });
  }
  return rows;
};

const main = async () => {
  const priorityQueuePath = resolvePath(getArg("priority-queue-jsonl"));
  if (!priorityQueuePath) {
    console.error("[resolve-brand-alias-queue] missing --priority-queue-jsonl");
    process.exit(1);
  }

  const planPath =
    resolvePath(getArg("plan-json"))
    ?? "/Users/howard07/Downloads/NuTri_Top100_Brand_PatchLane_Plan_v2.json";

  const outDir =
    resolvePath(getArg("out-dir"))
    ?? path.join(ROOT_DIR, "output", `v1.6.14-e-plus-${new Date().toISOString().replace(/[:.]/g, "-")}`, "coverage");

  const minScore = Math.max(0, Math.min(1, asNumber(getArg("min-score"), 0.82)));
  const highPriorityCount = Math.max(1, asNumber(getArg("high-priority-count"), 24));

  const queueRows = await readJsonl(priorityQueuePath);
  if (queueRows.length === 0) {
    console.error("[resolve-brand-alias-queue] priority queue is empty");
    process.exit(1);
  }

  const plan = await readJson(planPath);
  const brands = loadPlanBrands(plan);

  const resolved = [];
  const residual = [];

  const sorted = queueRows
    .slice()
    .sort((a, b) => asNumber(b?.impact_score, 0) - asNumber(a?.impact_score, 0));

  for (let idx = 0; idx < sorted.length; idx += 1) {
    const row = sorted[idx];
    const market = String(row?.market ?? "US").toUpperCase();
    const alias = String(row?.brand ?? "").trim();
    const aliasNorm = normalizeBrand(alias);
    const inScope = brands.filter((candidate) => candidate.market === market);

    let best = null;
    let bestScore = 0;
    for (const candidate of inScope) {
      const score = scoreAliasMatch(aliasNorm, candidate.brandNorm);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    const highPriority = idx < highPriorityCount;
    if (best && bestScore >= minScore) {
      resolved.push({
        market,
        alias,
        aliasNorm,
        canonicalBrand: best.brand,
        canonicalBrandNorm: best.brandNorm,
        matchScore: Number(bestScore.toFixed(6)),
        highPriority,
        resolvedAt: new Date().toISOString(),
        resolvedBy: "auto_fuzzy_v1",
        source: "plan_seed",
      });
      continue;
    }

    residual.push({
      ...row,
      market,
      brand: alias,
      brandNorm: aliasNorm,
      highPriority,
      owner: row?.owner || "data-lane-ops",
      status: row?.status || "open",
      reasonCode: row?.reasonCode || "brand_alias_unresolved",
      eta: row?.eta || "next_cycle",
    });
  }

  const index = {};
  for (const row of resolved) {
    index[`${row.market}:${row.aliasNorm}`] = row.canonicalBrandNorm;
    index[`*:${row.aliasNorm}`] = row.canonicalBrandNorm;
  }

  const highPriorityResolved = resolved.filter((row) => row.highPriority).length;
  const highPriorityResidual = residual.filter((row) => row.highPriority).length;
  const gatePass = highPriorityResolved >= Math.min(highPriorityCount, sorted.length) && highPriorityResidual === 0;

  const resolutionMap = {
    generatedAt: new Date().toISOString(),
    sourcePriorityQueuePath: priorityQueuePath,
    planPath,
    minScore,
    highPriorityCount,
    mappings: resolved,
    index,
  };

  const audit = {
    generatedAt: resolutionMap.generatedAt,
    counts: {
      total: sorted.length,
      resolved: resolved.length,
      residual: residual.length,
      highPriorityResolved,
      highPriorityResidual,
    },
    gatePass,
    gateReason: gatePass ? "high_priority_aliases_resolved" : "high_priority_aliases_pending",
  };

  await writeJson(path.join(outDir, "brand_alias_resolution_map.json"), resolutionMap);
  await writeJson(path.join(outDir, "brand_alias_resolution_audit.json"), audit);
  await writeJsonl(path.join(outDir, "brand_alias_residual_queue.jsonl"), residual);

  console.log("[resolve-brand-alias-queue] completed");
  console.log(JSON.stringify({ outDir, gatePass, resolved: resolved.length, residual: residual.length }, null, 2));

  if (!gatePass) process.exit(2);
};

main().catch((error) => {
  console.error("[resolve-brand-alias-queue] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
