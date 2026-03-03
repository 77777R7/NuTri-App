import fs from "node:fs";
import path from "node:path";

import { normalizeBarcodeKey } from "../src/barcodeKey.js";
import { supabase } from "../src/supabase.js";

type RuntimeCandidateRow = {
  npn?: string;
  barcode_gtin14?: string;
  hitCount?: number;
  distinctDeviceCount?: number;
  distinctRequestCount?: number;
  userEstimateBase?: number;
  sourceKinds?: string[];
  candidateSources?: string[];
  timeoutHitCount?: number;
  brandName?: string | null;
  productName?: string | null;
  twoHopHint?: string | null;
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
};

type Tier = "P0_auto_import" | "P1_review" | "P2_reject" | "conflict";

type BarcodeMapRow = {
  barcode_gtin14: string | null;
  npn: string | null;
  source: string | null;
};

type FactsRow = {
  npn: string | null;
  facts_json: Record<string, unknown> | null;
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

const inputPath =
  getArg("input") ??
  path.resolve(process.cwd(), "output/npn_webhunt/runtime_signal/latest/runtime_signal_candidate_queue.jsonl");
const outDir =
  getArg("out-dir") ??
  path.resolve(process.cwd(), "output/npn_webhunt/runtime_signal", new Date().toISOString().replace(/[:]/g, "-"));
const latestDir =
  getArg("latest-dir") ??
  path.resolve(process.cwd(), "output/npn_webhunt/runtime_signal/latest");
const topMissBrandLimit = Math.max(5, Math.min(100, asNumber(getArg("top-miss-brand-limit"), 20)));
const p0HitMin = Math.max(2, asNumber(getArg("p0-hit-min"), 3));
const p0DistinctMin = Math.max(1, asNumber(getArg("p0-distinct-min"), 2));
const p1HitMin = Math.max(1, asNumber(getArg("p1-hit-min"), 2));
const p1HighValueHitMin = Math.max(3, asNumber(getArg("p1-high-value-hit-min"), 5));
const factsCheck = !hasFlag("skip-facts-candidates-check");
const chunkSize = Math.max(100, Math.min(1000, asNumber(getArg("chunk-size"), 400)));

const ensureDir = async (dirPath: string) => {
  await fs.promises.mkdir(dirPath, { recursive: true });
};

const writeJson = async (filePath: string, payload: unknown) => {
  await ensureDir(path.dirname(filePath));
  await fs.promises.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const writeJsonl = async (filePath: string, rows: Record<string, unknown>[]) => {
  await ensureDir(path.dirname(filePath));
  const payload = rows.map((row) => JSON.stringify(row)).join("\n");
  await fs.promises.writeFile(filePath, rows.length ? `${payload}\n` : "", "utf8");
};

const readJsonl = (filePath: string): RuntimeCandidateRow[] => {
  const raw = fs.readFileSync(filePath, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RuntimeCandidateRow);
};

const normalizeNpn = (value: unknown): string | null => {
  const digits = String(value ?? "").replace(/\D/g, "");
  return /^\d{8}$/.test(digits) ? digits : null;
};

const normalizeBarcode = (value: unknown): string | null => {
  const normalized = normalizeBarcodeKey(String(value ?? ""));
  return normalized.gtin14;
};

const normalizeBrand = (value: unknown): string => {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
};

const toStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? "").trim())
    .filter((item) => item.length > 0);
};

const loadMapRowsByBarcodes = async (barcodes: string[]): Promise<BarcodeMapRow[]> => {
  const rows: BarcodeMapRow[] = [];
  const unique = Array.from(new Set(barcodes));
  for (let i = 0; i < unique.length; i += chunkSize) {
    const slice = unique.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from("barcode_regulatory_map")
      .select("barcode_gtin14,npn,source")
      .in("barcode_gtin14", slice)
      .is("expires_at", null);
    if (error) throw new Error(`barcode_regulatory_map_query_failed: ${error.message}`);
    rows.push(...((data ?? []) as BarcodeMapRow[]));
  }
  return rows;
};

