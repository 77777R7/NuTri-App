import fs from "node:fs";
import path from "node:path";

import { supabase } from "../src/supabase.js";
import { normalizeBarcodeInput } from "../src/barcode.js";

type LnhpdRow = {
  lnhpd_id: number;
  npn: string | null;
  facts_json: Record<string, unknown> | null;
};

type BarcodeCandidateMetaEntry = {
  barcode: string;
  source?: string | null;
  evidence?: string | null;
  matchMode?: string | null;
  confidence?: number | null;
  lastSeenAt?: string | null;
  migratedAt?: string | null;
};

type MergeStats = {
  objectCandidateCount: number;
  droppedInvalidCount: number;
};

const args = process.argv.slice(2);
const hasFlag = (flag: string) => args.includes(`--${flag}`);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};
const asNumber = (value: string | null, fallback: number) => {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const apply = hasFlag("apply");
const pageSize = Math.min(2000, Math.max(100, asNumber(getArg("page-size"), 1000)));
const maxRows = Math.max(0, asNumber(getArg("max-rows"), 0));
const sampleLimit = Math.max(10, asNumber(getArg("sample-limit"), 80));
const maxCandidatesPerNpn = Math.min(10, Math.max(1, asNumber(getArg("max-candidates-per-npn"), 3)));
const summaryJson =
  getArg("summary-json") ??
  path.resolve(process.cwd(), "output", `lnhpd_barcode_candidates_cleanup_summary_${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}.json`);
const auditJson =
  getArg("audit-json") ??
  path.resolve(process.cwd(), "output", `lnhpd_barcode_candidates_cleanup_audit_${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}.json`);

const ensureDir = async (filePath: string) => {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
};

const writeJson = async (filePath: string, payload: unknown) => {
  await ensureDir(filePath);
  await fs.promises.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const sanitize = (value: unknown): string => String(value ?? "").replace(/\s+/g, " ").trim();

const normalizeBarcodeToGtin14 = (value: unknown): string | null => {
  const raw = sanitize(value);
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  const inputs = digits.length === 11 ? [`0${digits}`, digits] : [digits];
  for (const input of inputs) {
    const normalized = normalizeBarcodeInput(input);
    if (!normalized || normalized.isValidChecksum !== true) continue;
    const gtin14 = normalized.variants.find((variant) => /^\d{14}$/.test(variant)) ?? null;
    if (gtin14) return gtin14;
  }
  return null;
};

const normalizeMetaText = (value: unknown): string | null => {
  const text = sanitize(value);
  return text ? text : null;
};

const normalizeMetaConfidence = (value: unknown): number | null => {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return Number(n.toFixed(4));
};

const hasMeaningfulMeta = (entry: BarcodeCandidateMetaEntry): boolean =>
  Boolean(entry.source || entry.evidence || entry.matchMode || entry.confidence != null || entry.lastSeenAt || entry.migratedAt);

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
};

const stableStringify = (value: unknown): string => JSON.stringify(canonicalize(value));

const mergeFactsBarcodeCandidates = (params: {
  facts: Record<string, unknown>;
  maxCount: number;
  nowIso: string;
}) => {
  const { facts, maxCount, nowIso } = params;
  const metaByBarcode = new Map<string, BarcodeCandidateMetaEntry>();
  const existingOrder: string[] = [];
  const seenExisting = new Set<string>();
  const stats: MergeStats = { objectCandidateCount: 0, droppedInvalidCount: 0 };

  const upsertMeta = (barcode: string, patch: Partial<BarcodeCandidateMetaEntry>) => {
    const current = metaByBarcode.get(barcode) ?? { barcode };
    metaByBarcode.set(barcode, {
      barcode,
      source: patch.source ?? current.source ?? null,
      evidence: patch.evidence ?? current.evidence ?? null,
      matchMode: patch.matchMode ?? current.matchMode ?? null,
      confidence: patch.confidence ?? current.confidence ?? null,
      lastSeenAt: patch.lastSeenAt ?? current.lastSeenAt ?? null,
      migratedAt: patch.migratedAt ?? current.migratedAt ?? null,
    });
  };

  const rawCandidates = Array.isArray((facts as Record<string, unknown>).barcodeCandidates)
    ? ((facts as Record<string, unknown>).barcodeCandidates as unknown[])
    : [];
  for (const entry of rawCandidates) {
    let barcode: string | null = null;
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      stats.objectCandidateCount += 1;
      const obj = entry as Record<string, unknown>;
      barcode = normalizeBarcodeToGtin14(obj.barcode ?? obj.barcode_gtin14 ?? obj.gtin14 ?? obj.value);
      if (barcode) {
        upsertMeta(barcode, {
          source: normalizeMetaText(obj.source),
          evidence: normalizeMetaText(obj.evidence),
          matchMode: normalizeMetaText(obj.matchMode),
          confidence: normalizeMetaConfidence(obj.confidence),
          lastSeenAt: normalizeMetaText(obj.lastSeenAt ?? obj.last_seen_at),
          migratedAt: nowIso,
        });
      } else {
        stats.droppedInvalidCount += 1;
      }
    } else {
      barcode = normalizeBarcodeToGtin14(entry);
      if (!barcode && entry != null) stats.droppedInvalidCount += 1;
    }

    if (!barcode || seenExisting.has(barcode)) continue;
    seenExisting.add(barcode);
    existingOrder.push(barcode);
  }

  const rawMeta = Array.isArray((facts as Record<string, unknown>).barcodeCandidatesMeta)
    ? ((facts as Record<string, unknown>).barcodeCandidatesMeta as unknown[])
    : [];
  for (const entry of rawMeta) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const obj = entry as Record<string, unknown>;
    const barcode = normalizeBarcodeToGtin14(obj.barcode ?? obj.barcode_gtin14 ?? obj.gtin14 ?? obj.value);
    if (!barcode) continue;
    upsertMeta(barcode, {
      source: normalizeMetaText(obj.source),
      evidence: normalizeMetaText(obj.evidence),
      matchMode: normalizeMetaText(obj.matchMode),
      confidence: normalizeMetaConfidence(obj.confidence),
      lastSeenAt: normalizeMetaText(obj.lastSeenAt ?? obj.last_seen_at),
      migratedAt: normalizeMetaText(obj.migratedAt) ?? nowIso,
    });
  }

  const finalOrder: string[] = [];
  const seenFinal = new Set<string>();
  for (const barcode of existingOrder) {
    if (seenFinal.has(barcode)) continue;
    seenFinal.add(barcode);
    finalOrder.push(barcode);
    if (finalOrder.length >= maxCount) break;
  }

  const finalMeta = finalOrder
    .map((barcode) => metaByBarcode.get(barcode))
    .filter((entry): entry is BarcodeCandidateMetaEntry => Boolean(entry))
    .filter((entry) => hasMeaningfulMeta(entry))
    .map((entry) => ({
      barcode: entry.barcode,
      ...(entry.source ? { source: entry.source } : {}),
      ...(entry.evidence ? { evidence: entry.evidence } : {}),
      ...(entry.matchMode ? { matchMode: entry.matchMode } : {}),
      ...(entry.confidence != null ? { confidence: entry.confidence } : {}),
      ...(entry.lastSeenAt ? { lastSeenAt: entry.lastSeenAt } : {}),
      ...(entry.migratedAt ? { migratedAt: entry.migratedAt } : {}),
    }));

  return { barcodes: finalOrder, meta: finalMeta, stats };
};

