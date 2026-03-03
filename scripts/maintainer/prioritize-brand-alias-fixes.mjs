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

const toMapFromRows = (rows, brandKeyField, valueField, marketField = "market") => {
  const map = new Map();
  for (const row of rows) {
    const market = String(
      row?.[marketField]
      ?? row?.market
      ?? row?.seedMarket
      ?? "",
    ).toUpperCase();
    const brand = normalizeBrand(
      row?.[brandKeyField]
      ?? row?.brand
      ?? row?.seedBrand
      ?? row?.brandName,
    );
    if (!market || !brand) continue;
    const key = `${market}:${brand}`;
    const fallbackValue = asNumber(
      row?.product_count
      ?? row?.total_products
      ?? row?.total
      ?? row?.count
      ?? 0,
      0,
    );
    map.set(key, asNumber(row?.[valueField], fallbackValue));
  }
  return map;
};

const aggregateTop100CoverageRows = (rows) => {
  const byKey = new Map();
  for (const row of rows) {
    const market = String(row?.market ?? row?.seedMarket ?? "").toUpperCase();
    const brand = normalizeBrand(row?.brand ?? row?.seedBrand ?? row?.brandName);
    if (!market || !brand) continue;
    const key = `${market}:${brand}`;
    const current = byKey.get(key) || {
      market,
      brand,
      product_count: 0,
      regulatory_source_count: 0,
    };
    current.product_count += 1;
    const sourceType = String(row?.sourceType ?? "").toLowerCase();
    if (sourceType === "dsld" || sourceType === "lnhpd") current.regulatory_source_count += 1;
    byKey.set(key, current);
  }
  return Array.from(byKey.values());
};

