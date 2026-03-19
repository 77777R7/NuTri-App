#!/usr/bin/env node
/* eslint-disable no-console */
import { execFile as execFileCallback } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

const execFile = promisify(execFileCallback);

const ROOT = process.cwd();
const TODAY = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", "quality_marks", `nutrasource_catalog_closure_${TODAY}`),
);
const BRAND_LIMIT = Math.max(0, Number(getArg("brand-limit", "0")) || 0);
const BRAND_INCLUDE = String(getArg("brand-include", "") || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const BRAND_CONCURRENCY = Math.max(1, Number(getArg("brand-concurrency", "6")) || 6);
const DETAIL_CONCURRENCY = Math.max(1, Number(getArg("detail-concurrency", "8")) || 8);
const SAMPLE_BRANDS = ["Sports Research", "Barlean's", "Carlson"];
const AGENT_BROWSER_PKG = process.env.NUTRASOURCE_AGENT_BROWSER_VERSION ?? "0.20.11";
const AGENT_BROWSER_CMD =
  process.env.QUALITY_MARK_AGENT_BROWSER_SHELL_CMD ??
  `npm exec --yes --package agent-browser@${AGENT_BROWSER_PKG} -- agent-browser`;

process.env.QUALITY_MARK_AGENT_BROWSER_SHELL_CMD = AGENT_BROWSER_CMD;
process.env.QUALITY_MARK_AGENT_BROWSER_FALLBACK = process.env.QUALITY_MARK_AGENT_BROWSER_FALLBACK ?? "true";

const envCandidates = Array.from(
  new Set([
    path.resolve(ROOT, "backend/.env"),
    path.resolve(ROOT, ".env"),
  ]),
);
for (const envPath of envCandidates) {
  if (existsSync(envPath)) dotenv.config({ path: envPath, override: false });
}

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY; expected backend/.env or shell env.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { fetchQualityMarkSource } = await import("../../backend/src/qualityMarks/provider.ts");
const {
  NUTRASOURCE_RAW_PROGRAM_KEYS,
  normalizeBrandKey,
  normalizeProductCore,
  parseNutrasourceBrandPageProducts,
  parseNutrasourceBrandSearchResults,
  parseNutrasourceProductDetail,
  scoreProductNameMatch,
} = await import("../../backend/src/qualityMarks/nutrasourceCatalog.ts");

const safeText = (value) => String(value ?? "").trim();
const hasText = (value) => safeText(value).length > 0;
const nowIso = () => new Date().toISOString();

const writeJson = async (targetPath, payload) => {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const writeText = async (targetPath, value) => {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, value, "utf8");
};

const mapLimit = async (items, limit, worker) => {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
};

const increment = (map, key, by = 1) => {
  map[key] = (map[key] ?? 0) + by;
};

const sortCounts = (counts) =>
  Object.fromEntries(
    Object.entries(counts).sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    }),
  );

const buildBrandSearchUrl = (brandName) =>
  `https://certifications.nutrasource.ca/umbraco/surface/NutrasourceContent/GetFilteredBrands?pageNumber=1&pageSize=12&forCertification=&forInterest=&forCategory=&byName=${encodeURIComponent(brandName)}`;

const buildBrandSearchSource = (brandName) => ({
  url: buildBrandSearchUrl(brandName),
  sourceType: "official_registry",
  title: "Nutrasource brand search",
  responseFormat: "json",
  adapterKind: "nutrasource_brand_search",
  brandName,
  productName: null,
  queryText: brandName,
});

const buildBrandDetailSource = (brandId, brandName) => ({
  url: `https://certifications.nutrasource.ca/certified-products/brand?id=${encodeURIComponent(brandId)}`,
  sourceType: "official_registry",
  title: "Nutrasource brand detail",
  responseFormat: "html",
  adapterKind: "nutrasource_brand_detail",
  brandName,
  productName: null,
  queryText: brandName,
  brandId,
});

const buildProductDetailSource = (productNum, brandName, productName) => ({
  url: `https://certifications.nutrasource.ca/certified-products/product?id=${encodeURIComponent(productNum)}`,
  sourceType: "official_registry",
  title: "Nutrasource product detail",
  responseFormat: "html",
  adapterKind: "nutrasource_product_detail",
  brandName,
  productName,
  queryText: productName,
  productNum,
});

