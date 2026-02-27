#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);

const getArg = (flag, fallback = null) => {
  const inline = args.find((entry) => entry.startsWith(`--${flag}=`));
  if (inline) return inline.slice(flag.length + 3);
  const idx = args.indexOf(`--${flag}`);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return fallback;
};

const asNumber = (value, fallback) => {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const now = new Date().toISOString().replace(/[:]/g, "-");
const outDir = path.resolve(
  process.cwd(),
  getArg("out-dir", `output/lnhpd_top20_mapping_gap/${now}`),
);
const tablePrimary = getArg("table-primary", "lnhpd_facts_complete");
const tableSecondary = getArg("table-secondary", "lnhpd_facts");
const topBrands = Math.max(5, Math.min(100, asNumber(getArg("top-brands"), 20)));
const pageSize = Math.max(200, Math.min(5000, asNumber(getArg("page-size"), 2000)));
const limit = Math.max(0, asNumber(getArg("limit"), 0));

const loadEnv = () => {
  const envCandidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "backend/.env"),
    path.resolve(process.cwd(), "../.env"),
  ];
  for (const candidate of envCandidates) {
    if (!existsSync(candidate)) continue;
    dotenv.config({ path: candidate, override: false });
  }
};

const requireEnv = (name) => {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`[build-lnhpd-top20-mapping-gap] missing env ${name}`);
  return value;
};

const normalizeText = (value) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");

const normalizeBrandKey = (value) =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "(unknown)";

const normalizeNpn = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  if (!/^\d{8}$/.test(digits)) return null;
  if (/^(\d)\1{7}$/.test(digits)) return null;
  return digits;
};

const ensureDir = async (dirPath) => {
  await fs.mkdir(dirPath, { recursive: true });
};

const writeJson = async (filePath, payload) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const writeJsonl = async (filePath, rows) => {
  await ensureDir(path.dirname(filePath));
  const lines = rows.map((row) => JSON.stringify(row)).join("\n");
  await fs.writeFile(filePath, `${lines}\n`, "utf8");
};

const scoreRow = (row) => {
  let score = 0;
  if (row?.isComplete === true) score += 50;
  if (normalizeText(row?.brandName).length > 0) score += 25;
  if (normalizeText(row?.productName).length > 0) score += 25;
  return score;
};

const fetchRowsFromTable = async (supabase, table, maxRows) => {
  const out = [];
  let from = 0;
  while (true) {
    if (maxRows > 0 && out.length >= maxRows) break;
    const windowSize = maxRows > 0 ? Math.min(pageSize, maxRows - out.length) : pageSize;
    if (windowSize <= 0) break;
    const to = from + windowSize - 1;
    const { data, error } = await supabase
      .from(table)
      .select("lnhpd_id,npn,brand_name,product_name,is_complete")
      .order("lnhpd_id", { ascending: true })
      .range(from, to);
    if (error) {
      throw new Error(`[build-lnhpd-top20-mapping-gap] query ${table} failed: ${error.message}`);
    }
    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) break;
    out.push(...rows);
    from += rows.length;
    if (rows.length < windowSize) break;
  }
  return out;
};

const fetchMappedNpnSet = async (supabase) => {
  const mapped = new Set();
  let from = 0;
  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("barcode_regulatory_map")
      .select("npn")
      .order("npn", { ascending: true })
      .range(from, to);
    if (error) {
      throw new Error(`[build-lnhpd-top20-mapping-gap] query barcode_regulatory_map failed: ${error.message}`);
    }
    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) break;
    for (const row of rows) {
      const npn = normalizeNpn(row?.npn);
      if (npn) mapped.add(npn);
    }
    from += rows.length;
    if (rows.length < pageSize) break;
  }
  return mapped;
};

