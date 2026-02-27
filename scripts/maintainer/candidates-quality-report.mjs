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
  node scripts/maintainer/candidates-quality-report.mjs [options]

Options:
  --out-dir <path>       Output directory (default: output/maintainer-gates/<timestamp>)
  --window-hours <n>     Candidate lookback window in hours (default: 48)
  --enforce              Exit non-zero when conflictsByBarcode > 0
`);
  process.exit(0);
}

const nowTag = new Date().toISOString().replace(/[:.]/g, "-");
const outDirArg = getArg("out-dir") || path.join("output", "maintainer-gates", nowTag);
const outDir = path.isAbsolute(outDirArg) ? outDirArg : path.join(ROOT_DIR, outDirArg);
const outPath = path.join(outDir, "candidates_quality_report.json");
const windowHoursRaw = Number(getArg("window-hours") || process.env.CANDIDATES_QUALITY_WINDOW_HOURS || 48);
const windowHours = Number.isFinite(windowHoursRaw) && windowHoursRaw > 0 ? windowHoursRaw : 48;
const enforce = hasFlag("enforce");

const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!supabaseUrl || !serviceKey) {
  console.error("[candidates-quality-report] missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const normalizeDigits = (value) => String(value ?? "").replace(/\D/g, "").trim();
const CONFLICT_IGNORABLE_REASONS = new Set(["lower_rank", "equal_rank_not_better"]);
const hourBucket = (isoValue) => {
  const ms = Date.parse(String(isoValue ?? ""));
  if (!Number.isFinite(ms)) return "unknown";
  return new Date(ms).toISOString().slice(0, 13) + ":00:00Z";
};

const main = async () => {
  await fs.mkdir(outDir, { recursive: true });
  const sinceIso = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("barcode_regulatory_map_candidates")
    .select(
      "barcode_gtin14,incoming_npn,incoming_source,incoming_rank,reason_code,created_at",
    )
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(5000);

  if (error) {
    throw new Error(`candidates_query_failed: ${error.message}`);
  }

  const hourlyAdditions = {};
  const rejectReasonCounts = {};
  const sourceCounts = {};
  const rankCounts = {};
  const barcodeToNpnReasons = new Map();

  for (const row of data ?? []) {
    const hour = hourBucket(row?.created_at);
    hourlyAdditions[hour] = (hourlyAdditions[hour] ?? 0) + 1;

    const reason = String(row?.reason_code ?? "unknown").trim() || "unknown";
    rejectReasonCounts[reason] = (rejectReasonCounts[reason] ?? 0) + 1;

    const source = String(row?.incoming_source ?? "unknown").trim().toLowerCase() || "unknown";
    sourceCounts[source] = (sourceCounts[source] ?? 0) + 1;

    const rank = Number.isFinite(Number(row?.incoming_rank)) ? String(Number(row.incoming_rank)) : "unknown";
    rankCounts[rank] = (rankCounts[rank] ?? 0) + 1;

    const barcode = normalizeDigits(row?.barcode_gtin14);
    const npn = normalizeDigits(row?.incoming_npn);
    if (!barcode || !npn) continue;
    const reasonNormalized = reason.toLowerCase();
    const barcodeEntry = barcodeToNpnReasons.get(barcode) ?? new Map();
    const npnEntry = barcodeEntry.get(npn) ?? {
      count: 0,
      actionableCount: 0,
      reasons: new Set(),
    };
    npnEntry.count += 1;
    npnEntry.reasons.add(reasonNormalized);
    if (!CONFLICT_IGNORABLE_REASONS.has(reasonNormalized)) {
      npnEntry.actionableCount += 1;
    }
    barcodeEntry.set(npn, npnEntry);
    barcodeToNpnReasons.set(barcode, barcodeEntry);
  }

  const rawConflictBarcodes = [];
  const conflictBarcodes = [];
  const suppressedConflictBarcodes = [];
  for (const [barcode, npnMap] of barcodeToNpnReasons.entries()) {
    if (npnMap.size <= 1) continue;
    const actionableNpnCount = [...npnMap.values()].filter((entry) => entry.actionableCount > 0).length;
    const baseRow = { barcodeGtin14: barcode, uniqueIncomingNpnCount: npnMap.size };
    rawConflictBarcodes.push(baseRow);
    if (actionableNpnCount > 1) {
      conflictBarcodes.push(baseRow);
    } else {
      suppressedConflictBarcodes.push({
        ...baseRow,
        suppressedReason: "only_lower_rank_or_non_actionable_rejections",
      });
    }
  }
  rawConflictBarcodes.sort((a, b) => b.uniqueIncomingNpnCount - a.uniqueIncomingNpnCount);
  conflictBarcodes.sort((a, b) => b.uniqueIncomingNpnCount - a.uniqueIncomingNpnCount);
  suppressedConflictBarcodes.sort((a, b) => b.uniqueIncomingNpnCount - a.uniqueIncomingNpnCount);

  const topRejectReasons = Object.entries(rejectReasonCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([reason, count]) => ({ reason, count }));

  const report = {
    generatedAt: new Date().toISOString(),
    windowHours,
    totalCandidates: (data ?? []).length,
    hourlyAdditions,
    topRejectReasons,
    rejectReasonCounts,
    sourceCounts,
    rankCounts,
    rawConflictsByBarcode: rawConflictBarcodes.length,
    conflictsByBarcode: conflictBarcodes.length,
    conflictBarcodes: conflictBarcodes.slice(0, 100),
    suppressedConflictsByBarcode: suppressedConflictBarcodes.length,
    suppressedConflictBarcodes: suppressedConflictBarcodes.slice(0, 100),
    pass: conflictBarcodes.length === 0,
  };

  await fs.writeFile(outPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`[candidates-quality-report] wrote ${outPath}`);
  if (enforce && report.conflictsByBarcode > 0) {
    console.error(`[candidates-quality-report] conflictsByBarcode=${report.conflictsByBarcode} > 0`);
    process.exit(1);
  }
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[candidates-quality-report] failed", message);
  process.exit(1);
});