const fetchAllPages = async ({ table, select, pageSize = 1000 }) => {
  const rows = [];
  let from = 0;
  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase.from(table).select(select).range(from, to);
    if (error) {
      if (/does not exist/i.test(String(error.message ?? ""))) return { rows, warning: `${table}_missing` };
      throw new Error(`${table} read failed: ${error.message}`);
    }
    const chunk = Array.isArray(data) ? data : [];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
    from += pageSize;
  }
  return { rows, warning: null };
};

const buildDbBrandSeed = async () => {
  const [brandTable, overlayTable] = await Promise.all([
    fetchAllPages({ table: "brands", select: "name" }),
    fetchAllPages({ table: "iherb_overlay_products", select: "brand_name" }),
  ]);

  const brandSourceMap = new Map();
  for (const row of brandTable.rows) {
    const brandName = safeText(row?.name);
    if (!brandName) continue;
    const key = normalizeBrandKey(brandName);
    if (!brandSourceMap.has(key)) {
      brandSourceMap.set(key, {
        sourceBrandName: brandName,
        normalizedBrandKey: key,
        sources: new Set(),
      });
    }
    brandSourceMap.get(key).sources.add("brands");
  }
  for (const row of overlayTable.rows) {
    const brandName = safeText(row?.brand_name);
    if (!brandName) continue;
    const key = normalizeBrandKey(brandName);
    if (!brandSourceMap.has(key)) {
      brandSourceMap.set(key, {
        sourceBrandName: brandName,
        normalizedBrandKey: key,
        sources: new Set(),
      });
    }
    brandSourceMap.get(key).sources.add("iherb_overlay_products");
  }

  let rows = Array.from(brandSourceMap.values())
    .map((row) => ({
      sourceBrandName: row.sourceBrandName,
      normalizedBrandKey: row.normalizedBrandKey,
      sources: Array.from(row.sources).sort(),
    }))
    .sort((a, b) => a.sourceBrandName.localeCompare(b.sourceBrandName));

  if (BRAND_INCLUDE.length > 0) {
    const includeKeys = new Set(BRAND_INCLUDE.map((value) => normalizeBrandKey(value)));
    rows = rows.filter((row) => includeKeys.has(row.normalizedBrandKey));
  }

  return {
    schemaVersion: "nutrasource_db_brand_seed.v1",
    generatedAt: nowIso(),
    sourceWarnings: [brandTable.warning, overlayTable.warning].filter(Boolean),
    count: rows.length,
    rows: BRAND_LIMIT > 0 ? rows.slice(0, BRAND_LIMIT) : rows,
  };
};

const fetchBrandResults = async (seedRow) => {
  const source = buildBrandSearchSource(seedRow.sourceBrandName);
  const fetched = await fetchQualityMarkSource(source, 12000);
  if (!fetched.ok || !fetched.body) {
    return {
      sourceBrandName: seedRow.sourceBrandName,
      rows: [
        {
          sourceBrandName: seedRow.sourceBrandName,
          resolvedBrandName: null,
          brandId: null,
          brandDetailUrl: null,
          brandProgramsRaw: [],
          found: false,
          matchType: "ambiguous",
          matchScore: 0,
          selectedForCrawl: false,
          warning: fetched.error ?? "brand_search_failed",
        },
      ],
      warning: fetched.error ?? "brand_search_failed",
    };
  }

  const rows = parseNutrasourceBrandSearchResults(fetched.body, seedRow.sourceBrandName);
  if (rows.length === 0) {
    return {
      sourceBrandName: seedRow.sourceBrandName,
      rows: [
        {
          sourceBrandName: seedRow.sourceBrandName,
          resolvedBrandName: null,
          brandId: null,
          brandDetailUrl: null,
          brandProgramsRaw: [],
          found: false,
          matchType: "ambiguous",
          matchScore: 0,
          selectedForCrawl: false,
          warning: "brand_not_found",
        },
      ],
      warning: "brand_not_found",
    };
  }
  return {
    sourceBrandName: seedRow.sourceBrandName,
    rows,
    warning: null,
  };
};

