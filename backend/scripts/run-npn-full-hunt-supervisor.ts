import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { normalizeBarcodeKey } from "../src/barcodeKey.js";
import { upsertRegulatoryMapWithPolicy } from "../src/barcodeResolutionDbCache.js";
import { supabase } from "../src/supabase.js";

type QueueRow = {
  queueIndex?: number;
  npn?: string;
  lnhpdId?: number | null;
  brandName?: string | null;
  productName?: string | null;
  sourceTable?: string | null;
};

type DomainTier = "A" | "B" | "C";

type DomainSeedRow = {
  domain?: string;
  priorityTier?: string;
  status?: string;
};

type DomainSeedPayload = {
  domains?: DomainSeedRow[];
};

type DomainScoreboardRow = {
  domain?: string;
  suggestedTier?: string;
};

type DomainTierCounter = {
  domainsSelected: number;
  domainsScanned: number;
  urlsScanned: number;
  pairCountDedup: number;
};

type DomainBudgetCounter = {
  batchesIncluded: number;
  domainSelections: number;
};

type SitemapDomainStatsRow = {
  domain?: string;
  pagesScanned?: number;
  pairCountDedup?: number;
  pairCount?: number;
};

type BatchRunSummary = {
  batchId: string;
  batchIndex: number;
  queueStart: number;
  queueEnd: number;
  queueCount: number;
  startedAt: string;
  finishedAt: string;
  elapsedSec: number;
  compareStats: {
    rejectedInvalidNpn: number;
    rejectedInvalidGtin14: number;
    conflictsByBarcode: number;
    netNewPairs: number;
    tierCounts: Record<string, number>;
  };
  importStats: {
    skippedByPrecisionGate: boolean;
    imported: number;
    wouldImport: number;
    skippedConflictAtWrite: number;
    failedWrites: number;
    sourceTag: string;
  };
  quality: {
    p0Rate: number;
    yieldPer1000Npns: number;
    yieldPer1000NetNewPairs: number;
    conflictRate: number;
    repairQueueDelta: number | null;
  };
  topMissBrands: Array<{ brandName: string; count: number }>;
  topMissBrandsByTier: Record<DomainTier | "unknown", Array<{ brandName: string; count: number }>>;
  domainSelection: {
    selectedDomains: string[];
    selectedByTier: Record<DomainTier, string[]>;
    source: "domains_file" | "domains_seed";
  };
  domainTierStats: Record<DomainTier, DomainTierCounter>;
  domainBudgetUsage: Record<DomainTier, DomainBudgetCounter>;
  files: {
    batchQueueJsonl: string;
    batchQueueJson: string;
    domainsBatchFile: string | null;
    sitemapOutDir: string;
    enrichOutDir: string;
    mergedPairsJson: string;
    compareOutDir: string;
    tieredImportQueueJson: string;
    repairPriorityQueueJson: string;
  };
};

type ProgressReport = {
  runId: string;
  runDir: string;
  queueFile: string;
  queueTotal: number;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "completed" | "stopped";
  stopReason: string | null;
  batchesCompleted: number;
  queueCursor: number;
  cumulative: {
    attemptedNpns: number;
    importedP0: number;
    wouldImportP0: number;
    conflictsByBarcode: number;
    rejectedInvalidGtin14: number;
    rejectedInvalidNpn: number;
    p1Review: number;
    p2Reject: number;
    repairQueueSize: number;
    domainTierStats: Record<DomainTier, DomainTierCounter>;
    domainBudgetUsage: Record<DomainTier, DomainBudgetCounter>;
  };
  domainCursorByTier: Record<DomainTier, number>;
  batchReports: BatchRunSummary[];
};

