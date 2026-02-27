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
  node scripts/maintainer/remediate-candidate-conflicts.mjs [options]

Options:
  --out-dir <path>         Output directory (default: output/maintainer-gates/<timestamp>)
  --window-hours <n>       Lookback window (default: 48)
  --barcode <gtin14>       Optional single barcode remediation target
  --apply                  Execute deletes (default: dry-run)
`);
  process.exit(0);
}

const nowTag = new Date().toISOString().replace(/[:.]/g, "-");
const outDirArg = getArg("out-dir") || path.join("output", "maintainer-gates", nowTag);
const outDir = path.isAbsolute(outDirArg) ? outDirArg : path.join(ROOT_DIR, outDirArg);
const reportPath = path.join(outDir, "candidate_conflict_remediation_report.json");
const windowHoursRaw = Number(getArg("window-hours") || process.env.CANDIDATE_CONFLICT_WINDOW_HOURS || 48);
const windowHours = Number.isFinite(windowHoursRaw) && windowHoursRaw > 0 ? windowHoursRaw : 48;
const barcodeArg = String(getArg("barcode") || "").replace(/\D/g, "");
const applyMode = hasFlag("apply");

const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!supabaseUrl || !serviceKey) {
  console.error("[remediate-candidate-conflicts] missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const normalizeDigits = (value) => String(value ?? "").replace(/\D/g, "").trim();

const mapSourceToRank = (source) => {
  const normalized = String(source ?? "").trim().toLowerCase();
  if (!normalized) return 100;
  if (
    normalized === "verified_regulatory"
    || normalized === "lnhpd"
    || normalized === "name_match"
    || normalized === "manual_verified"
    || normalized === "barcode_scans"
  ) return 400;
  if (normalized === "label_record" || normalized === "dsld" || normalized === "label_scan" || normalized === "catalog_label") {
    return 300;
  }
  if (normalized === "stable_db" || normalized === "scan_history" || normalized === "map" || normalized === "map_stale") {
    return 200;
  }
  if (normalized === "lnhpd_not_found") return 10;
  return 100;
};

const main = async () => {
  await fs.mkdir(outDir, { recursive: true });
  const sinceIso = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();

  let query = supabase
    .from("barcode_regulatory_map_candidates")
    .select("barcode_gtin14,incoming_npn,incoming_rank,incoming_source,reason_code,created_at")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(5000);

  if (barcodeArg) {
    query = query.eq("barcode_gtin14", barcodeArg);
  }

  const { data: candidateRows, error: candidateError } = await query;
  if (candidateError) {
    throw new Error(`candidate_query_failed: ${candidateError.message}`);
  }

  const barcodeToNpns = new Map();
  for (const row of candidateRows ?? []) {
    const barcode = normalizeDigits(row?.barcode_gtin14);
    const npn = normalizeDigits(row?.incoming_npn);
    if (!barcode || !npn) continue;
    const set = barcodeToNpns.get(barcode) ?? new Set();
    set.add(npn);
    barcodeToNpns.set(barcode, set);
  }

  const conflictBarcodes = Array.from(barcodeToNpns.entries())
    .filter(([, npns]) => npns.size > 1)
    .map(([barcode]) => barcode);

  const report = {
    generatedAt: new Date().toISOString(),
    windowHours,
    sinceIso,
    applyMode,
    scopedBarcode: barcodeArg || null,
    conflictBarcodes,
    scannedRows: (candidateRows ?? []).length,
    remediated: [],
    deletedRows: 0,
  };

  for (const barcode of conflictBarcodes) {
    const { data: mapRow, error: mapError } = await supabase
      .from("barcode_regulatory_map")
      .select("barcode_gtin14,npn,source,confidence,updated_at")
      .eq("barcode_gtin14", barcode)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (mapError) {
      report.remediated.push({
        barcodeGtin14: barcode,
        action: "skipped",
        reason: `map_lookup_failed:${mapError.message}`,
      });
      continue;
    }

    const authoritativeNpn = normalizeDigits(mapRow?.npn);
    const authoritativeRank = mapSourceToRank(mapRow?.source);
    if (!authoritativeNpn || authoritativeRank < 300) {
      report.remediated.push({
        barcodeGtin14: barcode,
        action: "skipped",
        reason: "no_authoritative_map_row",
        mapRow: mapRow ?? null,
      });
      continue;
    }

    const rowsForBarcode = (candidateRows ?? []).filter((row) => normalizeDigits(row?.barcode_gtin14) === barcode);
    const deletableRows = rowsForBarcode.filter((row) => {
      const incomingNpn = normalizeDigits(row?.incoming_npn);
      const incomingRank = Number.isFinite(Number(row?.incoming_rank)) ? Number(row.incoming_rank) : 100;
      const reason = String(row?.reason_code ?? "").trim().toLowerCase();
      if (!incomingNpn || incomingNpn === authoritativeNpn) return false;
      if (incomingRank > 100) return false;
      if (reason !== "lower_rank" && reason !== "equal_rank_not_better") return false;
      return true;
    });

    let deletedCount = 0;
    if (applyMode && deletableRows.length > 0) {
      const incomingNpns = Array.from(new Set(deletableRows.map((row) => normalizeDigits(row?.incoming_npn)).filter(Boolean)));
      let deleteQuery = supabase
        .from("barcode_regulatory_map_candidates")
        .delete()
        .eq("barcode_gtin14", barcode)
        .gte("created_at", sinceIso)
        .in("incoming_npn", incomingNpns)
        .in("reason_code", ["lower_rank", "equal_rank_not_better"]);
      const { error: deleteError } = await deleteQuery;
      if (deleteError) {
        report.remediated.push({
          barcodeGtin14: barcode,
          action: "delete_failed",
          reason: deleteError.message,
          targetedRows: deletableRows.length,
        });
        continue;
      }
      deletedCount = deletableRows.length;
      report.deletedRows += deletedCount;
    }

    report.remediated.push({
      barcodeGtin14: barcode,
      action: applyMode ? "deleted_low_signal_conflicts" : "would_delete_low_signal_conflicts",
      authoritativeNpn,
      authoritativeSource: mapRow?.source ?? null,
      authoritativeRank,
      targetedRows: deletableRows.length,
      deletedRows: deletedCount,
      targetedIncomingNpns: Array.from(
        new Set(deletableRows.map((row) => normalizeDigits(row?.incoming_npn)).filter(Boolean)),
      ),
    });
  }

  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`[remediate-candidate-conflicts] wrote ${reportPath}`);
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[remediate-candidate-conflicts] failed", message);
  process.exit(1);
});
