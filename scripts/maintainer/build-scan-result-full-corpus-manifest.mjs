#!/usr/bin/env node
/* eslint-disable no-console */

import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  buildCensus,
  countBy,
  ensureDir,
  getMcpListEvidence,
  loadRuntimeFamilyCatalog,
  normalizeOverlayProduct,
  parseArgs,
  readBackendEnv,
  renderCensusMarkdown,
  renderDiscoveryMarkdown,
  writeCsv,
  writeJson,
  writeText,
} from "./lib/scan-result-full-corpus-audit.mjs";

const MANIFEST_COLUMNS = [
  "product_id",
  "upc_code",
  "barcode_gtin14",
  "brand_name",
  "title",
  "link",
  "product_catalog_image",
  "product_images",
  "categories",
  "supplement_facts",
  "serving",
  "description_sections",
  "source_zip_path",
  "updated_at",
];

const fetchAllOverlayRows = async ({ supabase, limit = null, pageSize = 1000 }) => {
  const out = [];
  let from = 0;
  while (true) {
    const remaining = limit ? limit - out.length : pageSize;
    if (remaining <= 0) break;
    const to = from + Math.min(pageSize, remaining) - 1;
    const { data, error } = await supabase
      .from("iherb_overlay_products")
      .select(MANIFEST_COLUMNS.join(","))
      .order("updated_at", { ascending: false })
      .range(from, to);
    if (error) throw new Error(`iherb_overlay_products select failed: ${error.message}`);
    const rows = Array.isArray(data) ? data : [];
    out.push(...rows);
    if (rows.length < to - from + 1) break;
    from = to + 1;
  }
  return out;
};

const buildFamilyCensusRows = (products) => Object.entries(countBy(products, "family"))
  .map(([family, product_count]) => {
    const rows = products.filter((row) => row.family === family);
    return {
      family,
      product_count,
      barcode_capable_count: rows.filter((row) => row.barcode).length,
      product_id_only_count: rows.filter((row) => !row.barcode && row.productId).length,
      source_tiers: Object.entries(countBy(rows, "sourceTier")).map(([key, count]) => `${key}:${count}`).join("|"),
      facts_statuses: Object.entries(countBy(rows, "factsStatus")).map(([key, count]) => `${key}:${count}`).join("|"),
      top_category: Object.entries(countBy(rows, (row) => row.category ?? "unknown"))[0]?.[0] ?? null,
    };
  });

const buildManifestCsvRows = (products) => products.map((row) => ({
  productId: row.productId,
  barcode: row.barcode,
  upcCode: row.upcCode,
  productName: row.productName,
  brand: row.brand,
  family: row.family,
  familyMatchSource: row.familyMatchSource,
  category: row.category,
  sourceTier: row.sourceTier,
  factsStatus: row.factsStatus,
  coverageStatus: row.coverageStatus,
  activeIngredientCount: row.activeIngredients.length,
  activeIngredientNames: row.activeIngredientNames.join(" | "),
  missingCriticalFields: row.missingCriticalFields.join(" | "),
  likelySupplement: row.likelySupplement,
  rawUpdatedAt: row.rawUpdatedAt,
}));

const main = async () => {
  const args = parseArgs(process.argv.slice(2), { mode: "manifest", concurrency: 1 });
  await ensureDir(args.runDir);
  const generatedAt = new Date().toISOString();
  const env = await readBackendEnv();
  const catalog = await loadRuntimeFamilyCatalog();
  const mcpEvidence = getMcpListEvidence();
  const discoveryPath = path.join(args.runDir, "discovery.md");

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    const discovery = renderDiscoveryMarkdown({
      generatedAt,
      args,
      mcpEvidence,
      catalog,
      tableEvidence: {
        authorityProductTable: "iherb_overlay_products",
        manifestSelectColumns: MANIFEST_COLUMNS,
      },
      routeEvidence: { renderMcpRuntimeEvidence: "not_checked_missing_supabase_env" },
    });
    await writeText(discoveryPath, discovery);
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in backend/.env or .env; manifest builder is read-only but needs credentials to select corpus rows.");
  }

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const rawRows = args.dryRun
    ? await fetchAllOverlayRows({ supabase, limit: args.limit ?? 25 })
    : await fetchAllOverlayRows({ supabase, limit: args.limit });
  const products = rawRows.map((row) => normalizeOverlayProduct(row, catalog));
  const census = buildCensus(products);
  const manifest = {
    reportType: "scan_result_full_corpus_manifest",
    generatedAt,
    runId: args.runId,
    dryRun: args.dryRun,
    source: {
      table: "iherb_overlay_products",
      selectColumns: MANIFEST_COLUMNS,
      readOnly: true,
      supabaseMcp: {
        listed: mcpEvidence.supabaseListed,
        authStatus: mcpEvidence.supabaseAuthStatus,
      },
    },
    configuredTarget: args.stagingUrl,
    census,
    familyCatalog: catalog,
    products,
  };

  await writeJson(path.join(args.runDir, "manifest.json"), manifest);
  await writeCsv(path.join(args.runDir, "manifest.csv"), buildManifestCsvRows(products));
  await writeText(path.join(args.runDir, "census.md"), renderCensusMarkdown({ generatedAt, census }));
  await writeCsv(path.join(args.runDir, "family-census.csv"), buildFamilyCensusRows(products));
  await writeText(discoveryPath, renderDiscoveryMarkdown({
    generatedAt,
    args,
    mcpEvidence,
    catalog,
    tableEvidence: {
      authorityProductTable: "iherb_overlay_products",
      manifestSelectColumns: MANIFEST_COLUMNS,
    },
    routeEvidence: { renderMcpRuntimeEvidence: "render_mcp_connector_unauthorized_or_not_checked_by_script" },
  }));

  console.log(`[scan-result-corpus-manifest] runId=${args.runId} products=${products.length} out=${args.runDir}`);
};

main().catch((error) => {
  console.error("[scan-result-corpus-manifest] failed", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