const fetchBrandCatalogForResult = async (brandResult) => {
  if (!brandResult.selectedForCrawl || !brandResult.brandId || !brandResult.brandDetailUrl) {
    return {
      brandId: brandResult.brandId,
      brandName: brandResult.resolvedBrandName,
      products: [],
      warning: null,
    };
  }
  const source = buildBrandDetailSource(brandResult.brandId, brandResult.resolvedBrandName);
  const fetched = await fetchQualityMarkSource(source, 15000);
  if (!fetched.ok || !fetched.body) {
    return {
      brandId: brandResult.brandId,
      brandName: brandResult.resolvedBrandName,
      products: [],
      warning: fetched.error ?? "brand_detail_failed",
    };
  }
  const products = parseNutrasourceBrandPageProducts(
    fetched.body,
    brandResult.brandId,
    brandResult.resolvedBrandName,
    Array.isArray(brandResult.brandProgramsRaw) ? brandResult.brandProgramsRaw : [],
  );
  return {
    brandId: brandResult.brandId,
    brandName: brandResult.resolvedBrandName,
    products,
    warning: null,
  };
};

const fetchProductDetailRecord = async (catalogRow) => {
  const source = buildProductDetailSource(catalogRow.productNum, catalogRow.brandName, catalogRow.productName);
  const fetched = await fetchQualityMarkSource(source, 15000);
  if (!fetched.ok || !fetched.body) {
    return {
      ...catalogRow,
      programsProductRaw: [],
      programsEffective: catalogRow.programsBrandRaw ?? [],
      lotOptions: [],
      pageTitle: null,
      pageFetched: false,
      warning: fetched.error ?? "product_detail_failed",
    };
  }

  const parsed = parseNutrasourceProductDetail(
    fetched.body,
    catalogRow.productNum,
    catalogRow.detailUrl,
    catalogRow.brandId,
    catalogRow.programsBrandRaw ?? [],
  );
  return {
    ...parsed,
    warning: null,
  };
};

const fetchOverlayMatchRows = async () => {
  const { rows, warning } = await fetchAllPages({
    table: "iherb_overlay_products",
    select: "product_id,barcode_gtin14,brand_name,title,link",
    pageSize: 1000,
  });
  const dedupedRows = Array.from(
    new Map(
      rows.map((row) => [
        `${row?.product_id ?? ""}|${safeText(row?.brand_name)}|${safeText(row?.title)}`,
        row,
      ]),
    ).values(),
  );
  return {
    rows: dedupedRows.map((row) => ({
      product_id: row?.product_id ?? null,
      barcode_gtin14: safeText(row?.barcode_gtin14) || null,
      brand_name: safeText(row?.brand_name) || null,
      title: safeText(row?.title) || null,
      link: safeText(row?.link) || null,
    })),
    warning,
  };
};

const fetchSupplementMatchRows = async () => {
  const rows = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("supplements")
      .select("id,brand_id,barcode,name,brands(name)")
      .range(from, to);
    if (error) throw new Error(`supplements read failed: ${error.message}`);
    const chunk = Array.isArray(data) ? data : [];
    for (const row of chunk) {
      rows.push({
        supplement_id: row?.id ?? null,
        brand_id: row?.brand_id ?? null,
        barcode: safeText(row?.barcode) || null,
        brand_name: safeText(row?.brands?.name) || null,
        name: safeText(row?.name) || null,
      });
    }
    if (chunk.length < pageSize) break;
    from += pageSize;
  }
  return {
    rows: Array.from(
      new Map(
        rows.map((row) => [
          `${row.supplement_id ?? ""}|${row.brand_id ?? ""}|${row.name ?? ""}`,
          row,
        ]),
      ).values(),
    ),
  };
};

