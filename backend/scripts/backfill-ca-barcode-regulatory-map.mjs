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
const getArg = (name, fallback = "") => {
  const exact = args.find((entry) => entry.startsWith(`--${name}=`));
  if (exact) return exact.slice(name.length + 3);
  const idx = args.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return fallback;
};
const hasFlag = (name) => args.includes(`--${name}`);

const normalizeBarcode = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length < 8) return "";
  return digits.length >= 14 ? digits.slice(-14) : digits.padStart(14, "0");
};

const normalizeNpn = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!/^\d{8}$/.test(digits)) return null;
  if (/^(\d)\1{7}$/.test(digits)) return null;
  return digits;
};

const extractBarcodeCandidates = (facts) => {
  if (!facts || typeof facts !== "object") return [];
  const out = new Set();
  const record = facts;
  const rawCandidates = Array.isArray(record.barcodeCandidates) ? record.barcodeCandidates : [];
  for (const item of rawCandidates) {
    if (typeof item === "string" || typeof item === "number") {
      const normalized = normalizeBarcode(item);
      if (normalized) out.add(normalized);
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const objectBarcode = normalizeBarcode(
      item.barcode ??
        item.barcode_gtin14 ??
        item.barcode_raw ??
        item.gtin14 ??
        item.code ??
        null,
    );
    if (objectBarcode) out.add(objectBarcode);
  }

  const rawMeta = Array.isArray(record.barcodeCandidatesMeta) ? record.barcodeCandidatesMeta : [];
  for (const item of rawMeta) {
    if (!item || typeof item !== "object") continue;
    const objectBarcode = normalizeBarcode(
      item.barcode ??
        item.barcode_gtin14 ??
        item.barcode_raw ??
        item.gtin14 ??
        item.code ??
        null,
    );
    if (objectBarcode) out.add(objectBarcode);
  }

  for (const key of ["barcode", "barcode_gtin14", "barcode_raw", "gtin14"]) {
    const candidate = normalizeBarcode(record[key]);
    if (candidate) out.add(candidate);
  }
  return [...out];
};

const extractBarcodesFromUnknown = (input, outSet) => {
  if (!input) return;
  if (Array.isArray(input)) {
    for (const entry of input) extractBarcodesFromUnknown(entry, outSet);
    return;
  }
  if (typeof input === "string" || typeof input === "number") {
    const barcode = normalizeBarcode(input);
    if (barcode) outSet.add(barcode);
    return;
  }
  if (typeof input !== "object") return;
  const record = input;
  for (const key of [
    "barcode",
    "barcode_gtin14",
    "barcode_raw",
    "gtin14",
    "code",
    "upc",
    "ean",
  ]) {
    const barcode = normalizeBarcode(record[key]);
    if (barcode) outSet.add(barcode);
  }
  if (Array.isArray(record.barcodes)) {
    for (const value of record.barcodes) {
      const barcode = normalizeBarcode(value);
      if (barcode) outSet.add(barcode);
    }
  }
  for (const value of Object.values(record)) {
    if (value && typeof value === "object") {
      extractBarcodesFromUnknown(value, outSet);
    }
  }
};

const percentile = (values, p) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (Math.max(0, Math.min(100, p)) / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];
  const weight = rank - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
};

