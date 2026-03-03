#!/usr/bin/env node
/* eslint-disable no-console */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

const ROOT_DIR = process.cwd();
const args = process.argv.slice(2);

const getArg = (flag, fallback = null) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return fallback;
  return args[idx + 1] ?? fallback;
};

const resolvePath = (value) => {
  if (!value) return null;
  return path.isAbsolute(value) ? value : path.join(ROOT_DIR, value);
};

const ensureDir = async (dirPath) => {
  await fs.mkdir(dirPath, { recursive: true });
};

const readJsonl = async (filePath) => {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
};

const writeJson = async (filePath, payload) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const writeJsonl = async (filePath, rows) => {
  await ensureDir(path.dirname(filePath));
  const body = (Array.isArray(rows) ? rows : []).map((row) => JSON.stringify(row)).join("\n");
  await fs.writeFile(filePath, body ? `${body}\n` : "", "utf8");
};

const writeText = async (filePath, body) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, body, "utf8");
};

const normalizeBrand = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokenize = (value) => normalizeBrand(value).split(" ").filter(Boolean);

const overlapCount = (a, b) => {
  const sa = new Set(tokenize(a));
  const sb = new Set(tokenize(b));
  let count = 0;
  for (const t of sa) if (sb.has(t)) count += 1;
  return count;
};

const asNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const withTimeout = async (promise, timeoutMs, label) => {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout:${label}`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const hashOf = (obj) =>
  crypto.createHash("sha256").update(JSON.stringify(obj)).digest("hex");

const envCandidates = [
  path.join(ROOT_DIR, ".env"),
  path.join(ROOT_DIR, "backend/.env"),
  path.join(path.dirname(ROOT_DIR), ".env"),
];
for (const candidate of envCandidates) dotenv.config({ path: candidate, override: false });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[build-coverage-gap-hit-matrix] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  global: { headers: { "x-stage": "v1.6.14-epp-gap-matrix" } },
});

const buildSearchTerms = (brand) => {
  const raw = String(brand ?? "").trim();
  const normalized = normalizeBrand(raw);
  const compact = normalized.replace(/\s+/g, "");
  const noApos = raw.replace(/['’]/g, "");
  const terms = new Set([raw, noApos, normalized, compact].filter(Boolean));
  return [...terms].sort((a, b) => b.length - a.length);
};

const queryCounts = async ({ market, brand, timeoutMs }) => {
  const brandNorm = normalizeBrand(brand);
  const terms = buildSearchTerms(brand);
  const likeTerm = terms[0] ?? brand;

  if (market === "US") {
    const exact = await withTimeout(
      supabase.from("dsld_labels_meta").select("dsld_label_id", { count: "exact", head: true }).eq("brand_norm", brandNorm),
      timeoutMs,
      "us_exact",
    );
    const brandLike = await withTimeout(
      supabase.from("dsld_labels_meta").select("dsld_label_id", { count: "exact", head: true }).ilike("brand", `%${likeTerm}%`),
      timeoutMs,
      "us_brand_like",
    );
    const titleLike = await withTimeout(
      supabase.from("dsld_labels_meta").select("dsld_label_id", { count: "exact", head: true }).ilike("product_name", `%${likeTerm}%`),
      timeoutMs,
      "us_title_like",
    );
    const titleSample = await withTimeout(
      supabase
        .from("dsld_labels_meta")
        .select("dsld_label_id,brand,product_name,brand_norm")
        .ilike("product_name", `%${likeTerm}%`)
        .limit(60),
      timeoutMs,
      "us_title_sample",
    );
    return {
      market,
      sourceType: "dsld",
      brandNorm,
      exactCount: exact.count || 0,
      brandLikeCount: brandLike.count || 0,
      titleLikeCount: titleLike.count || 0,
      sampleRows: (titleSample.data || []).map((row) => ({
        sourceType: "dsld",
        sourceId: String(row.dsld_label_id ?? ""),
        identityKey: row?.dsld_label_id ? `dsldLabelId:${row.dsld_label_id}` : null,
        brandName: row?.brand || null,
        productName: row?.product_name || null,
        brandNorm: row?.brand_norm || null,
      })),
    };
  }

  const exact = await withTimeout(
    supabase.from("lnhpd_facts_complete").select("npn", { count: "exact", head: true }).eq("brand_norm", brandNorm),
    timeoutMs,
    "ca_exact",
  );
  const brandLike = await withTimeout(
    supabase.from("lnhpd_facts_complete").select("npn", { count: "exact", head: true }).ilike("brand_name", `%${likeTerm}%`),
    timeoutMs,
    "ca_brand_like",
  );
  const titleLike = await withTimeout(
    supabase.from("lnhpd_facts_complete").select("npn", { count: "exact", head: true }).ilike("product_name", `%${likeTerm}%`),
    timeoutMs,
    "ca_title_like",
  );
  const titleSample = await withTimeout(
    supabase
      .from("lnhpd_facts_complete")
      .select("npn,brand_name,product_name,brand_norm")
      .ilike("product_name", `%${likeTerm}%`)
      .limit(60),
    timeoutMs,
    "ca_title_sample",
  );
  return {
    market,
    sourceType: "lnhpd",
    brandNorm,
    exactCount: exact.count || 0,
    brandLikeCount: brandLike.count || 0,
    titleLikeCount: titleLike.count || 0,
    sampleRows: (titleSample.data || []).map((row) => ({
      sourceType: "lnhpd",
      sourceId: String(row.npn ?? ""),
      identityKey: row?.npn ? `npn:${row.npn}` : null,
      brandName: row?.brand_name || null,
      productName: row?.product_name || null,
      brandNorm: row?.brand_norm || null,
    })),
  };
};

const classifyRow = ({ gap, queryResult }) => {
  const market = String(gap.market ?? "").toUpperCase();
  const termTokens = tokenize(gap.brand);
  const samples = queryResult.sampleRows || [];
  const titleConfirmedRows = samples.filter((row) => overlapCount(row.productName, termTokens.join(" ")) > 0);
  const titleTokenOverlapCount =
    titleConfirmedRows.length > 0
      ? titleConfirmedRows.length
      : (queryResult.titleLikeCount > 0 ? 1 : 0);
  const manufacturerSignalCount = samples.filter((row) => {
    const bn = normalizeBrand(row.brandName);
    return /(labs?|laborator|international|pharma|nutrition|naturals?|health|products?)/.test(bn);
  }).length;

  const matchable =
    queryResult.titleLikeCount > 0
    && titleTokenOverlapCount > 0;

  const allZero =
    queryResult.exactCount === 0
    && queryResult.brandLikeCount === 0
    && queryResult.titleLikeCount === 0;

  const classification = allZero ? "ceiling" : (matchable ? "matchable" : "review");
  const representative = titleConfirmedRows[0]
    || samples[0]
    || (queryResult.titleLikeCount > 0
      ? {
        sourceType: queryResult.sourceType,
        sourceId: `title_like_only:${market}:${normalizeBrand(gap.brand)}`,
        identityKey: `${queryResult.sourceType}:title_like_only:${market}:${normalizeBrand(gap.brand)}`,
        brandName: gap.brand,
        productName: gap.brand,
        brandNorm: normalizeBrand(gap.brand),
      }
      : null);

  return {
    market: gap.market,
    brand: gap.brand,
    brandNorm: normalizeBrand(gap.brand),
    sourceType: queryResult.sourceType,
    counts: {
      exact_brand_norm: queryResult.exactCount,
      brand_ilike: queryResult.brandLikeCount,
      product_title_ilike: queryResult.titleLikeCount,
      title_token_overlap: titleTokenOverlapCount,
      manufacturer_signal: manufacturerSignalCount,
    },
    classification,
    representative,
    sampleCount: samples.length,
  };
};

const main = async () => {
  const gapQueuePath = resolvePath(getArg("gap-queue-jsonl"))
    ?? path.join(
      ROOT_DIR,
      "output",
      "v1.6.14-e-plus-20260302T074048Z",
      "step0_to_step2_rerun",
      "step0_universe",
      "brand_alias_fix_queue.jsonl",
    );
  const timeoutMs = Math.max(3000, asNumber(getArg("query-timeout-ms"), 15000));
  const etaDays = Math.max(1, asNumber(getArg("eta-days"), 7));
  const outDir = resolvePath(getArg("out-dir"))
    ?? path.join(ROOT_DIR, "output", `v1.6.14-e-plus-${new Date().toISOString().replace(/[:.]/g, "-")}`, "coverage");

  const gaps = await readJsonl(gapQueuePath);
  if (gaps.length === 0) {
    console.error("[build-coverage-gap-hit-matrix] gap queue empty");
    process.exit(1);
  }

  const matrix = [];
  const matchableCandidates = [];
  const residualQueue = [];
  const nowIso = new Date().toISOString();
  const eta = new Date(Date.now() + etaDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  for (const gap of gaps) {
    const market = String(gap?.market ?? "").toUpperCase();
    const brand = String(gap?.brand ?? "").trim();
    if (!market || !brand) continue;

    const queryResult = await queryCounts({ market, brand, timeoutMs });
    const row = classifyRow({ gap: { market, brand }, queryResult });
    matrix.push(row);

    if (row.classification === "matchable" && row.representative?.identityKey) {
      matchableCandidates.push({
        market,
        brand,
        sourceType: row.representative.sourceType,
        sourceId: row.representative.sourceId,
        identityKey: row.representative.identityKey,
        brandName: row.representative.brandName,
        productName: row.representative.productName,
        matchedBy: "coverage_term",
        matchedTerm: brand,
        matchSignals: ["product_title_token_overlap", "distributor_or_manufacturer_signal"],
        confidenceBucket: "medium",
        reasonCode: "coverage_gap_title_led_matchable",
        owner: gap?.owner || "data-lane-ops",
        status: "matchable",
        eta,
      });
    }

    if (row.classification === "ceiling") {
      residualQueue.push({
        market,
        brand,
        brandNorm: row.brandNorm,
        owner: gap?.owner || "data-lane-ops",
        status: gap?.status || "open",
        reasonCode: "coverage_ceiling_no_authoritative_hit",
        targetRelease: gap?.targetRelease || "v1.6.14-e-plus-followup",
        eta: gap?.eta || eta,
      });
    }
  }

  const summary = {
    generatedAt: nowIso,
    input: {
      gapQueuePath,
      timeoutMs,
      totalGaps: gaps.length,
    },
    counts: {
      matchable: matrix.filter((row) => row.classification === "matchable").length,
      ceiling: matrix.filter((row) => row.classification === "ceiling").length,
      review: matrix.filter((row) => row.classification === "review").length,
    },
    matrixHash: hashOf(matrix),
  };

  await writeJson(path.join(outDir, "coverage_gap_hit_matrix.json"), {
    ...summary,
    rows: matrix,
  });
  await writeJsonl(path.join(outDir, "coverage_gap_matchable_candidates.jsonl"), matchableCandidates);
  await writeJsonl(path.join(outDir, "coverage_gap_residual_queue.jsonl"), residualQueue);
  await writeText(
    path.join(outDir, "coverage_gap_hit_matrix.md"),
    [
      "# Coverage Gap Hit Matrix",
      "",
      `- input gaps: ${summary.input.totalGaps}`,
      `- matchable: ${summary.counts.matchable}`,
      `- ceiling: ${summary.counts.ceiling}`,
      `- review: ${summary.counts.review}`,
      `- matrixHash: ${summary.matrixHash}`,
      "",
      "## Rows",
      ...matrix.map((row) =>
        `- ${row.market} | ${row.brand} | ${row.classification} | exact=${row.counts.exact_brand_norm} | brandLike=${row.counts.brand_ilike} | titleLike=${row.counts.product_title_ilike} | titleTokenOverlap=${row.counts.title_token_overlap}`),
    ].join("\n") + "\n",
  );

  console.log("[build-coverage-gap-hit-matrix] completed");
  console.log(
    JSON.stringify(
      {
        outDir,
        ...summary.counts,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error("[build-coverage-gap-hit-matrix] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
