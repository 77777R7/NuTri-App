import fs from "node:fs";
import path from "node:path";

import { supabase } from "../src/supabase.js";

type CountResult = {
  count: number | null;
  error: string | null;
};

type BarcodeMapRow = {
  barcode_gtin14: string | null;
  npn: string | null;
  source: string | null;
  expires_at: string | null;
};

type LnhpdCandidateRow = {
  lnhpd_id: number | string | null;
  npn: string | null;
  facts_json: Record<string, unknown> | null;
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

const now = new Date();
const stamp = now.toISOString().replace(/[:]/g, "-");
const outDir =
  getArg("out-dir") ??
  path.resolve(process.cwd(), "output/npn_webhunt/baselines", stamp);
const latestDir =
  getArg("latest-dir") ??
  path.resolve(process.cwd(), "output/npn_webhunt/baselines/latest");
const label = getArg("label") ?? "M0_baseline";
const pageSize = Math.max(500, Math.min(5000, asNumber(getArg("page-size"), 3000)));
const candidateSampleLimit = Math.max(200, Math.min(10000, asNumber(getArg("candidate-sample-limit"), 5000)));

const ensureDir = async (dirPath: string) => {
  await fs.promises.mkdir(dirPath, { recursive: true });
};

const writeJson = async (filePath: string, payload: unknown) => {
  await ensureDir(path.dirname(filePath));
  await fs.promises.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const normalizeNpn = (value: unknown): string | null => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!/^\d{8}$/.test(digits)) return null;
  return digits;
};

