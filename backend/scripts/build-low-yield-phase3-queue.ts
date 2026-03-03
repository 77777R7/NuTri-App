import fs from "node:fs";
import path from "node:path";

import { supabase } from "../src/supabase.js";

type QueueRow = {
  queueIndex?: number;
  npn?: string;
  lnhpdId?: number | null;
  brandName?: string | null;
  productName?: string | null;
  sourceTable?: string;
};

type BatchReport = {
  batchId?: string;
  quality?: { yieldPer1000Npns?: number | null };
  topMissBrands?: Array<{ brandName?: string; count?: number }>;
};

type MapRow = {
  npn: string | null;
  source?: unknown;
  expires_at?: string | null;
};

type ExistingMapStats = {
  filterEnabled: boolean;
  totalCandidates: number;
  mappedCount: number;
  filteredByMap: number;
  matchedSources: string[];
};

const args = process.argv.slice(2);
const hasFlag = (flag: string): boolean => args.includes(`--${flag}`);
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

const runDirArg = getArg("run-dir");
if (!runDirArg) {
  console.error("[build-low-yield-phase3-queue] missing --run-dir");
  process.exit(1);
}

const runDir = path.isAbsolute(runDirArg) ? runDirArg : path.resolve(process.cwd(), runDirArg);
const outDir =
  getArg("out-dir") ?? path.join(runDir, "phase3_low_yield_queue", new Date().toISOString().replace(/[:]/g, "-"));
const topBrandLimit = Math.max(3, Math.min(100, asNumber(getArg("top-brand-limit"), 20)));
const npnLimit = Math.max(20, Math.min(5000, asNumber(getArg("npn-limit"), 800)));
const includeTailBrands = hasFlag("include-tail-brands");
const tailBrandLimit = Math.max(0, Math.min(200, asNumber(getArg("tail-brand-limit"), 40)));
const tailNpnLimit = Math.max(npnLimit, Math.min(12000, asNumber(getArg("tail-npn-limit"), Math.max(npnLimit, 2000))));
const brandAliasMax = Math.max(1, Math.min(8, asNumber(getArg("brand-alias-max"), 4)));
const existingMapTable = getArg("existing-map-table") ?? "barcode_regulatory_map";
const existingMapSource = getArg("existing-map-source")?.trim() ?? null;
const existingMapSourceColumn = getArg("existing-map-source-column")?.trim() || "source";
const existingMapActiveOnly = hasFlag("existing-map-active-only");
const existingMapPageSize = Math.max(100, Math.min(1000, asNumber(getArg("existing-map-page-size"), 500)));
const excludeExistingNpnInMap = hasFlag("exclude-existing-npn-in-map");

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

const normalizeBrand = (value: unknown): string =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const BRAND_SUFFIX_STOP = new Set([
  "inc",
  "inc.",
  "ltd",
  "ltd.",
  "limited",
  "corp",
  "corp.",
  "corporation",
  "company",
  "co",
  "co.",
  "international",
  "enterprises",
  "enterprise",
  "laboratories",
  "laboratory",
  "lab",
  "labs",
  "canada",
]);

const normalizeBrandCore = (value: unknown): string => {
  const raw = String(value ?? "")
    .toLowerCase()
    .replace(/[\u2018\u2019']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!raw) return "";
  const parts = raw.split(" ").filter(Boolean);
  const filtered = parts.filter((token) => !BRAND_SUFFIX_STOP.has(token));
  return (filtered.length ? filtered : parts).join(" ").trim();
};

const buildBrandAliases = (value: unknown, maxCount: number): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (entry: string) => {
    const normalized = entry.trim().replace(/\s+/g, " ");
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(normalized);
  };
  const original = String(value ?? "").trim();
  if (original) push(original);
  const core = normalizeBrandCore(original);
  if (core) push(core);
  const compact = core.replace(/\s+/g, "");
  if (compact && compact.length >= 5) push(compact);
  return out.slice(0, maxCount);
};

const readJsonSafe = (filePath: string): unknown => {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
};

const readJsonlSafe = (filePath: string): QueueRow[] => {
  try {
    return fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as QueueRow;
        } catch {
          return null;
        }
      })
      .filter((row): row is QueueRow => Boolean(row));
  } catch {
    return [];
  }
};