const groupByBrand = (rows, brandField) => {
  const map = new Map();
  for (const row of rows) {
    const brandName = safeText(row?.[brandField]);
    if (!brandName) continue;
    const key = normalizeBrandKey(brandName);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
};

const rankCandidatesForMatch = (detailRow, candidates, productField) =>
  candidates
    .map((candidate) => {
      const match = scoreProductNameMatch(
        detailRow.brandName ?? "",
        detailRow.productName,
        safeText(candidate?.[productField]),
      );
      return {
        candidate,
        exact: match.exact,
        highConfidence: match.highConfidence,
        score: match.score,
        sourceCore: match.sourceCore,
        candidateCore: match.candidateCore,
      };
    })
    .sort((left, right) => right.score - left.score || safeText(left.candidate?.[productField]).localeCompare(safeText(right.candidate?.[productField])));

const buildMatchOutcome = ({ detailRow, candidates, productField, shape }) => {
  if (!detailRow.brandName) {
    return {
      matchOutcome: "unmatched",
      matchScore: 0,
      matchedCount: 0,
      candidates: [],
      detailRow,
      ...shape(null),
    };
  }
  const ranked = rankCandidatesForMatch(detailRow, candidates, productField);
  if (ranked.length === 0) {
    return {
      matchOutcome: "unmatched",
      matchScore: 0,
      matchedCount: 0,
      candidates: [],
      detailRow,
      ...shape(null),
    };
  }
  const exactMatches = ranked.filter((row) => row.exact);
  if (exactMatches.length === 1) {
    return {
      matchOutcome: "exact",
      matchScore: 1,
      matchedCount: 1,
      candidates: [],
      detailRow,
      ...shape(exactMatches[0].candidate),
    };
  }
  if (exactMatches.length > 1) {
    return {
      matchOutcome: "ambiguous",
      matchScore: 1,
      matchedCount: exactMatches.length,
      candidates: exactMatches.slice(0, 5).map((row) => shape(row.candidate)),
      detailRow,
      ...shape(null),
    };
  }
  const best = ranked[0];
  const second = ranked[1] ?? null;
  if (best.highConfidence && best.score >= 0.72 && (!second || best.score - second.score >= 0.03)) {
    return {
      matchOutcome: "high_confidence",
      matchScore: best.score,
      matchedCount: 1,
      candidates: [],
      detailRow,
      ...shape(best.candidate),
    };
  }
  if (best.highConfidence) {
    return {
      matchOutcome: "ambiguous",
      matchScore: best.score,
      matchedCount: ranked.filter((row) => row.score >= best.score - 0.03).length,
      candidates: ranked
        .filter((row) => row.score >= best.score - 0.03)
        .slice(0, 5)
        .map((row) => shape(row.candidate)),
      detailRow,
      ...shape(null),
    };
  }
  return {
    matchOutcome: "unmatched",
    matchScore: best.score,
    matchedCount: 0,
    candidates: [],
    detailRow,
    ...shape(null),
  };
};

const summarizeMatchRows = (rows) =>
  sortCounts(
    rows.reduce((acc, row) => {
      increment(acc, row.matchOutcome);
      return acc;
    }, {}),
  );

const candidateShapeFromMatchRow = (row) =>
  "product_id" in row
    ? {
        product_id: row.product_id,
        barcode_gtin14: row.barcode_gtin14,
        link: row.link,
      }
    : {
        supplement_id: row.supplement_id,
        brand_id: row.brand_id,
        barcode: row.barcode,
      };

const clearPrimaryMatchFields = (row) =>
  "product_id" in row
    ? {
        product_id: null,
        barcode_gtin14: null,
        link: null,
      }
    : {
        supplement_id: null,
        brand_id: null,
        barcode: null,
      };

const demoteCollidingMatches = (rows) => {
  const groups = new Map();
  for (const row of rows) {
    if (!["exact", "high_confidence"].includes(row.matchOutcome)) continue;
    const targetId = "product_id" in row ? row.product_id : row.supplement_id;
    if (!targetId) continue;
    if (!groups.has(targetId)) groups.set(targetId, []);
    groups.get(targetId).push(row);
  }

  const collisionIds = new Set(
    Array.from(groups.entries())
      .filter(([, group]) => {
        const productNums = new Set(group.map((row) => row.detailRow.productNum));
        return productNums.size > 1;
      })
      .map(([targetId]) => targetId),
  );

  return rows.map((row) => {
    const targetId = "product_id" in row ? row.product_id : row.supplement_id;
    if (!targetId || !collisionIds.has(targetId) || !["exact", "high_confidence"].includes(row.matchOutcome)) {
      return row;
    }
    const group = groups.get(targetId) ?? [];
    const uniqueCandidates = Array.from(
      new Map(
        group.map((groupRow) => [JSON.stringify(candidateShapeFromMatchRow(groupRow)), candidateShapeFromMatchRow(groupRow)]),
      ).values(),
    );
    return {
      ...row,
      matchOutcome: "ambiguous",
      matchedCount: group.length,
      candidates: uniqueCandidates,
      collisionReason: "shared_target_collision",
      ...clearPrimaryMatchFields(row),
    };
  });
};

const buildPromotionReadySeed = (productDetails, iherbMatches, supplementMatches) => {
  const eligiblePrograms = new Set(["ifos", "igen"]);
  const matchIndex = new Map();
  for (const row of [...iherbMatches, ...supplementMatches]) {
    if (!["exact", "high_confidence"].includes(row.matchOutcome)) continue;
    matchIndex.set(row.detailRow.productNum, row);
  }
  return productDetails
    .filter((row) => row.programsEffective.some((program) => eligiblePrograms.has(program)))
    .filter((row) => matchIndex.has(row.productNum))
    .map((row) => {
      const match = matchIndex.get(row.productNum);
      return {
        productNum: row.productNum,
        brandId: row.brandId,
        brandName: row.brandName,
        productName: row.productName,
        detailUrl: row.detailUrl,
        programsEffective: row.programsEffective.filter((program) => eligiblePrograms.has(program)),
        lotOptions: row.lotOptions,
        matchTarget: "product_id" in (match ?? {}) ? "iherb_overlay" : "supplements",
        matchOutcome: match?.matchOutcome ?? null,
        matchedRecord:
          match && "product_id" in match
            ? {
                product_id: match.product_id,
                barcode_gtin14: match.barcode_gtin14,
                link: match.link,
              }
            : match
              ? {
                  supplement_id: match.supplement_id,
                  brand_id: match.brand_id,
                  barcode: match.barcode,
                }
              : null,
      };
    })
    .sort((a, b) => a.brandName.localeCompare(b.brandName) || a.productName.localeCompare(b.productName));
};

const runAgentBrowserCommand = async (command) => {
  const args = ["-lc", command];
  const options = {
    cwd: ROOT,
    maxBuffer: 8 * 1024 * 1024,
  };
  const { stdout } = await execFile("zsh", args, options);
  return stdout;
};

const buildAgentBrowserPrefix = (session) => `${AGENT_BROWSER_CMD} --session ${JSON.stringify(session)}`;

const validateBrowserUi = async () => {
  const session = `nutrasource-home-${Date.now()}`;
  const prefix = buildAgentBrowserPrefix(session);
  const homeText = await runAgentBrowserCommand(
    `${prefix} open https://certifications.nutrasource.ca/certified-products && ${prefix} wait --load networkidle && ${prefix} get text body`,
  );
  const homeOk =
    /I'm looking for a/i.test(homeText) &&
    /\bBrand\b/i.test(homeText) &&
    /\bProduct\b/i.test(homeText) &&
    /\bSEARCH\b/i.test(homeText);

  const submitScript = `(() => {
    const input = document.querySelector('input[type="search"], input[placeholder*="Search"], input[type="text"]');
    const button = [...document.querySelectorAll('button')].find((node) => /search/i.test(node.textContent || ''));
    if (!input || !button) return 'missing_controls';
    input.value = 'sports research';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    button.click();
    return 'submitted';
  })()`;
  const submitScriptBase64 = Buffer.from(submitScript).toString("base64");

  const submitted = await runAgentBrowserCommand(
    `${prefix} eval -b ${JSON.stringify(submitScriptBase64)}`,
  );
  const afterSearchText = await runAgentBrowserCommand(
    `${prefix} wait --load networkidle && ${prefix} get text body && ${prefix} close`,
  );

  return {
    session,
    homeOk,
    submitResult: submitted.trim(),
    resultOk: /sports research/i.test(afterSearchText),
  };
};

const resolveSampleBrandRows = async () => {
  const sampleGroups = await mapLimit(
    SAMPLE_BRANDS.map((sourceBrandName) => ({ sourceBrandName })),
    3,
    fetchBrandResults,
  );
  return sampleGroups
    .flatMap((group) => group.rows)
    .filter((row) => row.selectedForCrawl && row.brandDetailUrl);
};

const validateBrandPages = async () => {
  const sampleBrandRows = await resolveSampleBrandRows();
  const validations = [];
  for (const brandName of SAMPLE_BRANDS) {
    const match = sampleBrandRows.find(
      (row) => normalizeBrandKey(row.resolvedBrandName ?? "") === normalizeBrandKey(brandName),
    );
    if (!match?.brandDetailUrl) {
      validations.push({ brandName, ok: false, reason: "brand_not_found" });
      continue;
    }
    const session = `nutra-brand-${Date.now()}-${brandName.replace(/[^a-z0-9]+/gi, "-")}`;
    const prefix = buildAgentBrowserPrefix(session);
    const text = await runAgentBrowserCommand(
      `${prefix} open ${JSON.stringify(match.brandDetailUrl)} && ${prefix} wait --load networkidle && ${prefix} get text body && ${prefix} close`,
    );
    validations.push({
      brandName,
      ok: /Brand Products/i.test(text) && text.length > 200,
      brandDetailUrl: match.brandDetailUrl,
    });
  }
  return validations;
};

const validateProductPages = async () => {
  const sampleBrandRows = await resolveSampleBrandRows();
  const sampleCatalogGroups = await mapLimit(sampleBrandRows, 3, fetchBrandCatalogForResult);
  const sampleProductRows = sampleCatalogGroups.flatMap((group) => group.products);
  const validations = [];
  for (const brandName of SAMPLE_BRANDS) {
    const sample = sampleProductRows.find((row) => normalizeBrandKey(row.brandName ?? "") === normalizeBrandKey(brandName));
    if (!sample?.detailUrl) {
      validations.push({ brandName, ok: false, reason: "product_not_found" });
      continue;
    }
    const session = `nutra-product-${Date.now()}-${brandName.replace(/[^a-z0-9]+/gi, "-")}`;
    const prefix = buildAgentBrowserPrefix(session);
    const text = await runAgentBrowserCommand(
      `${prefix} open ${JSON.stringify(sample.detailUrl)} && ${prefix} wait --load networkidle && ${prefix} get text body && ${prefix} close`,
    );
    validations.push({
      brandName,
      ok:
        new RegExp(sample.productName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").slice(0, 24), "i").test(text) &&
        (/Product Summary/i.test(text) || /Certified/i.test(text) || /Testing Results/i.test(text)),
      detailUrl: sample.detailUrl,
    });
  }
  return validations;
};

const buildSummaryMarkdown = (summary) => {
  const lines = [];
  lines.push("# Nutrasource Catalog Closure Summary");
  lines.push("");
  lines.push(`Generated at: ${summary.generatedAt}`);
  lines.push("");
  lines.push("## Totals");
  lines.push(`- Input brands: ${summary.inputBrandCount}`);
  lines.push(`- Nutrasource found brands: ${summary.foundBrandCount}`);
  lines.push(`- Crawled brand pages: ${summary.crawledBrandPageCount}`);
  lines.push(`- Enumerated products: ${summary.productCatalogCount}`);
  lines.push(`- Product detail fetched: ${summary.productDetailFetchedCount}`);
  lines.push("");
  lines.push("## Match Outcomes");
  lines.push("- iHerb overlay");
  for (const [key, value] of Object.entries(summary.iherbOverlayMatchCounts)) lines.push(`  - ${key}: ${value}`);
  lines.push("- Supabase supplements");
  for (const [key, value] of Object.entries(summary.supabaseCatalogMatchCounts)) lines.push(`  - ${key}: ${value}`);
  lines.push("");
  lines.push("## Programs");
  lines.push(`- Promotion-ready IFOS/iGEN rows: ${summary.promotionReadyCount}`);
  lines.push(`- Raw-only unsupported-program rows: ${summary.rawOnlyCount}`);
  lines.push("");
  lines.push("## Browser Validation");
  lines.push(`- Home UI validation: ${summary.browserValidation.homeUiOk ? "pass" : "fail"}`);
  lines.push(`- Brand page validation pass count: ${summary.browserValidation.brandPagePassCount}`);
  lines.push(`- Product detail validation pass count: ${summary.browserValidation.productPagePassCount}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const dbBrandSeed = await buildDbBrandSeed();
  const dbBrandSeedPath = path.join(OUT_DIR, "db_brand_seed.json");
  await writeJson(dbBrandSeedPath, dbBrandSeed);

  const brandResultGroups = await mapLimit(dbBrandSeed.rows, BRAND_CONCURRENCY, fetchBrandResults);
  const nutrasourceBrandResults = {
    schemaVersion: "nutrasource_brand_results.v1",
    generatedAt: nowIso(),
    rows: brandResultGroups.flatMap((group) => group.rows),
  };
  const brandResultsPath = path.join(OUT_DIR, "nutrasource_brand_results.json");
  await writeJson(brandResultsPath, nutrasourceBrandResults);

  const selectedBrandResults = nutrasourceBrandResults.rows.filter((row) => row.selectedForCrawl && row.brandId);
  const brandCatalogGroups = await mapLimit(selectedBrandResults, BRAND_CONCURRENCY, fetchBrandCatalogForResult);
  const nutrasourceProductCatalog = {
    schemaVersion: "nutrasource_product_catalog.v1",
    generatedAt: nowIso(),
    rows: brandCatalogGroups.flatMap((group) => group.products),
  };
  const productCatalogPath = path.join(OUT_DIR, "nutrasource_product_catalog.json");
  await writeJson(productCatalogPath, nutrasourceProductCatalog);

  const dedupedCatalogRows = Array.from(
    new Map(nutrasourceProductCatalog.rows.map((row) => [row.productNum, row])).values(),
  );
  const productDetailsRows = await mapLimit(dedupedCatalogRows, DETAIL_CONCURRENCY, fetchProductDetailRecord);
  const nutrasourceProductDetails = {
    schemaVersion: "nutrasource_product_details.v1",
    generatedAt: nowIso(),
    rows: productDetailsRows,
  };
  const productDetailsPath = path.join(OUT_DIR, "nutrasource_product_details.json");
  await writeJson(productDetailsPath, nutrasourceProductDetails);

  const [overlayMatchesSource, supplementMatchesSource] = await Promise.all([
    fetchOverlayMatchRows(),
    fetchSupplementMatchRows(),
  ]);

  const overlayByBrand = groupByBrand(overlayMatchesSource.rows, "brand_name");
  const supplementsByBrand = groupByBrand(supplementMatchesSource.rows, "brand_name");

  const rawMatchIherbOverlayRows = productDetailsRows.map((detailRow) =>
    buildMatchOutcome({
      detailRow,
      candidates: overlayByBrand.get(normalizeBrandKey(detailRow.brandName ?? "")) ?? [],
      productField: "title",
      shape: (candidate) =>
        candidate
          ? {
              product_id: candidate.product_id,
              barcode_gtin14: candidate.barcode_gtin14,
              link: candidate.link,
            }
          : {
              product_id: null,
              barcode_gtin14: null,
              link: null,
            },
    }),
  );
  const rawMatchSupabaseCatalogRows = productDetailsRows.map((detailRow) =>
    buildMatchOutcome({
      detailRow,
      candidates: supplementsByBrand.get(normalizeBrandKey(detailRow.brandName ?? "")) ?? [],
      productField: "name",
      shape: (candidate) =>
        candidate
          ? {
              supplement_id: candidate.supplement_id,
              brand_id: candidate.brand_id,
              barcode: candidate.barcode,
            }
          : {
              supplement_id: null,
              brand_id: null,
              barcode: null,
            },
    }),
  );

  const matchIherbOverlayRows = demoteCollidingMatches(rawMatchIherbOverlayRows);
  const matchSupabaseCatalogRows = demoteCollidingMatches(rawMatchSupabaseCatalogRows);

  const matchIherbOverlay = {
    schemaVersion: "nutrasource_match_iherb_overlay.v1",
    generatedAt: nowIso(),
    rows: matchIherbOverlayRows,
  };
  const matchSupabaseCatalog = {
    schemaVersion: "nutrasource_match_supabase_catalog.v1",
    generatedAt: nowIso(),
    rows: matchSupabaseCatalogRows,
  };

  const matchIherbOverlayPath = path.join(OUT_DIR, "match_iherb_overlay.json");
  const matchSupabaseCatalogPath = path.join(OUT_DIR, "match_supabase_catalog.json");
  await writeJson(matchIherbOverlayPath, matchIherbOverlay);
  await writeJson(matchSupabaseCatalogPath, matchSupabaseCatalog);

  const promotionReadySeedRows = buildPromotionReadySeed(
    productDetailsRows,
    matchIherbOverlayRows,
    matchSupabaseCatalogRows,
  );
  const promotionReadySeed = {
    schemaVersion: "nutrasource_promotion_ready_seed.v1",
    generatedAt: nowIso(),
    rows: promotionReadySeedRows,
  };
  const promotionReadySeedPath = path.join(OUT_DIR, "promotion_ready_seed.json");
  await writeJson(promotionReadySeedPath, promotionReadySeed);

  const browserHomeValidation = await validateBrowserUi();
  const browserBrandValidations = await validateBrandPages();
  const browserProductValidations = await validateProductPages();
  const browserValidation = {
    schemaVersion: "nutrasource_browser_validation.v1",
    generatedAt: nowIso(),
    homeUi: browserHomeValidation,
    brandPages: browserBrandValidations,
    productPages: browserProductValidations,
  };
  const browserValidationPath = path.join(OUT_DIR, "browser_validation.json");
  await writeJson(browserValidationPath, browserValidation);

  const rawOnlyCount = productDetailsRows.filter(
    (row) => row.programsEffective.length > 0 && !row.programsEffective.some((program) => ["ifos", "igen"].includes(program)),
  ).length;

  const summary = {
    schemaVersion: "nutrasource_catalog_closure_summary.v1",
    generatedAt: nowIso(),
    inputs: {
      outputDir: OUT_DIR,
      brandLimit: BRAND_LIMIT,
      brandInclude: BRAND_INCLUDE,
      brandConcurrency: BRAND_CONCURRENCY,
      detailConcurrency: DETAIL_CONCURRENCY,
    },
    inputBrandCount: dbBrandSeed.rows.length,
    foundBrandCount: new Set(
      nutrasourceBrandResults.rows.filter((row) => row.found).map((row) => row.sourceBrandName),
    ).size,
    crawledBrandPageCount: selectedBrandResults.length,
    productCatalogCount: nutrasourceProductCatalog.rows.length,
    productDetailFetchedCount: productDetailsRows.filter((row) => row.pageFetched).length,
    iherbOverlayMatchCounts: summarizeMatchRows(matchIherbOverlayRows),
    supabaseCatalogMatchCounts: summarizeMatchRows(matchSupabaseCatalogRows),
    promotionReadyCount: promotionReadySeedRows.length,
    rawOnlyCount,
    browserValidation: {
      homeUiOk: browserHomeValidation.homeOk && browserHomeValidation.resultOk,
      brandPagePassCount: browserBrandValidations.filter((row) => row.ok).length,
      productPagePassCount: browserProductValidations.filter((row) => row.ok).length,
    },
    outputs: {
      dbBrandSeedPath,
      brandResultsPath,
      productCatalogPath,
      productDetailsPath,
      matchIherbOverlayPath,
      matchSupabaseCatalogPath,
      promotionReadySeedPath,
      browserValidationPath,
    },
  };

  const summaryJsonPath = path.join(OUT_DIR, "summary.json");
  const summaryMdPath = path.join(OUT_DIR, "summary.md");
  await writeJson(summaryJsonPath, summary);
  await writeText(summaryMdPath, buildSummaryMarkdown(summary));

  console.log(
    JSON.stringify(
      {
        ok: true,
        outDir: OUT_DIR,
        inputBrandCount: summary.inputBrandCount,
        foundBrandCount: summary.foundBrandCount,
        productCatalogCount: summary.productCatalogCount,
        productDetailFetchedCount: summary.productDetailFetchedCount,
        promotionReadyCount: summary.promotionReadyCount,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
