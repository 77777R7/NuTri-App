import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import dotenv from "dotenv";
import { supabase } from "../src/supabase.js";

type ScoreSource = "lnhpd" | "dsld";
type TargetMode = "r1_only" | "r1_topn" | "topn_only";
type TopNQueryMode = "sql_group_by" | "scan";

type DiagnoseIdentity = {
  source?: unknown;
  identityType?: unknown;
  identityValue?: unknown;
};

type DiagnoseScore = {
  signalZeroCause?: unknown;
  matchedIngredients?: unknown;
  formMatchingDiagnostics?: {
    rowsWithoutFormRows?: unknown;
    rowsWithFormsNoMatch?: unknown;
    rowsMappingMismatch?: unknown;
  } | null;
} | null;

type DiagnoseKbRow = {
  reviewedHits?: unknown;
  missReasons?: Record<string, unknown> | null;
} | null;

type DiagnoseRow = {
  barcode?: unknown;
  sourceType?: unknown;
  identityResolution?: {
    mappingPath?: {
      label?: unknown;
    } | null;
  } | null;
  identity?: DiagnoseIdentity | null;
  score?: DiagnoseScore;
  kbWithName?: DiagnoseKbRow;
  kbWithoutName?: DiagnoseKbRow;
};

type DiagnoseReport = {
  generatedAt?: unknown;
  rows?: DiagnoseRow[];
};

type ProductIngredientRow = {
  id: string | null;
  ingredient_id: string | null;
};

type IngredientMetaRow = {
  id: string;
  name: string | null;
  canonical_key: string | null;
  unit: string | null;
};

type TopNQueryResult = {
  counts: Map<string, number>;
  queryMode: TopNQueryMode;
  scannedRows: number | null;
  truncated: boolean;
  fallbackReason: string | null;
};

const execFileAsync = promisify(execFile);

dotenv.config({ path: path.join(process.cwd(), ".env") });
dotenv.config({ path: path.join(process.cwd(), "..", ".env") });

const DEFAULT_REPORT_PATH =
  "output/reviewed_hit_diagnostics/2026-02-22T21-04-59-160Z/report.json";

const args = process.argv.slice(2);
const getArg = (flag: string): string | null => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};
const hasFlag = (flag: string): boolean => args.includes(`--${flag}`);

const topN = Math.max(1, Number(getArg("topn") ?? getArg("top-n") ?? "50"));
const pageSize = Math.min(1000, Math.max(1, Number(getArg("page-size") ?? "1000")));
const reportPath = getArg("report") ?? DEFAULT_REPORT_PATH;
const sourceArg = String(getArg("sources") ?? "lnhpd,dsld").toLowerCase();
const sources = sourceArg
  .split(",")
  .map((item) => item.trim())
  .filter((item): item is ScoreSource => item === "lnhpd" || item === "dsld");
const normalizedSources: ScoreSource[] = Array.from(new Set(sources.length ? sources : ["lnhpd", "dsld"]));

const modeArg = (getArg("mode") ?? "r1_topn").trim().toLowerCase();
if (modeArg !== "r1_only" && modeArg !== "r1_topn" && modeArg !== "topn_only") {
  throw new Error(`[ingredient-form-targets] unsupported --mode: ${modeArg}`);
}
const mode = modeArg as TargetMode;

const topnQueryModeArg = (getArg("topn-query-mode") ?? "sql_group_by").trim().toLowerCase();
if (topnQueryModeArg !== "sql_group_by" && topnQueryModeArg !== "scan") {
  throw new Error(`[ingredient-form-targets] unsupported --topn-query-mode: ${topnQueryModeArg}`);
}
const topnQueryMode = topnQueryModeArg as TopNQueryMode;

const baselineReportPath = getArg("r1-baseline-report");
const allowTopnWhenR1Empty = hasFlag("allow-topn-when-r1-empty");
const allowTopnScanFallback = hasFlag("allow-topn-scan-fallback");
const nowTag = new Date().toISOString().replace(/[:.]/g, "-");
const outputPath =
  getArg("output") ?? `output/ingredient_forms_seed/${nowTag}/targets.json`;
