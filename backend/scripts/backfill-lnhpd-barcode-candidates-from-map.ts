import fs from "node:fs";
import path from "node:path";

import { supabase } from "../src/supabase.js";

type BarcodeMapRow = {
  barcode_gtin14: string | null;
  npn: string | null;
  source: string | null;
  confidence: number | null;
  last_seen_at: string | null;
  updated_at: string | null;
  created_at: string | null;
  expires_at: string | null;
};

type FactsRow = {
  lnhpd_id: number | string | null;
  npn: string | null;
  facts_json: Record<string, unknown> | null;
};

type CandidateEntry = {
  barcode: string;
  source: string;
  confidence: number;
  lastSeenAt: string | null;
  updatedAt: string | null;
  createdAt: string | null;
};

type ApplyStats = {
  table: "lnhpd_facts" | "lnhpd_facts_complete";
  rowsScanned: number;
  rowsUpdated: number;
  rowsUnchanged: number;
  rowsFailed: number;
  mapNpnsMatchedRows: number;
  mapNpnsCoverageBefore: number;
  mapNpnsCoverageAfter: number;
  errors: Array<{ lnhpdId: string; message: string }>;
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

const now = new Date();
const stamp = now.toISOString().replace(/[:]/g, "-");
const outDir =
  getArg("out-dir") ?? path.resolve(process.cwd(), "output/npn_webhunt/backfill_barcode_candidates", stamp);
const maxCandidatesPerNpn = Math.max(1, Math.min(10, asNumber(getArg("max-candidates-per-npn"), 3)));
const pageSize = Math.max(200, Math.min(5000, asNumber(getArg("page-size"), 1500)));
const npnChunkSize = Math.max(50, Math.min(400, asNumber(getArg("npn-chunk-size"), 180)));
const includeComplete = hasFlag("include-complete");
const dryRun = hasFlag("dry-run");

const SOURCE_PRIORITY: Record<string, number> = {
  web_manual_search_v1: 300,
  web_npn_enrich_v1: 220,
  web_npn_enrich_ddg_v1: 180,
  barcode_scans: 120,
};

const ensureDir = async (dirPath: string) => {
  await fs.promises.mkdir(dirPath, { recursive: true });
};

const writeJson = async (filePath: string, payload: unknown) => {
  await ensureDir(path.dirname(filePath));
  await fs.promises.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const appendJsonl = async (filePath: string, rows: Record<string, unknown>[]) => {
  if (!rows.length) return;
  await ensureDir(path.dirname(filePath));
  const content = rows.map((row) => JSON.stringify(row)).join("\n");
  await fs.promises.appendFile(filePath, `${content}\n`, "utf8");
};

const normalizeNpn = (value: unknown): string | null => {
  const digits = String(value ?? "").replace(/\D/g, "");
  return /^\d{8}$/.test(digits) ? digits : null;
};

const normalizeBarcode = (value: unknown): string | null => {
  const digits = String(value ?? "").replace(/\D/g, "");
  return /^\d{14}$/.test(digits) ? digits : null;
};

const toIsoOrNull = (value: unknown): string | null => {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = new Date(text);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed.toISOString();
};

const stableStringify = (value: unknown): string => {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(",")}}`;
};

const countRowsWithBarcodeCandidates = async (
  table: "lnhpd_facts" | "lnhpd_facts_complete",
): Promise<number | null> => {
  const { count, error } = await supabase
    .from(table)
    .select("lnhpd_id", { head: true, count: "exact" })
    .not("facts_json->barcodeCandidates", "is", null);
  if (error) return null;
  return typeof count === "number" ? count : 0;
};

const loadActiveMapRows = async (): Promise<BarcodeMapRow[]> => {
  const out: BarcodeMapRow[] = [];
  let from = 0;
  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("barcode_regulatory_map")
      .select("barcode_gtin14,npn,source,confidence,last_seen_at,updated_at,created_at,expires_at")
      .is("expires_at", null)
      .order("barcode_gtin14", { ascending: true })
      .range(from, to);
    if (error) {
      throw new Error(`load_barcode_regulatory_map_failed: ${error.message}`);
    }

    const rows = (data ?? []) as BarcodeMapRow[];
    if (!rows.length) break;
    out.push(...rows);
    from += rows.length;
    if (rows.length < pageSize) break;
  }
  return out;
};

const buildMapCandidates = (
  rows: BarcodeMapRow[],
): {
  npnToCandidates: Map<string, CandidateEntry[]>;
  activeDistinctNpns: Set<string>;
  activeDistinctBarcodes: Set<string>;
} => {
  const npnToEntries = new Map<string, CandidateEntry[]>();
  const activeDistinctNpns = new Set<string>();
  const activeDistinctBarcodes = new Set<string>();

  for (const row of rows) {
    const npn = normalizeNpn(row.npn);
    const barcode = normalizeBarcode(row.barcode_gtin14);
    if (!npn || !barcode) continue;

    activeDistinctNpns.add(npn);
    activeDistinctBarcodes.add(barcode);

    const source = String(row.source ?? "(unset)").trim() || "(unset)";
    const confidence = Number.isFinite(Number(row.confidence)) ? Number(row.confidence) : 0.5;
    const entry: CandidateEntry = {
      barcode,
      source,
      confidence,
      lastSeenAt: toIsoOrNull(row.last_seen_at),
      updatedAt: toIsoOrNull(row.updated_at),
      createdAt: toIsoOrNull(row.created_at),
    };

    const list = npnToEntries.get(npn) ?? [];
    list.push(entry);
    npnToEntries.set(npn, list);
  }

  const npnToCandidates = new Map<string, CandidateEntry[]>();
  for (const [npn, entries] of npnToEntries.entries()) {
    const dedup = new Map<string, CandidateEntry>();
    for (const entry of entries) {
      const previous = dedup.get(entry.barcode);
      if (!previous) {
        dedup.set(entry.barcode, entry);
        continue;
      }

      const prevScore =
        (SOURCE_PRIORITY[previous.source] ?? 0) * 1000 +
        previous.confidence * 100 +
        (previous.lastSeenAt ? new Date(previous.lastSeenAt).getTime() / 1_000_000_000 : 0);
      const curScore =
        (SOURCE_PRIORITY[entry.source] ?? 0) * 1000 +
        entry.confidence * 100 +
        (entry.lastSeenAt ? new Date(entry.lastSeenAt).getTime() / 1_000_000_000 : 0);
      if (curScore > prevScore) dedup.set(entry.barcode, entry);
    }

    const ranked = Array.from(dedup.values()).sort((a, b) => {
      const aScore =
        (SOURCE_PRIORITY[a.source] ?? 0) * 1000 +
        a.confidence * 100 +
        (a.lastSeenAt ? new Date(a.lastSeenAt).getTime() / 1_000_000_000 : 0);
      const bScore =
        (SOURCE_PRIORITY[b.source] ?? 0) * 1000 +
        b.confidence * 100 +
        (b.lastSeenAt ? new Date(b.lastSeenAt).getTime() / 1_000_000_000 : 0);
      return bScore - aScore;
    });

    npnToCandidates.set(npn, ranked.slice(0, maxCandidatesPerNpn));
  }

  return { npnToCandidates, activeDistinctNpns, activeDistinctBarcodes };
};

const loadRowsByNpns = async (
  table: "lnhpd_facts" | "lnhpd_facts_complete",
  npns: string[],
): Promise<FactsRow[]> => {
  if (!npns.length) return [];
  const out: FactsRow[] = [];
  for (let i = 0; i < npns.length; i += npnChunkSize) {
    const slice = npns.slice(i, i + npnChunkSize);
    const { data, error } = await supabase
      .from(table)
      .select("lnhpd_id,npn,facts_json")
      .in("npn", slice)
      .order("lnhpd_id", { ascending: true });
    if (error) {
      throw new Error(`load_${table}_rows_failed: ${error.message}`);
    }
    out.push(...((data ?? []) as FactsRow[]));
  }
  return out;
};

const extractBarcodeCandidates = (facts: Record<string, unknown>): Set<string> => {
  const out = new Set<string>();
  const raw = Array.isArray(facts.barcodeCandidates) ? (facts.barcodeCandidates as unknown[]) : [];
  for (const item of raw) {
    const barcode = normalizeBarcode(
      typeof item === "string" || typeof item === "number"
        ? String(item)
        : item && typeof item === "object"
          ? (item as Record<string, unknown>).barcode ?? (item as Record<string, unknown>).barcode_gtin14
          : null,
    );
    if (barcode) out.add(barcode);
  }
  return out;
};

const applyToTable = async (params: {
  table: "lnhpd_facts" | "lnhpd_facts_complete";
  npnToCandidates: Map<string, CandidateEntry[]>;
  nowIso: string;
  writeLogPath: string;
}): Promise<ApplyStats> => {
  const npns = Array.from(params.npnToCandidates.keys()).sort();
  const rows = await loadRowsByNpns(params.table, npns);

  const stats: ApplyStats = {
    table: params.table,
    rowsScanned: 0,
    rowsUpdated: 0,
    rowsUnchanged: 0,
    rowsFailed: 0,
    mapNpnsMatchedRows: 0,
    mapNpnsCoverageBefore: 0,
    mapNpnsCoverageAfter: 0,
    errors: [],
  };

  const npnCoverage = new Map<string, { before: boolean; after: boolean; rowCount: number }>();

  for (const row of rows) {
    stats.rowsScanned += 1;
    const npn = normalizeNpn(row.npn);
    if (!npn) continue;

    const selected = params.npnToCandidates.get(npn);
    if (!selected || selected.length === 0) continue;
    stats.mapNpnsMatchedRows += 1;

    const originalFacts = row.facts_json && typeof row.facts_json === "object" ? { ...row.facts_json } : {};
    const beforeCandidates = extractBarcodeCandidates(originalFacts);

    const beforeCoverage = npnCoverage.get(npn) ?? { before: false, after: false, rowCount: 0 };
    if (beforeCandidates.size > 0) beforeCoverage.before = true;
    beforeCoverage.rowCount += 1;

    const nextFacts: Record<string, unknown> = { ...originalFacts };
    const nextBarcodes = selected.map((entry) => entry.barcode);
    const nextMeta = selected.map((entry) => ({
      barcode: entry.barcode,
      source: entry.source,
      confidence: Number(entry.confidence.toFixed(3)),
      evidence: "barcode_regulatory_map",
      matchMode: "map_backfill",
      lastSeenAt: entry.lastSeenAt,
      updatedAt: entry.updatedAt,
      createdAt: entry.createdAt,
      syncedAt: params.nowIso,
    }));

    nextFacts.barcodeCandidates = nextBarcodes;
    nextFacts.barcodeCandidatesMeta = nextMeta;
    nextFacts.barcodeSource = "barcode_regulatory_map_backfill_v1";
    nextFacts.barcodeUpdatedAt = params.nowIso;

    const beforeSignature = stableStringify({
      barcodeCandidates: originalFacts.barcodeCandidates ?? null,
      barcodeCandidatesMeta: originalFacts.barcodeCandidatesMeta ?? null,
      barcodeSource: originalFacts.barcodeSource ?? null,
      barcodeUpdatedAt: originalFacts.barcodeUpdatedAt ?? null,
    });

    const afterSignature = stableStringify({
      barcodeCandidates: nextFacts.barcodeCandidates ?? null,
      barcodeCandidatesMeta: nextFacts.barcodeCandidatesMeta ?? null,
      barcodeSource: nextFacts.barcodeSource ?? null,
      barcodeUpdatedAt: nextFacts.barcodeUpdatedAt ?? null,
    });

    beforeCoverage.after = true;
    npnCoverage.set(npn, beforeCoverage);

    if (beforeSignature === afterSignature) {
      stats.rowsUnchanged += 1;
      continue;
    }

    if (dryRun) {
      stats.rowsUpdated += 1;
      await appendJsonl(params.writeLogPath, [
        {
          table: params.table,
          lnhpdId: row.lnhpd_id,
          npn,
          action: "would_update",
          barcodeCandidates: nextBarcodes,
        },
      ]);
      continue;
    }

    const { error } = await supabase
      .from(params.table)
      .update({ facts_json: nextFacts })
      .eq("lnhpd_id", row.lnhpd_id);
    if (error) {
      stats.rowsFailed += 1;
      stats.errors.push({ lnhpdId: String(row.lnhpd_id ?? ""), message: error.message });
      continue;
    }

    stats.rowsUpdated += 1;
    await appendJsonl(params.writeLogPath, [
      {
        table: params.table,
        lnhpdId: row.lnhpd_id,
        npn,
        action: "updated",
        barcodeCandidates: nextBarcodes,
      },
    ]);
  }

  let coverageBefore = 0;
  let coverageAfter = 0;
  for (const item of npnCoverage.values()) {
    if (item.before) coverageBefore += 1;
    if (item.after) coverageAfter += 1;
  }
  stats.mapNpnsCoverageBefore = coverageBefore;
  stats.mapNpnsCoverageAfter = coverageAfter;

  return stats;
};

const main = async () => {
  const startedAt = new Date().toISOString();
  const beforeCounts = {
    lnhpdFactsRowsWithBarcodeCandidates: await countRowsWithBarcodeCandidates("lnhpd_facts"),
    lnhpdFactsCompleteRowsWithBarcodeCandidates: await countRowsWithBarcodeCandidates("lnhpd_facts_complete"),
  };

  const mapRows = await loadActiveMapRows();
  const { npnToCandidates, activeDistinctNpns, activeDistinctBarcodes } = buildMapCandidates(mapRows);
  const nowIso = new Date().toISOString();

  await ensureDir(outDir);
  const writeLogPath = path.join(outDir, "applied_rows.jsonl");

  const tableStats: ApplyStats[] = [];
  tableStats.push(
    await applyToTable({
      table: "lnhpd_facts",
      npnToCandidates,
      nowIso,
      writeLogPath,
    }),
  );

  if (includeComplete) {
    tableStats.push(
      await applyToTable({
        table: "lnhpd_facts_complete",
        npnToCandidates,
        nowIso,
        writeLogPath,
      }),
    );
  }

  const afterCounts = {
    lnhpdFactsRowsWithBarcodeCandidates: await countRowsWithBarcodeCandidates("lnhpd_facts"),
    lnhpdFactsCompleteRowsWithBarcodeCandidates: await countRowsWithBarcodeCandidates("lnhpd_facts_complete"),
  };

  const lnhpdStats = tableStats.find((item) => item.table === "lnhpd_facts");
  const coverage = {
    activeDistinctNpnsInMap: activeDistinctNpns.size,
    activeDistinctBarcodesInMap: activeDistinctBarcodes.size,
    mapNpnsCoverageBefore: lnhpdStats?.mapNpnsCoverageBefore ?? 0,
    mapNpnsCoverageAfter: lnhpdStats?.mapNpnsCoverageAfter ?? 0,
    mapNpnCoverageRateBefore:
      activeDistinctNpns.size > 0
        ? Number(((lnhpdStats?.mapNpnsCoverageBefore ?? 0) / activeDistinctNpns.size).toFixed(6))
        : 0,
    mapNpnCoverageRateAfter:
      activeDistinctNpns.size > 0
        ? Number(((lnhpdStats?.mapNpnsCoverageAfter ?? 0) / activeDistinctNpns.size).toFixed(6))
        : 0,
  };

  const summary = {
    schemaVersion: 1,
    startedAt,
    finishedAt: new Date().toISOString(),
    mode: dryRun ? "dry_run" : "apply",
    includeComplete,
    maxCandidatesPerNpn,
    beforeCounts,
    afterCounts,
    mapStats: {
      activeRows: mapRows.length,
      activeDistinctNpns: activeDistinctNpns.size,
      activeDistinctBarcodes: activeDistinctBarcodes.size,
      npnsWithSelectedCandidates: npnToCandidates.size,
    },
    coverage,
    tableStats,
    files: {
      writeLogPath,
      summaryPath: path.join(outDir, "summary.json"),
    },
  };

  await writeJson(path.join(outDir, "summary.json"), summary);
  await writeJson(path.join(outDir, "coverage_report.json"), {
    generatedAt: new Date().toISOString(),
    mode: summary.mode,
    coverage,
    beforeCounts,
    afterCounts,
  });

  console.log(JSON.stringify({ ok: true, outDir, summary }, null, 2));
};

main().catch((error) => {
  console.error("[backfill-lnhpd-barcode-candidates-from-map] fatal:", error instanceof Error ? error.message : error);
  process.exit(1);
});