const fetchMappedNpns = async (npns: string[], options: {
  table: string;
  sourceFilter: string | null;
  sourceColumn: string;
  activeOnly: boolean;
}): Promise<{ mappedNpns: Set<string>; matchedSources: Set<string> }> => {
  const mappedNpns = new Set<string>();
  const matchedSources = new Set<string>();
  if (!npns.length) return { mappedNpns, matchedSources };

  const unique = Array.from(new Set(npns.filter(Boolean)));
  const chunkSize = 500;

  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    let from = 0;

    while (true) {
      const to = from + existingMapPageSize - 1;
      let query = supabase
        .from(options.table)
        .select(`npn,${options.sourceColumn},expires_at`)
        .in("npn", chunk)
        .range(from, to);

      if (options.activeOnly) {
        query = query.is("expires_at", null);
      }

      const { data, error } = await query;
      if (error) {
        throw new Error(`fetch mapped npns failed: ${error.message}`);
      }

      const rows = (data ?? []) as MapRow[];
      for (const row of rows) {
        const npn = normalizeNpn(row?.npn);
        if (!npn) continue;

        if (options.sourceFilter) {
          const sourceValue = String(row?.[options.sourceColumn as keyof MapRow] ?? "").trim().toLowerCase();
          if (sourceValue !== options.sourceFilter.toLowerCase()) {
            continue;
          }
          matchedSources.add(String(row?.[options.sourceColumn as keyof MapRow] ?? "").trim());
        }

        mappedNpns.add(npn);
      }

      if (!rows.length || rows.length < existingMapPageSize) {
        break;
      }
      from += existingMapPageSize;
    }
  }

  return { mappedNpns, matchedSources };
};

