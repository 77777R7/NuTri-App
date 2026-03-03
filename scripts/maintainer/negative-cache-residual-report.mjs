#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

const ROOT_DIR = process.cwd();
dotenv.config({ path: path.join(ROOT_DIR, "backend", ".env") });
dotenv.config({ path: path.join(ROOT_DIR, ".env") });

const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(`--${flag}`);
const getArg = (flag) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

if (hasFlag("help")) {
  console.log(`Usage:
  node scripts/maintainer/negative-cache-residual-report.mjs [options]

Options:
  --out-dir <path>         Output directory (default: output/maintainer-gates/<timestamp>)
  --lookback-hours <n>     Scan lookback window in hours (default: 48)
  --sample-size <n>        Max scan rows sampled (default: 300)
  --enforce                Exit non-zero when residualHitRate > 0
`);
  process.exit(0);
}

const nowTag = new Date().toISOString().replace(/[:.]/g, "-");
const outDirArg = getArg("out-dir") || path.join("output", "maintainer-gates", nowTag);
const outDir = path.isAbsolute(outDirArg) ? outDirArg : path.join(ROOT_DIR, outDirArg);
const outPath = path.join(outDir, "negative_cache_residual_report.json");
const lookbackHoursRaw = Number(getArg("lookback-hours") || process.env.NEGATIVE_CACHE_RESIDUAL_LOOKBACK_HOURS || 48);
const sampleSizeRaw = Number(getArg("sample-size") || process.env.NEGATIVE_CACHE_RESIDUAL_SAMPLE_SIZE || 300);
const lookbackHours = Number.isFinite(lookbackHoursRaw) && lookbackHoursRaw > 0 ? lookbackHoursRaw : 48;
const sampleSize = Number.isFinite(sampleSizeRaw) && sampleSizeRaw > 0 ? Math.floor(sampleSizeRaw) : 300;
const enforce = hasFlag("enforce");

const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!supabaseUrl || !serviceKey) {
  console.error("[negative-cache-residual-report] missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const normalizeDigits = (value) => String(value ?? "").replace(/\D/g, "").trim();
const isPositiveServedFrom = (servedFrom) => {
  const value = String(servedFrom ?? "").trim().toLowerCase();
  if (!value) return false;
  if (value.includes("not_found")) return false;
  if (value.startsWith("error")) return false;
  return true;
};

const isFuture = (isoValue) => {
  const ms = Date.parse(String(isoValue ?? ""));
  if (!Number.isFinite(ms)) return false;
  return ms > Date.now();
};

const main = async () => {
  await fs.mkdir(outDir, { recursive: true });
  const sinceIso = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();

  const { data: scanRows, error: scanError } = await supabase
    .from("barcode_scans")
    .select("barcode_gtin14,barcode_raw,served_from,created_at")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(sampleSize);

  if (scanError) {
    throw new Error(`barcode_scans_query_failed: ${scanError.message}`);
  }

  const candidates = (scanRows ?? [])
    .filter((row) => isPositiveServedFrom(row?.served_from))
    .map((row) => ({
      barcodeGtin14: normalizeDigits(row?.barcode_gtin14),
      barcodeRaw: normalizeDigits(row?.barcode_raw),
      servedFrom: String(row?.served_from ?? ""),
      createdAt: row?.created_at ?? null,
    }))
    .filter((row) => row.barcodeGtin14.length === 14);

  const uniqueGtin = Array.from(new Set(candidates.map((row) => row.barcodeGtin14)));
  const uniqueRaw = Array.from(new Set(candidates.map((row) => row.barcodeRaw).filter(Boolean)));

  const negativeRows = [];
  if (uniqueGtin.length > 0) {
    const { data, error } = await supabase
      .from("negative_cache")
      .select("barcode_gtin14,barcode_raw,reason_code,until,updated_at")
      .in("barcode_gtin14", uniqueGtin);
    if (error) throw new Error(`negative_cache_gtin_query_failed: ${error.message}`);
    negativeRows.push(...(data ?? []));
  }
  if (uniqueRaw.length > 0) {
    const { data, error } = await supabase
      .from("negative_cache")
      .select("barcode_gtin14,barcode_raw,reason_code,until,updated_at")
      .in("barcode_raw", uniqueRaw);
    if (error) throw new Error(`negative_cache_raw_query_failed: ${error.message}`);
    negativeRows.push(...(data ?? []));
  }

  const activeNegativeByGtin = new Map();
  const activeNegativeByRaw = new Map();
  for (const row of negativeRows) {
    if (!isFuture(row?.until)) continue;
    const gtin = normalizeDigits(row?.barcode_gtin14);
    const raw = normalizeDigits(row?.barcode_raw);
    if (gtin) activeNegativeByGtin.set(gtin, row);
    if (raw) activeNegativeByRaw.set(raw, row);
  }

  const checkedRows = [];
  for (const row of candidates) {
    const match = activeNegativeByGtin.get(row.barcodeGtin14) || (row.barcodeRaw ? activeNegativeByRaw.get(row.barcodeRaw) : null);
    checkedRows.push({
      barcodeGtin14: row.barcodeGtin14,
      barcodeRaw: row.barcodeRaw || null,
      servedFrom: row.servedFrom,
      scanCreatedAt: row.createdAt,
      residual: Boolean(match),
      negativeReason: match?.reason_code ?? null,
      negativeUntil: match?.until ?? null,
      negativeUpdatedAt: match?.updated_at ?? null,
    });
  }
  const checkedRowsUnique = [];
  const seenChecked = new Set();
  for (const row of checkedRows) {
    if (!row?.barcodeGtin14 || seenChecked.has(row.barcodeGtin14)) continue;
    seenChecked.add(row.barcodeGtin14);
    checkedRowsUnique.push(row);
  }
  const residualRows = checkedRowsUnique.filter((row) => row.residual === true);

  const totalChecked = checkedRowsUnique.length;
  const residualCount = residualRows.length;
  const residualHitRate = totalChecked > 0 ? Number((residualCount / totalChecked).toFixed(6)) : 0;
  const report = {
    generatedAt: new Date().toISOString(),
    lookbackHours,
    sampleSize,
    totalChecked,
    checkedUniqueBarcodeCount: checkedRowsUnique.length,
    residualCount,
    residualUniqueBarcodeCount: residualRows.length,
    residualHitRate,
    residualHitRateTarget: 0,
    pass: residualHitRate === 0,
    sampleCheckedRows: checkedRowsUnique.slice(0, 100),
    sampleResidualRows: residualRows.slice(0, 100),
  };

  await fs.writeFile(outPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`[negative-cache-residual-report] wrote ${outPath}`);
  if (enforce && report.residualHitRate > 0) {
    console.error(`[negative-cache-residual-report] residualHitRate=${report.residualHitRate} > 0`);
    process.exit(1);
  }
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[negative-cache-residual-report] failed", message);
  process.exit(1);
});
