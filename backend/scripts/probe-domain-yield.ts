import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

type DomainSeedRow = {
  domain?: string;
  type?: "retailer" | "brand" | string;
  platformGuess?: "shopify" | "wp" | "custom" | string;
  sitemapHints?: string[];
  priorityTier?: "A" | "B" | "C" | string;
  status?: "active" | "paused" | "disabled" | string;
  lastProbeAt?: string | null;
};

type DomainSeedPayload = {
  version?: string;
  generatedAt?: string;
  domains?: DomainSeedRow[];
};

type DomainStatsRow = {
  domain: string;
  sitemapsTried: number;
  sitemapsRead: number;
  pagesQueued: number;
  pagesScanned: number;
  pagesFetchFailed?: number;
  pagesWithNpn?: number;
  pagesWithBarcode?: number;
  pagesWithPairs: number;
  pairCount: number;
  pairCountRaw?: number;
  pairCountDedup?: number;
  npnCount: number;
  avgFetchMs?: number;
  errRate?: number;
  npnFoundRate?: number;
  barcodeFoundRate?: number;
  npnAndBarcodeSamePageRate?: number;
  yieldPer1000Urls?: number;
};

type ScoreRow = {
  domain: string;
  currentTier: "A" | "B" | "C";
  suggestedTier: "A" | "B" | "C";
  platformGuess: string | null;
  status: string;
  urlsScanned: number;
  npnHits: number;
  barcodeHits: number;
  npnAndBarcodeSamePageHits: number;
  pairCountRaw: number;
  pairCountDedup: number;
  npnCount: number;
  yieldPer1000Urls: number;
  npnFoundRate: number;
  barcodeFoundRate: number;
  npnAndBarcodeSamePageRate: number;
  avgFetchMs: number;
  errRate: number;
  qualityFlags: string[];
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

const repoRoot = process.cwd();
const stamp = new Date().toISOString().replace(/[:]/g, "-");
const domainsSeedFile =
  getArg("domains-seed-file") ??
  path.resolve(repoRoot, "backend/config/domains_seed.v1.json");
const outDir =
  getArg("out-dir") ??
  path.resolve(repoRoot, "output/npn_webhunt/domain_yield", stamp);
const samplePagesPerDomain = Math.max(
  50,
  Math.min(2000, asNumber(getArg("sample-pages-per-domain"), 300)),
);
const timeoutMs = Math.max(3000, asNumber(getArg("timeout-ms"), 12000));
const concurrency = Math.max(1, Math.min(20, asNumber(getArg("concurrency"), 10)));
const minEvidenceLevel = (getArg("min-evidence-level") ?? "medium").toLowerCase();
const strictPairing = !hasFlag("loose-pairing");
const npnAllowlistFile = getArg("npn-allowlist-file");

const ensureDir = async (dirPath: string) => {
  await fs.promises.mkdir(dirPath, { recursive: true });
};

const writeJson = async (filePath: string, payload: unknown) => {
  await ensureDir(path.dirname(filePath));
  await fs.promises.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const writeText = async (filePath: string, text: string) => {
  await ensureDir(path.dirname(filePath));
  await fs.promises.writeFile(filePath, text, "utf8");
};

const normalizeDomain = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");

const normalizeTier = (value: unknown): "A" | "B" | "C" => {
  const text = String(value ?? "").trim().toUpperCase();
  if (text === "A" || text === "B" || text === "C") return text;
  return "C";
};

const loadDomainSeeds = async (
  filePath: string,
): Promise<Array<{ domain: string; tier: "A" | "B" | "C"; status: string; platformGuess: string | null }>> => {
  const raw = await fs.promises.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as DomainSeedPayload;
  const rows = Array.isArray(parsed?.domains) ? parsed.domains : [];
  const out: Array<{ domain: string; tier: "A" | "B" | "C"; status: string; platformGuess: string | null }> = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const domain = normalizeDomain(String(row?.domain ?? ""));
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    out.push({
      domain,
      tier: normalizeTier(row?.priorityTier),
      status: String(row?.status ?? "active"),
      platformGuess: row?.platformGuess ? String(row.platformGuess) : null,
    });
  }
  return out;
};

const runSitemapProbe = async (params: {
  domainsFile: string;
  outDir: string;
}) => {
  const cmdArgs = [
    "--import",
    "tsx",
    "backend/scripts/scrape-npn-barcodes-from-sitemaps.ts",
    "--domains-file",
    params.domainsFile,
    "--out-dir",
    params.outDir,
    "--max-pages-per-domain",
    String(samplePagesPerDomain),
    "--timeout-ms",
    String(timeoutMs),
    "--concurrency",
    String(concurrency),
    "--min-evidence-level",
    minEvidenceLevel,
    "--max-sitemaps-per-domain",
    "20",
    "--max-urls-per-sitemap",
    "12000",
  ];
  if (strictPairing) cmdArgs.push("--strict-pairing");
  if (npnAllowlistFile) {
    cmdArgs.push("--npn-allowlist-file", npnAllowlistFile);
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, cmdArgs, {
      cwd: repoRoot,
      env: process.env,
      stdio: "inherit",
    });
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`[probe-domain-yield] sitemap probe failed with exit code ${code}`));
    });
  });
};

