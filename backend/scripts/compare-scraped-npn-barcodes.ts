import fs from "node:fs";
import path from "node:path";

import { normalizeBarcodeInput } from "../src/barcode.js";
import { supabase } from "../src/supabase.js";

type ScrapedPair = {
  domain?: string;
  npn?: string;
  barcode?: string;
  url?: string;
  sourceFile?: string;
  extractMode?: string;
  evidenceLevel?: "high" | "medium" | "low";
  evidenceScore?: number;
  tokenDistance?: number | null;
  brandOverlap?: number | null;
  productOverlap?: number | null;
  requiredBrandOverlap?: number | null;
  requiredProductOverlap?: number | null;
  contextPass?: boolean | null;
};

type MapRow = {
  barcode_gtin14: string | null;
  npn: string | null;
  source: string | null;
  confidence: number | null;
};

type FactsRow = {
  npn: string | null;
  facts_json: Record<string, unknown> | null;
};

type NormalizedPair = {
  npn: string;
  barcodeGtin14: string;
  barcodeRaw: string;
  domain: string;
  url: string;
  sourceFile: string | null;
  extractMode: string | null;
  evidenceLevel: "high" | "medium" | "low";
  evidenceScore: number;
  tokenDistance: number | null;
  brandOverlap: number;
  productOverlap: number;
  requiredBrandOverlap: number;
  requiredProductOverlap: number;
  contextPass: boolean;
};

type RejectedInput = {
  npnRaw: string;
  barcodeRaw: string;
  domain: string;
  url: string;
  rejectReason: "invalid_npn" | "invalid_gtin14";
};

type Tier = "P0_auto_import" | "P1_review" | "P2_reject" | "conflict";
type DomainTier = "A" | "B" | "C";

type DomainSeedPayload = {
  domains?: Array<{
    domain?: string;
    priorityTier?: string;
    status?: string;
  }>;
};

type DomainScoreboardRow = {
  domain?: string;
  suggestedTier?: string;
};

const args = process.argv.slice(2);
const getArg = (flag: string): string | null => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const inputPath =
  getArg("input") ??
  path.resolve(process.cwd(), "output/npn_webhunt/final_2026-02-26/merged_pairs.json");
const domainsSeedFile =
  getArg("domains-seed-file") ??
  path.resolve(process.cwd(), "backend/config/domains_seed.v1.json");
const domainScoreboardJson = getArg("domain-scoreboard-json");
const outDirArg = getArg("out-dir");
const table = getArg("lnhpd-table") ?? "lnhpd_facts";
const chunkSize = Math.max(20, Math.min(400, Number(getArg("chunk-size") ?? "180")));
const pageSize = Math.max(200, Math.min(5000, Number(getArg("page-size") ?? "1500")));
const p0RequireTierA = !args.includes("--allow-non-tier-a-p0");

const normalizeNpn = (value: unknown): string | null => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!/^\d{8}$/.test(digits)) return null;
  if (/^(\d)\1{7}$/.test(digits)) return null;
  return digits;
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

const normalizeBarcodeToGtin14 = (value: unknown): string | null => {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits || digits.length < 8 || digits.length > 14) return null;

  const candidates = digits.length === 11 ? [`0${digits}`, digits] : [digits];
  for (const candidate of candidates) {
    const normalized = normalizeBarcodeInput(candidate);
    if (!normalized || normalized.isValidChecksum !== true) continue;
    const gtin14 = normalized.variants.find((variant) => /^\d{14}$/.test(variant)) ?? null;
    if (!gtin14) continue;
    if (/^(\d)\1{13}$/.test(gtin14)) continue;
    return gtin14;
  }
  return null;
};

