#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

const ROOT_DIR = process.cwd();
dotenv.config({ path: path.join(ROOT_DIR, "backend", ".env") });
dotenv.config({ path: path.join(ROOT_DIR, ".env") });

const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(`--${flag}`);
const getArg = (flag) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};
const getArgList = (flag) => {
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] !== `--${flag}`) continue;
    const value = args[i + 1];
    if (!value || value.startsWith("--")) continue;
    out.push(value);
  }
  return out;
};

if (hasFlag("help")) {
  console.log(`Usage:
  node scripts/maintainer/bootstrap-gate-baseline.mjs [options]

Required env:
  SOURCE_SUPABASE_URL
  SOURCE_SUPABASE_SERVICE_ROLE_KEY
  TARGET_SUPABASE_URL
  TARGET_SUPABASE_SERVICE_ROLE_KEY

Options:
  --barcode-fixtures <path>   Fixture file path (can repeat; defaults to curated baseline fixtures)
  --out-dir <path>            Output directory (default: output/release-gates/bootstrap-baseline/<timestamp>)
  --chunk-size <n>            Query/upsert chunk size (default: 500)
  --api-base-url <url>        API base URL for post-import hard validations (default: API_BASE_URL or http://127.0.0.1:3001)
  --skip-validations          Skip post-import hard validations (default: false)
  --dry-run                   Fetch and evaluate only; do not write target DB
`);
  process.exit(0);
}

const nowTag = new Date().toISOString().replace(/[:.]/g, "-");
const outDirArg =
  getArg("out-dir")
  || path.join("output", "release-gates", "bootstrap-baseline", nowTag);
const outDir = path.isAbsolute(outDirArg) ? outDirArg : path.join(ROOT_DIR, outDirArg);
const reportJsonPath = path.join(outDir, "baseline_import_report.json");
const reportMdPath = path.join(outDir, "baseline_import_report.md");

const chunkSizeRaw = Number(getArg("chunk-size") || process.env.BASELINE_BOOTSTRAP_CHUNK_SIZE || 500);
const chunkSize = Number.isFinite(chunkSizeRaw) && chunkSizeRaw > 0 ? Math.floor(chunkSizeRaw) : 500;
const apiBaseUrl = String(getArg("api-base-url") || process.env.API_BASE_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
const skipValidations = hasFlag("skip-validations");
const dryRun = hasFlag("dry-run");

const defaultFixturePaths = [
  path.join("scripts", "maintainer", "fixtures", "expected_authoritative_set.v1.json"),
  path.join("scripts", "maintainer", "fixtures", "ods_ul_visibility_barcodes.v1.json"),
  path.join("scripts", "maintainer", "fixtures", "inferred_only_consistency_barcodes.v1.json"),
  path.join("scripts", "maintainer", "fixtures", "ca_common_test_barcodes.v1.json"),
  path.join("scripts", "maintainer", "fixtures", "surface_consistency_barcodes.v1.json"),
];
const fixtureArgs = getArgList("barcode-fixtures");
const fixturePaths = (fixtureArgs.length > 0 ? fixtureArgs : defaultFixturePaths)
  .flatMap((value) => String(value).split(","))
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => (path.isAbsolute(value) ? value : path.join(ROOT_DIR, value)));

const SOURCE_SUPABASE_URL = process.env.SOURCE_SUPABASE_URL || "";
const SOURCE_SUPABASE_SERVICE_ROLE_KEY = process.env.SOURCE_SUPABASE_SERVICE_ROLE_KEY || "";
const TARGET_SUPABASE_URL = process.env.TARGET_SUPABASE_URL || "";
const TARGET_SUPABASE_SERVICE_ROLE_KEY = process.env.TARGET_SUPABASE_SERVICE_ROLE_KEY || "";

if (!SOURCE_SUPABASE_URL || !SOURCE_SUPABASE_SERVICE_ROLE_KEY || !TARGET_SUPABASE_URL || !TARGET_SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[bootstrap-gate-baseline] missing required source/target Supabase env vars");
  process.exit(1);
}

