import fs from "node:fs";
import path from "node:path";

import { supabase } from "../src/supabase.js";

type LnhpdRow = {
  lnhpd_id: number | string | null;
  npn: string | null;
  brand_name: string | null;
  product_name: string | null;
};

type CandidateRow = {
  npn: string;
  lnhpdId: number | null;
  brandName: string | null;
  productName: string | null;
  sourceTable: string;
  sourcePriority: number;
};

type BrandBucket = {
  brandKey: string;
  count: number;
  sampleNpns: string[];
  sampleProducts: string[];
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
  path.resolve(process.cwd(), "output/npn_webhunt/queues", stamp);
const pageSize = Math.max(200, Math.min(5000, asNumber(getArg("page-size"), 2000)));
const maxRowsPerTable = Math.max(0, asNumber(getArg("max-rows-per-table"), 0));
const topBrandLimit = Math.max(20, Math.min(1000, asNumber(getArg("top-brand-limit"), 300)));
const primaryTable = getArg("lnhpd-table-primary") ?? "lnhpd_facts";
const secondaryTable = getArg("lnhpd-table-secondary") ?? "lnhpd_facts_complete";

const HIGH_YIELD_DOMAINS = [
  "newrootsherbal.com",
  "avivahealth.com",
  "gohealthstore.ca",
  "goodhealthmarttoronto.com",
  "goodnaturedhealth.ca",
  "myvivastore.com",
  "nutritionhouse.com",
  "vitasave.ca",
  "nationalnutrition.ca",
  "healthyplanetcanada.com",
  "well.ca",
  "shop.georgianhealthfoods.ca",
  "canadianvitaminshop.com",
];

const BRAND_DOMAIN_HINTS: Record<string, string[]> = {
  jamieson: ["jamiesonvitamins.com"],
  webber: ["webbernaturals.com"],
  webbernaturals: ["webbernaturals.com"],
  canprev: ["canprev.ca"],
  organika: ["organika.com"],
  genuinehealth: ["genuinehealth.ca"],
  naturesway: ["natureswaycanada.ca"],
  "nature s way": ["natureswaycanada.ca"],
  naturesbounty: ["naturesbounty.com"],
  nowfoods: ["nowfoods.ca"],
  omegaalpha: ["omegaalpha.ca"],
  harmonicarts: ["harmonicarts.ca"],
  newroots: ["newrootsherbal.com"],
  naturalfactors: ["naturalfactors.com"],
  naturalfactorsnutritional: ["naturalfactors.com"],
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

const normalizeNpn = (value: string | null | undefined): string | null => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!/^\d{8}$/.test(digits)) return null;
  if (/^(\d)\1{7}$/.test(digits)) return null;
  return digits;
};

const normalizeBrandKey = (value: string | null | undefined): string => {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || "(unknown)";
};

const toDisplay = (value: string | null | undefined): string | null => {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized || null;
};

const scoreRowRichness = (row: CandidateRow): number => {
  const brandScore = row.brandName ? Math.min(60, row.brandName.length) : 0;
  const productScore = row.productName ? Math.min(120, row.productName.length) : 0;
  const idScore = row.lnhpdId != null ? 8 : 0;
  return row.sourcePriority * 1000 + brandScore + productScore + idScore;
};

const toCandidate = (row: LnhpdRow, sourceTable: string, sourcePriority: number): CandidateRow | null => {
  const npn = normalizeNpn(row.npn);
  if (!npn) return null;
  const lnhpdIdRaw = Number(row.lnhpd_id);
  return {
    npn,
    lnhpdId: Number.isFinite(lnhpdIdRaw) ? lnhpdIdRaw : null,
    brandName: toDisplay(row.brand_name),
    productName: toDisplay(row.product_name),
    sourceTable,
    sourcePriority,
  };
};

const fetchLnhpdRows = async (
  table: string,
  sourcePriority: number,
  maxRows: number,
): Promise<Map<string, CandidateRow>> => {
  const out = new Map<string, CandidateRow>();
  let from = 0;
  let scanned = 0;
  while (true) {
    if (maxRows > 0 && scanned >= maxRows) break;
    const windowSize = maxRows > 0 ? Math.min(pageSize, maxRows - scanned) : pageSize;
    if (windowSize <= 0) break;

    const to = from + windowSize - 1;
    const { data, error } = await supabase
      .from(table)
      .select("lnhpd_id,npn,brand_name,product_name")
      .order("lnhpd_id", { ascending: true })
      .range(from, to);
    if (error) throw new Error(`[build-uncovered-queue] query ${table} failed: ${error.message}`);

    const rows = (data ?? []) as LnhpdRow[];
    if (!rows.length) break;

    for (const row of rows) {
      const candidate = toCandidate(row, table, sourcePriority);
      if (!candidate) continue;
      const previous = out.get(candidate.npn);
      if (!previous || scoreRowRichness(candidate) > scoreRowRichness(previous)) {
        out.set(candidate.npn, candidate);
      }
    }

    scanned += rows.length;
    from += rows.length;
    if (rows.length < windowSize) break;
  }
  return out;
};

const fetchMappedNpns = async (): Promise<Set<string>> => {
  const mapped = new Set<string>();
  let from = 0;
  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("barcode_regulatory_map")
      .select("npn")
      .order("npn", { ascending: true })
      .range(from, to);
    if (error) throw new Error(`[build-uncovered-queue] query barcode_regulatory_map failed: ${error.message}`);
    const rows = (data ?? []) as Array<{ npn?: string | null }>;
    if (!rows.length) break;
    for (const row of rows) {
      const npn = normalizeNpn(row.npn ?? null);
      if (npn) mapped.add(npn);
    }
    from += rows.length;
    if (rows.length < pageSize) break;
  }
  return mapped;
};