const evidenceScoreFromPair = (pair: ScrapedPair): number => {
  if (typeof pair.evidenceScore === "number" && Number.isFinite(pair.evidenceScore)) {
    return Math.max(0, Math.min(10, Number(pair.evidenceScore.toFixed(2))));
  }
  const level = pair.evidenceLevel;
  if (level === "high") return 9;
  if (level === "medium") return 7;
  if (level === "low") return 6;
  const mode = String(pair.extractMode ?? "").toLowerCase();
  if (mode.includes("jsonld")) return 9;
  if (mode.includes("keyword")) return 7;
  if (mode.includes("snippet")) return 6;
  if (mode.includes("sitemap")) return 6;
  return 6;
};

const evidenceLevelFromScore = (score: number): "high" | "medium" | "low" => {
  if (score >= 8) return "high";
  if (score >= 6) return "medium";
  return "low";
};

const ensureDir = async (dirPath: string) => {
  await fs.promises.mkdir(dirPath, { recursive: true });
};

const writeJson = async (filePath: string, payload: unknown) => {
  await ensureDir(path.dirname(filePath));
  await fs.promises.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const writeCsv = async (filePath: string, headers: string[], rows: Record<string, unknown>[]) => {
  const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((key) => escape(row[key])).join(","));
  }
  await ensureDir(path.dirname(filePath));
  await fs.promises.writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
};

const countRejectedByReason = (
  rows: RejectedInput[],
  reason: RejectedInput["rejectReason"],
): number => rows.filter((row) => row.rejectReason === reason).length;

const readInputPairs = async (): Promise<{ pairs: NormalizedPair[]; rejectedRows: RejectedInput[] }> => {
  const raw = await fs.promises.readFile(inputPath, "utf8");
  const parsed = JSON.parse(raw) as ScrapedPair[];
  if (!Array.isArray(parsed)) throw new Error("input must be an array of pairs");

  const dedup = new Map<string, NormalizedPair>();
  const rejectedRows: RejectedInput[] = [];

  for (const row of parsed) {
    const npnRaw = String(row.npn ?? "");
    const barcodeRaw = String(row.barcode ?? "");
    const npn = normalizeNpn(row.npn);
    const barcodeGtin14 = normalizeBarcodeToGtin14(row.barcode);

    if (!npn) {
      rejectedRows.push({
        npnRaw,
        barcodeRaw,
        domain: String(row.domain ?? ""),
        url: String(row.url ?? ""),
        rejectReason: "invalid_npn",
      });
      continue;
    }

    if (!barcodeGtin14) {
      rejectedRows.push({
        npnRaw,
        barcodeRaw,
        domain: String(row.domain ?? ""),
        url: String(row.url ?? ""),
        rejectReason: "invalid_gtin14",
      });
      continue;
    }

    const candidate: NormalizedPair = {
      npn,
      barcodeGtin14,
      barcodeRaw,
      domain: normalizeDomain(String(row.domain ?? "")),
      url: String(row.url ?? ""),
      sourceFile: row.sourceFile ? String(row.sourceFile) : null,
      extractMode: row.extractMode ? String(row.extractMode) : null,
      evidenceScore: evidenceScoreFromPair(row),
      evidenceLevel: evidenceLevelFromScore(evidenceScoreFromPair(row)),
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
    };

    const key = `${npn}|${barcodeGtin14}`;
    const previous = dedup.get(key);
    if (!previous) {
      dedup.set(key, candidate);
      continue;
    }

    if (candidate.evidenceScore > previous.evidenceScore) {
      dedup.set(key, candidate);
      continue;
    }

    if (candidate.evidenceScore === previous.evidenceScore && candidate.url && !previous.url) {
      dedup.set(key, candidate);
    }
  }

  return { pairs: Array.from(dedup.values()), rejectedRows };
};

