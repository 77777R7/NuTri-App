#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const readJson = async (filePath) => JSON.parse(await fs.readFile(path.resolve(ROOT, filePath), "utf8"));
const writeJson = async (filePath, value) =>
  fs.writeFile(path.resolve(ROOT, filePath), `${JSON.stringify(value, null, 2)}\n`, "utf8");

const BASE_STAGING_JSON = getArg(
  "base-staging-json",
  path.join(ROOT, "output", "p0_p3_official_bootstrap_pure_encapsulations_active38_20260317", "staging_products.official_refreshed.json"),
);
const OUT_DIR = getArg("out-dir", path.join(ROOT, "output", "p0_p3_v1_strict_only_merge_cohort_20260318"));
const CANARY_SIZE = Number(getArg("canary-size", "2000")) || 2000;
const BATCH2_SIZE = Number(getArg("batch2-size", "10000")) || 10000;

const OVERRIDE_STAGING_SLICES = [
  {
    path: path.join(
      ROOT,
      "output",
      "p0_p3_codeage_remaining_six_closure_20260317",
      "unified_wave",
      "staging_products.official_refreshed.sanitized.json",
    ),
    productIds: new Set(["121637", "157265", "143300", "157271", "146937", "152821"]),
    label: "codeage_remaining_six_sanitized",
  },
  {
    path: path.join(
      ROOT,
      "output",
      "p0_p3_codeage_urolithin_official_recovery_clean_20260317",
      "staging_products.official_refreshed.json",
    ),
    productIds: new Set(["126291"]),
    label: "codeage_urolithin_clean",
  },
];

const EXCLUDED_CATEGORY_REGEX =
  /(pet|dog|cat|sheet mask|mask|serum|lotion|cream|shampoo|conditioner|cleanser|soap|toothpaste|deodorant|skin care|k-beauty|body care|bath|beauty|fragrance|home|cleaners|disinfect|makeup|nail|hair color|facial|eye care|oral care|baby food|pouches, purees & meals|packaged & prepared foods|tea & beverages|tea|coffee|food|snacks|beans & lentils)/i;
const EXCLUDED_TITLE_REGEX =
  /(for dogs|for cats|dog chews|cat chews|sheet mask|serum|lotion|shampoo|conditioner|toothpaste|deodorant|hand soap|eye mask)/i;
const SUPPLEMENT_FACT_HEADER_PATTERNS = new Set([
  "amount per serving %daily value",
  "amount per serving % daily value",
  "one capsule contains % dv",
]);

const normalizeText = (value) =>
  String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeLower = (value) => normalizeText(value).toLowerCase();

const looksLikeStructuredSupplementFacts = (row) => {
  const facts = Array.isArray(row?.supplementFacts?.nutritionalFacts) ? row.supplementFacts.nutritionalFacts : [];
  let goodFacts = 0;
  for (const fact of facts) {
    const substancy = normalizeLower(fact?.substancy);
    const amount = normalizeLower(fact?.amountPerServing);
    const dailyValue = normalizeLower(fact?.dailyValuePercent);
    const joined = normalizeText(`${substancy} ${amount} ${dailyValue}`).toLowerCase();
    if (!joined || SUPPLEMENT_FACT_HEADER_PATTERNS.has(joined)) continue;
    if (
      substancy ||
      /(mg|mcg|g|iu|cfu|afu|kcal|calories|billion|million|tbsp|tsp|gummies|capsule|softgel|tablet)/i.test(joined)
    ) {
      goodFacts += 1;
    }
  }
  return goodFacts > 0;
};

const isStrictReady = (row) =>
  normalizeText(row?.completeness?.status) === "full_overlay_ready" &&
  Boolean(row?.sourceSummary?.hasUsIherbPage) &&
  !Boolean(row?.sourceSummary?.npnIgnored);