const main = async () => {
  const aliasQueuePath = resolvePath(getArg("alias-queue-jsonl"));
  if (!aliasQueuePath) {
    console.error("[prioritize-brand-alias-fixes] missing --alias-queue-jsonl");
    process.exit(1);
  }

  const top53ScopePath = resolvePath(getArg("top53-scope-json"));
  const top100CoveragePath = resolvePath(getArg("top100-coverage-json"));
  const missingDistPath = resolvePath(getArg("missing-distribution-json"));
  const outDir =
    resolvePath(getArg("out-dir"))
    ?? path.join(ROOT_DIR, "output", `v1.6.14-e-plus-${new Date().toISOString().replace(/[:.]/g, "-")}`, "coverage");

  const queueRows = await readJsonl(aliasQueuePath);
  if (queueRows.length === 0) {
    console.error("[prioritize-brand-alias-fixes] alias queue is empty");
    process.exit(1);
  }

  const top53Payload = top53ScopePath ? await readJson(top53ScopePath).catch(() => null) : null;
  const top53Rows = Array.isArray(top53Payload?.selected)
    ? top53Payload.selected
    : Array.isArray(top53Payload?.rows)
      ? top53Payload.rows
      : [];

  const top100CoverageRows = top100CoveragePath ? await readJson(top100CoveragePath).catch(() => []) : [];
  const top100RawRows = Array.isArray(top100CoverageRows)
    ? top100CoverageRows
    : Array.isArray(top100CoverageRows?.rows)
      ? top100CoverageRows.rows
      : [];
  const top100Rows = top100RawRows.some((row) => row && (row.product_count != null || row.regulatory_source_count != null))
    ? top100RawRows
    : aggregateTop100CoverageRows(top100RawRows);

  const missingDistPayload = missingDistPath ? await readJson(missingDistPath).catch(() => null) : null;
  const missingRows = Array.isArray(missingDistPayload?.rows)
    ? missingDistPayload.rows
    : Array.isArray(missingDistPayload)
      ? missingDistPayload
      : [];

  const top53HitMap = new Map();
  for (const row of top53Rows) {
    const market = String(row?.market ?? row?.seedMarket ?? "").toUpperCase();
    const brand = normalizeBrand(row?.brand ?? row?.seedBrand ?? row?.brandName);
    if (!market || !brand) continue;
    const key = `${market}:${brand}`;
    top53HitMap.set(key, (top53HitMap.get(key) || 0) + 1);
  }

  const top100HitMap = toMapFromRows(top100Rows, "brand", "product_count");
  const authoritativeUnlockMap = toMapFromRows(top100Rows, "brand", "regulatory_source_count");

  const laneRelevanceMap = new Map();
  for (const row of missingRows) {
    const market = String(row?.market ?? "").toUpperCase();
    const brand = normalizeBrand(row?.brand);
    if (!market || !brand) continue;
    const total = Math.max(1, asNumber(row?.total_products ?? row?.total ?? row?.product_count, 0));
    const missingDirections = asNumber(row?.missing_directions_count ?? row?.missing_directions, 0);
    laneRelevanceMap.set(`${market}:${brand}`, missingDirections / total);
  }

  const maxTop53 = Math.max(1, ...top53HitMap.values(), 1);
  const maxTop100 = Math.max(1, ...top100HitMap.values(), 1);
  const maxUnlock = Math.max(1, ...authoritativeUnlockMap.values(), 1);

  const scored = queueRows.map((row) => {
    const market = String(row?.market ?? "").toUpperCase() || "US";
    const brand = String(row?.brand ?? "").trim();
    const brandNorm = normalizeBrand(brand);
    const key = `${market}:${brandNorm}`;

    const top53Hit = (top53HitMap.get(key) || 0) / maxTop53;
    const top100Hit = (top100HitMap.get(key) || 0) / maxTop100;
    const authoritativeUnlock = (authoritativeUnlockMap.get(key) || 0) / maxUnlock;
    const laneRelevance = laneRelevanceMap.get(key) || 0;

    const impactScore = Number((
      0.4 * top53Hit
      + 0.3 * top100Hit
      + 0.2 * authoritativeUnlock
      + 0.1 * laneRelevance
    ).toFixed(6));

    return {
      ...row,
      market,
      brand,
      brandNorm,
      top53_hit: top53Hit,
      top100_hit: top100Hit,
      authoritative_unlock: authoritativeUnlock,
      lane_relevance: laneRelevance,
      impact_score: impactScore,
      owner: row?.owner || "data-lane-ops",
      status: row?.status || "open",
      reasonCode: row?.reasonCode || "brand_normalization_miss",
      targetRelease: row?.targetRelease || "v1.6.14-e-plus-followup",
    };
  });

  scored.sort((a, b) => b.impact_score - a.impact_score || a.brand.localeCompare(b.brand));

  const report = {
    generatedAt: new Date().toISOString(),
    aliasQueuePath,
    top53ScopePath: top53ScopePath || null,
    top100CoveragePath: top100CoveragePath || null,
    missingDistPath: missingDistPath || null,
    formula: "impact_score = 0.40*top53_hit + 0.30*top100_hit + 0.20*authoritative_unlock + 0.10*lane_relevance",
    counts: {
      total: scored.length,
      impactPositive: scored.filter((row) => row.impact_score > 0).length,
      top53Matched: scored.filter((row) => row.top53_hit > 0).length,
      top100Matched: scored.filter((row) => row.top100_hit > 0).length,
    },
    top10: scored.slice(0, 10).map((row, idx) => ({
      rank: idx + 1,
      market: row.market,
      brand: row.brand,
      impact_score: row.impact_score,
      top53_hit: row.top53_hit,
      top100_hit: row.top100_hit,
      authoritative_unlock: row.authoritative_unlock,
      lane_relevance: row.lane_relevance,
    })),
  };

  await writeJsonl(path.join(outDir, "brand_alias_priority_queue.jsonl"), scored);
  await writeJson(path.join(outDir, "brand_alias_priority_report.json"), report);

  console.log("[prioritize-brand-alias-fixes] completed");
  console.log(JSON.stringify({ outDir, total: scored.length }, null, 2));
};

main().catch((error) => {
  console.error("[prioritize-brand-alias-fixes] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
