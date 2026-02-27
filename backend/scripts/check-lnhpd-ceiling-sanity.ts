#!/usr/bin/env tsx
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

import { extractDeterministicSignalPack } from "../src/insights/deterministicSignalExtractor.ts";
import { deriveLnhpdRawEvidence } from "./lib/lnhpd-000-bucket.mjs";

type TargetRow = {
  barcode: string;
  sourceId: string | null;
  npn: string | null;
  sourceUrl: string | null;
  hasIngredientsInSource: boolean;
  hasAmountsInSource: boolean;
  ourHasMedicinalRaw: boolean;
  ourHasAmountRaw: boolean;
  conclusion: string;
  parserDiagnosticsTop: string[];
};

const args = process.argv.slice(2);
const getArg = (flag: string, fallback: string | null = null): string | null => {
  const inline = args.find((entry) => entry.startsWith(`--${flag}=`));
  if (inline) return inline.slice(flag.length + 3);
  const idx = args.indexOf(`--${flag}`);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1] ?? fallback;
  return fallback;
};

const normalizeBarcode = (value: unknown): string => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.length >= 14 ? digits.slice(-14) : digits.padStart(14, "0");
};

const normalizeNpn = (value: unknown): string | null => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!/^\d{8}$/.test(digits)) return null;
  return digits;
};

const normalizeText = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const parseBoolean = (value: string | null, fallback: boolean): boolean => {
  if (value == null) return fallback;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "on"].includes(normalized);
};

const extractBarcodesFromUnknown = (input: unknown, out: Set<string>) => {
  if (!input) return;
  if (Array.isArray(input)) {
    for (const entry of input) extractBarcodesFromUnknown(entry, out);
    return;
  }
  if (typeof input === "string" || typeof input === "number") {
    const barcode = normalizeBarcode(input);
    if (barcode) out.add(barcode);
    return;
  }
  if (typeof input !== "object") return;
  const record = input as Record<string, unknown>;
  for (const key of ["barcode", "barcode_gtin14", "barcode_raw", "gtin14", "code"]) {
    const barcode = normalizeBarcode(record[key]);
    if (barcode) out.add(barcode);
  }
  for (const value of Object.values(record)) {
    if (typeof value === "object" && value != null) extractBarcodesFromUnknown(value, out);
  }
};

const loadEnv = (rootDir: string) => {
  const envCandidates = [
    path.resolve(rootDir, "backend/.env"),
    path.resolve(rootDir, ".env"),
    path.resolve(rootDir, "../.env"),
  ];
  for (const candidate of envCandidates) {
    if (!existsSync(candidate)) continue;
    dotenv.config({ path: candidate, override: false });
  }
};

const requireEnv = (name: string): string => {
  const value = normalizeText(process.env[name]);
  if (!value) throw new Error(`[check-lnhpd-ceiling-sanity] missing env ${name}`);
  return value;
};