const loadFactsRowsByNpns = async (table: "lnhpd_facts" | "lnhpd_facts_complete", npns: string[]): Promise<FactsRow[]> => {
  const rows: FactsRow[] = [];
  const unique = Array.from(new Set(npns));
  for (let i = 0; i < unique.length; i += chunkSize) {
    const slice = unique.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from(table)
      .select("npn,facts_json")
      .in("npn", slice);
    if (error) throw new Error(`${table}_query_failed: ${error.message}`);
    rows.push(...((data ?? []) as FactsRow[]));
  }
  return rows;
};

const extractFactsPairSet = (rows: FactsRow[]): Set<string> => {
  const out = new Set<string>();
  for (const row of rows) {
    const npn = normalizeNpn(row.npn);
    if (!npn) continue;
    const facts = row.facts_json ?? {};
    const barcodeCandidates = Array.isArray((facts as Record<string, unknown>).barcodeCandidates)
      ? ((facts as Record<string, unknown>).barcodeCandidates as unknown[])
      : [];
    for (const item of barcodeCandidates) {
      let barcode: string | null = null;
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const rowObj = item as Record<string, unknown>;
        barcode = normalizeBarcode(rowObj.barcode ?? rowObj.barcode_gtin14 ?? rowObj.gtin14 ?? rowObj.value);
      } else {
        barcode = normalizeBarcode(item);
      }
      if (!barcode) continue;
      out.add(`${npn}|${barcode}`);
    }
  }
  return out;
};

const isStrongSource = (sourceKinds: string[], candidateSources: string[]): boolean => {
  const kindSet = new Set(sourceKinds.map((item) => item.toLowerCase()));
  const sourceSet = new Set(candidateSources.map((item) => item.toLowerCase()));
  if (kindSet.has("stream_stability_product_identity")) return true;
  if (kindSet.has("regulatory_ids_candidates")) return true;
  return sourceSet.has("map") || sourceSet.has("snapshot") || sourceSet.has("lnhpd_fetch");
};