const round = (value: number, digits = 6): number => {
  if (!Number.isFinite(value)) return 0;
  const base = 10 ** digits;
  return Math.round(value * base) / base;
};

const scoreDomain = (row: DomainStatsRow): { tier: "A" | "B" | "C"; flags: string[] } => {
  const flags: string[] = [];
  const rate = Number(row.npnAndBarcodeSamePageRate ?? 0);
  const yieldPer1k = Number(row.yieldPer1000Urls ?? 0);
  const errRate = Number(row.errRate ?? 0);

  if (row.pagesScanned < 80) flags.push("low_sample_size");
  if (errRate >= 0.35) flags.push("high_error_rate");
  if (rate < 0.005) flags.push("low_same_page_rate");
  if (yieldPer1k < 20) flags.push("low_yield");

  if (errRate < 0.25 && rate >= 0.02 && yieldPer1k >= 20) return { tier: "A", flags };
  if (errRate < 0.40 && rate >= 0.005 && yieldPer1k >= 5) return { tier: "B", flags };
  return { tier: "C", flags };
};

const main = async () => {
  const seeds = await loadDomainSeeds(domainsSeedFile);
  const activeSeeds = seeds.filter((row) => row.status.toLowerCase() === "active");
  if (!activeSeeds.length) {
    throw new Error("[probe-domain-yield] no active domains in seed file");
  }

  await ensureDir(outDir);
  const probeDomainsFile = path.join(outDir, "probe_domains.txt");
  await writeText(
    probeDomainsFile,
    `${activeSeeds.map((row) => row.domain).join("\n")}\n`,
  );

  const rawProbeOutDir = path.join(outDir, "raw_probe");
  await runSitemapProbe({
    domainsFile: probeDomainsFile,
    outDir: rawProbeOutDir,
  });

  const statsPath = path.join(rawProbeOutDir, "domain_stats.json");
  const summaryPath = path.join(rawProbeOutDir, "summary.json");
  const domainStats = JSON.parse(
    await fs.promises.readFile(statsPath, "utf8"),
  ) as DomainStatsRow[];
  const rawSummary = JSON.parse(await fs.promises.readFile(summaryPath, "utf8")) as Record<string, unknown>;

  const seedMap = new Map(activeSeeds.map((row) => [row.domain, row]));
  const scoreboard: ScoreRow[] = [];
  for (const row of domainStats) {
    const seed = seedMap.get(normalizeDomain(row.domain));
    const currentTier = seed?.tier ?? "C";
    const urlsScanned = Number(row.pagesScanned ?? 0);
    const npnHits = Number(row.pagesWithNpn ?? 0);
    const barcodeHits = Number(row.pagesWithBarcode ?? 0);
    const samePageHits = Number(row.pagesWithPairs ?? 0);
    const pairCountRaw = Number(row.pairCountRaw ?? row.pairCount ?? 0);
    const pairCountDedup = Number(row.pairCountDedup ?? row.pairCount ?? 0);
    const errRate = Number(
      row.errRate ??
        (urlsScanned > 0 ? Number(row.pagesFetchFailed ?? 0) / urlsScanned : 0),
    );
    const npnFoundRate = Number(row.npnFoundRate ?? (urlsScanned > 0 ? npnHits / urlsScanned : 0));
    const barcodeFoundRate = Number(
      row.barcodeFoundRate ?? (urlsScanned > 0 ? barcodeHits / urlsScanned : 0),
    );
    const samePageRate = Number(
      row.npnAndBarcodeSamePageRate ?? (urlsScanned > 0 ? samePageHits / urlsScanned : 0),
    );
    const yieldPer1000Urls = Number(
      row.yieldPer1000Urls ??
        (urlsScanned > 0 ? (pairCountDedup / urlsScanned) * 1000 : 0),
    );
    const avgFetchMs = Number(row.avgFetchMs ?? 0);
    const scored = scoreDomain({
      ...row,
      errRate,
      npnAndBarcodeSamePageRate: samePageRate,
      yieldPer1000Urls,
    });

    scoreboard.push({
      domain: row.domain,
      currentTier,
      suggestedTier: scored.tier,
      platformGuess: seed?.platformGuess ?? null,
      status: seed?.status ?? "active",
      urlsScanned,
      npnHits,
      barcodeHits,
      npnAndBarcodeSamePageHits: samePageHits,
      pairCountRaw,
      pairCountDedup,
      npnCount: Number(row.npnCount ?? 0),
      yieldPer1000Urls: round(yieldPer1000Urls, 3),
      npnFoundRate: round(npnFoundRate),
      barcodeFoundRate: round(barcodeFoundRate),
      npnAndBarcodeSamePageRate: round(samePageRate),
      avgFetchMs: round(avgFetchMs, 2),
      errRate: round(errRate),
      qualityFlags: scored.flags,
    });
  }

  scoreboard.sort((a, b) => b.yieldPer1000Urls - a.yieldPer1000Urls);
  const tierCounts = scoreboard.reduce(
    (acc, row) => {
      acc.current[row.currentTier] += 1;
      acc.suggested[row.suggestedTier] += 1;
      return acc;
    },
    {
      current: { A: 0, B: 0, C: 0 },
      suggested: { A: 0, B: 0, C: 0 },
    },
  );

  const report = {
    generatedAt: new Date().toISOString(),
    domainsSeedFile: domainsSeedFile,
    probeDomainsFile,
    rawProbeOutDir,
    settings: {
      samplePagesPerDomain,
      timeoutMs,
      concurrency,
      strictPairing,
      minEvidenceLevel,
      npnAllowlistFile: npnAllowlistFile ?? null,
    },
    totals: {
      domains: scoreboard.length,
      urlsScanned: scoreboard.reduce((acc, row) => acc + row.urlsScanned, 0),
      pairCountRaw: scoreboard.reduce((acc, row) => acc + row.pairCountRaw, 0),
      pairCountDedup: scoreboard.reduce((acc, row) => acc + row.pairCountDedup, 0),
      npnCount: scoreboard.reduce((acc, row) => acc + row.npnCount, 0),
    },
    tierCounts,
    topDomains: scoreboard.slice(0, 30),
    rawSummary,
    scoreboard,
  };

  await writeJson(path.join(outDir, "domain_scoreboard.json"), report);
  await writeJson(path.join(outDir, "domain_scoreboard.rows.json"), scoreboard);
  console.log(
    JSON.stringify(
      {
        outDir,
        domains: report.totals.domains,
        urlsScanned: report.totals.urlsScanned,
        pairCountDedup: report.totals.pairCountDedup,
        suggestedTierA: tierCounts.suggested.A,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error(
    "[probe-domain-yield] fatal:",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