const renderMarkdown = (payload) => {
  const lines = [];
  lines.push("# LNHPD Top20 Mapping Gap");
  lines.push("");
  lines.push(`- generatedAt: ${payload.generatedAt}`);
  lines.push(`- topBrands: ${payload.topBrands}`);
  lines.push(`- totalNpns: ${payload.stats.totalNpns}`);
  lines.push(`- mappedNpns: ${payload.stats.mappedNpns}`);
  lines.push(`- unmappedNpns: ${payload.stats.unmappedNpns}`);
  lines.push("");
  lines.push("## Brand Buckets");
  lines.push("");
  lines.push("| rank | brandKey | totalNpns | mapped | unmapped | mappingCoverage | sampleNpn |");
  lines.push("|---:|---|---:|---:|---:|---:|---|");
  for (const row of payload.brandBuckets) {
    lines.push(
      `| ${row.rank} | ${String(row.brandKey).replace(/\|/g, "\\|")} | ${row.totalNpns} | ${row.mappedNpns} | ${row.unmappedNpns} | ${(row.mappingCoverage * 100).toFixed(2)}% | ${(row.sampleNpns || []).slice(0, 3).join(", ")} |`,
    );
  }
  lines.push("");
  lines.push("## Gap Samples");
  lines.push("");
  lines.push("| npn | brand | product | rank | reason |");
  lines.push("|---|---|---|---:|---|");
  for (const row of payload.allowlistRows.slice(0, 120)) {
    lines.push(
      `| ${row.npn} | ${String(row.brandName || "").replace(/\|/g, "\\|")} | ${String(row.productName || "").replace(/\|/g, "\\|")} | ${row.brandRank} | ${row.reason} |`,
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  loadEnv();
  const supabase = createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );

  const primaryRows = await fetchRowsFromTable(supabase, tablePrimary, limit);
  const secondaryRows = await fetchRowsFromTable(supabase, tableSecondary, limit);
  const mergedByNpn = new Map();

  for (const row of [...secondaryRows, ...primaryRows]) {
    const npn = normalizeNpn(row?.npn);
    if (!npn) continue;
    const normalized = {
      npn,
      lnhpdId: row?.lnhpd_id == null ? null : Number(row.lnhpd_id) || null,
      brandName: normalizeText(row?.brand_name) || null,
      productName: normalizeText(row?.product_name) || null,
      isComplete: row?.is_complete === true,
      sourceTable: primaryRows.includes(row) ? tablePrimary : tableSecondary,
    };
    const prev = mergedByNpn.get(npn);
    if (!prev || scoreRow(normalized) >= scoreRow(prev)) {
      mergedByNpn.set(npn, normalized);
    }
  }

  const rows = Array.from(mergedByNpn.values());
  const mappedNpnSet = await fetchMappedNpnSet(supabase);

  const brandBucketsMap = new Map();
  for (const row of rows) {
    const brandKey = normalizeBrandKey(row.brandName);
    if (!brandBucketsMap.has(brandKey)) {
      brandBucketsMap.set(brandKey, {
        brandKey,
        totalNpns: 0,
        mappedNpns: 0,
        unmappedNpns: 0,
        sampleNpns: [],
      });
    }
    const bucket = brandBucketsMap.get(brandKey);
    bucket.totalNpns += 1;
    const mapped = mappedNpnSet.has(row.npn);
    if (mapped) bucket.mappedNpns += 1;
    else bucket.unmappedNpns += 1;
    if (bucket.sampleNpns.length < 5) bucket.sampleNpns.push(row.npn);
  }

  const brandBuckets = Array.from(brandBucketsMap.values())
    .sort((a, b) => b.totalNpns - a.totalNpns || a.brandKey.localeCompare(b.brandKey))
    .slice(0, topBrands)
    .map((row, index) => ({
      ...row,
      rank: index + 1,
      mappingCoverage: row.totalNpns > 0 ? row.mappedNpns / row.totalNpns : 0,
    }));

  const allowedBrandSet = new Set(brandBuckets.map((row) => row.brandKey));
  const rankByBrand = new Map(brandBuckets.map((row) => [row.brandKey, row.rank]));
  const allowlistRows = rows
    .filter((row) => allowedBrandSet.has(normalizeBrandKey(row.brandName)))
    .filter((row) => !mappedNpnSet.has(row.npn))
    .map((row) => {
      const brandKey = normalizeBrandKey(row.brandName);
      return {
        npn: row.npn,
        lnhpdId: row.lnhpdId,
        brandName: row.brandName,
        productName: row.productName,
        brandKey,
        brandRank: rankByBrand.get(brandKey) || null,
        reason: "TOP20_MAPPING_GAP",
      };
    })
    .sort((a, b) => (a.brandRank || 999) - (b.brandRank || 999) || String(a.npn).localeCompare(String(b.npn)));

  const payload = {
    generatedAt: new Date().toISOString(),
    tablePrimary,
    tableSecondary,
    topBrands,
    stats: {
      totalNpns: rows.length,
      mappedNpns: rows.filter((row) => mappedNpnSet.has(row.npn)).length,
      unmappedNpns: rows.filter((row) => !mappedNpnSet.has(row.npn)).length,
      allowlistCount: allowlistRows.length,
    },
    brandBuckets,
    allowlistRows,
  };

  await ensureDir(outDir);
  const allowlistPath = path.join(outDir, "npn_allowlist_top20.jsonl");
  const brandStatsPath = path.join(outDir, "brand_bucket_stats.json");
  const reportPath = path.join(outDir, "mapping_gap_top20.md");

  await writeJsonl(allowlistPath, allowlistRows);
  await writeJson(brandStatsPath, payload);
  await fs.writeFile(reportPath, renderMarkdown(payload), "utf8");

  console.log(
    JSON.stringify(
      {
        outDir,
        allowlistPath,
        brandStatsPath,
        reportPath,
        topBrands,
        allowlistCount: allowlistRows.length,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error("[build-lnhpd-top20-mapping-gap] failed", error instanceof Error ? error.message : error);
  process.exit(1);
});