const classifyV1Decision = (row) => {
  if (!isStrictReady(row)) return { include: false, reason: "not_strict_ready" };
  const title = normalizeText(row?.title);
  const categories = Array.isArray(row?.categories) ? row.categories.join(" | ") : "";
  if (EXCLUDED_TITLE_REGEX.test(title)) return { include: false, reason: "excluded_title_signal" };
  if (EXCLUDED_CATEGORY_REGEX.test(categories)) return { include: false, reason: "excluded_category_signal" };
  if (!looksLikeStructuredSupplementFacts(row)) return { include: false, reason: "missing_structured_supplement_facts" };
  return { include: true, reason: "v1_supplement_strict_ready" };
};

const sortRows = (rows) =>
  [...rows].sort((a, b) => {
    const brandCmp = normalizeLower(a?.brandName).localeCompare(normalizeLower(b?.brandName));
    if (brandCmp !== 0) return brandCmp;
    const titleCmp = normalizeLower(a?.title).localeCompare(normalizeLower(b?.title));
    if (titleCmp !== 0) return titleCmp;
    return normalizeLower(a?.productId).localeCompare(normalizeLower(b?.productId));
  });

const buildRoundRobinSlice = (rows, limit) => {
  const groups = new Map();
  for (const row of sortRows(rows)) {
    const key = normalizeText(row?.brandName) || "unknown";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const brands = [...groups.keys()].sort((a, b) => a.localeCompare(b));
  const selected = [];
  let offset = 0;
  while (selected.length < limit) {
    let progressed = false;
    for (const brand of brands) {
      const group = groups.get(brand) ?? [];
      if (offset < group.length) {
        selected.push(group[offset]);
        progressed = true;
        if (selected.length >= limit) break;
      }
    }
    if (!progressed) break;
    offset += 1;
  }
  return selected;
};

const buildBrandHistogram = (rows) => {
  const histogram = new Map();
  for (const row of rows) {
    const brand = normalizeText(row?.brandName) || "unknown";
    histogram.set(brand, (histogram.get(brand) ?? 0) + 1);
  }
  return [...histogram.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([brandName, count]) => ({ brandName, count }));
};

const makeStagingPayload = (rows, metadata = {}) => ({
  schemaVersion: "v1_strict_only_merge_cohort.v1",
  generatedAt: new Date().toISOString(),
  metadata,
  products: rows,
});

const main = async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const base = await readJson(BASE_STAGING_JSON);
  const baseProducts = Array.isArray(base?.products) ? base.products : [];
  const productMap = new Map(
    baseProducts
      .filter((row) => normalizeText(row?.productId))
      .map((row) => [normalizeText(row.productId), row]),
  );

  const appliedOverrides = [];
  for (const override of OVERRIDE_STAGING_SLICES) {
    const payload = await readJson(override.path);
    for (const row of Array.isArray(payload?.products) ? payload.products : []) {
      const productId = normalizeText(row?.productId);
      if (!productId || !override.productIds.has(productId)) continue;
      productMap.set(productId, row);
      appliedOverrides.push({
        label: override.label,
        path: override.path,
        productId,
        title: row?.title ?? null,
      });
    }
  }

  const mergedRows = sortRows([...productMap.values()]);
  const strictRows = mergedRows.filter((row) => isStrictReady(row));

  const included = [];
  const excluded = [];
  for (const row of strictRows) {
    const decision = classifyV1Decision(row);
    if (decision.include) {
      included.push(row);
    } else {
      excluded.push({
        productId: normalizeText(row?.productId) || null,
        brandName: normalizeText(row?.brandName) || null,
        title: normalizeText(row?.title) || null,
        dosageForm: normalizeText(row?.dosageForm) || null,
        categories: Array.isArray(row?.categories) ? row.categories : [],
        reason: decision.reason,
      });
    }
  }

  const canaryRows = buildRoundRobinSlice(included, Math.min(CANARY_SIZE, included.length));
  const canaryIds = new Set(canaryRows.map((row) => normalizeText(row?.productId)));
  const remainingAfterCanary = included.filter((row) => !canaryIds.has(normalizeText(row?.productId)));
  const batch2Rows = buildRoundRobinSlice(remainingAfterCanary, Math.min(BATCH2_SIZE, remainingAfterCanary.length));
  const batch2Ids = new Set(batch2Rows.map((row) => normalizeText(row?.productId)));
  const remainderRows = remainingAfterCanary.filter((row) => !batch2Ids.has(normalizeText(row?.productId)));

  const fullOut = path.join(OUT_DIR, "v1_strict_only_full_staging.json");
  const canaryOut = path.join(OUT_DIR, `v1_strict_only_canary_${canaryRows.length}_staging.json`);
  const batch2Out = path.join(OUT_DIR, `v1_strict_only_batch2_${batch2Rows.length}_staging.json`);
  const remainderOut = path.join(OUT_DIR, `v1_strict_only_remainder_${remainderRows.length}_staging.json`);
  const idsOut = path.join(OUT_DIR, "v1_strict_only_product_ids.json");
  const excludedOut = path.join(OUT_DIR, "v1_strict_only_excluded_rows.json");
  const summaryOut = path.join(OUT_DIR, "v1_strict_only_merge_cohort_summary.json");

  await Promise.all([
    writeJson(
      fullOut,
      makeStagingPayload(included, {
        cohortType: "v1_strict_only_full",
        baseStagingJson: BASE_STAGING_JSON,
        appliedOverrides,
      }),
    ),
    writeJson(
      canaryOut,
      makeStagingPayload(canaryRows, {
        cohortType: "v1_strict_only_canary",
        baseStagingJson: BASE_STAGING_JSON,
        parentCohortPath: fullOut,
        appliedOverrides,
      }),
    ),
    writeJson(
      batch2Out,
      makeStagingPayload(batch2Rows, {
        cohortType: "v1_strict_only_batch2",
        baseStagingJson: BASE_STAGING_JSON,
        parentCohortPath: fullOut,
        appliedOverrides,
      }),
    ),
    writeJson(
      remainderOut,
      makeStagingPayload(remainderRows, {
        cohortType: "v1_strict_only_remainder",
        baseStagingJson: BASE_STAGING_JSON,
        parentCohortPath: fullOut,
        appliedOverrides,
      }),
    ),
    writeJson(idsOut, {
      generatedAt: new Date().toISOString(),
      productIds: included.map((row) => normalizeText(row?.productId)).filter(Boolean),
    }),
    writeJson(excludedOut, {
      generatedAt: new Date().toISOString(),
      count: excluded.length,
      rows: excluded,
    }),
  ]);

  const exclusionReasonCounts = excluded.reduce((acc, row) => {
    acc[row.reason] = (acc[row.reason] ?? 0) + 1;
    return acc;
  }, {});

  const summary = {
    generatedAt: new Date().toISOString(),
    objective: "Produce a V1 strict-only supplement merge cohort plus deterministic canary/batch slices.",
    baseStagingJson: BASE_STAGING_JSON,
    appliedOverrides,
    counts: {
      mergedBaseRows: mergedRows.length,
      strictReadyRows: strictRows.length,
      v1StrictOnlyRows: included.length,
      excludedFromStrictReady: excluded.length,
      canaryRows: canaryRows.length,
      batch2Rows: batch2Rows.length,
      remainderRows: remainderRows.length,
    },
    exclusionReasonCounts,
    topBrands: buildBrandHistogram(included).slice(0, 50),
    outputs: {
      fullStagingJson: fullOut,
      canaryStagingJson: canaryOut,
      batch2StagingJson: batch2Out,
      remainderStagingJson: remainderOut,
      productIdsJson: idsOut,
      excludedRowsJson: excludedOut,
    },
    policy: {
      includeOnly: [
        "full_overlay_ready",
        "hasUsIherbPage=true",
        "npnIgnored=false",
        "structured supplement facts present",
      ],
      excludeSignals: [
        "pet/dog/cat",
        "skin-care/topical/body-care",
        "soap/cleanser/toothpaste/deodorant",
        "food/snack/tea/packaged-meal style categories",
      ],
    },
  };
  await writeJson(summaryOut, summary);

  console.log(
    JSON.stringify(
      {
        ok: true,
        summary,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