const main = async () => {
  const startedAt = new Date().toISOString();
  let from = 0;
  let scannedRows = 0;
  let updatedRows = 0;
  let rowsWithCandidates = 0;
  let rowsWithObjectCandidates = 0;
  let droppedInvalidCount = 0;
  let metaMigratedCount = 0;
  const samples: Array<Record<string, unknown>> = [];

  while (true) {
    if (maxRows > 0 && scannedRows >= maxRows) break;
    const size = maxRows > 0 ? Math.min(pageSize, Math.max(0, maxRows - scannedRows)) : pageSize;
    if (size <= 0) break;

    const { data, error } = await supabase
      .from("lnhpd_facts")
      .select("lnhpd_id,npn,facts_json")
      .order("lnhpd_id", { ascending: true })
      .range(from, from + size - 1);
    if (error) {
      throw new Error(`load_lnhpd_facts_failed: ${error.message}`);
    }
    const rows = (data ?? []) as LnhpdRow[];
    if (rows.length === 0) break;

    for (const row of rows) {
      scannedRows += 1;
      const facts = row.facts_json && typeof row.facts_json === "object" ? { ...row.facts_json } : null;
      if (!facts) continue;
      const rawCandidates = Array.isArray((facts as Record<string, unknown>).barcodeCandidates)
        ? ((facts as Record<string, unknown>).barcodeCandidates as unknown[])
        : [];
      const hasMeta = Array.isArray((facts as Record<string, unknown>).barcodeCandidatesMeta);
      if (!rawCandidates.length && !hasMeta) continue;

      rowsWithCandidates += 1;
      const nowIso = new Date().toISOString();
      const merged = mergeFactsBarcodeCandidates({
        facts: facts as Record<string, unknown>,
        maxCount: maxCandidatesPerNpn,
        nowIso,
      });

      if (merged.stats.objectCandidateCount > 0) rowsWithObjectCandidates += 1;
      droppedInvalidCount += merged.stats.droppedInvalidCount;
      metaMigratedCount += merged.meta.length;

      const beforeCandidates = (facts as Record<string, unknown>).barcodeCandidates;
      const beforeMeta = (facts as Record<string, unknown>).barcodeCandidatesMeta;
      const afterFacts = { ...(facts as Record<string, unknown>) };
      afterFacts.barcodeCandidates = merged.barcodes;
      if (merged.meta.length > 0) afterFacts.barcodeCandidatesMeta = merged.meta;
      else delete afterFacts.barcodeCandidatesMeta;

      const changed =
        stableStringify(beforeCandidates ?? null) !== stableStringify(afterFacts.barcodeCandidates ?? null) ||
        stableStringify(beforeMeta ?? null) !== stableStringify(afterFacts.barcodeCandidatesMeta ?? null);

      if (!changed) continue;
      updatedRows += 1;
      if (samples.length < sampleLimit) {
        samples.push({
          lnhpdId: row.lnhpd_id,
          npn: row.npn,
          beforeCandidates,
          afterCandidates: afterFacts.barcodeCandidates,
          beforeMeta: beforeMeta ?? null,
          afterMeta: afterFacts.barcodeCandidatesMeta ?? null,
        });
      }

      if (apply) {
        const { error: updateError } = await supabase
          .from("lnhpd_facts")
          .update({ facts_json: afterFacts })
          .eq("lnhpd_id", row.lnhpd_id);
        if (updateError) {
          throw new Error(`update_lnhpd_facts_failed(${row.lnhpd_id}): ${updateError.message}`);
        }
      }
    }

    if (rows.length < size) break;
    from += rows.length;
  }

  const summary = {
    startedAt,
    finishedAt: new Date().toISOString(),
    apply,
    pageSize,
    maxRows,
    maxCandidatesPerNpn,
    scannedRows,
    rowsWithCandidates,
    rowsWithObjectCandidates,
    updatedRows,
    droppedInvalidCount,
    metaMigratedCount,
    summaryJson,
    auditJson,
  };

  await writeJson(summaryJson, summary);
  await writeJson(auditJson, {
    generatedAt: new Date().toISOString(),
    apply,
    sampleLimit,
    changedRowsSample: samples,
  });

  console.log(JSON.stringify(summary, null, 2));
};

main().catch((error) => {
  console.error("[cleanup-lnhpd-barcode-candidates] fatal", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
