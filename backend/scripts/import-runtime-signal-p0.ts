import fs from "node:fs";
import path from "node:path";

import { normalizeBarcodeKey } from "../src/barcodeKey.js";
import {
  type BarcodeRegulatoryMapRow,
  type BarcodeRegulatoryMapWriteOutcome,
  mapSourceToRank,
  upsertRegulatoryMapWithPolicy,
} from "../src/barcodeResolutionDbCache.js";
import { supabase } from "../src/supabase.js";

type RuntimeTierRow = {
  tier?: string;
  npn?: string;
  barcode_gtin14?: string;
  hitCount?: number;
  distinctDeviceCount?: number;
  distinctRequestCount?: number;
  sourceStrong?: boolean;
};

type PreviewStats = {
  p0_conflict_count?: number;
  writeEnabled?: boolean;
};

type ManifestRow = {
  npn?: string;
  barcode_gtin14?: string;
  executionTag?: string;
  execution_tag?: string;
};

const args = process.argv.slice(2);
const getArg = (flag: string): string | null => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};
const hasFlag = (flag: string): boolean => args.includes(`--${flag}`);
const asNumber = (value: string | null, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeManifestTag = (value: unknown): string | null => {
  const valueStr = String(value ?? "").trim().toLowerCase();
  return valueStr.length > 0 ? valueStr : null;
};

const parseTags = (value: string | null): string[] => {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
};

const tieredQueuePath =
  getArg("tiered-queue") ??
  path.resolve(process.cwd(), "output/npn_webhunt/runtime_signal/latest/runtime_tiered_queue.json");
const previewStatsPath =
  getArg("preview-stats") ??
  path.resolve(process.cwd(), "output/npn_webhunt/runtime_signal/latest/runtime_p0_preview_stats.json");
const outDir =
  getArg("out-dir") ??
  path.resolve(process.cwd(), "output/npn_webhunt/runtime_signal/import", new Date().toISOString().replace(/[:]/g, "-"));
const latestDir =
  getArg("latest-dir") ??
  path.resolve(process.cwd(), "output/npn_webhunt/runtime_signal/latest");
const source = (getArg("source") ?? "runtime_signal_v1").trim();
const dryRun = hasFlag("dry-run");
const disableRankPrefilter = hasFlag("disable-rank-prefilter");
const writeGuardMode = (getArg("write-guard-mode") ?? "enforce") as "off" | "shadow" | "enforce";
const keyContractMode = (getArg("key-contract-mode") ?? "enforce") as "off" | "shadow" | "enforce";
const timeoutMs = Math.max(500, asNumber(getArg("timeout-ms"), 1500));
const maxRows = Math.max(0, asNumber(getArg("max-rows"), 0));
const prefilterBatchSize = Math.max(100, asNumber(getArg("prefilter-batch-size"), 500));
const manifestPath = getArg("manifest-path");
const manifestTags = parseTags(getArg("manifest-tags"));

const readJsonlSafe = <T>(filePath: string): T[] => {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf8").trim();
  if (!raw) return [];
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as T;
      } catch {
        return null;
      }
    })
    .filter(Boolean) as T[];
};

const readManifestRows = (filePath: string | null): ManifestRow[] => {
  if (!filePath) return [];
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (Array.isArray(parsed)) return parsed as ManifestRow[];
    if (Array.isArray(parsed?.rows)) return parsed.rows as ManifestRow[];
  } catch {
    const rows = readJsonlSafe<ManifestRow>(filePath);
    if (rows.length > 0) return rows;
  }
  return [];
};

const ensureDir = async (dirPath: string) => {
  await fs.promises.mkdir(dirPath, { recursive: true });
};