const loadDomainTierMap = async (): Promise<Map<string, DomainTier>> => {
  const out = new Map<string, DomainTier>();

  if (fs.existsSync(domainsSeedFile)) {
    const seedRaw = await fs.promises.readFile(domainsSeedFile, "utf8");
    const seed = JSON.parse(seedRaw) as DomainSeedPayload;
    const rows = Array.isArray(seed?.domains) ? seed.domains : [];
    for (const row of rows) {
      const domain = normalizeDomain(row?.domain);
      if (!domain) continue;
      const status = String(row?.status ?? "active").toLowerCase();
      if (status !== "active") continue;
      out.set(domain, normalizeTier(row?.priorityTier));
    }
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
      if (!domain) continue;
      out.set(domain, normalizeTier(row?.suggestedTier));
    }
  }

  return out;
};

const fetchMapRowsByNpns = async (npns: string[]): Promise<MapRow[]> => {
  const out: MapRow[] = [];
  for (let i = 0; i < npns.length; i += chunkSize) {
    const chunk = npns.slice(i, i + chunkSize);
    let from = 0;
    while (true) {
      const to = from + pageSize - 1;
      const { data, error } = await supabase
        .from("barcode_regulatory_map")
        .select("barcode_gtin14,npn,source,confidence")
        .in("npn", chunk)
        .range(from, to);
      if (error) throw new Error(`fetch barcode_regulatory_map failed: ${error.message}`);
      const rows = (data ?? []) as MapRow[];
      out.push(...rows);
      if (rows.length < pageSize) break;
      from += pageSize;
    }
  }
  return out;
};

const fetchFactsRowsByNpns = async (npns: string[]): Promise<FactsRow[]> => {
  const out: FactsRow[] = [];
  for (let i = 0; i < npns.length; i += chunkSize) {
    const chunk = npns.slice(i, i + chunkSize);
    let from = 0;
    while (true) {
      const to = from + pageSize - 1;
      const { data, error } = await supabase
        .from(table)
        .select("npn,facts_json")
        .in("npn", chunk)
        .range(from, to);
      if (error) throw new Error(`fetch ${table} failed: ${error.message}`);
      const rows = (data ?? []) as FactsRow[];
      out.push(...rows);
      if (rows.length < pageSize) break;
      from += pageSize;
    }
  }
  return out;
};

const extractFactsCandidatePairs = (rows: FactsRow[]) => {
  const pairSet = new Set<string>();
  for (const row of rows) {
    const npn = normalizeNpn(row.npn);
    if (!npn) continue;
    const facts = row.facts_json ?? {};
    const candidates = Array.isArray((facts as Record<string, unknown>).barcodeCandidates)
      ? ((facts as Record<string, unknown>).barcodeCandidates as unknown[])
      : [];
    for (const candidate of candidates) {
      const barcode =
        candidate && typeof candidate === "object" && !Array.isArray(candidate)
          ? normalizeBarcodeToGtin14(
              (candidate as Record<string, unknown>).barcode ??
                (candidate as Record<string, unknown>).barcode_gtin14 ??
                (candidate as Record<string, unknown>).gtin14 ??
                (candidate as Record<string, unknown>).value,
            )
          : normalizeBarcodeToGtin14(candidate);
      if (!barcode) continue;
      pairSet.add(`${npn}|${barcode}`);
    }
  }
  return pairSet;
};