const sqlOutputPath =
  getArg("sql-output") ?? path.join(path.dirname(outputPath), "targets_review.sql");

const ensureDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  await mkdir(dir, { recursive: true });
};

const chunkArray = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

const toScoreSource = (value: unknown): ScoreSource | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "lnhpd" || normalized === "dsld") return normalized;
  return null;
};

const toStringOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const toNumberOrNull = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const looksLikePlaceholderDbUrl = (value: string): boolean => {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return true;
  return (
    normalized.includes("your_password")
    || normalized.includes("<password>")
    || normalized.includes("replace_me")
    || normalized.includes("example.com")
    || normalized.includes("example.supabase.co")
    || normalized.includes("project_ref")
    || normalized.includes("supabase.co/postgres")
  );
};

const loadReport = async (filePath: string): Promise<DiagnoseReport> => {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as DiagnoseReport;
};

const countMissReason = (kbRow: DiagnoseKbRow, key: string): number => {
  const reasons = kbRow?.missReasons;
  if (!reasons || typeof reasons !== "object") return 0;
  return toNumberOrNull(reasons[key]) ?? 0;
};

const isReviewedGapRow = (row: DiagnoseRow): boolean => {
  const withNameHits = toNumberOrNull(row?.kbWithName?.reviewedHits) ?? 0;
  const withoutNameHits = toNumberOrNull(row?.kbWithoutName?.reviewedHits) ?? 0;
  if (withNameHits > 0 || withoutNameHits > 0) return false;
  const ingredientNotSupported =
    countMissReason(row?.kbWithoutName ?? null, "ingredient_not_supported") +
    countMissReason(row?.kbWithName ?? null, "ingredient_not_supported");
  const noEntryForFormKey =
    countMissReason(row?.kbWithoutName ?? null, "no_entry_for_form_key") +
    countMissReason(row?.kbWithName ?? null, "no_entry_for_form_key");
  const signalZeroCause = toStringOrNull(row?.score?.signalZeroCause);
  return ingredientNotSupported > 0 || noEntryForFormKey > 0 || signalZeroCause === "NO_FORM_ROWS";
};

const collectHintValues = (value: unknown): { ingredientIds: string[]; canonicalKeys: string[] } => {
  const ingredientIds = new Set<string>();
  const canonicalKeys = new Set<string>();
  if (!Array.isArray(value)) {
    return { ingredientIds: [], canonicalKeys: [] };
  }
  value.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const record = item as {
      ingredientId?: unknown;
      ingredient_id?: unknown;
      ingredientCanonicalKey?: unknown;
      ingredient_canonical_key?: unknown;
    };
    const ingredientId = toStringOrNull(record.ingredientId) ?? toStringOrNull(record.ingredient_id);
    const canonicalKey =
      toStringOrNull(record.ingredientCanonicalKey) ?? toStringOrNull(record.ingredient_canonical_key);
    if (ingredientId) ingredientIds.add(ingredientId);
    if (canonicalKey) canonicalKeys.add(canonicalKey);
  });
  return {
    ingredientIds: Array.from(ingredientIds).sort((a, b) => a.localeCompare(b)),
    canonicalKeys: Array.from(canonicalKeys).sort((a, b) => a.localeCompare(b)),
  };
};