const writeJson = async (filePath: string, payload: unknown) => {
  await ensureDir(path.dirname(filePath));
  await fs.promises.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const readJson = <T>(filePath: string): T => JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
const chunkArray = <T>(items: T[], size: number): T[][] => {
  if (items.length === 0) return [];
  const chunks: T[][] = [];
  for (let idx = 0; idx < items.length; idx += size) {
    chunks.push(items.slice(idx, idx + size));
  }
  return chunks;
};

const normalizeNpn = (value: unknown): string | null => {
  const digits = String(value ?? "").replace(/\D/g, "");
  return /^\d{8}$/.test(digits) ? digits : null;
};

const normalizeBarcode = (value: unknown): string | null => normalizeBarcodeKey(String(value ?? "")).gtin14;

const toConfidence = (row: RuntimeTierRow): number => {
  const hitCount = Number(row.hitCount ?? 0);
  const distinctDeviceCount = Number(row.distinctDeviceCount ?? 0);
  const distinctRequestCount = Number(row.distinctRequestCount ?? 0);
  const userSignal = distinctDeviceCount > 0 ? distinctDeviceCount : distinctRequestCount;
  const sourceStrongBoost = row.sourceStrong ? 0.02 : 0;
  const hitBoost = Math.min(0.04, Math.max(0, hitCount - 3) * 0.01);
  const userBoost = Math.min(0.03, Math.max(0, userSignal - 2) * 0.01);
  const value = 0.9 + sourceStrongBoost + hitBoost + userBoost;
  return Math.max(0.85, Math.min(0.99, Number(value.toFixed(3))));
};

const writeAuditCandidate = async (params: {
  barcodeGtin14: string;
  npn: string;
  confidence: number;
  reasonCode: string;
  existing: BarcodeRegulatoryMapRow | null;
  existingRank: number | null;
  incomingRank: number;
  source: string;
}) => {
  const payload = {
    barcode_gtin14: params.barcodeGtin14,
    barcode_raw: params.barcodeGtin14,
    incoming_npn: params.npn,
    incoming_source: params.source,
    incoming_confidence: params.confidence,
    incoming_expires_at: null,
    incoming_rank: params.incomingRank,
    existing_npn: params.existing?.npn ?? null,
    existing_source: params.existing?.source ?? null,
    existing_confidence: params.existing?.confidence ?? null,
    existing_expires_at: params.existing?.expires_at ?? null,
    existing_rank: params.existingRank,
    reason_code: params.reasonCode,
  };
  const { error } = await supabase.from("barcode_regulatory_map_candidates").insert(payload);
  if (error) {
    throw new Error(`audit_insert_failed:${error.message}`);
  }
};

const main = async () => {
  const tierRows = readJson<RuntimeTierRow[]>(tieredQueuePath);
  const previewStats = fs.existsSync(previewStatsPath) ? readJson<PreviewStats>(previewStatsPath) : null;

  if (manifestPath && manifestTags.length === 0) {
    throw new Error("manifest-tags is required when manifest-path is set");
  }

  const manifestRows = readManifestRows(manifestPath);
  const manifestTagSet = new Set(manifestTags);
  const manifestKeySet = new Set<string>();
  let manifestMatchedTotal = 0;
  let manifestMatchedTagTotal = 0;

  for (const row of manifestRows) {
    const npn = normalizeNpn(row.npn);
    const barcode = normalizeBarcode(row.barcode_gtin14);
    if (!npn || !barcode) continue;
    manifestMatchedTotal += 1;
    const tag = normalizeManifestTag(row.executionTag) ?? normalizeManifestTag(row.execution_tag) ?? "";
    if (tag && !manifestTagSet.has(tag)) continue;
    manifestMatchedTagTotal += 1;
    manifestKeySet.add(`${npn}|${barcode}`);
  }

  const p0Rows = tierRows
    .filter((row) => String(row.tier ?? "") === "P0_auto_import")
    .filter((row) => normalizeNpn(row.npn) && normalizeBarcode(row.barcode_gtin14));
  const manifestEnabled = manifestPath != null && manifestTagSet.size > 0;
  const rows = p0Rows
    .filter((row) => {
      if (!manifestEnabled) return true;
      const npn = normalizeNpn(row.npn);
      const barcode = normalizeBarcode(row.barcode_gtin14);
      if (!npn || !barcode) return false;
      return manifestKeySet.has(`${npn}|${barcode}`);
    })
    .slice(0, maxRows > 0 ? maxRows : undefined);

  const manifestMisses = manifestEnabled ? Math.max(0, manifestKeySet.size - rows.length) : 0;

  let conflictsByBarcode = 0;
  let invalidGtin14 = 0;
  const npnByBarcode = new Map<string, Set<string>>();
  for (const row of rows) {
    const npn = normalizeNpn(row.npn);
    const barcode = normalizeBarcode(row.barcode_gtin14);
    if (!barcode || !npn) {
      invalidGtin14 += 1;
      continue;
    }
    if (!npnByBarcode.has(barcode)) npnByBarcode.set(barcode, new Set<string>());
    npnByBarcode.get(barcode)!.add(npn);
  }
  for (const set of npnByBarcode.values()) {
    if (set.size > 1) conflictsByBarcode += 1;
  }

  const previewConflictCount = Number(previewStats?.p0_conflict_count ?? 0);
  const previewWriteEnabled = previewStats?.writeEnabled !== false;
  const writeAllowed =
    previewConflictCount === 0 &&
    conflictsByBarcode === 0 &&
    invalidGtin14 === 0 &&
    previewWriteEnabled;

  let attempted = 0;
  let imported = 0;
  let blocked = 0;
  let failed = 0;
  let downgradeBlockedCount = 0;
  let prefilterLowerRankSkipped = 0;
  let alreadyPresentHigherRankSameNpn = 0;
  let auditRowsWritten = 0;
  let skippedByGate = 0;
  let manifestMatched = 0;
  let manifestSkipped = 0;
  const incomingRank = mapSourceToRank(source);

  const existingByBarcode = new Map<string, BarcodeRegulatoryMapRow>();
  if (!disableRankPrefilter && rows.length > 0) {
    const barcodeList = Array.from(
      new Set(
        rows
          .map((row) => normalizeBarcode(row.barcode_gtin14))
          .filter((barcode): barcode is string => Boolean(barcode)),
      ),
    );
    for (const chunk of chunkArray(barcodeList, prefilterBatchSize)) {
      const { data, error } = await supabase
        .from("barcode_regulatory_map")
        .select("barcode_gtin14,npn,source,confidence,last_seen_at,expires_at,created_at,updated_at")
        .in("barcode_gtin14", chunk);
      if (error) {
        throw new Error(`prefilter_fetch_failed:${error.message}`);
      }
      for (const row of data ?? []) {
        const barcode = normalizeBarcode((row as { barcode_gtin14?: string }).barcode_gtin14 ?? "");
        if (!barcode) continue;
        existingByBarcode.set(barcode, row as BarcodeRegulatoryMapRow);
      }
    }
  }

  const resultRows: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    const npn = normalizeNpn(row.npn);
    const barcode = normalizeBarcode(row.barcode_gtin14);
    if (!npn || !barcode) continue;
    attempted += 1;
    const manifestKey = `${npn}|${barcode}`;
    const manifestUsed = manifestEnabled ? manifestKeySet.has(manifestKey) : false;
    if (manifestEnabled) {
      if (manifestUsed) {
        manifestMatched += 1;
      } else {
        manifestSkipped += 1;
      }
    }

    if (!writeAllowed) {
      skippedByGate += 1;
      resultRows.push({
        npn,
        barcode_gtin14: barcode,
        status: "skipped_by_gate",
        reason: "precision_gate_failed",
      });
      continue;
    }

    const confidence = toConfidence(row);
    if (!disableRankPrefilter) {
      const existing = existingByBarcode.get(barcode) ?? null;
      if (existing) {
        const existingRank = mapSourceToRank(existing.source);
        if (incomingRank < existingRank) {
          const existingNpn = normalizeNpn(existing.npn);
          if (existingNpn && existingNpn === npn) {
            alreadyPresentHigherRankSameNpn += 1;
            const reasonCode = "runtime_signal_already_present_higher_rank_same_npn";
            try {
              await writeAuditCandidate({
                barcodeGtin14: barcode,
                npn,
                confidence,
                reasonCode,
                existing,
                existingRank,
                incomingRank,
                source,
              });
              auditRowsWritten += 1;
            } catch {
              failed += 1;
            }
            resultRows.push({
              npn,
              barcode_gtin14: barcode,
              status: "already_present",
              reason: "higher_rank_same_npn",
              existingRank,
              incomingRank,
              manifestUsed,
            });
            continue;
          }
          blocked += 1;
          downgradeBlockedCount += 1;
          prefilterLowerRankSkipped += 1;
          const reasonCode = "runtime_signal_blocked_lower_rank_prefilter";
          try {
            await writeAuditCandidate({
              barcodeGtin14: barcode,
              npn,
              confidence,
              reasonCode,
              existing,
              existingRank,
              incomingRank,
              source,
            });
            auditRowsWritten += 1;
          } catch {
            failed += 1;
          }
          resultRows.push({
            npn,
            barcode_gtin14: barcode,
            status: "blocked",
            reason: "lower_rank_prefilter",
            existingRank,
            incomingRank,
          });
          continue;
        }
      }
    }

    if (dryRun) {
      imported += 1;
      resultRows.push({
        npn,
        barcode_gtin14: barcode,
        status: "dry_run_preview",
      });
      continue;
    }

    let outcome: BarcodeRegulatoryMapWriteOutcome;
    try {
      outcome = await upsertRegulatoryMapWithPolicy(
        {
          barcodeGtin14: barcode,
          barcodeRaw: barcode,
          npn,
          confidence,
          source,
          expiresAt: null,
        },
        { timeoutMs, keyContractMode, writeGuardMode },
      );
    } catch (error) {
      failed += 1;
      resultRows.push({
        npn,
        barcode_gtin14: barcode,
        status: "failed",
        reason: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    if (outcome.status === "upserted") {
      imported += 1;
    } else {
      blocked += 1;
      if (
        outcome.reason === "lower_rank" ||
        outcome.reason === "equal_rank_not_better" ||
        outcome.reason === "negative_signal"
      ) {
        downgradeBlockedCount += 1;
      }
    }

    const reasonCode =
      outcome.status === "upserted"
        ? "runtime_signal_upserted"
        : `runtime_signal_blocked_${String(outcome.reason ?? "unknown")}`;
    try {
      await writeAuditCandidate({
        barcodeGtin14: barcode,
        npn,
        confidence,
        reasonCode,
        existing: outcome.existing,
        existingRank: outcome.existingRank,
        incomingRank: outcome.incomingRank,
        source,
      });
      auditRowsWritten += 1;
    } catch {
      failed += 1;
    }

    resultRows.push({
      npn,
      barcode_gtin14: barcode,
      status: outcome.status,
      reason: outcome.reason,
      existingRank: outcome.existingRank,
      incomingRank: outcome.incomingRank,
      manifestUsed,
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    source,
    dryRun,
    writeGuardMode,
    keyContractMode,
    inputs: {
      tieredQueuePath,
      previewStatsPath,
      p0Rows: p0Rows.length,
      maxRows,
      manifestPath,
      manifestTags,
      manifestEnabled,
      manifestTotal: manifestMatchedTotal,
      manifestMatchedTagTotal,
      manifestMatched,
      manifestSkipped,
      manifestMisses,
    },
    gates: {
      writeAllowed,
      previewConflictCount,
      conflictsByBarcode,
      invalid_gtin14: invalidGtin14,
      previewWriteEnabled,
      manifestEnabled,
      manifestMatchedTotal,
      manifestMatched,
      manifestSkipped,
      manifestMisses,
    },
    stats: {
      attempted,
      imported,
      effectiveAccepted: imported + alreadyPresentHigherRankSameNpn,
      blocked,
      failed,
      alreadyPresentHigherRankSameNpn,
      skippedByGate,
      conflictsByBarcode,
      invalid_gtin14: invalidGtin14,
      downgradeBlockedCount,
      prefilterLowerRankSkipped,
      auditRowsWritten,
    },
    files: {
      reportJson: path.join(outDir, "runtime_p0_import_report.json"),
      resultJson: path.join(outDir, "runtime_p0_import_rows.json"),
    },
  };

  await ensureDir(outDir);
  await writeJson(report.files.reportJson, report);
  await writeJson(report.files.resultJson, resultRows);
  await ensureDir(latestDir);
  await writeJson(path.join(latestDir, "runtime_p0_import_report.json"), report);
  await writeJson(path.join(latestDir, "runtime_p0_import_rows.json"), resultRows);

  console.log(
    JSON.stringify(
      {
        ok: true,
        outDir,
        writeAllowed,
        attempted,
        imported,
        effectiveAccepted: imported + alreadyPresentHigherRankSameNpn,
        blocked,
        failed,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error("[import-runtime-signal-p0] fatal:", error instanceof Error ? error.message : error);
  process.exit(1);
});