const main = async () => {
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const outDirArg =
    getArg("out-dir") ||
    path.join("output", "v1.6.8-ca-map-backfill", stamp);
  const outDir = path.isAbsolute(outDirArg) ? outDirArg : path.join(ROOT_DIR, outDirArg);
  const dryRun = hasFlag("dry-run");
  const tablePrimary = getArg("table-primary", "lnhpd_facts_complete");
  const tableSecondary = getArg("table-secondary", "lnhpd_facts");
  const pageSize = Math.max(200, Math.min(5000, Number(getArg("page-size", "1500")) || 1500));
  const confidence = Math.max(0.5, Math.min(1, Number(getArg("confidence", "0.99")) || 0.99));
  const sourceTag = String(getArg("source", "lnhpd")).trim() || "lnhpd";
  const expiryDays = Math.max(30, Math.min(365, Number(getArg("expiry-days", "90")) || 90));

  const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY is required");
  }
  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const targetSet = new Set();
  const barcodesArg = String(getArg("barcodes", "") || "").trim();
  if (barcodesArg) {
    for (const value of barcodesArg.split(",")) {
      const barcode = normalizeBarcode(value);
      if (barcode) targetSet.add(barcode);
    }
  }

  const barcodesJsonArg = String(getArg("barcodes-json", "") || "").trim();
  if (barcodesJsonArg) {
    const inputPath = path.isAbsolute(barcodesJsonArg)
      ? barcodesJsonArg
      : path.join(ROOT_DIR, barcodesJsonArg);
    const raw = await fs.readFile(inputPath, "utf8");
    extractBarcodesFromUnknown(JSON.parse(raw), targetSet);
  }

  if (targetSet.size === 0) {
    throw new Error("no barcodes provided (use --barcodes or --barcodes-json)");
  }

  const targets = [...targetSet].sort();
  const targetsSet = new Set(targets);

  const existingMapRows = [];
  for (let i = 0; i < targets.length; i += 200) {
    const slice = targets.slice(i, i + 200);
    const { data, error } = await supabase
      .from("barcode_regulatory_map")
      .select("barcode_gtin14,barcode_raw,npn,source,confidence,expires_at,updated_at,last_seen_at")
      .in("barcode_gtin14", slice);
    if (error) {
      throw new Error(`load existing barcode_regulatory_map failed: ${error.message}`);
    }
    existingMapRows.push(...(data ?? []));
  }

  const existingByBarcode = new Map();
  for (const row of existingMapRows) {
    const barcode = normalizeBarcode(row?.barcode_gtin14 ?? row?.barcode_raw ?? "");
    if (!barcode || !targetsSet.has(barcode)) continue;
    const npn = normalizeNpn(row?.npn);
    if (!npn) continue;
    const current = existingByBarcode.get(barcode);
    if (!current || Number(row?.confidence ?? 0) > Number(current?.confidence ?? 0)) {
      existingByBarcode.set(barcode, {
        barcode,
        npn,
        source: String(row?.source ?? ""),
        confidence: Number(row?.confidence ?? 0) || 0,
        updatedAt: row?.updated_at ?? null,
      });
    }
  }

  const unresolved = new Set(targets.filter((barcode) => !existingByBarcode.has(barcode)));
  const matchesByBarcode = new Map();
  const tableStats = [];

  const scanTable = async (tableName, rankWeight) => {
    if (unresolved.size === 0) return;
    let from = 0;
    let scannedRows = 0;
    let matchedRows = 0;
    while (unresolved.size > 0) {
      const to = from + pageSize - 1;
      const { data, error } = await supabase
        .from(tableName)
        .select("lnhpd_id,npn,updated_at,facts_json")
        .not("npn", "is", null)
        .not("facts_json->barcodeCandidates", "is", null)
        .order("lnhpd_id", { ascending: true })
        .range(from, to);
      if (error) {
        throw new Error(`scan ${tableName} failed @ ${from}-${to}: ${error.message}`);
      }
      const rows = Array.isArray(data) ? data : [];
      if (!rows.length) break;
      scannedRows += rows.length;

      for (const row of rows) {
        const npn = normalizeNpn(row?.npn);
        if (!npn) continue;
        const facts = row?.facts_json && typeof row.facts_json === "object" ? row.facts_json : null;
        const candidateBarcodes = extractBarcodeCandidates(facts);
        if (!candidateBarcodes.length) continue;
        for (const barcode of candidateBarcodes) {
          if (!targetsSet.has(barcode)) continue;
          if (!matchesByBarcode.has(barcode)) matchesByBarcode.set(barcode, []);
          const list = matchesByBarcode.get(barcode);
          const already = list.some((entry) => entry.npn === npn && entry.table === tableName);
          if (!already) {
            list.push({
              npn,
              lnhpdId: row?.lnhpd_id ?? null,
              updatedAt: row?.updated_at ?? null,
              table: tableName,
              rankWeight,
            });
          }
          if (unresolved.has(barcode)) {
            unresolved.delete(barcode);
            matchedRows += 1;
          }
        }
      }

      from += rows.length;
      if (rows.length < pageSize) break;
    }
    tableStats.push({
      table: tableName,
      scannedRows,
      matchedRows,
    });
  };

  await scanTable(tablePrimary, 2);
  await scanTable(tableSecondary, 1);

  const selectBestMatch = (barcode) => {
    const candidates = matchesByBarcode.get(barcode) ?? [];
    if (!candidates.length) return { status: "unresolved", selected: null, candidates: [] };
    const npnSet = new Set(candidates.map((entry) => entry.npn));
    const ranked = [...candidates].sort((a, b) => {
      const aScore =
        a.rankWeight * 100 +
        (a.updatedAt ? Date.parse(a.updatedAt) / 1_000_000_000 : 0);
      const bScore =
        b.rankWeight * 100 +
        (b.updatedAt ? Date.parse(b.updatedAt) / 1_000_000_000 : 0);
      return bScore - aScore;
    });
    const selected = ranked[0] ?? null;
    if (npnSet.size > 1) {
      return { status: "conflict", selected, candidates: ranked };
    }
    return { status: "resolved", selected, candidates: ranked };
  };

  const upserts = [];
  const perBarcode = [];
  const nowIso = new Date().toISOString();
  const expiresIso = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString();

  for (const barcode of targets) {
    const existing = existingByBarcode.get(barcode) ?? null;
    if (existing) {
      perBarcode.push({
        barcode,
        action: "already_mapped",
        npn: existing.npn,
        source: existing.source,
        confidence: existing.confidence,
        evidence: [],
      });
      continue;
    }
    const match = selectBestMatch(barcode);
    if (match.status === "conflict") {
      perBarcode.push({
        barcode,
        action: "conflict_skip",
        npn: match.selected?.npn ?? null,
        source: null,
        confidence: null,
        evidence: match.candidates.slice(0, 5),
      });
      continue;
    }
    if (match.status !== "resolved" || !match.selected?.npn) {
      perBarcode.push({
        barcode,
        action: "unresolved",
        npn: null,
        source: null,
        confidence: null,
        evidence: [],
      });
      continue;
    }

    const row = {
      barcode_gtin14: barcode,
      barcode_raw: barcode.slice(-12),
      npn: match.selected.npn,
      source: sourceTag,
      confidence,
      last_seen_at: nowIso,
      expires_at: expiresIso,
    };
    upserts.push(row);
    perBarcode.push({
      barcode,
      action: dryRun ? "would_backfill" : "backfilled",
      npn: match.selected.npn,
      source: sourceTag,
      confidence,
      evidence: match.candidates.slice(0, 5),
    });
  }

  let upsertError = null;
  const upsertDurations = [];
  if (!dryRun && upserts.length > 0) {
    for (let i = 0; i < upserts.length; i += 100) {
      const slice = upserts.slice(i, i + 100);
      const startedAt = Date.now();
      const { error } = await supabase
        .from("barcode_regulatory_map")
        .upsert(slice, { onConflict: "barcode_gtin14" });
      upsertDurations.push(Date.now() - startedAt);
      if (error) {
        upsertError = error.message;
        break;
      }
    }
  }

  const counts = {
    total: targets.length,
    alreadyMapped: perBarcode.filter((row) => row.action === "already_mapped").length,
    backfilled: perBarcode.filter((row) => row.action === "backfilled").length,
    wouldBackfill: perBarcode.filter((row) => row.action === "would_backfill").length,
    unresolved: perBarcode.filter((row) => row.action === "unresolved").length,
    conflictSkip: perBarcode.filter((row) => row.action === "conflict_skip").length,
  };

  const report = {
    generatedAt: new Date().toISOString(),
    dryRun,
    sourceTag,
    confidence,
    expiryDays,
    tablePrimary,
    tableSecondary,
    pageSize,
    counts,
    tableStats,
    upsert: {
      attemptedRows: upserts.length,
      p50Ms: Number(percentile(upsertDurations, 50).toFixed(2)),
      p95Ms: Number(percentile(upsertDurations, 95).toFixed(2)),
      error: upsertError,
    },
    perBarcode,
  };

  await fs.mkdir(outDir, { recursive: true });
  const reportPath = path.join(outDir, "ca_barcode_map_backfill_report.json");
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const summaryLines = [
    "# CA Barcode -> NPN Backfill Report",
    "",
    `- generatedAt: ${report.generatedAt}`,
    `- dryRun: ${dryRun ? "yes" : "no"}`,
    `- total: ${counts.total}`,
    `- alreadyMapped: ${counts.alreadyMapped}`,
    `- backfilled: ${counts.backfilled}`,
    `- unresolved: ${counts.unresolved}`,
    `- conflictSkip: ${counts.conflictSkip}`,
    `- upsertError: ${upsertError ?? "none"}`,
    "",
    "| barcode | action | npn | source | confidence |",
    "|---|---|---|---|---:|",
    ...perBarcode.map(
      (row) =>
        `| ${row.barcode} | ${row.action} | ${row.npn ?? ""} | ${row.source ?? ""} | ${
          Number.isFinite(Number(row.confidence)) ? Number(row.confidence).toFixed(2) : ""
        } |`,
    ),
    "",
  ];
  await fs.writeFile(path.join(outDir, "ca_barcode_map_backfill_report.md"), summaryLines.join("\n"), "utf8");

  console.log(JSON.stringify({ outDir, reportPath, counts }, null, 2));
};

main().catch((error) => {
  console.error("[backfill-ca-barcode-regulatory-map] failed", error instanceof Error ? error.message : String(error));
  process.exit(1);
});