const collectIdentityRows = (
  report: DiagnoseReport,
  predicate: (row: DiagnoseRow) => boolean,
): {
  resolved: Array<{
    source: ScoreSource;
    identityValue: string;
    barcode: string | null;
    mappingPath: string | null;
    hintIngredientIds: string[];
    hintCanonicalKeys: string[];
  }>;
  unresolved: Array<{
    source: ScoreSource | null;
    barcode: string | null;
    reason: string;
    mappingPath: string | null;
    hintIngredientIds: string[];
    hintCanonicalKeys: string[];
  }>;
  total: number;
} => {
  const rows = Array.isArray(report.rows) ? report.rows : [];
  const resolved: Array<{
    source: ScoreSource;
    identityValue: string;
    barcode: string | null;
    mappingPath: string | null;
    hintIngredientIds: string[];
    hintCanonicalKeys: string[];
  }> = [];
  const unresolved: Array<{
    source: ScoreSource | null;
    barcode: string | null;
    reason: string;
    mappingPath: string | null;
    hintIngredientIds: string[];
    hintCanonicalKeys: string[];
  }> = [];

  rows.forEach((row) => {
    if (!predicate(row)) return;
    const source = toScoreSource(row?.identity?.source) ?? toScoreSource(row?.sourceType);
    const identityValue = toStringOrNull(row?.identity?.identityValue);
    const barcode = toStringOrNull(row?.barcode);
    const mappingPath = toStringOrNull(row?.identityResolution?.mappingPath?.label);

    const matchedHints = collectHintValues(row?.score?.matchedIngredients);
    const diagnosticsWithoutForms = collectHintValues(row?.score?.formMatchingDiagnostics?.rowsWithoutFormRows);
    const diagnosticsNoMatch = collectHintValues(row?.score?.formMatchingDiagnostics?.rowsWithFormsNoMatch);
    const diagnosticsMappingMismatch = collectHintValues(row?.score?.formMatchingDiagnostics?.rowsMappingMismatch);
    const hintIngredientIds = Array.from(
      new Set([
        ...matchedHints.ingredientIds,
        ...diagnosticsWithoutForms.ingredientIds,
        ...diagnosticsNoMatch.ingredientIds,
        ...diagnosticsMappingMismatch.ingredientIds,
      ]),
    ).sort((a, b) => a.localeCompare(b));
    const hintCanonicalKeys = Array.from(
      new Set([
        ...matchedHints.canonicalKeys,
        ...diagnosticsWithoutForms.canonicalKeys,
        ...diagnosticsNoMatch.canonicalKeys,
        ...diagnosticsMappingMismatch.canonicalKeys,
      ]),
    ).sort((a, b) => a.localeCompare(b));

    if (!source) {
      unresolved.push({ source: null, barcode, reason: "missing_source", mappingPath, hintIngredientIds, hintCanonicalKeys });
      return;
    }
    if (!normalizedSources.includes(source)) {
      unresolved.push({ source, barcode, reason: "source_not_selected", mappingPath, hintIngredientIds, hintCanonicalKeys });
      return;
    }
    if (!identityValue) {
      unresolved.push({ source, barcode, reason: "missing_identity_value", mappingPath, hintIngredientIds, hintCanonicalKeys });
      return;
    }
    resolved.push({
      source,
      identityValue,
      barcode,
      mappingPath,
      hintIngredientIds,
      hintCanonicalKeys,
    });
  });
  return {
    resolved,
    unresolved,
    total: resolved.length + unresolved.length,
  };
};

const fetchIngredientIdsBySourceColumn = async (
  source: ScoreSource,
  column: "source_id" | "canonical_source_id",
  value: string,
): Promise<Set<string>> => {
  const out = new Set<string>();
  let cursor: string | null = null;

  while (true) {
    let query = supabase
      .from("product_ingredients")
      .select("id,ingredient_id")
      .eq("source", source)
      .eq("is_active", true)
      .not("ingredient_id", "is", null)
      .eq(column, value)
      .order("id", { ascending: true })
      .limit(pageSize);

    if (cursor) {
      query = query.gt("id", cursor as never);
    }

    const { data, error } = await query;
    if (error) throw error;
    const rows = (data ?? []) as ProductIngredientRow[];
    rows.forEach((row) => {
      if (row.ingredient_id) out.add(row.ingredient_id);
    });
    if (rows.length < pageSize) break;
    const nextCursor = rows[rows.length - 1]?.id ?? null;
    if (!nextCursor || nextCursor === cursor) break;
    cursor = nextCursor;
  }

  return out;
};

const fetchIngredientIdsForIdentity = async (
  source: ScoreSource,
  identityValue: string,
): Promise<Set<string>> => {
  const [bySourceId, byCanonical] = await Promise.all([
    fetchIngredientIdsBySourceColumn(source, "source_id", identityValue),
    fetchIngredientIdsBySourceColumn(source, "canonical_source_id", identityValue),
  ]);
  const merged = new Set<string>();
  bySourceId.forEach((id) => merged.add(id));
  byCanonical.forEach((id) => merged.add(id));
  return merged;
};