const args = process.argv.slice(2);
const getArg = (flag: string): string | null => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};
const hasFlag = (flag: string) => args.includes(`--${flag}`);
const asNumber = (value: string | null, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const stamp = new Date().toISOString().replace(/[:]/g, "-");
const runId = getArg("run-id") ?? `npn-full-hunt-${stamp}`;
const queueFile =
  getArg("queue-file") ??
  path.resolve(process.cwd(), "output/npn_webhunt/queues/latest/uncovered_full.jsonl");
const runDir =
  getArg("run-dir") ??
  path.resolve(process.cwd(), "output/npn_webhunt/full_hunt", runId);
const domainsFile = getArg("domains-file");
const domainsSeedFile =
  getArg("domains-seed-file") ??
  path.resolve(process.cwd(), "backend/config/domains_seed.v1.json");
const domainScoreboardJson = getArg("domain-scoreboard-json");
const batchSize = Math.max(100, asNumber(getArg("batch-size"), 2000));
const runHours = Math.max(1, asNumber(getArg("run-hours"), 24));
const maxBatches = Math.max(0, asNumber(getArg("max-batches"), 0));
const minEvidenceLevel = (getArg("min-evidence-level") ?? "medium").toLowerCase();
const maxAttemptsPerNpn = Math.max(1, asNumber(getArg("max-attempts-per-npn"), 2));
const maxDomainsPerBatch = Math.max(3, asNumber(getArg("max-domains-per-batch"), 18));
const tierBFrequency = Math.max(1, asNumber(getArg("tier-b-frequency"), 2));
const tierCFrequency = Math.max(1, asNumber(getArg("tier-c-frequency"), 4));
const sitemapMaxPagesPerDomain = Math.max(50, asNumber(getArg("sitemap-max-pages-per-domain"), 220));
const sitemapTimeoutMs = Math.max(3000, asNumber(getArg("sitemap-timeout-ms"), 10000));
const sitemapConcurrency = Math.max(1, Math.min(20, asNumber(getArg("sitemap-concurrency"), 10)));
const sitemapMaxSitemapsPerDomain = Math.max(3, asNumber(getArg("sitemap-max-sitemaps-per-domain"), 16));
const sitemapMaxUrlsPerSitemap = Math.max(1000, asNumber(getArg("sitemap-max-urls-per-sitemap"), 8000));
const enrichPageSize = Math.max(50, asNumber(getArg("enrich-page-size"), 250));
const enrichQueryNum = Math.max(1, Math.min(10, asNumber(getArg("enrich-query-num"), 3)));
const enrichQueryDelayMs = Math.max(0, asNumber(getArg("enrich-query-delay-ms"), 80));
const enrichCseTimeoutMs = Math.max(1500, asNumber(getArg("enrich-cse-timeout-ms"), 3500));
const enrichHtmlTimeoutMs = Math.max(1500, asNumber(getArg("enrich-html-timeout-ms"), 5000));
const enrichTokenStrictnessRaw = (getArg("token-strictness") ?? "normal").toLowerCase();
const enrichTokenStrictness: "low" | "normal" =
  enrichTokenStrictnessRaw === "low" ? "low" : "normal";
const enableUpcFallbackQuery = hasFlag("enable-upc-fallback-query");
const tierAOnly = hasFlag("tier-a-only");
const stoplossYieldThreshold = Math.max(
  0,
  asNumber(getArg("stoploss-netnew-yield-threshold"), 0),
);
const stoplossWindowBatches = Math.max(0, asNumber(getArg("stoploss-hours"), 0));
const stoplossRequireRepairDeltaNonNegative = hasFlag("stoploss-repair-delta-nonnegative");
const stageTimeoutSitemapSec = Math.max(120, asNumber(getArg("stage-timeout-sitemap-sec"), 1800));
const stageTimeoutEnrichSec = Math.max(120, asNumber(getArg("stage-timeout-enrich-sec"), 5400));
const stageTimeoutCompareSec = Math.max(120, asNumber(getArg("stage-timeout-compare-sec"), 1800));
const includeExistingNpn = hasFlag("include-existing-npn");
const dryRun = hasFlag("dry-run");
const reset = hasFlag("reset");
const nodeBin = process.execPath;

const ensureDir = async (dirPath: string) => {
  await fs.promises.mkdir(dirPath, { recursive: true });
};

const writeJson = async (filePath: string, payload: unknown) => {
  await ensureDir(path.dirname(filePath));
  await fs.promises.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const writeJsonl = async (filePath: string, rows: Record<string, unknown>[]) => {
  await ensureDir(path.dirname(filePath));
  const content = rows.map((row) => JSON.stringify(row)).join("\n");
  await fs.promises.writeFile(filePath, `${content}\n`, "utf8");
};

const appendJsonl = async (filePath: string, row: Record<string, unknown>) => {
  await ensureDir(path.dirname(filePath));
  await fs.promises.appendFile(filePath, `${JSON.stringify(row)}\n`, "utf8");
};

const normalizeNpn = (value: unknown): string | null => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!/^\d{8}$/.test(digits)) return null;
  return digits;
};

const normalizeBarcode = (value: unknown): string | null => {
  return normalizeBarcodeKey(String(value ?? "")).gtin14;
};

const normalizeDomain = (value: unknown): string =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");

const normalizeTier = (value: unknown): DomainTier => {
  const raw = String(value ?? "").trim().toUpperCase();
  if (raw === "A" || raw === "B" || raw === "C") return raw;
  return "C";
};

const makeTierCounter = (): DomainTierCounter => ({
  domainsSelected: 0,
  domainsScanned: 0,
  urlsScanned: 0,
  pairCountDedup: 0,
});

const makeBudgetCounter = (): DomainBudgetCounter => ({
  batchesIncluded: 0,
  domainSelections: 0,
});

const createTierCounterRecord = (): Record<DomainTier, DomainTierCounter> => ({
  A: makeTierCounter(),
  B: makeTierCounter(),
  C: makeTierCounter(),
});

const createBudgetCounterRecord = (): Record<DomainTier, DomainBudgetCounter> => ({
  A: makeBudgetCounter(),
  B: makeBudgetCounter(),
  C: makeBudgetCounter(),
});

const createTierBrandCounterRecord = (): Record<DomainTier | "unknown", Map<string, number>> => ({
  A: new Map<string, number>(),
  B: new Map<string, number>(),
  C: new Map<string, number>(),
  unknown: new Map<string, number>(),
});

const loadQueueRows = async (filePath: string): Promise<QueueRow[]> => {
  const raw = await fs.promises.readFile(filePath, "utf8");
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? (parsed as QueueRow[]) : [];
  }

  const rows: QueueRow[] = [];
  const seen = new Set<string>();
  for (const line of trimmed.split(/\r?\n/)) {
    const text = line.trim();
    if (!text) continue;
    let row: QueueRow | null = null;
    if (text.startsWith("{")) {
      try {
        row = JSON.parse(text) as QueueRow;
      } catch {
        row = null;
      }
    }
    if (!row) {
      const npn = normalizeNpn(text);
      if (!npn || seen.has(npn)) continue;
      seen.add(npn);
      rows.push({ npn });
      continue;
    }
    const npn = normalizeNpn(row.npn);
    if (!npn || seen.has(npn)) continue;
    seen.add(npn);
    rows.push({ ...row, npn });
  }
  return rows;
};

const loadDomainListFromFile = async (filePath: string): Promise<string[]> => {
  const raw = await fs.promises.readFile(filePath, "utf8");
  return Array.from(
    new Set(
      raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => normalizeDomain(line))
        .filter(Boolean),
    ),
  );
};

