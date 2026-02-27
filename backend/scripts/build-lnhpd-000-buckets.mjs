#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

import { classifyLnhpd000Bucket } from "./lib/lnhpd-000-bucket.mjs";

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
  getArg("out-dir", `output/lnhpd_000_buckets/${now}`),
);
const tablePrimary = getArg("table-primary", "lnhpd_facts_complete");
const tableSecondary = getArg("table-secondary", "lnhpd_facts");
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
  if (!value) throw new Error(`[build-lnhpd-000-buckets] missing env ${name}`);
  return value;
};

const normalizeNpn = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  if (!/^\d{8}$/.test(digits)) return null;
  if (/^(\d)\1{7}$/.test(digits)) return null;
  return digits;
};

const normalizeText = (value) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");

const scoreRow = (row) => {
  let score = 0;
  if (row?.is_complete === true) score += 50;
  if (normalizeText(row?.brand_name).length > 0) score += 20;
  if (normalizeText(row?.product_name).length > 0) score += 20;
  const facts = row?.facts_json && typeof row.facts_json === "object" ? row.facts_json : null;
  if (facts) score += 10;
  return score;
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
      .select("lnhpd_id,npn,brand_name,product_name,is_complete,facts_json")
      .order("lnhpd_id", { ascending: true })
      .range(from, to);
    if (error) {
      throw new Error(`[build-lnhpd-000-buckets] query ${table} failed: ${error.message}`);
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
      throw new Error(`[build-lnhpd-000-buckets] query barcode_regulatory_map failed: ${error.message}`);
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
  lines.push("# LNHPD 0/0/0 Buckets");
  lines.push("");
  lines.push(`- generatedAt: ${payload.generatedAt}`);
  lines.push(`- tablePrimary: ${payload.tablePrimary}`);
  lines.push(`- tableSecondary: ${payload.tableSecondary}`);
  lines.push(`- totalScanned: ${payload.stats.totalScanned}`);
  lines.push(`- zeroZeroZeroRows: ${payload.stats.zeroZeroZeroRows}`);
  lines.push(`- mappedRows: ${payload.stats.mappedRows}`);
  lines.push(`- unmappedRows: ${payload.stats.unmappedRows}`);
  lines.push("");
  lines.push("## Bucket Counts");
  lines.push("");
  for (const [bucket, count] of Object.entries(payload.stats.bucketCounts || {}).sort((a, b) => Number(b[1]) - Number(a[1]))) {
    lines.push(`- ${bucket}: ${count}`);
  }
  lines.push("");
  lines.push("## Top Rows");
  lines.push("");
  lines.push("| npn | brand | product | mapped | bucket | subcause | fixLane | hasMedicinalRaw | hasAmountRaw | hasRiskInfoRaw | hasRecommendedUseRaw |");
  lines.push("|---|---|---|---:|---|---|---|---:|---:|---:|---:|");
  for (const row of payload.rows.slice(0, 60)) {
    lines.push(
      `| ${row.npn} | ${String(row.brandName || "").replace(/\|/g, "\\|")} | ${String(row.productName || "").replace(/\|/g, "\\|")} | ${row.hasBarcodeMapping ? 1 : 0} | ${row.bucket} | ${row.subcause} | ${row.fixLane} | ${row.hasMedicinalRaw ? 1 : 0} | ${row.hasAmountRaw ? 1 : 0} | ${row.hasRiskInfoRaw ? 1 : 0} | ${row.hasRecommendedUseRaw ? 1 : 0} |`,
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
    const next = {
      npn,
      lnhpdId: row?.lnhpd_id == null ? null : Number(row.lnhpd_id) || null,
      brandName: normalizeText(row?.brand_name) || null,
      productName: normalizeText(row?.product_name) || null,
      isComplete: row?.is_complete === true,
      factsJson: row?.facts_json && typeof row.facts_json === "object" ? row.facts_json : null,
      sourceTable: primaryRows.includes(row) ? tablePrimary : tableSecondary,
    };
    const prev = mergedByNpn.get(npn);
    if (!prev || scoreRow(next) >= scoreRow(prev)) {
      mergedByNpn.set(npn, next);
    }
  }

  const mappedNpnSet = await fetchMappedNpnSet(supabase);
  const allRows = Array.from(mergedByNpn.values());

  const bucketRows = [];
  for (const row of allRows) {
    const hasBarcodeMapping = mappedNpnSet.has(row.npn);
    const classified = classifyLnhpd000Bucket({
      factsJson: row.factsJson,
      hasBarcodeMapping,
    });
    if (!(classified.extractorIngredientCount === 0 && classified.extractorDoseCount === 0)) {
      continue;
    }
    bucketRows.push({
      npn: row.npn,
      lnhpdId: row.lnhpdId,
      brandName: row.brandName,
      productName: row.productName,
      hasBarcodeMapping,
      ...classified,
    });
  }

  const bucketCounts = bucketRows.reduce((acc, row) => {
    const key = String(row.bucket || "UNKNOWN");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const payload = {
    generatedAt: new Date().toISOString(),
    tablePrimary,
    tableSecondary,
    stats: {
      totalScanned: allRows.length,
      zeroZeroZeroRows: bucketRows.length,
      mappedRows: bucketRows.filter((row) => row.hasBarcodeMapping).length,
      unmappedRows: bucketRows.filter((row) => !row.hasBarcodeMapping).length,
      bucketCounts,
    },
    rows: bucketRows.sort((a, b) => String(a.bucket).localeCompare(String(b.bucket)) || String(a.npn).localeCompare(String(b.npn))),
  };

  const jsonlPath = path.join(outDir, "lnhpd_000_buckets.jsonl");
  const mdPath = path.join(outDir, "lnhpd_000_buckets.md");
  const statsPath = path.join(outDir, "lnhpd_000_bucket_stats.json");

  await ensureDir(outDir);
  await writeJsonl(jsonlPath, payload.rows);
  await fs.writeFile(mdPath, renderMarkdown(payload), "utf8");
  await writeJson(statsPath, payload);

  console.log(
    JSON.stringify(
      {
        outDir,
        jsonl: jsonlPath,
        markdown: mdPath,
        stats: statsPath,
        totalScanned: payload.stats.totalScanned,
        zeroZeroZeroRows: payload.stats.zeroZeroZeroRows,
        bucketCounts,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error("[build-lnhpd-000-buckets] failed", error instanceof Error ? error.message : error);
  process.exit(1);
});