const fetchIngredientIdsByCanonicalKeys = async (
  canonicalKeys: string[],
): Promise<Map<string, string[]>> => {
  const byCanonicalKey = new Map<string, Set<string>>();
  for (const chunk of chunkArray(canonicalKeys, 200)) {
    const { data, error } = await supabase
      .from("ingredients")
      .select("id,canonical_key")
      .in("canonical_key", chunk);
    if (error) throw error;
    (data ?? []).forEach((row) => {
      const ingredientId = toStringOrNull((row as { id?: unknown }).id);
      const canonicalKey = toStringOrNull((row as { canonical_key?: unknown }).canonical_key);
      if (!ingredientId || !canonicalKey) return;
      const bucket = byCanonicalKey.get(canonicalKey) ?? new Set<string>();
      bucket.add(ingredientId);
      byCanonicalKey.set(canonicalKey, bucket);
    });
  }

  const out = new Map<string, string[]>();
  byCanonicalKey.forEach((ids, canonicalKey) => {
    out.set(
      canonicalKey,
      Array.from(ids).sort((a, b) => a.localeCompare(b)),
    );
  });
  return out;
};

const fetchTopNIngredientCountsBySqlGroupBy = async (
  requestedTopN: number,
): Promise<TopNQueryResult> => {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    throw new Error("[ingredient-form-targets] SUPABASE_DB_URL is required for --topn-query-mode sql_group_by");
  }
  if (looksLikePlaceholderDbUrl(dbUrl)) {
    throw new Error(
      "[ingredient-form-targets] SUPABASE_DB_URL appears to be a placeholder; provide a real Postgres connection string for sql_group_by mode",
    );
  }
  const quotedSources = normalizedSources.map((source) => `'${source}'`).join(", ");
  const sql = [
    "select ingredient_id::text as ingredient_id, count(*)::bigint as ingredient_count",
    "from product_ingredients",
    `where source = any(array[${quotedSources}]::text[])`,
    "  and is_active = true",
    "  and ingredient_id is not null",
    "group by ingredient_id",
    "order by ingredient_count desc, ingredient_id asc",
    `limit ${requestedTopN};`,
  ].join("\n");

  const psqlBin = process.env.PSQL_BIN || "psql";
  const { stdout, stderr } = await execFileAsync(
    psqlBin,
    ["-X", "-A", "-t", "-F", "\t", "-v", "ON_ERROR_STOP=1", dbUrl, "-c", sql],
    { maxBuffer: 1024 * 1024 * 20 },
  );
  if (stderr && stderr.trim()) {
    const trimmed = stderr.trim();
    if (trimmed.toLowerCase().includes("error")) {
      throw new Error(`[ingredient-form-targets] topN sql_group_by failed: ${trimmed}`);
    }
  }

  const counts = new Map<string, number>();
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  lines.forEach((line) => {
    const [ingredientIdRaw, countRaw] = line.split("\t");
    const ingredientId = toStringOrNull(ingredientIdRaw);
    const count = toNumberOrNull(countRaw);
    if (!ingredientId || count == null) return;
    counts.set(ingredientId, count);
  });

  return {
    counts,
    queryMode: "sql_group_by",
    scannedRows: null,
    truncated: false,
    fallbackReason: null,
  };
};

const fetchTopNIngredientCountsByScan = async (
  requestedTopN: number,
): Promise<TopNQueryResult> => {
  const counts = new Map<string, number>();
  let cursor: string | null = null;
  let scannedRows = 0;

  while (true) {
    let query = supabase
      .from("product_ingredients")
      .select("id,ingredient_id")
      .in("source", normalizedSources)
      .eq("is_active", true)
      .not("ingredient_id", "is", null)
      .order("id", { ascending: true })
      .limit(pageSize);

    if (cursor) {
      query = query.gt("id", cursor as never);
    }

    const { data, error } = await query;
    if (error) throw error;
    const rows = (data ?? []) as ProductIngredientRow[];
    if (!rows.length) break;

    rows.forEach((row) => {
      const ingredientId = row.ingredient_id;
      if (!ingredientId) return;
      counts.set(ingredientId, (counts.get(ingredientId) ?? 0) + 1);
    });

    scannedRows += rows.length;
    const nextCursor = rows[rows.length - 1]?.id ?? null;
    if (!nextCursor || nextCursor === cursor) break;
    cursor = nextCursor;
    if (rows.length < pageSize) break;
  }

  const sorted = Array.from(counts.entries())
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })
    .slice(0, requestedTopN);
  const limited = new Map(sorted);

  return {
    counts: limited,
    queryMode: "scan",
    scannedRows,
    truncated: false,
    fallbackReason: null,
  };
};