const classifyTier = (params: {
  exactInMap: boolean;
  inFactsCandidates: boolean;
  conflictNpns: string[];
  evidenceScore: number;
  domainTier: DomainTier;
  samePagePairingPass: boolean;
  tokenGatePass: boolean;
}): {
  tier: Tier;
  rejectReason: string | null;
  conflictType: string | null;
  gateRejectReason: string[];
} => {
  const {
    exactInMap,
    inFactsCandidates,
    conflictNpns,
    evidenceScore,
    domainTier,
    samePagePairingPass,
    tokenGatePass,
  } = params;
  const gateRejectReason: string[] = [];

  if (exactInMap) {
    gateRejectReason.push("duplicate_in_map");
    return {
      tier: "P2_reject",
      rejectReason: "duplicate_in_map",
      conflictType: null,
      gateRejectReason,
    };
  }
  if (conflictNpns.length > 0) {
    gateRejectReason.push("barcode_conflict_existing_map");
    return {
      tier: "conflict",
      rejectReason: "barcode_conflict_existing_map",
      conflictType: "barcode_mapped_to_other_npn",
      gateRejectReason,
    };
  }
  if (inFactsCandidates) {
    gateRejectReason.push("duplicate_in_facts_candidates");
    return {
      tier: "P2_reject",
      rejectReason: "duplicate_in_facts_candidates",
      conflictType: null,
      gateRejectReason,
    };
  }

  if (!samePagePairingPass) gateRejectReason.push("same_page_pairing_missing");
  if (!tokenGatePass) gateRejectReason.push("token_gate_failed");
  if (p0RequireTierA && domainTier !== "A") gateRejectReason.push("domain_not_tier_a");
  if (evidenceScore < 8) gateRejectReason.push("evidence_score_below_p0");

  if (gateRejectReason.length === 0) {
    return {
      tier: "P0_auto_import",
      rejectReason: null,
      conflictType: null,
      gateRejectReason,
    };
  }
  if (evidenceScore >= 6) {
    return {
      tier: "P1_review",
      rejectReason: gateRejectReason[0] ?? "evidence_score_requires_review",
      conflictType: null,
      gateRejectReason,
    };
  }
  return {
    tier: "P2_reject",
    rejectReason: gateRejectReason[0] ?? "low_evidence_score",
    conflictType: null,
    gateRejectReason,
  };
};