const findBestMapRow = async (supabase: ReturnType<typeof createClient>, barcode: string) => {
  const barcodeRaw = String(Number(barcode)).padStart(12, "0");
  const tryFetch = async (column: string, value: string) =>
    supabase
      .from("barcode_regulatory_map")
      .select("barcode_gtin14,barcode_raw,npn,source,confidence,last_seen_at,updated_at")
      .eq(column, value)
      .order("confidence", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(5);

  const candidates = [];
  const first = await tryFetch("barcode_gtin14", barcode);
  if (!first.error && Array.isArray(first.data)) candidates.push(...first.data);
  const second = await tryFetch("barcode_raw", barcodeRaw);
  if (!second.error && Array.isArray(second.data)) candidates.push(...second.data);

  let best: Record<string, unknown> | null = null;
  for (const row of candidates) {
    const npn = normalizeNpn(row?.npn);
    if (!npn) continue;
    if (!best) {
      best = row;
      continue;
    }
    const bestConf = Number(best.confidence ?? 0) || 0;
    const rowConf = Number(row?.confidence ?? 0) || 0;
    if (rowConf > bestConf) {
      best = row;
    }
  }
  return best;
};

const fetchLnhpdFactsRow = async (
  supabase: ReturnType<typeof createClient>,
  npn: string,
  tablePrimary: string,
  tableSecondary: string,
) => {
  const query = async (table: string) =>
    supabase
      .from(table)
      .select("lnhpd_id,npn,brand_name,product_name,facts_json,is_complete,updated_at")
      .eq("npn", npn)
      .order("updated_at", { ascending: false })
      .limit(3);

  const primary = await query(tablePrimary);
  if (!primary.error && Array.isArray(primary.data) && primary.data.length > 0) {
    return { table: tablePrimary, row: primary.data[0] as Record<string, unknown> };
  }
  const secondary = await query(tableSecondary);
  if (!secondary.error && Array.isArray(secondary.data) && secondary.data.length > 0) {
    return { table: tableSecondary, row: secondary.data[0] as Record<string, unknown> };
  }
  return { table: null, row: null };
};

const computeConclusion = (params: {
  hasIngredientsInSource: boolean;
  hasAmountsInSource: boolean;
  ourHasMedicinalRaw: boolean;
  ourHasAmountRaw: boolean;
  parserDiagnosticsTop: string[];
}) => {
  const {
    hasIngredientsInSource,
    hasAmountsInSource,
    ourHasMedicinalRaw,
    ourHasAmountRaw,
    parserDiagnosticsTop,
  } = params;
  const diagnostics = new Set(parserDiagnosticsTop.map((entry) => entry.toUpperCase()));

  if (!hasIngredientsInSource) return "TRUE_DATA_CEILING_MISSING_INGREDIENTS_IN_SOURCE";
  if (hasIngredientsInSource && !hasAmountsInSource) return "TRUE_DATA_CEILING_MISSING_AMOUNTS_IN_SOURCE";
  if (hasIngredientsInSource && hasAmountsInSource && (!ourHasMedicinalRaw || !ourHasAmountRaw)) {
    return diagnostics.has("PARSER_GAP_FIXABLE")
      ? "ETL_OR_PARSER_GAP_FIXABLE"
      : "PARSER_OUTPUT_MISMATCH";
  }
  if (ourHasMedicinalRaw && ourHasAmountRaw) return "NOT_CEILING_DATA_PRESENT";
  return "NEEDS_MANUAL_REVIEW";
};

const toHealthCanadaSourceUrl = (npn: string | null): string | null =>
  npn ? `https://health-products.canada.ca/lnhpd-bdpsnh/search?lang=eng&query=${npn}` : null;

const renderMarkdown = (rows: TargetRow[], metadata: Record<string, unknown>) => {
  const lines: string[] = [];
  lines.push("# LNHPD Ceiling Sanity Check");
  lines.push("");
  lines.push(`- generatedAt: ${new Date().toISOString()}`);
  lines.push(`- total: ${rows.length}`);
  lines.push(`- metadata: ${JSON.stringify(metadata)}`);
  lines.push("");
  lines.push("| barcode | npn | sourceUrl | hasIngredientsInSource | hasAmountsInSource | ourHasMedicinalRaw | ourHasAmountRaw | conclusion | parserDiagnosticsTop |");
  lines.push("|---|---|---|---:|---:|---:|---:|---|---|");
  for (const row of rows) {
    const sourceUrl = row.sourceUrl ? row.sourceUrl.replace(/\|/g, "\\|") : "";
    const diagnostics = row.parserDiagnosticsTop.join(", ").replace(/\|/g, "\\|");
    lines.push(
      `| ${row.barcode} | ${row.npn ?? ""} | ${sourceUrl} | ${row.hasIngredientsInSource ? 1 : 0} | ${row.hasAmountsInSource ? 1 : 0} | ${row.ourHasMedicinalRaw ? 1 : 0} | ${row.ourHasAmountRaw ? 1 : 0} | ${row.conclusion} | ${diagnostics} |`,
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  const rootDir = process.cwd();
  loadEnv(rootDir);

  const tablePrimary = getArg("table-primary", "lnhpd_facts_complete")!;
  const tableSecondary = getArg("table-secondary", "lnhpd_facts")!;
  const summaryPathArg = getArg("summary");
  const inputJsonArg = getArg("input-json");
  const barcodesArg = getArg("barcodes");
  const outDirArg = getArg("out-dir", `output/lnhpd_ceiling_sanity/${new Date().toISOString().replace(/[:]/g, "-")}`)!;
  const outDir = path.isAbsolute(outDirArg) ? outDirArg : path.join(rootDir, outDirArg);
  const includeSummary = parseBoolean(getArg("include-summary", "true"), true);

  const barcodeSet = new Set<string>();
  if (barcodesArg) {
    for (const value of barcodesArg.split(",")) {
      const barcode = normalizeBarcode(value);
      if (barcode) barcodeSet.add(barcode);
    }
  }

  if (inputJsonArg) {
    const inputPath = path.isAbsolute(inputJsonArg) ? inputJsonArg : path.join(rootDir, inputJsonArg);
    const raw = await fs.readFile(inputPath, "utf8");
    extractBarcodesFromUnknown(JSON.parse(raw), barcodeSet);
  }

  let summaryAttempts: Record<string, unknown>[] = [];
  if (includeSummary && summaryPathArg) {
    const summaryPath = path.isAbsolute(summaryPathArg) ? summaryPathArg : path.join(rootDir, summaryPathArg);
    const raw = await fs.readFile(summaryPath, "utf8");
    const summary = JSON.parse(raw);
    const attempts = Array.isArray(summary?.attempts) ? summary.attempts : [];
    summaryAttempts = attempts.filter((row) => row && typeof row === "object");
    for (const row of summaryAttempts) {
      const barcode = normalizeBarcode((row as Record<string, unknown>).barcode);
      if (barcode) barcodeSet.add(barcode);
    }
  }

  if (barcodeSet.size === 0) {
    throw new Error("[check-lnhpd-ceiling-sanity] no barcodes provided; pass --barcodes or --input-json or --summary");
  }

  const supabase = createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const rows: TargetRow[] = [];
  const sortedBarcodes = Array.from(barcodeSet).sort();

  for (const barcode of sortedBarcodes) {
    const mapRow = await findBestMapRow(supabase, barcode);
    const summaryAttempt = summaryAttempts.find((attempt) => normalizeBarcode((attempt as Record<string, unknown>).barcode) === barcode)
      ?? null;
    const summarySourceId = normalizeText((summaryAttempt as Record<string, unknown> | null)?.sourceId);
    const npn = normalizeNpn(mapRow?.npn) || normalizeNpn(summarySourceId) || null;
    const sourceUrl = toHealthCanadaSourceUrl(npn);

    let hasIngredientsInSource = false;
    let hasAmountsInSource = false;
    let ourHasMedicinalRaw = false;
    let ourHasAmountRaw = false;
    let parserDiagnosticsTop: string[] = [];

    if (npn) {
      const factsLookup = await fetchLnhpdFactsRow(supabase, npn, tablePrimary, tableSecondary);
      const factsJson = factsLookup.row?.facts_json ?? null;
      const rawEvidence = deriveLnhpdRawEvidence(factsJson);
      hasIngredientsInSource = rawEvidence.hasMedicinalRaw;
      hasAmountsInSource = rawEvidence.hasAmountRaw;

      const pack = extractDeterministicSignalPack({
        sourceRole: "lnhpd",
        factsJson,
      });
      ourHasMedicinalRaw = pack.ingredientRows.length > 0;
      ourHasAmountRaw = pack.doseSignals.some((row) => row.dosePerUnit != null);
      parserDiagnosticsTop = pack.parserDiagnostics.slice(0, 5).map((entry) => entry.code);
    }

    rows.push({
      barcode,
      sourceId: npn,
      npn,
      sourceUrl,
      hasIngredientsInSource,
      hasAmountsInSource,
      ourHasMedicinalRaw,
      ourHasAmountRaw,
      parserDiagnosticsTop,
      conclusion: computeConclusion({
        hasIngredientsInSource,
        hasAmountsInSource,
        ourHasMedicinalRaw,
        ourHasAmountRaw,
        parserDiagnosticsTop,
      }),
    });
  }

  const metadata = {
    tablePrimary,
    tableSecondary,
    totalBarcodes: rows.length,
    withNpn: rows.filter((row) => Boolean(row.npn)).length,
    withoutNpn: rows.filter((row) => !row.npn).length,
    summaryProvided: Boolean(summaryPathArg),
  };

  await fs.mkdir(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "lnhpd_ceiling_sanity.json");
  const mdPath = path.join(outDir, "lnhpd_ceiling_sanity.md");
  await fs.writeFile(jsonPath, `${JSON.stringify({ metadata, rows }, null, 2)}\n`, "utf8");
  await fs.writeFile(mdPath, renderMarkdown(rows, metadata), "utf8");

  console.log(
    JSON.stringify(
      {
        outDir,
        json: jsonPath,
        markdown: mdPath,
        metadata,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error(
    "[check-lnhpd-ceiling-sanity] failed",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