const sourceClient = createClient(SOURCE_SUPABASE_URL, SOURCE_SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const targetClient = createClient(TARGET_SUPABASE_URL, TARGET_SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const normalizeDigits = (value) => String(value ?? "").replace(/\D/g, "").trim();
const normalizeBarcode = (value) => {
  const digits = normalizeDigits(value);
  if (!digits) return null;
  if (digits.length >= 14) return digits.slice(-14);
  if (digits.length >= 8) return digits.padStart(14, "0");
  return null;
};
const normalizeNpn = (value) => {
  const digits = normalizeDigits(value);
  if (!digits) return null;
  return digits.length >= 8 ? digits.slice(-8) : digits.padStart(8, "0");
};
const uniq = (values) => Array.from(new Set(values.filter(Boolean)));

const readJson = async (filePath) => {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const chunkArray = (values, size) => {
  const out = [];
  for (let i = 0; i < values.length; i += size) {
    out.push(values.slice(i, i + size));
  }
  return out;
};

const fetchRowsByIn = async ({
  client,
  table,
  column,
  values,
  select = "*",
  extraFilter = null,
}) => {
  if (!Array.isArray(values) || values.length === 0) return [];
  const chunks = chunkArray(values, chunkSize);
  const rows = [];
  for (const chunk of chunks) {
    let query = client.from(table).select(select).in(column, chunk);
    if (typeof extraFilter === "function") {
      query = extraFilter(query);
    }
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await query;
    if (error) {
      throw new Error(`fetch_${table}_by_${column}_failed:${error.message}`);
    }
    if (Array.isArray(data)) rows.push(...data);
  }
  return rows;
};

const upsertRows = async ({
  client,
  table,
  rows,
  onConflict,
}) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { upserted: 0, chunks: 0 };
  }
  const chunks = chunkArray(rows, chunkSize);
  for (const chunk of chunks) {
    // eslint-disable-next-line no-await-in-loop
    const { error } = await client.from(table).upsert(chunk, { onConflict });
    if (error) {
      throw new Error(`upsert_${table}_failed:${error.message}`);
    }
  }
  return { upserted: rows.length, chunks: chunks.length };
};

const runNodeScript = async (scriptPath, scriptArgs = [], envPatch = {}) => {
  return await new Promise((resolve) => {
    const child = spawn("node", [scriptPath, ...scriptArgs], {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        ...envPatch,
      },
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (code) => {
      resolve({
        code: code ?? 1,
        stdout,
        stderr,
      });
    });
    child.on("error", (error) => {
      resolve({
        code: 1,
        stdout,
        stderr: String(error?.message ?? error),
      });
    });
  });
};

const parseFixture = (payload) => {
  const rows = Array.isArray(payload)
    ? payload
    : (payload && Array.isArray(payload.barcodes) ? payload.barcodes : []);
  const barcodes = [];
  const expectedAuthoritative = [];
  for (const row of rows) {
    const rawBarcode = typeof row === "string" ? row : row?.barcode;
    const barcode = normalizeBarcode(rawBarcode);
    if (!barcode) continue;
    barcodes.push(barcode);
    if (row && typeof row === "object" && row.expectedFinal === true) {
      expectedAuthoritative.push(barcode);
    }
  }
  return {
    barcodes,
    expectedAuthoritative,
  };
};

const probeSourceTypeFinal = async (barcode) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`${apiBaseUrl}/api/enrich-stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "x-auth-disabled": "1",
      },
      body: JSON.stringify({
        barcode,
        streamMode: "analysis_bundle_only",
      }),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      return { barcode, ok: false, sourceTypeFinal: false, error: `http_${response.status}` };
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = "message";
    let dataLines = [];
    let sourceTypeFinal = null;
    const flush = () => {
      if (!dataLines.length) return;
      const raw = dataLines.join("\n");
      dataLines = [];
      let payload = null;
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = null;
      }
      if (currentEvent === "analysis_bundle" && payload?.meta && typeof payload.meta === "object") {
        if (typeof payload.meta.sourceTypeFinal === "boolean") {
          sourceTypeFinal = payload.meta.sourceTypeFinal;
        }
      }
      currentEvent = "message";
    };

    while (true) {
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line) {
          flush();
          continue;
        }
        if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim() || "message";
          continue;
        }
        if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trim());
        }
      }
      if (sourceTypeFinal === true) {
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
    flush();
    return {
      barcode,
      ok: sourceTypeFinal === true,
      sourceTypeFinal: sourceTypeFinal === true,
      error: sourceTypeFinal === true ? null : "source_type_final_false",
    };
  } catch (error) {
    return {
      barcode,
      ok: false,
      sourceTypeFinal: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
};

const toMarkdown = (report) => {
  const lines = [];
  lines.push("# Baseline Import Report");
  lines.push("");
  lines.push(`- generatedAt: ${report.generatedAt}`);
  lines.push(`- dryRun: ${report.dryRun ? "true" : "false"}`);
  lines.push(`- source: ${report.sourceSupabaseUrl}`);
  lines.push(`- target: ${report.targetSupabaseUrl}`);
  lines.push(`- fixtureCount: ${report.fixtures.length}`);
  lines.push(`- barcodeCount: ${report.barcodeCount}`);
  lines.push(`- pass: ${report.pass ? "true" : "false"}`);
  lines.push("");
  lines.push("## Imported Rows");
  lines.push("");
  lines.push(`- barcode_regulatory_map: ${report.tables.barcode_regulatory_map}`);
  lines.push(`- lnhpd_facts: ${report.tables.lnhpd_facts}`);
  lines.push(`- product_ingredients: ${report.tables.product_ingredients}`);
  lines.push(`- ingredients: ${report.tables.ingredients}`);
  lines.push(`- ul__toxicity: ${report.tables.ul__toxicity}`);
  lines.push(`- dose_response_curves: ${report.tables.dose_response_curves}`);
  lines.push("");
  lines.push("## Hard Validations");
  lines.push("");
  lines.push(`- expected authoritative sourceTypeFinal: ${report.validations.expectedAuthoritative.pass ? "PASS" : "FAIL"} (${report.validations.expectedAuthoritative.passCount}/${report.validations.expectedAuthoritative.total})`);
  lines.push(`- UL guidance rate >= 0.30: ${report.validations.ulCoverage.pass ? "PASS" : "FAIL"} (${report.validations.ulCoverage.ulGuidanceRate})`);
  lines.push(`- bulk CA zero ingredients <= 1: ${report.validations.bulkCaZero.pass ? "PASS" : "FAIL"} (${report.validations.bulkCaZero.caZeroIngredientsCount})`);
  if (Array.isArray(report.failures) && report.failures.length > 0) {
    lines.push("");
    lines.push("## Failures");
    lines.push("");
    for (const failure of report.failures) lines.push(`- ${failure}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  await fs.mkdir(outDir, { recursive: true });

  const fixtureSummaries = [];
  const allBarcodes = [];
  const expectedAuthoritative = [];
  for (const fixturePath of fixturePaths) {
    // eslint-disable-next-line no-await-in-loop
    const payload = await readJson(fixturePath);
    const parsed = parseFixture(payload);
    fixtureSummaries.push({
      path: path.relative(ROOT_DIR, fixturePath),
      barcodeCount: parsed.barcodes.length,
      expectedAuthoritativeCount: parsed.expectedAuthoritative.length,
    });
    allBarcodes.push(...parsed.barcodes);
    expectedAuthoritative.push(...parsed.expectedAuthoritative);
  }

  const barcodeSet = uniq(allBarcodes);
  const expectedAuthoritativeSet = uniq(expectedAuthoritative);
  if (barcodeSet.length === 0) {
    throw new Error("no_valid_barcodes_from_fixtures");
  }

  const barcodeMapRows = await fetchRowsByIn({
    client: sourceClient,
    table: "barcode_regulatory_map",
    column: "barcode_gtin14",
    values: barcodeSet,
  });
  const npnSet = uniq(barcodeMapRows.map((row) => normalizeNpn(row?.npn)));

  const scanRows = await fetchRowsByIn({
    client: sourceClient,
    table: "barcode_scans",
    column: "barcode_gtin14",
    values: barcodeSet,
    select: "barcode_gtin14,dsld_label_id,served_from,created_at",
  });
  const dsldSourceIds = uniq(
    scanRows
      .map((row) => {
        const value = Number(row?.dsld_label_id);
        return Number.isFinite(value) ? String(Math.floor(value)) : null;
      }),
  );

  let lnhpdFactsRows = [];
  if (npnSet.length > 0) {
    lnhpdFactsRows = await fetchRowsByIn({
      client: sourceClient,
      table: "lnhpd_facts",
      column: "npn",
      values: npnSet,
    });
  }
  const lnhpdIds = uniq(
    lnhpdFactsRows
      .map((row) => Number(row?.lnhpd_id))
      .filter((value) => Number.isFinite(value))
      .map((value) => String(Math.floor(value))),
  );

  const productRows = [];
  if (dsldSourceIds.length > 0) {
    const rows = await fetchRowsByIn({
      client: sourceClient,
      table: "product_ingredients",
      column: "source_id",
      values: dsldSourceIds,
      extraFilter: (query) => query.eq("source", "dsld"),
    });
    productRows.push(...rows);
  }
  if (lnhpdIds.length > 0) {
    const rows = await fetchRowsByIn({
      client: sourceClient,
      table: "product_ingredients",
      column: "source_id",
      values: lnhpdIds,
      extraFilter: (query) => query.eq("source", "lnhpd"),
    });
    productRows.push(...rows);
  }

  const ingredientIds = uniq(productRows.map((row) => row?.ingredient_id).filter(Boolean));
  const ingredientRows = ingredientIds.length > 0
    ? await fetchRowsByIn({
      client: sourceClient,
      table: "ingredients",
      column: "id",
      values: ingredientIds,
    })
    : [];

  const ulRows = ingredientIds.length > 0
    ? await fetchRowsByIn({
      client: sourceClient,
      table: "ul__toxicity",
      column: "ingredient_id",
      values: ingredientIds,
    })
    : [];
  const doseCurveRows = ingredientIds.length > 0
    ? await fetchRowsByIn({
      client: sourceClient,
      table: "dose_response_curves",
      column: "ingredient_id",
      values: ingredientIds,
    })
    : [];

  const importStats = {
    barcode_regulatory_map: barcodeMapRows.length,
    lnhpd_facts: lnhpdFactsRows.length,
    product_ingredients: productRows.length,
    ingredients: ingredientRows.length,
    ul__toxicity: ulRows.length,
    dose_response_curves: doseCurveRows.length,
  };

  if (!dryRun) {
    await upsertRows({
      client: targetClient,
      table: "ingredients",
      rows: ingredientRows,
      onConflict: "id",
    });
    await upsertRows({
      client: targetClient,
      table: "ul__toxicity",
      rows: ulRows,
      onConflict: "ul_id",
    });
    await upsertRows({
      client: targetClient,
      table: "dose_response_curves",
      rows: doseCurveRows,
      onConflict: "curve_id",
    });
    await upsertRows({
      client: targetClient,
      table: "barcode_regulatory_map",
      rows: barcodeMapRows,
      onConflict: "barcode_gtin14",
    });
    await upsertRows({
      client: targetClient,
      table: "lnhpd_facts",
      rows: lnhpdFactsRows,
      onConflict: "lnhpd_id",
    });
    await upsertRows({
      client: targetClient,
      table: "product_ingredients",
      rows: productRows,
      onConflict: "id",
    });
  }

  let lnhpdFactsCompleteCount = 0;
  if (lnhpdIds.length > 0) {
    const completeRows = await fetchRowsByIn({
      client: targetClient,
      table: "lnhpd_facts_complete",
      column: "lnhpd_id",
      values: lnhpdIds,
      select: "lnhpd_id",
    });
    lnhpdFactsCompleteCount = completeRows.length;
  }

  const validations = {
    expectedAuthoritative: {
      skipped: skipValidations || dryRun,
      total: expectedAuthoritativeSet.length,
      passCount: 0,
      pass: skipValidations || dryRun,
      rows: [],
    },
    ulCoverage: {
      skipped: skipValidations || dryRun,
      ulGuidanceRate: null,
      scopeNonTotalCount: null,
      pass: skipValidations || dryRun,
      error: null,
    },
    bulkCaZero: {
      skipped: skipValidations || dryRun,
      caZeroIngredientsCount: null,
      pass: skipValidations || dryRun,
      error: null,
    },
  };

  if (!skipValidations && !dryRun) {
    for (const barcode of expectedAuthoritativeSet) {
      // eslint-disable-next-line no-await-in-loop
      const row = await probeSourceTypeFinal(barcode);
      validations.expectedAuthoritative.rows.push(row);
      if (row.ok) validations.expectedAuthoritative.passCount += 1;
    }
    validations.expectedAuthoritative.pass =
      validations.expectedAuthoritative.passCount === validations.expectedAuthoritative.total;

    const ulOutDir = path.join(outDir, "validation-ul");
    const ulRun = await runNodeScript(
      "scripts/maintainer/ods-ul-visibility-report.mjs",
      [
        "--out-dir",
        ulOutDir,
        "--barcodes-file",
        path.join("scripts", "maintainer", "fixtures", "ods_ul_visibility_barcodes.v1.json"),
        "--api-base-url",
        apiBaseUrl,
      ],
      {
        API_BASE_URL: apiBaseUrl,
      },
    );
    if (ulRun.code === 0) {
      const ulReport = await readJson(path.join(ulOutDir, "ods_ul_visibility_report.json"));
      const rate = Number(ulReport?.summary?.ulGuidanceRate ?? Number.NaN);
      const scopeNonTotalCount = Number(ulReport?.summary?.scopeNonTotalCount ?? Number.NaN);
      validations.ulCoverage.ulGuidanceRate = Number.isFinite(rate) ? Number(rate.toFixed(6)) : null;
      validations.ulCoverage.scopeNonTotalCount = Number.isFinite(scopeNonTotalCount) ? scopeNonTotalCount : null;
      validations.ulCoverage.pass = Number.isFinite(rate) && rate >= 0.3;
    } else {
      validations.ulCoverage.pass = false;
      validations.ulCoverage.error = (ulRun.stderr || ulRun.stdout || "ul_validation_failed").trim();
    }

    const bulkOutDir = path.join(outDir, "validation-bulk");
    const bulkRun = await runNodeScript(
      "scripts/maintainer/bulk-barcode-e2e.mjs",
      [],
      {
        API_BASE_URL: apiBaseUrl,
        BULK_E2E_OUT_DIR: bulkOutDir,
      },
    );
    if (bulkRun.code === 0) {
      const bulkGate = await readJson(path.join(bulkOutDir, "gate.json"));
      const caZero = Number(bulkGate?.metrics?.caZeroIngredientsCount ?? Number.NaN);
      validations.bulkCaZero.caZeroIngredientsCount = Number.isFinite(caZero) ? caZero : null;
      validations.bulkCaZero.pass = Number.isFinite(caZero) && caZero <= 1;
    } else {
      validations.bulkCaZero.pass = false;
      validations.bulkCaZero.error = (bulkRun.stderr || bulkRun.stdout || "bulk_validation_failed").trim();
    }
  }

  const failures = [];
  if (!validations.expectedAuthoritative.pass) {
    failures.push(
      `expected_authoritative_source_type_final_failed ${validations.expectedAuthoritative.passCount}/${validations.expectedAuthoritative.total}`,
    );
  }
  if (!validations.ulCoverage.pass) {
    failures.push(
      `ul_guidance_rate_failed rate=${validations.ulCoverage.ulGuidanceRate ?? "n/a"} threshold=0.3`,
    );
  }
  if (!validations.bulkCaZero.pass) {
    failures.push(
      `bulk_ca_zero_failed count=${validations.bulkCaZero.caZeroIngredientsCount ?? "n/a"} threshold=1`,
    );
  }

  const report = {
    generatedAt: new Date().toISOString(),
    dryRun,
    skipValidations,
    apiBaseUrl,
    sourceSupabaseUrl: SOURCE_SUPABASE_URL,
    targetSupabaseUrl: TARGET_SUPABASE_URL,
    fixtures: fixtureSummaries,
    barcodeCount: barcodeSet.length,
    expectedAuthoritativeCount: expectedAuthoritativeSet.length,
    inputs: {
      npnCount: npnSet.length,
      lnhpdIdCount: lnhpdIds.length,
      dsldSourceIdCount: dsldSourceIds.length,
      ingredientIdCount: ingredientIds.length,
    },
    tables: importStats,
    derived: {
      lnhpdFactsCompleteCount,
    },
    validations,
    pass: failures.length === 0,
    failures,
  };

  await fs.writeFile(reportJsonPath, JSON.stringify(report, null, 2), "utf8");
  await fs.writeFile(reportMdPath, toMarkdown(report), "utf8");

  console.log(`[bootstrap-gate-baseline] wrote ${reportJsonPath}`);
  console.log(`[bootstrap-gate-baseline] wrote ${reportMdPath}`);
  if (!report.pass) {
    console.error(`[bootstrap-gate-baseline] failed: ${failures.join(", ")}`);
    process.exit(1);
  }
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[bootstrap-gate-baseline] failed", message);
  process.exit(1);
});