const main = async () => {
  const candidateRows = readJsonl(inputPath)
    .map((row) => {
      const npn = normalizeNpn(row.npn);
      const barcode = normalizeBarcode(row.barcode_gtin14);
      if (!npn || !barcode) return null;
      return {
        npn,
        barcode_gtin14: barcode,
        hitCount: Number(row.hitCount ?? 0),
        distinctDeviceCount: Number(row.distinctDeviceCount ?? 0),
        distinctRequestCount: Number(row.distinctRequestCount ?? 0),
        userEstimateBase: Number(row.userEstimateBase ?? 0),
        sourceKinds: toStringArray(row.sourceKinds),
        candidateSources: toStringArray(row.candidateSources),
        timeoutHitCount: Number(row.timeoutHitCount ?? 0),
        brandName: String(row.brandName ?? "").trim() || null,
        productName: String(row.productName ?? "").trim() || null,
        twoHopHint: String(row.twoHopHint ?? "").trim() || null,
        firstSeenAt: row.firstSeenAt ?? null,
        lastSeenAt: row.lastSeenAt ?? null,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  const barcodes = candidateRows.map((row) => row.barcode_gtin14);
  const npns = candidateRows.map((row) => row.npn);
  const mapRows = await loadMapRowsByBarcodes(barcodes);

  const mapByBarcode = new Map<string, Set<string>>();
  for (const row of mapRows) {
    const barcode = normalizeBarcode(row.barcode_gtin14);
    const npn = normalizeNpn(row.npn);
    if (!barcode || !npn) continue;
    if (!mapByBarcode.has(barcode)) mapByBarcode.set(barcode, new Set<string>());
    mapByBarcode.get(barcode)!.add(npn);
  }

  let factsPairSet = new Set<string>();
  if (factsCheck && npns.length > 0) {
    const [rowsFacts, rowsFactsComplete] = await Promise.all([
      loadFactsRowsByNpns("lnhpd_facts", npns),
      loadFactsRowsByNpns("lnhpd_facts_complete", npns),
    ]);
    factsPairSet = extractFactsPairSet([...rowsFacts, ...rowsFactsComplete]);
  }

  const npnsByBarcode = new Map<string, Set<string>>();
  for (const row of candidateRows) {
    if (!npnsByBarcode.has(row.barcode_gtin14)) npnsByBarcode.set(row.barcode_gtin14, new Set<string>());
    npnsByBarcode.get(row.barcode_gtin14)!.add(row.npn);
  }

  const provisionalRows = candidateRows.map((row) => {
    const barcodeMapNpns = mapByBarcode.get(row.barcode_gtin14) ?? new Set<string>();
    const conflictNpns = Array.from(barcodeMapNpns).filter((value) => value !== row.npn);
    const intraBatchConflicts = Array.from(npnsByBarcode.get(row.barcode_gtin14) ?? new Set<string>()).filter(
      (value) => value !== row.npn,
    );
    const factsDuplicate = factsPairSet.has(`${row.npn}|${row.barcode_gtin14}`);
    const sourceStrong = isStrongSource(row.sourceKinds, row.candidateSources);
    const distinctUserCount = row.distinctDeviceCount > 0 ? row.distinctDeviceCount : row.distinctRequestCount;

    let tier: Tier = "P2_reject";
    let rejectReason = "low_signal";
    if (conflictNpns.length || intraBatchConflicts.length) {
      tier = "conflict";
      rejectReason = "barcode_conflict";
    } else if (
      !factsDuplicate &&
      row.hitCount >= p0HitMin &&
      distinctUserCount >= p0DistinctMin &&
      sourceStrong
    ) {
      tier = "P0_auto_import";
      rejectReason = "";
    } else if (!factsDuplicate && row.hitCount >= p1HitMin) {
      tier = "P1_review";
      rejectReason = sourceStrong ? "needs_more_consensus" : "weak_source_strength";
    } else if (factsDuplicate) {
      tier = "P2_reject";
      rejectReason = "duplicate_in_facts_candidates";
    }

    return {
      ...row,
      tier,
      rejectReason,
      conflictNpns,
      intraBatchConflicts,
      factsDuplicate,
      sourceStrong,
      distinctUserCount,
    };
  });

  const nonP0BrandCounter = new Map<string, number>();
  for (const row of provisionalRows) {
    if (row.tier === "P0_auto_import") continue;
    const brandKey = normalizeBrand(row.brandName);
    if (!brandKey) continue;
    nonP0BrandCounter.set(brandKey, (nonP0BrandCounter.get(brandKey) ?? 0) + row.hitCount);
  }
  const topMissBrandKeys = new Set(
    Array.from(nonP0BrandCounter.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, topMissBrandLimit)
      .map(([key]) => key),
  );

  const tieredRows = provisionalRows.map((row) => {
    const brandKey = normalizeBrand(row.brandName);
    const isTopMissBrand = brandKey.length > 0 && topMissBrandKeys.has(brandKey);
    const isHighScanNoFinal = row.hitCount >= p1HighValueHitMin;
    const highValueP1 =
      row.tier === "P1_review" && (isTopMissBrand || row.timeoutHitCount > 0 || isHighScanNoFinal);
    return {
      ...row,
      isTopMissBrand,
      isHighScanNoFinal,
      highValueP1,
      domainTier: "runtime",
    };
  });

  const p0Rows = tieredRows.filter((row) => row.tier === "P0_auto_import");
  const conflictRows = tieredRows.filter((row) => row.tier === "conflict");
  const p1Rows = tieredRows.filter((row) => row.tier === "P1_review");
  const p2Rows = tieredRows.filter((row) => row.tier === "P2_reject");
  const p1HighValueRows = tieredRows.filter((row) => row.highValueP1);

  const p0BrandCounter = new Map<string, number>();
  for (const row of p0Rows) {
    const brand = row.brandName ?? "(unknown)";
    p0BrandCounter.set(brand, (p0BrandCounter.get(brand) ?? 0) + row.hitCount);
  }

  const previewStats = {
    generatedAt: new Date().toISOString(),
    inputPath,
    p0_count: p0Rows.length,
    p0_conflict_count: conflictRows.length,
    p0_distinct_user_estimate: p0Rows.reduce((sum, row) => sum + Math.max(0, row.userEstimateBase), 0),
    top_brands_in_p0: Array.from(p0BrandCounter.entries())
      .map(([brandName, count]) => ({ brandName, count }))
      .sort((a, b) => b.count - a.count || a.brandName.localeCompare(b.brandName))
      .slice(0, 20),
    tier_counts: {
      P0_auto_import: p0Rows.length,
      P1_review: p1Rows.length,
      P2_reject: p2Rows.length,
      conflict: conflictRows.length,
    },
    p1_high_value_count: p1HighValueRows.length,
    writeEnabled: conflictRows.length === 0,
  };

  const runtimeQueueJson = path.join(outDir, "runtime_tiered_queue.json");
  const runtimePreviewJson = path.join(outDir, "runtime_p0_preview_stats.json");
  const runtimeP1HighValueJsonl = path.join(outDir, "runtime_p1_high_value_queue.jsonl");
  const repairPriorityJson = path.join(outDir, "repair_priority_queue.json");

  await ensureDir(outDir);
  await writeJson(runtimeQueueJson, tieredRows);
  await writeJson(runtimePreviewJson, previewStats);
  await writeJson(
    repairPriorityJson,
    tieredRows
      .filter((row) => row.tier !== "P0_auto_import")
      .map((row) => ({
        queuePriority: row.tier === "conflict" ? 1 : row.tier === "P1_review" ? 2 : 3,
        recommendedAction:
          row.tier === "conflict"
            ? "manual_conflict_resolution"
            : row.tier === "P1_review"
              ? "manual_evidence_review"
              : "needs_higher_quality_sources",
        ...row,
      })),
  );
  await writeJsonl(
    runtimeP1HighValueJsonl,
    p1HighValueRows.map((row, idx) => ({
      queueIndex: idx + 1,
      npn: row.npn,
      brandName: row.brandName,
      productName: row.productName,
      twoHopHint: row.twoHopHint,
      reason: row.timeoutHitCount > 0 ? "timeout_family_high_value" : row.isTopMissBrand ? "top_miss_brand" : "high_scan_no_final",
      timeoutHitCount: row.timeoutHitCount,
      hitCount: row.hitCount,
      distinctDeviceCount: row.distinctDeviceCount,
      distinctRequestCount: row.distinctRequestCount,
    })),
  );

  await ensureDir(latestDir);
  await writeJson(path.join(latestDir, "runtime_tiered_queue.json"), tieredRows);
  await writeJson(path.join(latestDir, "runtime_p0_preview_stats.json"), previewStats);
  await writeJson(
    path.join(latestDir, "repair_priority_queue.json"),
    tieredRows
      .filter((row) => row.tier !== "P0_auto_import")
      .map((row) => ({
        queuePriority: row.tier === "conflict" ? 1 : row.tier === "P1_review" ? 2 : 3,
        recommendedAction:
          row.tier === "conflict"
            ? "manual_conflict_resolution"
            : row.tier === "P1_review"
              ? "manual_evidence_review"
              : "needs_higher_quality_sources",
        ...row,
      })),
  );
  await writeJsonl(
    path.join(latestDir, "runtime_p1_high_value_queue.jsonl"),
    p1HighValueRows.map((row, idx) => ({
      queueIndex: idx + 1,
      npn: row.npn,
      brandName: row.brandName,
      productName: row.productName,
      twoHopHint: row.twoHopHint,
      reason: row.timeoutHitCount > 0 ? "timeout_family_high_value" : row.isTopMissBrand ? "top_miss_brand" : "high_scan_no_final",
      timeoutHitCount: row.timeoutHitCount,
      hitCount: row.hitCount,
      distinctDeviceCount: row.distinctDeviceCount,
      distinctRequestCount: row.distinctRequestCount,
    })),
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        outDir,
        p0Count: p0Rows.length,
        p0ConflictCount: conflictRows.length,
        p1HighValueCount: p1HighValueRows.length,
        writeEnabled: previewStats.writeEnabled,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error("[classify-runtime-signal-candidates] fatal:", error instanceof Error ? error.message : error);
  process.exit(1);
});