const listBatchDirs = (baseDir: string): string[] => {
  const batchesDir = path.join(baseDir, "batches");
  try {
    return fs
      .readdirSync(batchesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^B\d+/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
};

const main = async () => {
  const batchIds = listBatchDirs(runDir);
  if (!batchIds.length) {
    throw new Error(`no batch directories found under ${runDir}`);
  }

  const brandCounts = new Map<string, { brandName: string; count: number }>();
  const batchYieldRows: Array<{ batchId: string; yieldPer1000Npns: number | null }> = [];
  const npnCandidates = new Map<string, { npn: string; brandName: string | null; productName: string | null; sourceBatches: Set<string> }>();
  const queueNpnsBeforeTopFilter = new Set<string>();

  for (const batchId of batchIds) {
    const batchDir = path.join(runDir, "batches", batchId);
    const reportPath = path.join(batchDir, "batch_report.json");
    const queuePath = path.join(batchDir, "batch_queue.jsonl");

    const report = readJsonSafe(reportPath) as BatchReport | null;
    if (report) {
      const yieldVal =
        typeof report?.quality?.yieldPer1000Npns === "number" && Number.isFinite(report.quality.yieldPer1000Npns)
          ? report.quality.yieldPer1000Npns
          : null;
      batchYieldRows.push({ batchId, yieldPer1000Npns: yieldVal });

      const topMissBrands = Array.isArray(report.topMissBrands) ? report.topMissBrands : [];
      for (const item of topMissBrands) {
        const rawName = String(item?.brandName ?? "").trim();
        if (!rawName) continue;
        const key = normalizeBrand(rawName);
        const count = Number(item?.count ?? 0);
        const prev = brandCounts.get(key);
        if (!prev) {
          brandCounts.set(key, { brandName: rawName, count });
        } else {
          prev.count += count;
          brandCounts.set(key, prev);
        }
      }
    }

    const queueRows = readJsonlSafe(queuePath);
    for (const row of queueRows) {
      const npn = normalizeNpn(row.npn);
      if (!npn) continue;
      queueNpnsBeforeTopFilter.add(npn);
      const brandName = row.brandName ? String(row.brandName).trim() : null;
      const existing = npnCandidates.get(npn) ?? {
        npn,
        brandName,
        productName: row.productName ? String(row.productName).trim() : null,
        sourceBatches: new Set<string>(),
      };
      if (!existing.brandName && brandName) existing.brandName = brandName;
      if (!existing.productName && row.productName) existing.productName = String(row.productName).trim();
      existing.sourceBatches.add(batchId);
      npnCandidates.set(npn, existing);
    }
  }

  const existingMapStats: ExistingMapStats = {
    filterEnabled: excludeExistingNpnInMap,
    totalCandidates: queueNpnsBeforeTopFilter.size,
    mappedCount: 0,
    filteredByMap: 0,
    matchedSources: [],
  };

  let mappedNpns = new Set<string>();
  if (excludeExistingNpnInMap) {
    const { mappedNpns: mappedNpnsSet, matchedSources } = await fetchMappedNpns(Array.from(queueNpnsBeforeTopFilter), {
      table: existingMapTable,
      sourceFilter: existingMapSource,
      sourceColumn: existingMapSourceColumn,
      activeOnly: existingMapActiveOnly,
    });
    mappedNpns = mappedNpnsSet;
    existingMapStats.mappedCount = mappedNpns.size;
    existingMapStats.matchedSources = Array.from(matchedSources).sort();
  }

  const sortedBrands = Array.from(brandCounts.values()).sort((a, b) => b.count - a.count);
  const topBrands = sortedBrands.slice(0, topBrandLimit);
  const tailBrands = includeTailBrands ? sortedBrands.slice(topBrandLimit, topBrandLimit + tailBrandLimit) : [];
  const selectedBrands = includeTailBrands ? [...topBrands, ...tailBrands] : topBrands;
  const topBrandSet = new Set(topBrands.map((item) => normalizeBrand(item.brandName)));
  const selectedBrandSet = new Set(selectedBrands.map((item) => normalizeBrand(item.brandName)));
  const effectiveNpnLimit = includeTailBrands ? tailNpnLimit : npnLimit;

  const queueRows = Array.from(npnCandidates.values())
    .filter((row) => selectedBrandSet.has(normalizeBrand(row.brandName)))
    .filter((row) => {
      if (!excludeExistingNpnInMap) return true;
      const shouldKeep = !mappedNpns.has(row.npn);
      if (!shouldKeep) {
        existingMapStats.filteredByMap += 1;
      }
      return shouldKeep;
    })
    .sort((a, b) => {
      const aBrand = normalizeBrand(a.brandName);
      const bBrand = normalizeBrand(b.brandName);
      if (aBrand !== bBrand) return aBrand.localeCompare(bBrand);
      return a.npn.localeCompare(b.npn);
    })
    .slice(0, effectiveNpnLimit)
    .map((row, idx) => {
      const normalizedBrand = normalizeBrandCore(row.brandName ?? "");
      const aliases = buildBrandAliases(row.brandName ?? "", brandAliasMax);
      const twoHopHintBase = [normalizedBrand || row.brandName || "", row.productName ?? "", "barcode upc gtin"]
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      const brandKey = normalizeBrand(row.brandName);
      const reason = topBrandSet.has(brandKey)
        ? "low_yield_brand_phase3_top"
        : "low_yield_brand_phase3_tail";
      return {
      queueIndex: idx + 1,
      npn: row.npn,
      brandName: row.brandName,
      brandNameNormalized: normalizedBrand || null,
      brandAliases: aliases,
      productName: row.productName,
      sourceBatches: Array.from(row.sourceBatches).sort(),
      reason,
      twoHopHint: twoHopHintBase || `${row.npn} barcode`,
    };
    });

  await ensureDir(outDir);
  const queueJsonlPath = path.join(outDir, "low_yield_phase3_queue.jsonl");
  await fs.promises.writeFile(queueJsonlPath, "", "utf8");
  await appendJsonl(queueJsonlPath, queueRows);

  const existingMapStatsPath = path.join(outDir, "existing_map_filter_meta.json");
  if (excludeExistingNpnInMap) {
    await writeJson(existingMapStatsPath, {
      enabled: existingMapStats.filterEnabled,
      generatedAt: new Date().toISOString(),
      totalCandidates: existingMapStats.totalCandidates,
      mappedCount: existingMapStats.mappedCount,
      filteredByMap: existingMapStats.filteredByMap,
      matchedSources: existingMapStats.matchedSources,
      options: {
        table: existingMapTable,
        source: existingMapSource,
        sourceColumn: existingMapSourceColumn,
        activeOnly: existingMapActiveOnly,
      },
    });
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    runDir,
    topBrandLimit,
    includeTailBrands,
    tailBrandLimit,
    tailNpnLimit,
    npnLimit,
    effectiveNpnLimit,
    batchCount: batchIds.length,
    batchYieldRows,
    topBrands,
    tailBrands,
    selectedBrands,
    queueSize: queueRows.length,
    existingMapStats,
    files: {
      queueJsonl: queueJsonlPath,
      summaryJson: path.join(outDir, "summary.json"),
      existingMapFilterMeta: excludeExistingNpnInMap ? existingMapStatsPath : null,
    },
  };

  await writeJson(path.join(outDir, "summary.json"), summary);

  console.log(
    JSON.stringify(
      {
        ok: true,
        outDir,
        queueSize: queueRows.length,
        topBrands: topBrands.slice(0, 10),
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error("[build-low-yield-phase3-queue] fatal:", error instanceof Error ? error.message : error);
  process.exit(1);
});