const buildBrandBuckets = (rows: CandidateRow[]): BrandBucket[] => {
  const buckets = new Map<string, BrandBucket>();
  for (const row of rows) {
    const key = normalizeBrandKey(row.brandName);
    if (!buckets.has(key)) {
      buckets.set(key, {
        brandKey: key,
        count: 0,
        sampleNpns: [],
        sampleProducts: [],
      });
    }
    const bucket = buckets.get(key)!;
    bucket.count += 1;
    if (bucket.sampleNpns.length < 5) bucket.sampleNpns.push(row.npn);
    if (row.productName && bucket.sampleProducts.length < 3) bucket.sampleProducts.push(row.productName);
  }
  return Array.from(buckets.values())
    .sort((a, b) => b.count - a.count || a.brandKey.localeCompare(b.brandKey))
    .slice(0, topBrandLimit);
};

const buildDomainSeedPlan = (buckets: BrandBucket[]) => {
  const brandDerived: Array<{
    brandKey: string;
    count: number;
    suggestedDomains: string[];
    reason: string;
  }> = [];

  const seenDomains = new Set<string>(HIGH_YIELD_DOMAINS);
  const prioritizedDomains = [...HIGH_YIELD_DOMAINS];

  for (const bucket of buckets.slice(0, 80)) {
    const compact = bucket.brandKey.replace(/\s+/g, "");
    const known = new Set<string>([
      ...(BRAND_DOMAIN_HINTS[bucket.brandKey] ?? []),
      ...(BRAND_DOMAIN_HINTS[compact] ?? []),
    ]);
    if (known.size === 0 && bucket.brandKey !== "(unknown)" && compact.length >= 5) {
      known.add(`${compact}.ca`);
      known.add(`${compact}.com`);
    }
    const domains = Array.from(known).filter(Boolean).slice(0, 4);
    if (!domains.length) continue;

    brandDerived.push({
      brandKey: bucket.brandKey,
      count: bucket.count,
      suggestedDomains: domains,
      reason: "brand_bucket_seed",
    });

    for (const domain of domains) {
      if (seenDomains.has(domain)) continue;
      seenDomains.add(domain);
      prioritizedDomains.push(domain);
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    highYieldDomains: HIGH_YIELD_DOMAINS,
    brandDerivedSeeds: brandDerived,
    prioritizedDomains,
    notes: [
      "High-yield domains are fixed seeds from prior batches.",
      "Brand-derived domains are heuristics for CSE/domain targeting and require strict pairing gates.",
    ],
  };
};

const main = async () => {
  const startedAt = Date.now();
  const [primaryRows, secondaryRows, mappedNpns] = await Promise.all([
    fetchLnhpdRows(primaryTable, 1, maxRowsPerTable),
    fetchLnhpdRows(secondaryTable, 2, maxRowsPerTable),
    fetchMappedNpns(),
  ]);

  const universeByNpn = new Map<string, CandidateRow>();
  for (const [npn, row] of primaryRows.entries()) universeByNpn.set(npn, row);
  for (const [npn, row] of secondaryRows.entries()) {
    const previous = universeByNpn.get(npn);
    if (!previous || scoreRowRichness(row) > scoreRowRichness(previous)) {
      universeByNpn.set(npn, row);
    }
  }

  const uncoveredRows = Array.from(universeByNpn.values())
    .filter((row) => !mappedNpns.has(row.npn))
    .sort((a, b) => a.npn.localeCompare(b.npn));

  await ensureDir(outDir);
  const queueJsonl = path.join(outDir, "uncovered_full.jsonl");
  await fs.promises.writeFile(queueJsonl, "", "utf8");

  const queueRows = uncoveredRows.map((row, index) => ({
    queueIndex: index + 1,
    npn: row.npn,
    lnhpdId: row.lnhpdId,
    brandName: row.brandName,
    productName: row.productName,
    sourceTable: row.sourceTable,
  }));
  await appendJsonl(queueJsonl, queueRows);

  const brandBuckets = buildBrandBuckets(uncoveredRows);
  const brandBucketStatsPath = path.join(outDir, "brand_bucket_stats.json");
  const domainSeedPlan = buildDomainSeedPlan(brandBuckets);
  const domainSeedPlanPath = path.join(outDir, "domain_seed_plan.json");
  const summaryPath = path.join(outDir, "summary.json");

  await writeJson(brandBucketStatsPath, {
    generatedAt: new Date().toISOString(),
    totalBuckets: brandBuckets.length,
    topBrandLimit,
    items: brandBuckets,
  });
  await writeJson(domainSeedPlanPath, domainSeedPlan);
  await writeJson(summaryPath, {
    generatedAt: new Date().toISOString(),
    outDir,
    tables: {
      primary: primaryTable,
      secondary: secondaryTable,
    },
    stats: {
      primaryUniqueNpns: primaryRows.size,
      secondaryUniqueNpns: secondaryRows.size,
      universeNpns: universeByNpn.size,
      mappedNpns: mappedNpns.size,
      uncoveredNpns: uncoveredRows.length,
    },
    files: {
      uncoveredFullJsonl: queueJsonl,
      brandBucketStats: brandBucketStatsPath,
      domainSeedPlan: domainSeedPlanPath,
    },
    elapsedSec: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
  });

  console.log(
    JSON.stringify(
      {
        outDir,
        uncoveredNpns: uncoveredRows.length,
        mappedNpns: mappedNpns.size,
        universeNpns: universeByNpn.size,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error(
    "[build-lnhpd-uncovered-npn-queue] fatal:",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