const loadBarcodeMapRows = async (): Promise<BarcodeMapRow[]> => {
  const out: BarcodeMapRow[] = [];
  let from = 0;
  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("barcode_regulatory_map")
      .select("barcode_gtin14,npn,source,expires_at")
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

const loadRowsWithBarcodeCandidates = async (
  table: "lnhpd_facts" | "lnhpd_facts_complete",
): Promise<LnhpdCandidateRow[]> => {
  const { data, error } = await supabase
    .from(table)
    .select("lnhpd_id,npn,facts_json")
    .not("facts_json->barcodeCandidates", "is", null)
    .limit(candidateSampleLimit);

  if (error) {
    throw new Error(`load_${table}_barcode_candidates_failed: ${error.message}`);
  }

  return (data ?? []) as LnhpdCandidateRow[];
};

const countRows = async (
  table: "lnhpd_facts" | "lnhpd_facts_complete",
  column = "lnhpd_id",
): Promise<CountResult> => {
  const { count, error } = await supabase.from(table).select(column, { head: true, count: "exact" });
  if (error) return { count: null, error: error.message };
  return { count: typeof count === "number" ? count : 0, error: null };
};

const countRowsWithNpn = async (
  table: "lnhpd_facts" | "lnhpd_facts_complete",
): Promise<CountResult> => {
  const { count, error } = await supabase
    .from(table)
    .select("lnhpd_id", { head: true, count: "exact" })
    .not("npn", "is", null);
  if (error) return { count: null, error: error.message };
  return { count: typeof count === "number" ? count : 0, error: null };
};

const loadLatestFullHuntProgress = async (): Promise<Record<string, unknown> | null> => {
  const baseDir = path.resolve(process.cwd(), "output/npn_webhunt/full_hunt");
  try {
    const entries = await fs.promises.readdir(baseDir, { withFileTypes: true });
    const dirs = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    if (!dirs.length) return null;

    for (let i = dirs.length - 1; i >= 0; i -= 1) {
      const runDir = path.join(baseDir, dirs[i]);
      const progressPath = path.join(runDir, "progress_report.json");
      if (!fs.existsSync(progressPath)) continue;
      const raw = await fs.promises.readFile(progressPath, "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return {
        runDir,
        progressPath,
        progress: parsed,
      };
    }
    return null;
  } catch {
    return null;
  }
};

const main = async () => {
  const startedAt = new Date().toISOString();

  const [
    barcodeMapRows,
    lnhpdFactsCandidates,
    lnhpdFactsCompleteCandidates,
    lnhpdFactsCount,
    lnhpdFactsCompleteCount,
    lnhpdFactsWithNpn,
    lnhpdFactsCompleteWithNpn,
    latestFullHunt,
  ] = await Promise.all([
    loadBarcodeMapRows(),
    loadRowsWithBarcodeCandidates("lnhpd_facts"),
    loadRowsWithBarcodeCandidates("lnhpd_facts_complete"),
    countRows("lnhpd_facts"),
    countRows("lnhpd_facts_complete"),
    countRowsWithNpn("lnhpd_facts"),
    countRowsWithNpn("lnhpd_facts_complete"),
    loadLatestFullHuntProgress(),
  ]);

  const activeRows = barcodeMapRows.filter((row) => !row.expires_at);
  const activeDistinctBarcodes = new Set(
    activeRows.map((row) => String(row.barcode_gtin14 ?? "").trim()).filter((value) => /^\d{14}$/.test(value)),
  );
  const activeDistinctNpns = new Set(
    activeRows.map((row) => normalizeNpn(row.npn)).filter((value): value is string => Boolean(value)),
  );

  const sourceBreakdown = new Map<string, number>();
  for (const row of activeRows) {
    const source = String(row.source ?? "(unset)").trim() || "(unset)";
    sourceBreakdown.set(source, (sourceBreakdown.get(source) ?? 0) + 1);
  }

  const uniqueCandidateIds = new Set<string>();
  const uniqueCandidateNpns = new Set<string>();
  const collectCandidateCoverage = (rows: LnhpdCandidateRow[]) => {
    for (const row of rows) {
      if (row.lnhpd_id != null) uniqueCandidateIds.add(String(row.lnhpd_id));
      const npn = normalizeNpn(row.npn);
      if (npn) uniqueCandidateNpns.add(npn);
    }
  };
  collectCandidateCoverage(lnhpdFactsCandidates);
  collectCandidateCoverage(lnhpdFactsCompleteCandidates);

  const baseline = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    label,
    startedAt,
    metrics: {
      activeUsableBarcodes: activeDistinctBarcodes.size,
      activeUsableNpnsFromMap: activeDistinctNpns.size,
      barcodeCandidatesCoveredLnhpdIds: uniqueCandidateIds.size,
      barcodeCandidatesCoveredNpns: uniqueCandidateNpns.size,
      lnhpd: {
        totalRows: lnhpdFactsCount,
        rowsWithNpn: lnhpdFactsWithNpn,
        rowsWithBarcodeCandidates: lnhpdFactsCandidates.length,
      },
      lnhpdComplete: {
        totalRows: lnhpdFactsCompleteCount,
        rowsWithNpn: lnhpdFactsCompleteWithNpn,
        rowsWithBarcodeCandidates: lnhpdFactsCompleteCandidates.length,
      },
    },
    expectedHeadline: {
      activeUsableBarcodes: 222,
      barcodeCandidatesCoveredLnhpdIds: 123,
      matchesCurrent: activeDistinctBarcodes.size === 222 && uniqueCandidateIds.size === 123,
    },
    barcodeMapActiveSourceBreakdown: Array.from(sourceBreakdown.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([source, count]) => ({ source, count })),
    artifacts: {
      latestFullHunt: latestFullHunt
        ? {
            runDir: latestFullHunt.runDir,
            progressPath: latestFullHunt.progressPath,
            status: (latestFullHunt.progress as Record<string, unknown>)?.status ?? null,
            queueCursor: (latestFullHunt.progress as Record<string, unknown>)?.queueCursor ?? null,
            queueTotal: (latestFullHunt.progress as Record<string, unknown>)?.queueTotal ?? null,
            stopReason: (latestFullHunt.progress as Record<string, unknown>)?.stopReason ?? null,
          }
        : null,
    },
  };

  const snapshotPath = path.join(outDir, "baseline_snapshot.json");
  const latestPath = path.join(latestDir, "baseline_snapshot.json");
  await writeJson(snapshotPath, baseline);
  await writeJson(latestPath, baseline);

  console.log(
    JSON.stringify(
      {
        ok: true,
        snapshotPath,
        latestPath,
        metrics: baseline.metrics,
        expectedHeadline: baseline.expectedHeadline,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error("[freeze-npn-baseline-snapshot] fatal:", error instanceof Error ? error.message : error);
  process.exit(1);
});