const loadDomainBuckets = async (): Promise<{
  source: "domains_file" | "domains_seed";
  tiers: Record<DomainTier, string[]>;
  domainTierMap: Map<string, DomainTier>;
}> => {
  const domainTierMap = new Map<string, DomainTier>();
  const tiers: Record<DomainTier, string[]> = { A: [], B: [], C: [] };

  if (domainsFile) {
    const explicitDomains = await loadDomainListFromFile(domainsFile);
    for (const domain of explicitDomains) {
      if (domainTierMap.has(domain)) continue;
      domainTierMap.set(domain, "A");
      tiers.A.push(domain);
    }
    return {
      source: "domains_file",
      tiers,
      domainTierMap,
    };
  }

  if (!fs.existsSync(domainsSeedFile)) {
    throw new Error(`[npn-supervisor] domains seed file not found: ${domainsSeedFile}`);
  }

  const seedRaw = await fs.promises.readFile(domainsSeedFile, "utf8");
  const seed = JSON.parse(seedRaw) as DomainSeedPayload;
  const seedRows = Array.isArray(seed?.domains) ? seed.domains : [];
  for (const row of seedRows) {
    const domain = normalizeDomain(row?.domain);
    if (!domain || domainTierMap.has(domain)) continue;
    const status = String(row?.status ?? "active").toLowerCase();
    if (status !== "active") continue;
    const tier = normalizeTier(row?.priorityTier);
    domainTierMap.set(domain, tier);
    tiers[tier].push(domain);
  }

  if (domainScoreboardJson && fs.existsSync(domainScoreboardJson)) {
    const raw = await fs.promises.readFile(domainScoreboardJson, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const rows = Array.isArray(parsed)
      ? (parsed as DomainScoreboardRow[])
      : Array.isArray((parsed as { scoreboard?: unknown[] })?.scoreboard)
        ? ((parsed as { scoreboard: DomainScoreboardRow[] }).scoreboard ?? [])
        : [];
    for (const row of rows) {
      const domain = normalizeDomain(row?.domain);
      if (!domain || !domainTierMap.has(domain)) continue;
      const nextTier = normalizeTier(row?.suggestedTier);
      const prevTier = domainTierMap.get(domain) ?? "C";
      if (prevTier === nextTier) continue;
      domainTierMap.set(domain, nextTier);
      tiers[prevTier] = tiers[prevTier].filter((entry) => entry !== domain);
      if (!tiers[nextTier].includes(domain)) tiers[nextTier].push(domain);
    }
  }

  return {
    source: "domains_seed",
    tiers,
    domainTierMap,
  };
};

const selectCycled = (
  rows: string[],
  cursor: number,
  count: number,
): { selected: string[]; nextCursor: number } => {
  if (!rows.length || count <= 0) return { selected: [], nextCursor: cursor };
  const take = Math.min(count, rows.length);
  const selected: string[] = [];
  for (let i = 0; i < take; i += 1) {
    selected.push(rows[(cursor + i) % rows.length]);
  }
  const nextCursor = (cursor + take) % rows.length;
  return { selected, nextCursor };
};

const selectDomainsForBatch = (params: {
  batchIndex: number;
  tiers: Record<DomainTier, string[]>;
  cursorByTier: Record<DomainTier, number>;
}): {
  selectedDomains: string[];
  selectedByTier: Record<DomainTier, string[]>;
  nextCursorByTier: Record<DomainTier, number>;
} => {
  const { batchIndex, tiers, cursorByTier } = params;
  const selectedByTier: Record<DomainTier, string[]> = { A: [], B: [], C: [] };
  const nextCursorByTier: Record<DomainTier, number> = { ...cursorByTier };

  const budgetA = Math.max(1, Math.min(maxDomainsPerBatch, Math.ceil(maxDomainsPerBatch * 0.6)));
  const budgetB = Math.max(0, Math.floor(maxDomainsPerBatch * 0.3));
  const budgetC = Math.max(0, maxDomainsPerBatch - budgetA - budgetB);

  const aPick = selectCycled(tiers.A, cursorByTier.A, budgetA);
  selectedByTier.A = aPick.selected;
  nextCursorByTier.A = aPick.nextCursor;

  if (!tierAOnly && (batchIndex % tierBFrequency === 0 || batchIndex === 1)) {
    const bPick = selectCycled(tiers.B, cursorByTier.B, budgetB);
    selectedByTier.B = bPick.selected;
    nextCursorByTier.B = bPick.nextCursor;
  }

  if (!tierAOnly && (batchIndex % tierCFrequency === 0 || batchIndex === 1)) {
    const cPick = selectCycled(tiers.C, cursorByTier.C, budgetC);
    selectedByTier.C = cPick.selected;
    nextCursorByTier.C = cPick.nextCursor;
  }

  let selectedDomains = Array.from(
    new Set([...selectedByTier.A, ...selectedByTier.B, ...selectedByTier.C]),
  ).slice(0, maxDomainsPerBatch);

  // Fallback: if tier cadence yields no domains (e.g. all domains are Tier C),
  // force-pick from the first non-empty tier to keep the 24h run alive.
  if (selectedDomains.length === 0) {
    const fallbackTier: DomainTier | null = tierAOnly
      ? tiers.A.length
        ? "A"
        : null
      : tiers.C.length
        ? "C"
        : tiers.B.length
          ? "B"
          : tiers.A.length
            ? "A"
            : null;
    if (fallbackTier) {
      const fallbackRows = tiers[fallbackTier];
      const fallbackCount = Math.max(1, Math.min(maxDomainsPerBatch, fallbackRows.length));
      const fallbackPick = selectCycled(
        fallbackRows,
        nextCursorByTier[fallbackTier],
        fallbackCount,
      );
      selectedByTier[fallbackTier] = fallbackPick.selected;
      nextCursorByTier[fallbackTier] = fallbackPick.nextCursor;
      selectedDomains = Array.from(
        new Set([...selectedByTier.A, ...selectedByTier.B, ...selectedByTier.C]),
      ).slice(0, maxDomainsPerBatch);
    }
  }

  return {
    selectedDomains,
    selectedByTier,
    nextCursorByTier,
  };
};

const runCommand = async (
  label: string,
  cmdArgs: string[],
  cwd: string,
  logFile: string,
  timeoutSec: number,
): Promise<void> => {
  await ensureDir(path.dirname(logFile));
  const output = fs.createWriteStream(logFile, { flags: "a" });
  output.write(`\n# ${new Date().toISOString()} ${label}\n`);
  output.write(`# timeout_sec=${timeoutSec}\n`);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(nodeBin, ["--import", "tsx", ...cmdArgs], {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let settled = false;
    let killTimer: NodeJS.Timeout | null = null;
    let forceKillTimer: NodeJS.Timeout | null = null;
    const finalize = (handler: () => void) => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      handler();
    };

    killTimer = setTimeout(() => {
      output.write(
        `\n# ${new Date().toISOString()} ${label} timeout exceeded (${timeoutSec}s); sending SIGTERM\n`,
      );
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => {
        output.write(
          `\n# ${new Date().toISOString()} ${label} still alive after SIGTERM; sending SIGKILL\n`,
        );
        child.kill("SIGKILL");
      }, 15_000);
    }, timeoutSec * 1000);

    child.stdout.on("data", (chunk) => output.write(chunk));
    child.stderr.on("data", (chunk) => output.write(chunk));
    child.on("error", (error) => finalize(() => reject(error)));
    child.on("close", (code) => {
      if (code === 0) finalize(() => resolve());
      else finalize(() => reject(new Error(`${label} failed with exit code ${code}`)));
    });
  });
};

