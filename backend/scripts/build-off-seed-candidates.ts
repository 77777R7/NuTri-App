import fs from "node:fs";
import path from "node:path";

import { buildOffSeedCandidates, type OffProductRecord } from "../src/offSeedCandidates.js";
import { supabase } from "../src/supabase.js";

const args = process.argv.slice(2);
const getArg = (flag: string): string | null => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};
const hasFlag = (flag: string): boolean => args.includes(`--${flag}`);

const pages = Math.max(1, Number(getArg("pages") ?? 20));
const pageSize = Math.max(20, Math.min(200, Number(getArg("page-size") ?? 100)));
const delayMs = Math.max(0, Number(getArg("delay-ms") ?? 120));
const dryRun = hasFlag("dry-run");
const runId = getArg("run-id") ?? new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
const outDir =
  getArg("out-dir") ?? path.join(process.cwd(), "output", "off_candidates", runId);

const OFF_SEARCH_URL = "https://world.openfoodfacts.org/cgi/search.pl";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const ensureDir = async (dirPath: string) => {
  await fs.promises.mkdir(dirPath, { recursive: true });
};

const writeJson = async (filePath: string, payload: unknown) => {
  await ensureDir(path.dirname(filePath));
  await fs.promises.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const writeJsonl = async (filePath: string, rows: unknown[]) => {
  await ensureDir(path.dirname(filePath));
  const body = rows.map((row) => JSON.stringify(row)).join("\n");
  await fs.promises.writeFile(filePath, body.length ? `${body}\n` : "", "utf8");
};

const fetchOffPage = async (page: number): Promise<OffProductRecord[]> => {
  const query = new URLSearchParams({
    action: "process",
    json: "1",
    page: String(page),
    page_size: String(pageSize),
    fields: "code,product_name,brands,categories,categories_tags,countries,countries_tags,url",
    sort_by: "unique_scans_n",
  });
  const response = await fetch(`${OFF_SEARCH_URL}?${query.toString()}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`off_page_http_${response.status}`);
  }
  const payload = (await response.json()) as { products?: unknown[] };
  const products = Array.isArray(payload.products) ? payload.products : [];
  return products.filter((row): row is OffProductRecord => row != null && typeof row === "object");
};

const chunk = <T>(rows: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
};

const fetchExistingBarcodeSet = async (barcodes: string[]): Promise<Set<string>> => {
  const out = new Set<string>();
  const chunks = chunk(Array.from(new Set(barcodes)), 300);

  for (const codes of chunks) {
    if (codes.length === 0) continue;
    const [{ data: mapRows, error: mapError }, { data: dsldRows, error: dsldError }] = await Promise.all([
      supabase
        .from("barcode_regulatory_map")
        .select("barcode_gtin14")
        .in("barcode_gtin14", codes),
      supabase
        .from("dsld_barcode_canonical")
        .select("barcode_normalized_gtin14")
        .in("barcode_normalized_gtin14", codes),
    ]);

    if (mapError) throw new Error(`map_lookup_failed:${mapError.message}`);
    if (dsldError) throw new Error(`dsld_lookup_failed:${dsldError.message}`);

    (mapRows ?? []).forEach((row: { barcode_gtin14?: string | null }) => {
      if (typeof row.barcode_gtin14 === "string" && row.barcode_gtin14) out.add(row.barcode_gtin14);
    });
    (dsldRows ?? []).forEach((row: { barcode_normalized_gtin14?: string | null }) => {
      if (typeof row.barcode_normalized_gtin14 === "string" && row.barcode_normalized_gtin14) out.add(row.barcode_normalized_gtin14);
    });
  }

  return out;
};

const normalizeCandidateBarcode = (value: string | null | undefined): string | null => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length > 14) return null;
  return digits.padStart(14, "0");
};

const run = async () => {
  const fetched: OffProductRecord[] = [];
  for (let page = 1; page <= pages; page += 1) {
    const rows = await fetchOffPage(page);
    fetched.push(...rows);
    if (delayMs > 0 && page < pages) await sleep(delayMs);
  }

  const feedBarcodes = fetched
    .map((row) => normalizeCandidateBarcode(row.code ?? null))
    .filter((value): value is string => Boolean(value));
  const existing = await fetchExistingBarcodeSet(feedBarcodes);
  const { primary, shadowUsCa, rejected } = buildOffSeedCandidates({
    records: fetched,
    existingBarcodes: existing,
  });

  const primaryFile = path.join(outDir, "candidates.primary.jsonl");
  const shadowFile = path.join(outDir, "candidates.shadow_usca.jsonl");
  const rejectedFile = path.join(outDir, "rejected.jsonl");
  const metricsFile = path.join(outDir, "metrics.json");

  const metrics = {
    runId,
    generatedAt: new Date().toISOString(),
    pages,
    pageSize,
    fetchedCount: fetched.length,
    feedBarcodeCount: feedBarcodes.length,
    existingOverlapCount: existing.size,
    primaryCount: primary.length,
    shadowUsCaCount: shadowUsCa.length,
    rejectedCount: rejected.length,
    dryRun,
    files: {
      primary: primaryFile,
      shadow: shadowFile,
      rejected: rejectedFile,
    },
  };

  if (!dryRun) {
    await Promise.all([
      writeJsonl(primaryFile, primary),
      writeJsonl(shadowFile, shadowUsCa),
      writeJsonl(rejectedFile, rejected),
      writeJson(metricsFile, metrics),
    ]);
  }

  console.log(
    JSON.stringify(
      {
        status: "ok",
        ...metrics,
      },
      null,
      2,
    ),
  );
};

run().catch((error) => {
  console.error("[off-seed] failed", error);
  process.exit(1);
});