const fetchTopNIngredientCounts = async (requestedTopN: number): Promise<TopNQueryResult> => {
  if (topnQueryMode === "scan") {
    return fetchTopNIngredientCountsByScan(requestedTopN);
  }
  try {
    return await fetchTopNIngredientCountsBySqlGroupBy(requestedTopN);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!allowTopnScanFallback) {
      throw new Error(
        `[ingredient-form-targets] sql_group_by failed and scan fallback is disabled. Re-run with --allow-topn-scan-fallback or --topn-query-mode scan. cause=${message}`,
      );
    }
    console.warn(`[ingredient-form-targets] sql_group_by unavailable, falling back to scan: ${message}`);
    const fallback = await fetchTopNIngredientCountsByScan(requestedTopN);
    return { ...fallback, fallbackReason: message };
  }
};

const fetchIngredientMeta = async (ingredientIds: string[]): Promise<Map<string, IngredientMetaRow>> => {
  const out = new Map<string, IngredientMetaRow>();
  for (const chunk of chunkArray(ingredientIds, 200)) {
    const { data, error } = await supabase
      .from("ingredients")
      .select("id,name,canonical_key,unit")
      .in("id", chunk);
    if (error) throw error;
    (data ?? []).forEach((row) => {
      if (!row?.id) return;
      out.set(row.id as string, row as IngredientMetaRow);
    });
  }
  return out;
};

const fetchFormCounts = async (ingredientIds: string[]): Promise<Map<string, number>> => {
  const counts = new Map<string, number>();
  for (const chunk of chunkArray(ingredientIds, 200)) {
    const { data, error } = await supabase
      .from("ingredient_forms")
      .select("ingredient_id")
      .in("ingredient_id", chunk);
    if (error) throw error;
    (data ?? []).forEach((row) => {
      const ingredientId = (row as { ingredient_id?: string | null }).ingredient_id ?? null;
      if (!ingredientId) return;
      counts.set(ingredientId, (counts.get(ingredientId) ?? 0) + 1);
    });
  }
  return counts;
};

const buildSqlAudit = (ingredientIds: string[]): string => {
  if (!ingredientIds.length) {
    return [
      "-- No ingredient ids selected.",
      "-- Run build-ingredient-form-targets.ts with a non-empty report/topN scope.",
      "",
    ].join("\n");
  }
  const idsLiteral = ingredientIds.map((id) => `'${id}'`).join(", ");
  return [
    "-- Target ingredient form coverage audit",
    `-- generated_at: ${new Date().toISOString()}`,
    "select i.id, i.name as canonical_name, count(f.id) as form_rows",
    "from ingredients i",
    "left join ingredient_forms f on f.ingredient_id = i.id",
    `where i.id = any(array[${idsLiteral}]::uuid[])`,
    "group by i.id, i.name",
    "order by form_rows asc, i.id;",
    "",
  ].join("\n");
};