const extractDomain = (url: string): string => {
  try {
    return normalizeDomain(new URL(url).hostname);
  } catch {
    return "";
  }
};

const loadJsonArray = async (filePath: string): Promise<Record<string, unknown>[]> => {
  const raw = await fs.promises.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : [];
};

const loadJson = async <T = Record<string, unknown>>(filePath: string): Promise<T> => {
  const raw = await fs.promises.readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
};

const loadJsonl = async (filePath: string): Promise<Record<string, unknown>[]> => {
  const raw = await fs.promises.readFile(filePath, "utf8");
  const rows: Record<string, unknown>[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const text = line.trim();
    if (!text) continue;
    try {
      rows.push(JSON.parse(text) as Record<string, unknown>);
    } catch {
      // ignore malformed line
    }
  }
  return rows;
};

const mergePairsFromBatch = async (params: {
  sitemapPairsJson: string;
  enrichMatchesJsonl: string;
  outFile: string;
}) => {
  const merged = new Map<string, Record<string, unknown>>();

  const upsert = (entry: Record<string, unknown>) => {
    const npn = normalizeNpn(entry.npn);
    const barcode = normalizeBarcode(entry.barcode);
    if (!npn || !barcode) return;
    const key = `${npn}|${barcode}`;
    const nextScore = Number(entry.evidenceScore ?? 0);
    const prev = merged.get(key);
    if (!prev) {
      merged.set(key, entry);
      return;
    }
    const prevScore = Number(prev.evidenceScore ?? 0);
    if (nextScore > prevScore) {
      merged.set(key, entry);
    }
  };

  const sitemapRows = await loadJsonArray(params.sitemapPairsJson);
  for (const row of sitemapRows) {
    upsert({
      domain: row.domain ?? "",
      npn: row.npn ?? "",
      barcode: row.barcode ?? "",
      url: row.url ?? "",
      sourceFile: "sitemap",
      extractMode: row.extractMode ?? "sitemap_batch_v2",
      evidenceLevel: row.evidenceLevel ?? "low",
      evidenceScore: row.evidenceScore ?? 6,
      tokenDistance:
        typeof row.tokenDistance === "number" && Number.isFinite(row.tokenDistance)
          ? Number(row.tokenDistance)
          : null,
      brandOverlap:
        typeof row.brandOverlap === "number" && Number.isFinite(row.brandOverlap)
          ? Number(row.brandOverlap)
          : 0,
      productOverlap:
        typeof row.productOverlap === "number" && Number.isFinite(row.productOverlap)
          ? Number(row.productOverlap)
          : 0,
      requiredBrandOverlap:
        typeof row.requiredBrandOverlap === "number" && Number.isFinite(row.requiredBrandOverlap)
          ? Number(row.requiredBrandOverlap)
          : 1,
      requiredProductOverlap:
        typeof row.requiredProductOverlap === "number" && Number.isFinite(row.requiredProductOverlap)
          ? Number(row.requiredProductOverlap)
          : 2,
      contextPass: row.contextPass === true,
    });
  }

  if (fs.existsSync(params.enrichMatchesJsonl)) {
    const matchRows = await loadJsonl(params.enrichMatchesJsonl);
    for (const row of matchRows) {
      const npn = normalizeNpn(row.npn);
      if (!npn) continue;
      const evidences = Array.isArray(row.evidence) ? (row.evidence as Record<string, unknown>[]) : [];
      for (const evidence of evidences) {
        const barcode = normalizeBarcode(evidence.barcodeGtin14 ?? evidence.barcode ?? "");
        if (!barcode) continue;
        const sourceType = String(evidence.sourceType ?? "snippet");
        const evidenceScore = sourceType === "jsonld" ? 9 : sourceType === "keyword" ? 7 : 6;
        const link = String(evidence.link ?? "");
        upsert({
          domain: extractDomain(link),
          npn,
          barcode,
          url: link,
          sourceFile: "enrich",
          extractMode: `cse_${sourceType}`,
          evidenceLevel: evidenceScore >= 8 ? "high" : evidenceScore >= 6 ? "medium" : "low",
          evidenceScore,
          tokenDistance: null,
          brandOverlap: 0,
          productOverlap: 0,
          requiredBrandOverlap: 1,
          requiredProductOverlap: 2,
          contextPass: false,
        });
      }
    }
  }

  const payload = Array.from(merged.values());
  await writeJson(params.outFile, payload);
  return payload.length;
};

