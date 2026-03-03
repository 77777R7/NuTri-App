import fs from "node:fs";
import path from "node:path";

import { normalizeBarcodeKey } from "../src/barcodeKey.js";
import { supabase } from "../src/supabase.js";

type BarcodeScanRow = {
  barcode_gtin14: string | null;
  brand_name: string | null;
  product_name: string | null;
  device_id: string | null;
  request_id: string | null;
  served_from: string | null;
  created_at: string | null;
  meta: Record<string, unknown> | null;
};

type SourceKind =
  | "stream_stability_product_identity"
  | "meta_npn"
  | "regulatory_ids_candidates"
  | "meta_npn_candidate";

type CandidateAccumulator = {
  npn: string;
  barcodeGtin14: string;
  hitCount: number;
  distinctDeviceIds: Set<string>;
  distinctRequestIds: Set<string>;
  brandCounter: Map<string, number>;
  productCounter: Map<string, number>;
  sourceKindCounter: Map<SourceKind, number>;
  candidateSourceCounter: Map<string, number>;
  timeoutHitCount: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
};

const args = process.argv.slice(2);
const getArg = (flag: string): string | null => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const asNumber = (value: string | null, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const stamp = new Date().toISOString().replace(/[:]/g, "-");
const outDir =
  getArg("out-dir") ??
  path.resolve(process.cwd(), "output/npn_webhunt/runtime_signal", stamp);
const latestDir =
  getArg("latest-dir") ??
  path.resolve(process.cwd(), "output/npn_webhunt/runtime_signal/latest");
const lookbackHours = Math.max(1, asNumber(getArg("lookback-hours"), 24 * 90));
const pageSize = Math.max(500, Math.min(5000, asNumber(getArg("page-size"), 2000)));
const maxRows = Math.max(0, asNumber(getArg("max-rows"), 0));
const servedFrom = (getArg("served-from") ?? "lnhpd").trim().toLowerCase();

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

const normalizeNpn = (value: unknown): string | null => {
  const digits = String(value ?? "").replace(/\D/g, "");
  return /^\d{8}$/.test(digits) ? digits : null;
};

const normalizeBarcode = (value: unknown): string | null => {
  const normalized = normalizeBarcodeKey(String(value ?? ""));
  return normalized.gtin14;
};

const normalizeTextKey = (value: unknown): string | null => {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return text;
};

const toIso = (value: unknown): string | null => {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
};

const pickTopValue = (counter: Map<string, number>): string | null => {
  const rows = Array.from(counter.entries());
  if (!rows.length) return null;
  rows.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return rows[0][0] ?? null;
};

const extractString = (obj: Record<string, unknown> | null | undefined, key: string): string | null => {
  if (!obj || typeof obj !== "object") return null;
  const value = obj[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const extractNpnCandidates = (meta: Record<string, unknown> | null): Array<{
  npn: string;
  sourceKind: SourceKind;
  candidateSource: string | null;
}> => {
  const out: Array<{ npn: string; sourceKind: SourceKind; candidateSource: string | null }> = [];
  const seen = new Set<string>();
  const push = (npnValue: string | null, sourceKind: SourceKind, candidateSource: string | null = null) => {
    if (!npnValue) return;
    const normalized = normalizeNpn(npnValue);
    if (!normalized) return;
    const key = `${normalized}|${sourceKind}|${candidateSource ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ npn: normalized, sourceKind, candidateSource });
  };

  const streamStability =
    meta?.stream_stability && typeof meta.stream_stability === "object"
      ? (meta.stream_stability as Record<string, unknown>)
      : null;
  const productIdentity =
    streamStability?.productIdentity && typeof streamStability.productIdentity === "object"
      ? (streamStability.productIdentity as Record<string, unknown>)
      : null;
  const sourceId = extractString(productIdentity, "sourceId");
  if (sourceId && sourceId.toLowerCase().startsWith("npn:")) {
    push(sourceId.slice(4), "stream_stability_product_identity", "stream_stability");
  }

  push(extractString(meta, "npn"), "meta_npn", extractString(meta, "npn_candidate_source"));
  push(extractString(meta, "npn_candidate"), "meta_npn_candidate", extractString(meta, "npn_candidate_source"));

  const regulatoryIds =
    meta?.regulatoryIds && typeof meta.regulatoryIds === "object"
      ? (meta.regulatoryIds as Record<string, unknown>)
      : null;
  const npnCandidates = Array.isArray(regulatoryIds?.npnCandidates)
    ? (regulatoryIds?.npnCandidates as unknown[])
    : [];
  for (const item of npnCandidates) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const sourceKindRaw = String(row.sourceKind ?? "").trim().toLowerCase();
    const candidateSource =
      sourceKindRaw ||
      String(row.stableReason ?? "").trim().toLowerCase() ||
      extractString(meta, "npn_candidate_source");
    push(String(row.value ?? ""), "regulatory_ids_candidates", candidateSource ?? null);
  }

  return out;
};

const hasTimeoutSignal = (meta: Record<string, unknown> | null): boolean => {
  if (!meta) return false;
  const fields = [
    extractString(meta, "terminalReason"),
    extractString(meta, "reasonCode"),
    extractString(meta, "fallbackReason"),
    extractString(meta, "errorCode"),
  ];
  const streamStability =
    meta.stream_stability && typeof meta.stream_stability === "object"
      ? (meta.stream_stability as Record<string, unknown>)
      : null;
  fields.push(extractString(streamStability, "terminalReason"));
  fields.push(extractString(streamStability, "reasonCode"));
  const merged = fields
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toUpperCase();
  if (!merged) return false;
  return merged.includes("FULL_REV1_MISSING_GUARD_TIMEOUT") || merged.includes("PERSISTENT_TIMEOUT");
};

const main = async () => {
  const sinceIso = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();
  const acc = new Map<string, CandidateAccumulator>();

  let fetchedRows = 0;
  let from = 0;
  while (true) {
    const to = from + pageSize - 1;
    const query = supabase
      .from("barcode_scans")
      .select("barcode_gtin14,brand_name,product_name,device_id,request_id,served_from,created_at,meta")
      .gte("created_at", sinceIso)
      .eq("served_from", servedFrom)
      .order("created_at", { ascending: false })
      .range(from, to);
    const { data, error } = await query;
    if (error) {
      throw new Error(`barcode_scans_query_failed: ${error.message}`);
    }
    const rows = (data ?? []) as BarcodeScanRow[];
    if (!rows.length) break;
    fetchedRows += rows.length;

    for (const row of rows) {
      const barcode = normalizeBarcode(row.barcode_gtin14);
      if (!barcode) continue;
      const meta = row.meta && typeof row.meta === "object" ? row.meta : null;
      const npnCandidates = extractNpnCandidates(meta);
      if (!npnCandidates.length) continue;

      const brandKey = normalizeTextKey(row.brand_name);
      const productKey = normalizeTextKey(row.product_name);
      const deviceId = normalizeTextKey(row.device_id);
      const requestId = normalizeTextKey(row.request_id);
      const createdAt = toIso(row.created_at);
      const timeoutSignal = hasTimeoutSignal(meta);

      for (const candidate of npnCandidates) {
        const key = `${candidate.npn}|${barcode}`;
        const existing = acc.get(key) ?? {
          npn: candidate.npn,
          barcodeGtin14: barcode,
          hitCount: 0,
          distinctDeviceIds: new Set<string>(),
          distinctRequestIds: new Set<string>(),
          brandCounter: new Map<string, number>(),
          productCounter: new Map<string, number>(),
          sourceKindCounter: new Map<SourceKind, number>(),
          candidateSourceCounter: new Map<string, number>(),
          timeoutHitCount: 0,
          firstSeenAt: createdAt,
          lastSeenAt: createdAt,
        };

        existing.hitCount += 1;
        if (deviceId) existing.distinctDeviceIds.add(deviceId);
        if (requestId) existing.distinctRequestIds.add(requestId);
        if (brandKey) existing.brandCounter.set(brandKey, (existing.brandCounter.get(brandKey) ?? 0) + 1);
        if (productKey) existing.productCounter.set(productKey, (existing.productCounter.get(productKey) ?? 0) + 1);
        existing.sourceKindCounter.set(
          candidate.sourceKind,
          (existing.sourceKindCounter.get(candidate.sourceKind) ?? 0) + 1,
        );
        if (candidate.candidateSource) {
          existing.candidateSourceCounter.set(
            candidate.candidateSource,
            (existing.candidateSourceCounter.get(candidate.candidateSource) ?? 0) + 1,
          );
        }
        if (timeoutSignal) existing.timeoutHitCount += 1;
        if (!existing.firstSeenAt || (createdAt && createdAt < existing.firstSeenAt)) existing.firstSeenAt = createdAt;
        if (!existing.lastSeenAt || (createdAt && createdAt > existing.lastSeenAt)) existing.lastSeenAt = createdAt;

        acc.set(key, existing);
      }
    }

    if (rows.length < pageSize) break;
    if (maxRows > 0 && fetchedRows >= maxRows) break;
    from += rows.length;
  }

  const rows = Array.from(acc.values())
    .map((row) => {
      const sourceKinds = Array.from(row.sourceKindCounter.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([value]) => value);
      const candidateSources = Array.from(row.candidateSourceCounter.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([value]) => value);
      const brandName = pickTopValue(row.brandCounter);
      const productName = pickTopValue(row.productCounter);
      const distinctDeviceCount = row.distinctDeviceIds.size;
      const distinctRequestCount = row.distinctRequestIds.size;
      return {
        npn: row.npn,
        barcode_gtin14: row.barcodeGtin14,
        hitCount: row.hitCount,
        distinctDeviceCount,
        distinctRequestCount,
        userEstimateBase: distinctDeviceCount > 0 ? distinctDeviceCount : distinctRequestCount,
        sourceKinds,
        candidateSources,
        timeoutHitCount: row.timeoutHitCount,
        brandName,
        productName,
        firstSeenAt: row.firstSeenAt,
        lastSeenAt: row.lastSeenAt,
        twoHopHint: [brandName ?? "", productName ?? "", "barcode upc gtin"].join(" ").replace(/\s+/g, " ").trim(),
      };
    })
    .sort((a, b) => b.hitCount - a.hitCount || a.npn.localeCompare(b.npn));

  const topBrands = new Map<string, number>();
  for (const row of rows) {
    if (!row.brandName) continue;
    topBrands.set(row.brandName, (topBrands.get(row.brandName) ?? 0) + row.hitCount);
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    lookbackHours,
    servedFrom,
    fetchedRows,
    candidatePairs: rows.length,
    distinctNpns: new Set(rows.map((row) => row.npn)).size,
    distinctBarcodes: new Set(rows.map((row) => row.barcode_gtin14)).size,
    topBrands: Array.from(topBrands.entries())
      .map(([brandName, count]) => ({ brandName, count }))
      .sort((a, b) => b.count - a.count || a.brandName.localeCompare(b.brandName))
      .slice(0, 20),
    files: {
      queueJsonl: path.join(outDir, "runtime_signal_candidate_queue.jsonl"),
      summaryJson: path.join(outDir, "runtime_signal_candidate_summary.json"),
    },
  };

  await ensureDir(outDir);
  await writeJsonl(summary.files.queueJsonl, rows as Record<string, unknown>[]);
  await writeJson(summary.files.summaryJson, summary);
  await ensureDir(latestDir);
  await writeJson(path.join(latestDir, "runtime_signal_candidate_summary.json"), summary);
  await writeJsonl(path.join(latestDir, "runtime_signal_candidate_queue.jsonl"), rows as Record<string, unknown>[]);

  console.log(
    JSON.stringify(
      {
        ok: true,
        outDir,
        candidatePairs: rows.length,
        distinctNpns: summary.distinctNpns,
        distinctBarcodes: summary.distinctBarcodes,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error("[build-runtime-signal-candidate-queue] fatal:", error instanceof Error ? error.message : error);
  process.exit(1);
});