const buildIdentityMap = (
  identities: Array<{
    source: ScoreSource;
    identityValue: string;
    barcode: string | null;
    mappingPath: string | null;
    hintIngredientIds: string[];
    hintCanonicalKeys: string[];
  }>,
) => {
  const uniqueIdentityMap = new Map<
    string,
    {
      source: ScoreSource;
      identityValue: string;
      barcodes: Set<string>;
      mappingPaths: Set<string>;
      hintIngredientIds: Set<string>;
      hintCanonicalKeys: Set<string>;
    }
  >();
  identities.forEach((item) => {
    const key = `${item.source}:${item.identityValue}`;
    const existing = uniqueIdentityMap.get(key) ?? {
      source: item.source,
      identityValue: item.identityValue,
      barcodes: new Set<string>(),
      mappingPaths: new Set<string>(),
      hintIngredientIds: new Set<string>(),
      hintCanonicalKeys: new Set<string>(),
    };
    if (item.barcode) existing.barcodes.add(item.barcode);
    if (item.mappingPath) existing.mappingPaths.add(item.mappingPath);
    item.hintIngredientIds.forEach((ingredientId) => existing.hintIngredientIds.add(ingredientId));
    item.hintCanonicalKeys.forEach((canonicalKey) => existing.hintCanonicalKeys.add(canonicalKey));
    uniqueIdentityMap.set(key, existing);
  });

  return Array.from(uniqueIdentityMap.values())
    .map((entry) => ({
      source: entry.source,
      identityValue: entry.identityValue,
      barcodes: Array.from(entry.barcodes).sort((a, b) => a.localeCompare(b)),
      mappingPaths: Array.from(entry.mappingPaths).sort((a, b) => a.localeCompare(b)),
      hintIngredientIds: Array.from(entry.hintIngredientIds).sort((a, b) => a.localeCompare(b)),
      hintCanonicalKeys: Array.from(entry.hintCanonicalKeys).sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => {
      const sourceCompare = a.source.localeCompare(b.source);
      if (sourceCompare !== 0) return sourceCompare;
      return a.identityValue.localeCompare(b.identityValue);
    });
};

const countRows = (report: DiagnoseReport, predicate: (row: DiagnoseRow) => boolean): number =>
  (Array.isArray(report.rows) ? report.rows : []).filter(predicate).length;

const run = async () => {
  const report = await loadReport(reportPath);
  const r1Rows = collectIdentityRows(report, isReviewedGapRow);
  const noFormRows = collectIdentityRows(
    report,
    (row) => toStringOrNull(row?.score?.signalZeroCause) === "NO_FORM_ROWS",
  );

  const uniqueIdentities = buildIdentityMap(r1Rows.resolved);
  const r1IngredientIdsDirect = new Set<string>();
  const r1CanonicalKeys = new Set<string>();
  const r1IngredientHitCount = new Map<string, number>();
  const identityToDirectIngredientIds = new Map<string, string[]>();

  for (const identity of uniqueIdentities) {
    // eslint-disable-next-line no-await-in-loop
    const ingredientIdsFromIdentity = await fetchIngredientIdsForIdentity(identity.source, identity.identityValue);
    const directIngredientIds = Array.from(
      new Set([...Array.from(ingredientIdsFromIdentity), ...identity.hintIngredientIds]),
    ).sort((a, b) => a.localeCompare(b));
    directIngredientIds.forEach((ingredientId) => {
      r1IngredientIdsDirect.add(ingredientId);
      r1IngredientHitCount.set(ingredientId, (r1IngredientHitCount.get(ingredientId) ?? 0) + 1);
    });
    identityToDirectIngredientIds.set(`${identity.source}:${identity.identityValue}`, directIngredientIds);
  }

  const directMetaById = await fetchIngredientMeta(Array.from(r1IngredientIdsDirect));
  directMetaById.forEach((meta) => {
    if (meta.canonical_key) r1CanonicalKeys.add(meta.canonical_key);
  });
  uniqueIdentities.forEach((identity) => {
    identity.hintCanonicalKeys.forEach((canonicalKey) => r1CanonicalKeys.add(canonicalKey));
  });

  const canonicalExpandedMap = await fetchIngredientIdsByCanonicalKeys(Array.from(r1CanonicalKeys));
  const r1CanonicalExpandedIngredientIds = new Set<string>();
  canonicalExpandedMap.forEach((ingredientIds) => {
    ingredientIds.forEach((ingredientId) => r1CanonicalExpandedIngredientIds.add(ingredientId));
  });

  const r1IngredientIds = new Set<string>([
    ...Array.from(r1IngredientIdsDirect),
    ...Array.from(r1CanonicalExpandedIngredientIds),
  ]);
  const r1CanonicalExpandedOnly = new Set(
    Array.from(r1CanonicalExpandedIngredientIds).filter((ingredientId) => !r1IngredientIdsDirect.has(ingredientId)),
  );

  const baselineReport = baselineReportPath ? await loadReport(baselineReportPath) : null;
  const baselineR1Rows = baselineReport ? countRows(baselineReport, isReviewedGapRow) : null;
  const r1EmptyTriggered = r1IngredientIds.size === 0 && (baselineR1Rows ?? 0) > 0;

  const includeR1 = mode !== "topn_only";
  const topnBlockedByGuard = mode === "r1_topn" && r1EmptyTriggered && !allowTopnWhenR1Empty;
  const includeTopN = mode === "topn_only" || (mode === "r1_topn" && !topnBlockedByGuard);
  const topNResult = includeTopN ? await fetchTopNIngredientCounts(topN) : {
    counts: new Map<string, number>(),
    queryMode: topnQueryMode,
    scannedRows: null,
    truncated: false,
    fallbackReason: null,
  };
  const topNIngredients = Array.from(topNResult.counts.entries())
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })
    .slice(0, topN)
    .map(([ingredientId, count]) => ({ ingredientId, count }));
  const topNIngredientIds = new Set(topNIngredients.map((item) => item.ingredientId));

  const targetIdSet = new Set<string>();
  if (includeR1) {
    r1IngredientIds.forEach((ingredientId) => targetIdSet.add(ingredientId));
  }
  if (includeTopN) {
    topNIngredientIds.forEach((ingredientId) => targetIdSet.add(ingredientId));
  }
  const targetIngredientIds = Array.from(targetIdSet).sort((a, b) => a.localeCompare(b));

  const [metaById, formCounts] = await Promise.all([
    fetchIngredientMeta(targetIngredientIds),
    fetchFormCounts(targetIngredientIds),
  ]);

  const targets = targetIngredientIds.map((ingredientId) => {
    const meta = metaById.get(ingredientId);
    const formRowCount = formCounts.get(ingredientId) ?? 0;
    return {
      ingredientId,
      ingredientName: meta?.name ?? null,
      canonicalKey: meta?.canonical_key ?? null,
      unit: meta?.unit ?? null,
      formRowCount,
      inR1: includeR1 ? r1IngredientIds.has(ingredientId) : false,
      inR1Direct: includeR1 ? r1IngredientIdsDirect.has(ingredientId) : false,
      inR1CanonicalExpanded: includeR1 ? r1CanonicalExpandedOnly.has(ingredientId) : false,
      inTopN: includeTopN ? topNIngredientIds.has(ingredientId) : false,
      r1IdentityHitCount: includeR1 ? (r1IngredientHitCount.get(ingredientId) ?? 0) : 0,
      topNCount: includeTopN ? (topNResult.counts.get(ingredientId) ?? 0) : 0,
    };
  });

  const missingTargets = targets.filter((item) => item.formRowCount === 0);

  const summary = {
    generatedAt: new Date().toISOString(),
    reportPath,
    reportGeneratedAt: typeof report.generatedAt === "string" ? report.generatedAt : null,
    sources: normalizedSources,
    kpiPrimary: "reviewed_hit_rate",
    kpiBasis: "reviewed_hit_rate",
    mode,
    guard: {
      r1EmptyTriggered,
      baselineReportPath: baselineReportPath ?? null,
      baselineR1Count: baselineR1Rows,
      topnBlockedByGuard,
      allowTopnWhenR1Empty,
      allowTopnScanFallback,
    },
    topN,
    topn: {
      queryMode: topNResult.queryMode,
      included: includeTopN,
      ingredientCount: topNIngredientIds.size,
      scannedRows: topNResult.scannedRows,
      truncated: topNResult.truncated,
      fallbackReason: topNResult.fallbackReason,
    },
    reviewedGapRowsInReport: r1Rows.total,
    reviewedGapRowsUnresolved: r1Rows.unresolved.length,
    noFormRowsInReport: noFormRows.total,
    noFormRowsUnresolved: noFormRows.unresolved.length,
    uniqueR1Identities: uniqueIdentities.length,
    r1IngredientCountDirect: r1IngredientIdsDirect.size,
    r1CanonicalKeyCount: r1CanonicalKeys.size,
    r1IngredientCountExpandedByCanonical: r1CanonicalExpandedIngredientIds.size,
    r1IngredientCount: r1IngredientIds.size,
    targetIngredientCount: targets.length,
    missingTargetIngredientCount: missingTargets.length,
    missingR1IngredientCount: missingTargets.filter((item) => item.inR1).length,
  };

  const identityIngredientMap: Array<{
    source: ScoreSource;
    identityValue: string;
    barcodes: string[];
    mappingPaths: string[];
    hintIngredientIds: string[];
    hintCanonicalKeys: string[];
    directIngredientIds: string[];
    canonicalKeys: string[];
    expandedIngredientIds: string[];
  }> = [];

  uniqueIdentities.forEach((identity) => {
    const identityKey = `${identity.source}:${identity.identityValue}`;
    const directIngredientIds = identityToDirectIngredientIds.get(identityKey) ?? [];
    const canonicalKeys = new Set<string>(identity.hintCanonicalKeys);
    directIngredientIds.forEach((ingredientId) => {
      const canonicalKey = directMetaById.get(ingredientId)?.canonical_key ?? null;
      if (canonicalKey) canonicalKeys.add(canonicalKey);
    });
    const expandedIngredientIds = new Set<string>(directIngredientIds);
    canonicalKeys.forEach((canonicalKey) => {
      const expanded = canonicalExpandedMap.get(canonicalKey) ?? [];
      expanded.forEach((ingredientId) => expandedIngredientIds.add(ingredientId));
    });

    identityIngredientMap.push({
      source: identity.source,
      identityValue: identity.identityValue,
      barcodes: identity.barcodes,
      mappingPaths: identity.mappingPaths,
      hintIngredientIds: identity.hintIngredientIds,
      hintCanonicalKeys: identity.hintCanonicalKeys,
      directIngredientIds,
      canonicalKeys: Array.from(canonicalKeys).sort((a, b) => a.localeCompare(b)),
      expandedIngredientIds: Array.from(expandedIngredientIds).sort((a, b) => a.localeCompare(b)),
    });
  });

  identityIngredientMap.sort((a, b) => {
    const sourceCompare = a.source.localeCompare(b.source);
    if (sourceCompare !== 0) return sourceCompare;
    return a.identityValue.localeCompare(b.identityValue);
  });

  const sqlAudit = buildSqlAudit(targetIngredientIds);
  const payload = {
    summary,
    r1ReviewedGapIdentities: identityIngredientMap,
    r1CanonicalExpandedIngredientIds: Array.from(r1CanonicalExpandedIngredientIds).sort((a, b) => a.localeCompare(b)),
    r1CanonicalExpandedOnlyIngredientIds: Array.from(r1CanonicalExpandedOnly).sort((a, b) => a.localeCompare(b)),
    r1CanonicalKeyToIngredientIds: Object.fromEntries(
      Array.from(canonicalExpandedMap.entries()).sort((a, b) => a[0].localeCompare(b[0])),
    ),
    unresolvedR1Rows: r1Rows.unresolved,
    unresolvedNoFormRows: noFormRows.unresolved,
    topNIngredients,
    targetIngredientIds,
    missingTargetIngredientIds: missingTargets.map((item) => item.ingredientId),
    targets,
    missingTargets,
  };

  await ensureDir(outputPath);
  await writeFile(outputPath, JSON.stringify(payload, null, 2), "utf8");
  await ensureDir(sqlOutputPath);
  await writeFile(sqlOutputPath, sqlAudit, "utf8");

  console.log(
    `[ingredient-form-targets] mode=${mode} targets=${targets.length} missing=${missingTargets.length} r1=${r1IngredientIds.size} topN=${topNIngredientIds.size}`,
  );
  console.log(`[ingredient-form-targets] output=${outputPath}`);
  console.log(`[ingredient-form-targets] sql=${sqlOutputPath}`);
};

run().catch((error) => {
  console.error("[ingredient-form-targets] failed:", error);
  process.exit(1);
});