const fetchExistingMapRows = async (barcodes: string[]) => {
  const rows: Array<{ barcode_gtin14: string; npn: string | null }> = [];
  const chunk = 400;
  for (let i = 0; i < barcodes.length; i += chunk) {
    const slice = barcodes.slice(i, i + chunk);
    const { data, error } = await supabase
      .from("barcode_regulatory_map")
      .select("barcode_gtin14,npn")
      .in("barcode_gtin14", slice);
    if (error) throw new Error(`[npn-supervisor] load existing map failed: ${error.message}`);
    rows.push(...(((data ?? []) as Array<{ barcode_gtin14: string; npn: string | null }>) ?? []));
  }
  return rows;
};

const mapConfidenceFromEvidence = (evidenceScore: number): number => {
  if (evidenceScore >= 9) return 0.96;
  if (evidenceScore >= 8.5) return 0.94;
  return 0.9;
};

const applyP0Tier = async (params: {
  tierRows: Record<string, unknown>[];
  sourceTag: string;
  dryRun: boolean;
  precisionGateOk: boolean;
}) => {
  const candidates = params.tierRows.filter((row) => row.tier === "P0_auto_import");
  if (!params.precisionGateOk || candidates.length === 0) {
    return {
      skippedByPrecisionGate: !params.precisionGateOk,
      imported: 0,
      wouldImport: candidates.length,
      skippedConflictAtWrite: 0,
      failedWrites: 0,
    };
  }

  const barcodes = Array.from(
    new Set(
      candidates
        .map((row) => normalizeBarcode(row.barcode_gtin14))
        .filter((value): value is string => Boolean(value)),
    ),
  );
  const existingRows = await fetchExistingMapRows(barcodes);
  const existingMap = new Map(existingRows.map((row) => [row.barcode_gtin14, normalizeNpn(row.npn)]));

  let imported = 0;
  let failedWrites = 0;
  let skippedConflictAtWrite = 0;

  for (const row of candidates) {
    const npn = normalizeNpn(row.npn);
    const barcode = normalizeBarcode(row.barcode_gtin14);
    if (!npn || !barcode) continue;

    const existing = existingMap.get(barcode);
    if (existing && existing !== npn) {
      skippedConflictAtWrite += 1;
      continue;
    }

    if (params.dryRun) {
      imported += 1;
      continue;
    }

    const confidence = mapConfidenceFromEvidence(Number(row.evidenceScore ?? 8));
    const outcome = await upsertRegulatoryMapWithPolicy(
    {
      barcodeGtin14: barcode,
      barcodeRaw: String(row.barcode_raw ?? barcode),
      npn,
      source: params.sourceTag,
      confidence,
      expiresAt: null,
    },
    { timeoutMs: 1500, keyContractMode: "enforce", writeGuardMode: "enforce" },
  );
    if (outcome.status === "blocked") {
      skippedConflictAtWrite += 1;
      continue;
    }
    imported += 1;
  }

  return {
    skippedByPrecisionGate: false,
    imported,
    wouldImport: candidates.length,
    skippedConflictAtWrite,
    failedWrites,
  };
};