const main = async () => {
  const startedAt = new Date().toISOString();
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const outDir = outDirArg ?? path.resolve(process.cwd(), `output/npn_webhunt/compare/${stamp}`);

  const { pairs: scrapedPairs, rejectedRows } = await readInputPairs();
  const domainTierMap = await loadDomainTierMap();
  const scrapedNpns = Array.from(new Set(scrapedPairs.map((row) => row.npn)));

  const mapRows = await fetchMapRowsByNpns(scrapedNpns);
  const mapPairSet = new Set<string>();
  const mapByBarcode = new Map<string, Set<string>>();
  for (const row of mapRows) {
    const npn = normalizeNpn(row.npn);
    const barcode = normalizeBarcodeToGtin14(row.barcode_gtin14);
    if (!npn || !barcode) continue;
    mapPairSet.add(`${npn}|${barcode}`);
    if (!mapByBarcode.has(barcode)) mapByBarcode.set(barcode, new Set());
    mapByBarcode.get(barcode)!.add(npn);
  }

  const factsRows = await fetchFactsRowsByNpns(scrapedNpns);
  const factsPairSet = extractFactsCandidatePairs(factsRows);

  const duplicatesInMap: Record<string, unknown>[] = [];
  const duplicatesInFactsOnly: Record<string, unknown>[] = [];
  const conflictsByBarcode: Record<string, unknown>[] = [];
  const netNewPairs: Record<string, unknown>[] = [];
  const tieredImportQueue: Record<string, unknown>[] = [];
  const gateRejectReasonCounter = new Map<string, number>();

  for (const pair of scrapedPairs) {
    const key = `${pair.npn}|${pair.barcodeGtin14}`;
    const barcodeNpns = mapByBarcode.get(pair.barcodeGtin14) ?? new Set<string>();
    const exactInMap = mapPairSet.has(key);
    const inFactsCandidates = factsPairSet.has(key);
    const conflictNpns = Array.from(barcodeNpns).filter((npn) => npn !== pair.npn);
    const domainTier = domainTierMap.get(pair.domain) ?? "C";
    const samePagePairingPass =
      pair.contextPass &&
      pair.tokenDistance != null &&
      Number.isFinite(pair.tokenDistance) &&
      Number(pair.tokenDistance) <= 260;
    const tokenGatePass =
      pair.brandOverlap >= Math.max(1, pair.requiredBrandOverlap) &&
      pair.productOverlap >= Math.max(2, pair.requiredProductOverlap);

    const tierResult = classifyTier({
      exactInMap,
      inFactsCandidates,
      conflictNpns,
      evidenceScore: pair.evidenceScore,
      domainTier,
      samePagePairingPass,
      tokenGatePass,
    });

    for (const reason of tierResult.gateRejectReason) {
      gateRejectReasonCounter.set(reason, (gateRejectReasonCounter.get(reason) ?? 0) + 1);
    }

    const row = {
      npn: pair.npn,
      barcode_gtin14: pair.barcodeGtin14,
      barcode_raw: pair.barcodeRaw,
      domain: pair.domain,
      url: pair.url,
      sourceFile: pair.sourceFile,
      extractMode: pair.extractMode,
      evidenceLevel: pair.evidenceLevel,
      evidenceScore: pair.evidenceScore,
      tokenDistance: pair.tokenDistance,
      brandOverlap: pair.brandOverlap,
      productOverlap: pair.productOverlap,
      requiredBrandOverlap: pair.requiredBrandOverlap,
      requiredProductOverlap: pair.requiredProductOverlap,
      contextPass: pair.contextPass,
      samePagePairingPass,
      tokenGatePass,
      domainTier,
      gateRejectReason: tierResult.gateRejectReason,
      precisionProxy: {
        samePagePairingPass,
        tokenGatePass,
        domainTier,
        evidenceScore: pair.evidenceScore,
        conflictFree: conflictNpns.length === 0,
      },
      exactInMap,
      inFactsCandidates,
      conflictNpns: conflictNpns.join("|"),
      tier: tierResult.tier,
      rejectReason: tierResult.rejectReason,
      conflictType: tierResult.conflictType,
      importEligible: tierResult.tier === "P0_auto_import",
    };

    tieredImportQueue.push(row);

    if (exactInMap) {
      duplicatesInMap.push(row);
      continue;
    }
    if (conflictNpns.length > 0) {
      conflictsByBarcode.push(row);
      continue;
    }
    if (inFactsCandidates) {
      duplicatesInFactsOnly.push(row);
      continue;
    }
    netNewPairs.push(row);
  }

  const tierCounts = {
    P0_auto_import: tieredImportQueue.filter((row) => row.tier === "P0_auto_import").length,
    P1_review: tieredImportQueue.filter((row) => row.tier === "P1_review").length,
    P2_reject: tieredImportQueue.filter((row) => row.tier === "P2_reject").length,
    conflict: tieredImportQueue.filter((row) => row.tier === "conflict").length,
  };
  const domainTierCounts = {
    A: tieredImportQueue.filter((row) => String(row.domainTier ?? "") === "A").length,
    B: tieredImportQueue.filter((row) => String(row.domainTier ?? "") === "B").length,
    C: tieredImportQueue.filter((row) => String(row.domainTier ?? "") === "C").length,
    unknown: tieredImportQueue.filter((row) => !["A", "B", "C"].includes(String(row.domainTier ?? ""))).length,
  };

  const repairPriorityQueue = tieredImportQueue
    .filter((row) => row.tier === "conflict" || row.tier === "P1_review" || row.tier === "P2_reject")
    .map((row) => {
      const tier = String(row.tier ?? "");
      const priority = tier === "conflict" ? 1 : tier === "P1_review" ? 2 : 3;
      const action =
        tier === "conflict"
          ? "manual_conflict_resolution"
          : tier === "P1_review"
            ? "manual_evidence_review"
            : "needs_higher_quality_sources";
      return {
        queuePriority: priority,
        recommendedAction: action,
        ...row,
      };
    })
    .sort((a, b) => {
      if (a.queuePriority !== b.queuePriority) return a.queuePriority - b.queuePriority;
      const scoreA = Number((a as Record<string, unknown>).evidenceScore ?? 0);
      const scoreB = Number((b as Record<string, unknown>).evidenceScore ?? 0);
      return scoreB - scoreA;
    });

  const summary = {
    startedAt,
    finishedAt: new Date().toISOString(),
    inputPath,
    outDir,
    settings: {
      domainsSeedFile,
      domainScoreboardJson: domainScoreboardJson ?? null,
      p0RequireTierA,
    },
    stats: {
      scrapedPairs: scrapedPairs.length,
      scrapedNpns: scrapedNpns.length,
      rejectedInputRows: rejectedRows.length,
      rejectedInvalidNpn: countRejectedByReason(rejectedRows, "invalid_npn"),
      rejectedInvalidGtin14: countRejectedByReason(rejectedRows, "invalid_gtin14"),
      mapRowsFetched: mapRows.length,
      factsRowsFetched: factsRows.length,
      duplicatesInMap: duplicatesInMap.length,
      duplicatesInFactsOnly: duplicatesInFactsOnly.length,
      conflictsByBarcode: conflictsByBarcode.length,
      netNewPairs: netNewPairs.length,
      tierCounts,
      domainTierCounts,
      precisionProxy: {
        p0AutoImportRate:
          tieredImportQueue.length > 0 ? Number((tierCounts.P0_auto_import / tieredImportQueue.length).toFixed(6)) : 0,
        conflictRate:
          tieredImportQueue.length > 0 ? Number((tierCounts.conflict / tieredImportQueue.length).toFixed(6)) : 0,
        invalidRate:
          scrapedPairs.length + rejectedRows.length > 0
            ? Number(
                (
                  (countRejectedByReason(rejectedRows, "invalid_npn") +
                    countRejectedByReason(rejectedRows, "invalid_gtin14")) /
                  (scrapedPairs.length + rejectedRows.length)
                ).toFixed(6),
              )
            : 0,
      },
      gateRejectReasonCounts: Object.fromEntries(
        Array.from(gateRejectReasonCounter.entries()).sort((a, b) => b[1] - a[1]),
      ),
    },
  };

  await writeJson(path.join(outDir, "summary.json"), summary);
  await writeJson(path.join(outDir, "rejected_input_rows.json"), rejectedRows);
  await writeJson(path.join(outDir, "duplicates_in_map.json"), duplicatesInMap);
  await writeJson(path.join(outDir, "duplicates_in_facts_only.json"), duplicatesInFactsOnly);
  await writeJson(path.join(outDir, "conflicts_by_barcode.json"), conflictsByBarcode);
  await writeJson(path.join(outDir, "net_new_pairs.json"), netNewPairs);
  await writeJson(path.join(outDir, "tiered_import_queue.json"), tieredImportQueue);
  await writeJson(path.join(outDir, "repair_priority_queue.json"), repairPriorityQueue);

  const headers = [
    "npn",
    "barcode_gtin14",
    "barcode_raw",
    "domain",
    "url",
    "sourceFile",
    "extractMode",
    "evidenceLevel",
    "evidenceScore",
    "tokenDistance",
    "brandOverlap",
    "productOverlap",
    "requiredBrandOverlap",
    "requiredProductOverlap",
    "contextPass",
    "samePagePairingPass",
    "tokenGatePass",
    "domainTier",
    "gateRejectReason",
    "exactInMap",
    "inFactsCandidates",
    "conflictNpns",
    "tier",
    "rejectReason",
    "conflictType",
    "importEligible",
  ];

  await writeCsv(path.join(outDir, "duplicates_in_map.csv"), headers, duplicatesInMap);
  await writeCsv(path.join(outDir, "duplicates_in_facts_only.csv"), headers, duplicatesInFactsOnly);
  await writeCsv(path.join(outDir, "conflicts_by_barcode.csv"), headers, conflictsByBarcode);
  await writeCsv(path.join(outDir, "net_new_pairs.csv"), headers, netNewPairs);
  await writeCsv(path.join(outDir, "tiered_import_queue.csv"), headers, tieredImportQueue);

  console.log(JSON.stringify(summary, null, 2));
};

main().catch((error) => {
  console.error("[compare-scraped-npn-barcodes] fatal:", error);
  process.exit(1);
});