const main = async () => {
  const startedAtMs = Date.now();
  const hardStopMs = startedAtMs + runHours * 60 * 60 * 1000;

  await ensureDir(runDir);
  const progressPath = path.join(runDir, "progress_report.json");
  const ledgerPath = path.join(runDir, "batch_ledger.jsonl");
  const queueRows = await loadQueueRows(queueFile);
  const domainBuckets = await loadDomainBuckets();
  const loadedProgress =
    !reset && fs.existsSync(progressPath) ? await loadJson<ProgressReport>(progressPath) : null;
  const progress: ProgressReport = loadedProgress
    ? ({
        ...loadedProgress,
        status: "running",
        stopReason: null,
        finishedAt: null,
        queueTotal: queueRows.length,
        runDir,
        queueFile,
        cumulative: {
          attemptedNpns: Number(loadedProgress.cumulative?.attemptedNpns ?? 0),
          importedP0: Number(loadedProgress.cumulative?.importedP0 ?? 0),
          wouldImportP0: Number(loadedProgress.cumulative?.wouldImportP0 ?? 0),
          conflictsByBarcode: Number(loadedProgress.cumulative?.conflictsByBarcode ?? 0),
          rejectedInvalidGtin14: Number(loadedProgress.cumulative?.rejectedInvalidGtin14 ?? 0),
          rejectedInvalidNpn: Number(loadedProgress.cumulative?.rejectedInvalidNpn ?? 0),
          p1Review: Number(loadedProgress.cumulative?.p1Review ?? 0),
          p2Reject: Number(loadedProgress.cumulative?.p2Reject ?? 0),
          repairQueueSize: Number(loadedProgress.cumulative?.repairQueueSize ?? 0),
          domainTierStats: {
            A: {
              ...makeTierCounter(),
              ...(loadedProgress.cumulative?.domainTierStats?.A ?? {}),
            },
            B: {
              ...makeTierCounter(),
              ...(loadedProgress.cumulative?.domainTierStats?.B ?? {}),
            },
            C: {
              ...makeTierCounter(),
              ...(loadedProgress.cumulative?.domainTierStats?.C ?? {}),
            },
          },
          domainBudgetUsage: {
            A: {
              ...makeBudgetCounter(),
              ...(loadedProgress.cumulative?.domainBudgetUsage?.A ?? {}),
            },
            B: {
              ...makeBudgetCounter(),
              ...(loadedProgress.cumulative?.domainBudgetUsage?.B ?? {}),
            },
            C: {
              ...makeBudgetCounter(),
              ...(loadedProgress.cumulative?.domainBudgetUsage?.C ?? {}),
            },
          },
        },
        domainCursorByTier: {
          A: Number(loadedProgress.domainCursorByTier?.A ?? 0),
          B: Number(loadedProgress.domainCursorByTier?.B ?? 0),
          C: Number(loadedProgress.domainCursorByTier?.C ?? 0),
        },
        batchReports: Array.isArray(loadedProgress.batchReports) ? loadedProgress.batchReports : [],
      } satisfies ProgressReport)
    : {
        runId,
        runDir,
        queueFile,
        queueTotal: queueRows.length,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        status: "running",
        stopReason: null,
        batchesCompleted: 0,
        queueCursor: 0,
        cumulative: {
          attemptedNpns: 0,
          importedP0: 0,
          wouldImportP0: 0,
          conflictsByBarcode: 0,
          rejectedInvalidGtin14: 0,
          rejectedInvalidNpn: 0,
          p1Review: 0,
          p2Reject: 0,
          repairQueueSize: 0,
          domainTierStats: createTierCounterRecord(),
          domainBudgetUsage: createBudgetCounterRecord(),
        },
        domainCursorByTier: { A: 0, B: 0, C: 0 },
        batchReports: [],
      };

  let lowYieldStreak = 0;
  let previousConflictRate: number | null = null;
  let stoplossStreak = 0;
  let previousRepairQueueCount: number | null = null;

  while (Date.now() < hardStopMs && progress.queueCursor < queueRows.length) {
    if (maxBatches > 0 && progress.batchesCompleted >= maxBatches) {
      progress.stopReason = "max_batches_reached";
      break;
    }

    const batchIndex = progress.batchesCompleted + 1;
    const batchId = `B${String(batchIndex).padStart(4, "0")}`;
    const batchDir = path.join(runDir, "batches", batchId);
    await ensureDir(batchDir);
    const logsDir = path.join(batchDir, "logs");
    await ensureDir(logsDir);

    const queueStart = progress.queueCursor;
    const queueSlice = queueRows.slice(queueStart, queueStart + batchSize);
    const queueEnd = queueStart + queueSlice.length;
    if (!queueSlice.length) break;
    progress.queueCursor = queueEnd;

    const batchQueueJson = path.join(batchDir, "batch_queue.json");
    const batchQueueJsonl = path.join(batchDir, "batch_queue.jsonl");
    await writeJson(batchQueueJson, { generatedAt: new Date().toISOString(), batchId, queue: queueSlice });
    await writeJsonl(batchQueueJsonl, queueSlice as Record<string, unknown>[]);

    const sitemapOutDir = path.join(batchDir, "sitemap");
    const enrichOutDir = path.join(batchDir, "enrich");
    const compareOutDir = path.join(batchDir, "compare");
    await ensureDir(sitemapOutDir);
    await ensureDir(enrichOutDir);
    await ensureDir(compareOutDir);
    const domainsBatchFile = path.join(batchDir, "domains.batch.txt");

    const startedAt = Date.now();
    const sourceTag = `npn_full_hunt_v2_1:${runId}:${batchId}`;
    const domainSelection = selectDomainsForBatch({
      batchIndex,
      tiers: domainBuckets.tiers,
      cursorByTier: progress.domainCursorByTier,
    });
    progress.domainCursorByTier = domainSelection.nextCursorByTier;
    if (domainSelection.selectedDomains.length === 0) {
      progress.stopReason = "no_active_domains_selected";
      break;
    }
    await fs.promises.writeFile(
      domainsBatchFile,
      `${domainSelection.selectedDomains.join("\n")}\n`,
      "utf8",
    );

    await runCommand(
      `sitemap_${batchId}`,
      [
        "backend/scripts/scrape-npn-barcodes-from-sitemaps.ts",
        "--out-dir",
        sitemapOutDir,
        "--npn-allowlist-file",
        batchQueueJsonl,
        "--strict-pairing",
        "--min-evidence-level",
        minEvidenceLevel,
        "--max-pages-per-domain",
        String(sitemapMaxPagesPerDomain),
        "--timeout-ms",
        String(sitemapTimeoutMs),
        "--concurrency",
        String(sitemapConcurrency),
        "--max-sitemaps-per-domain",
        String(sitemapMaxSitemapsPerDomain),
        "--max-urls-per-sitemap",
        String(sitemapMaxUrlsPerSitemap),
        "--domains-file",
        domainsBatchFile,
      ],
      path.resolve(process.cwd()),
      path.join(logsDir, "sitemap.log"),
      stageTimeoutSitemapSec,
    );

    await runCommand(
      `enrich_${batchId}`,
      [
        "backend/scripts/enrich-lnhpd-barcodes-from-web.ts",
        "--npn-queue-file",
        batchQueueJsonl,
        "--max-npns",
        String(queueSlice.length),
        "--page-size",
        String(enrichPageSize),
        "--max-attempts-per-npn",
        String(maxAttemptsPerNpn),
        "--query-num",
        String(enrichQueryNum),
        "--query-delay-ms",
        String(enrichQueryDelayMs),
        "--cse-timeout-ms",
        String(enrichCseTimeoutMs),
        "--html-timeout-ms",
        String(enrichHtmlTimeoutMs),
        "--token-strictness",
        enrichTokenStrictness,
        "--strict-brand-token-gate",
        "--strict-product-token-gate",
        ...(enableUpcFallbackQuery ? ["--enable-upc-fallback-query"] : []),
        ...(includeExistingNpn ? ["--include-existing-npn"] : []),
        "--summary-json",
        path.join(enrichOutDir, "summary.json"),
        "--coverage-report-json",
        path.join(enrichOutDir, "coverage_report.json"),
        "--matches-jsonl",
        path.join(enrichOutDir, "matches.jsonl"),
        "--failures-jsonl",
        path.join(enrichOutDir, "failures.jsonl"),
        "--checkpoint-file",
        path.join(enrichOutDir, "checkpoint.json"),
        ...(dryRun ? ["--dry-run"] : []),
      ],
      path.resolve(process.cwd()),
      path.join(logsDir, "enrich.log"),
      stageTimeoutEnrichSec,
    );

    const mergedPairsJson = path.join(batchDir, "merged_pairs.json");
    await mergePairsFromBatch({
      sitemapPairsJson: path.join(sitemapOutDir, "pairs.json"),
      enrichMatchesJsonl: path.join(enrichOutDir, "matches.jsonl"),
      outFile: mergedPairsJson,
    });

    await runCommand(
      `compare_${batchId}`,
      [
        "backend/scripts/compare-scraped-npn-barcodes.ts",
        "--input",
        mergedPairsJson,
        "--out-dir",
        compareOutDir,
        "--domains-seed-file",
        domainsSeedFile,
        ...(domainScoreboardJson ? ["--domain-scoreboard-json", domainScoreboardJson] : []),
      ],
      path.resolve(process.cwd()),
      path.join(logsDir, "compare.log"),
      stageTimeoutCompareSec,
    );

    const compareSummary = await loadJson<{ stats?: Record<string, unknown> }>(
      path.join(compareOutDir, "summary.json"),
    );
    const tieredQueue = await loadJsonArray(path.join(compareOutDir, "tiered_import_queue.json"));
    const repairQueue = await loadJsonArray(path.join(compareOutDir, "repair_priority_queue.json"));

    const compareStats = compareSummary.stats ?? {};
    const rejectedInvalidNpn = Number(compareStats.rejectedInvalidNpn ?? 0);
    const rejectedInvalidGtin14 = Number(compareStats.rejectedInvalidGtin14 ?? 0);
    const conflictsByBarcode = Number(compareStats.conflictsByBarcode ?? 0);
    const netNewPairs = Number(compareStats.netNewPairs ?? 0);
    const tierCountsRaw = (compareStats.tierCounts ?? {}) as Record<string, unknown>;
    const tierCounts = {
      P0_auto_import: Number(tierCountsRaw.P0_auto_import ?? 0),
      P1_review: Number(tierCountsRaw.P1_review ?? 0),
      P2_reject: Number(tierCountsRaw.P2_reject ?? 0),
      conflict: Number(tierCountsRaw.conflict ?? 0),
    };

    const sitemapDomainStats = fs.existsSync(path.join(sitemapOutDir, "domain_stats.json"))
      ? ((await loadJsonArray(path.join(sitemapOutDir, "domain_stats.json"))) as SitemapDomainStatsRow[])
      : [];
    const batchDomainTierStats = createTierCounterRecord();
    for (const tier of ["A", "B", "C"] as DomainTier[]) {
      batchDomainTierStats[tier].domainsSelected = domainSelection.selectedByTier[tier].length;
    }
    for (const row of sitemapDomainStats) {
      const domain = normalizeDomain(row.domain ?? "");
      if (!domain) continue;
      const tier = domainBuckets.domainTierMap.get(domain) ?? "C";
      batchDomainTierStats[tier].domainsScanned += 1;
      batchDomainTierStats[tier].urlsScanned += Number(row.pagesScanned ?? 0);
      batchDomainTierStats[tier].pairCountDedup += Number(row.pairCountDedup ?? row.pairCount ?? 0);
    }
    const batchDomainBudgetUsage = createBudgetCounterRecord();
    for (const tier of ["A", "B", "C"] as DomainTier[]) {
      const selectedCount = domainSelection.selectedByTier[tier].length;
      if (selectedCount <= 0) continue;
      batchDomainBudgetUsage[tier].domainSelections = selectedCount;
      batchDomainBudgetUsage[tier].batchesIncluded = 1;
    }

    const precisionGateOk = conflictsByBarcode === 0 && rejectedInvalidGtin14 === 0;
    const importStatsCore = await applyP0Tier({
      tierRows: tieredQueue,
      sourceTag,
      dryRun,
      precisionGateOk,
    });

    const p0Npns = new Set(
      tieredQueue
        .filter((row) => String(row.tier ?? "") === "P0_auto_import")
        .map((row) => normalizeNpn(row.npn))
        .filter((value): value is string => Boolean(value)),
    );
    const missBrandCounter = new Map<string, number>();
    for (const row of queueSlice) {
      const npn = normalizeNpn(row.npn);
      if (!npn || p0Npns.has(npn)) continue;
      const brand = String(row.brandName ?? "(unknown)").trim() || "(unknown)";
      missBrandCounter.set(brand, (missBrandCounter.get(brand) ?? 0) + 1);
    }
    const topMissBrands = Array.from(missBrandCounter.entries())
      .map(([brandName, count]) => ({ brandName, count }))
      .sort((a, b) => b.count - a.count || a.brandName.localeCompare(b.brandName))
      .slice(0, 10);

    const npnToBrand = new Map(
      queueSlice
        .map((row) => [normalizeNpn(row.npn), String(row.brandName ?? "(unknown)").trim() || "(unknown)"] as const)
        .filter((row): row is readonly [string, string] => Boolean(row[0])),
    );
    const tierBrandCounters = createTierBrandCounterRecord();
    for (const row of tieredQueue) {
      if (String(row.tier ?? "") === "P0_auto_import") continue;
      const npn = normalizeNpn(row.npn);
      if (!npn) continue;
      const brand = npnToBrand.get(npn) ?? "(unknown)";
      const rawTier = String(row.domainTier ?? "").trim().toUpperCase();
      const bucket: DomainTier | "unknown" =
        rawTier === "A" || rawTier === "B" || rawTier === "C" ? (rawTier as DomainTier) : "unknown";
      const map = tierBrandCounters[bucket] ?? tierBrandCounters.unknown;
      map.set(brand, (map.get(brand) ?? 0) + 1);
    }
    const topMissBrandsByTier = Object.fromEntries(
      (["A", "B", "C", "unknown"] as const).map((tier) => {
        const rows = Array.from(tierBrandCounters[tier].entries())
          .map(([brandName, count]) => ({ brandName, count }))
          .sort((a, b) => b.count - a.count || a.brandName.localeCompare(b.brandName))
          .slice(0, 10);
        return [tier, rows];
      }),
    ) as Record<DomainTier | "unknown", Array<{ brandName: string; count: number }>>;

    const p0Numerator = importStatsCore.imported || importStatsCore.wouldImport;
    const p0Rate = queueSlice.length > 0 ? p0Numerator / queueSlice.length : 0;
    const conflictRate = queueSlice.length > 0 ? conflictsByBarcode / queueSlice.length : 0;
    const yieldPer1000Npns = queueSlice.length > 0 ? (importStatsCore.imported / queueSlice.length) * 1000 : 0;
    const yieldPer1000NetNewPairs = queueSlice.length > 0 ? (netNewPairs / queueSlice.length) * 1000 : 0;
    const repairQueueDelta =
      previousRepairQueueCount == null ? null : Number(repairQueue.length) - Number(previousRepairQueueCount);

    const batchReport: BatchRunSummary = {
      batchId,
      batchIndex,
      queueStart,
      queueEnd: queueEnd - 1,
      queueCount: queueSlice.length,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date().toISOString(),
      elapsedSec: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
      compareStats: {
        rejectedInvalidNpn,
        rejectedInvalidGtin14,
        conflictsByBarcode,
        netNewPairs,
        tierCounts,
      },
      importStats: {
        ...importStatsCore,
        sourceTag,
      },
      quality: {
        p0Rate: Number(p0Rate.toFixed(6)),
        yieldPer1000Npns: Number(yieldPer1000Npns.toFixed(3)),
        yieldPer1000NetNewPairs: Number(yieldPer1000NetNewPairs.toFixed(3)),
        conflictRate: Number(conflictRate.toFixed(6)),
        repairQueueDelta,
      },
      topMissBrands,
      topMissBrandsByTier,
      domainSelection: {
        selectedDomains: domainSelection.selectedDomains,
        selectedByTier: domainSelection.selectedByTier,
        source: domainBuckets.source,
      },
      domainTierStats: batchDomainTierStats,
      domainBudgetUsage: batchDomainBudgetUsage,
      files: {
        batchQueueJsonl,
        batchQueueJson,
        domainsBatchFile,
        sitemapOutDir,
        enrichOutDir,
        mergedPairsJson,
        compareOutDir,
        tieredImportQueueJson: path.join(compareOutDir, "tiered_import_queue.json"),
        repairPriorityQueueJson: path.join(compareOutDir, "repair_priority_queue.json"),
      },
    };

    await writeJson(path.join(batchDir, "batch_report.json"), batchReport);
    await appendJsonl(ledgerPath, batchReport as unknown as Record<string, unknown>);

    progress.batchReports.push(batchReport);
    progress.batchesCompleted += 1;
    progress.cumulative.attemptedNpns += queueSlice.length;
    progress.cumulative.importedP0 += importStatsCore.imported;
    progress.cumulative.wouldImportP0 += importStatsCore.wouldImport;
    progress.cumulative.conflictsByBarcode += conflictsByBarcode;
    progress.cumulative.rejectedInvalidNpn += rejectedInvalidNpn;
    progress.cumulative.rejectedInvalidGtin14 += rejectedInvalidGtin14;
    progress.cumulative.p1Review += tierCounts.P1_review;
    progress.cumulative.p2Reject += tierCounts.P2_reject;
    progress.cumulative.repairQueueSize += repairQueue.length;
    for (const tier of ["A", "B", "C"] as DomainTier[]) {
      progress.cumulative.domainTierStats[tier].domainsSelected +=
        batchDomainBudgetUsage[tier].domainSelections;
      progress.cumulative.domainTierStats[tier].domainsScanned += batchDomainTierStats[tier].domainsScanned;
      progress.cumulative.domainTierStats[tier].urlsScanned += batchDomainTierStats[tier].urlsScanned;
      progress.cumulative.domainTierStats[tier].pairCountDedup += batchDomainTierStats[tier].pairCountDedup;

      progress.cumulative.domainBudgetUsage[tier].domainSelections +=
        batchDomainBudgetUsage[tier].domainSelections;
      progress.cumulative.domainBudgetUsage[tier].batchesIncluded +=
        batchDomainBudgetUsage[tier].batchesIncluded;
    }

    await writeJson(progressPath, progress);

    previousRepairQueueCount = repairQueue.length;

    const lowYield = p0Rate < 0.002;
    const nonImprovingConflict =
      previousConflictRate == null || conflictRate >= previousConflictRate;
    if (lowYield && nonImprovingConflict) {
      lowYieldStreak += 1;
    } else {
      lowYieldStreak = 0;
    }
    previousConflictRate = conflictRate;

    if (lowYieldStreak >= 3) {
      progress.stopReason = "low_yield_plateau_3_batches";
      break;
    }

    if (stoplossWindowBatches > 0 && stoplossYieldThreshold > 0) {
      const lowNetNewYield = yieldPer1000NetNewPairs < stoplossYieldThreshold;
      const repairStagnant =
        !stoplossRequireRepairDeltaNonNegative ||
        (repairQueueDelta != null && Number.isFinite(repairQueueDelta) && repairQueueDelta >= 0);
      if (lowNetNewYield && repairStagnant) {
        stoplossStreak += 1;
      } else {
        stoplossStreak = 0;
      }
      if (stoplossStreak >= stoplossWindowBatches) {
        progress.stopReason = "stoploss_low_netnew_yield_repair_stagnant";
        break;
      }
    }
  }

  progress.finishedAt = new Date().toISOString();
  progress.status = progress.stopReason ? "stopped" : "completed";
  await writeJson(progressPath, progress);

  console.log(
    JSON.stringify(
      {
        runId: progress.runId,
        status: progress.status,
        stopReason: progress.stopReason,
        batchesCompleted: progress.batchesCompleted,
        attemptedNpns: progress.cumulative.attemptedNpns,
        importedP0: progress.cumulative.importedP0,
        elapsedSec: Number(((Date.now() - startedAtMs) / 1000).toFixed(2)),
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error(
    "[run-npn-full-hunt-supervisor] fatal:",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
