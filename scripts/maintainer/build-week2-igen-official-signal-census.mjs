#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const TODAY = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const STAGING_PATH = getArg(
  "staging",
  path.join(ROOT, "output", "iherb_header_facts_week2_closure_v2_20260313", "staging_products.parser_enriched.json"),
);
const MERGE_REPORT_PATH = getArg(
  "merge-report",
  path.join(ROOT, "output", "iherb_overlay_bulk_merge_week2_final_unified_20260313", "overlay_merge_coverage_report.json"),
);
const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", "quality_marks", `week2_igen_official_signal_census_${TODAY}`),
);
const OUT_JSON = getArg("out-json", path.join(OUT_DIR, "igen_official_signal_census.json"));
const OUT_MD = getArg("out-md", path.join(OUT_DIR, "igen_official_signal_census.md"));
const SAMPLE_LIMIT = Math.max(1, Number(getArg("sample-limit", "12")) || 12);
const LOG_EVERY = Math.max(100, Number(getArg("log-every", "1000")) || 1000);

const { compileDecisionSupport } = await import("../../backend/src/decisionSupport.ts");
const {
  buildFactsDigestFromWeb,
  computeFactsDigestHash,
} = await import("../../backend/src/factsDigest.ts");
const {
  normalizeIherbSupplementFactsRows,
} = await import("../../backend/src/iherbOverlayIngredients.ts");

const readJson = async (targetPath) => JSON.parse(await fs.readFile(targetPath, "utf8"));
const safeText = (value) => String(value ?? "").trim();
const hasText = (value) => safeText(value).length > 0;
const nowIso = () => new Date().toISOString();

const toObjectRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};

const readSectionText = (sections, keys) => {
  for (const key of keys) {
    const value = sections[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
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

const toOverlayClaims = (row) => {
  const descriptionSections = toObjectRecord(row.descriptionSections);
  const supplementFacts = toObjectRecord(row.supplementFacts);
  const nutritionalFactsRaw = Array.isArray(supplementFacts.nutritionalFacts)
    ? supplementFacts.nutritionalFacts
    : [];

  return {
    provider: "iherb",
    productId: hasText(row.productId) ? String(row.productId) : null,
    brandName: hasText(row.brandName) ? String(row.brandName) : null,
    title: hasText(row.title) ? String(row.title) : null,
    link: hasText(row.link) ? String(row.link) : null,
    categories: Array.isArray(row.categories)
      ? row.categories.map((item) => safeText(item)).filter(Boolean)
      : [],
    description: readSectionText(descriptionSections, ["Description"]),
    suggestedUse: readSectionText(descriptionSections, ["Suggested use", "Suggested Use", "Suggested usage"]),
    otherIngredients: readSectionText(descriptionSections, ["Other ingredients", "Other Ingredients"]),
    warnings: readSectionText(descriptionSections, ["Warnings", "Warning"]),
    disclaimer: readSectionText(descriptionSections, ["Disclaimer"]),
    nutritionalFacts: nutritionalFactsRaw
      .map((item) => ({
        substancy: safeText(item?.substancy ?? item?.substance ?? item?.substance_name ?? item?.name),
        amountPerServing: safeText(item?.amountPerServing ?? item?.amount_per_serving ?? item?.amount),
        dailyValuePercent: safeText(item?.dailyValuePercent ?? item?.daily_value_percent ?? item?.dailyValue) || null,
      }))
      .filter((item) => item.substancy || item.amountPerServing || item.dailyValuePercent),
  };
};

const toIngredientsText = (overlayClaims) =>
  normalizeIherbSupplementFactsRows(overlayClaims?.nutritionalFacts)
    .map((row) => [safeText(row?.name), safeText(row?.dose)].filter(Boolean).join(" "))
    .filter(Boolean)
    .join("\n");

const toFactsDigest = (row, overlayClaims) => {
  const serving = toObjectRecord(row.serving);
  const supplementFacts = toObjectRecord(row.supplementFacts);
  const digest = buildFactsDigestFromWeb({
    facts: {
      barcode: safeText(row.barcode_gtin14),
      canonical: {
        name: hasText(row.title) ? String(row.title) : null,
        brand: hasText(row.brandName) ? String(row.brandName) : null,
        url: hasText(row.link) ? String(row.link) : null,
        domain: "iherb.com",
      },
      identifiers: { npn: null },
      textFacts: {
        ingredientsText: toIngredientsText(overlayClaims) || null,
        directionsText: overlayClaims?.suggestedUse ?? null,
        warningsText: overlayClaims?.warnings ?? null,
        servingSizeText:
          safeText(supplementFacts.servingSize) ||
          safeText(serving.servingSize) ||
          null,
      },
      coverageScore: 1,
      missingFields: [],
    },
    identityType: "gtin14",
    identityValue: safeText(row.barcode_gtin14),
    regionTags: ["us"],
  });

  digest.product.dosageForm =
    safeText(row.dosageForm) && safeText(row.dosageForm).toLowerCase() !== "n/a"
      ? safeText(row.dosageForm)
      : digest.product.dosageForm;
  digest.product.route = null;
  return digest;
};

const classifyIgenSignal = (payload) => {
  const matches = (Array.isArray(payload?.qualityMark?.programMatches) ? payload.qualityMark.programMatches : [])
    .filter((match) => safeText(match?.programId).toLowerCase() === "igen")
    .filter((match) => safeText(match?.evidenceType).toLowerCase() === "official_registry");

  const productLevel = matches.find(
    (match) =>
      safeText(match?.status) === "verified_registry_match" &&
      Boolean(match?.brandMatched) &&
      Boolean(match?.productMatched),
  );
  if (productLevel) return "product_level_official_signal";

  const brandLevelOnly = matches.find(
    (match) =>
      safeText(match?.status) === "ambiguous_match" &&
      safeText(match?.matchLevel) === "brand" &&
      Boolean(match?.brandMatched) &&
      !Boolean(match?.productMatched),
  );
  if (brandLevelOnly) return "brand_level_only_signal";

  const checkedNotFound = matches.find((match) => safeText(match?.status) === "not_found_in_registry");
  if (checkedNotFound) return "checked_not_found";

  const otherSignal = matches.find(Boolean);
  if (otherSignal) return "other_official_signal";

  return "no_official_signal";
};

const buildSample = ({ row, payload, bucket }) => ({
  bucket,
  productId: row?.productId ? String(row.productId) : null,
  barcode: row?.barcode_gtin14 ? String(row.barcode_gtin14) : null,
  brandName: row?.brandName ?? null,
  productName: row?.title ?? null,
  iherbUrl: row?.link ?? null,
  qualityMarkStatus: payload?.qualityMark?.status ?? null,
  verificationSummary: payload?.qualityMark?.verificationSummary ?? null,
  programMatches: Array.isArray(payload?.qualityMark?.programMatches) ? payload.qualityMark.programMatches : [],
});

const toMarkdown = (report) => {
  const lines = [];
  lines.push("# Week 2 iGEN Official Signal Census");
  lines.push("");
  lines.push(`Generated at: ${report.generatedAt}`);
  lines.push(`Staging path: ${report.inputs.stagingPath}`);
  lines.push(`Merge report path: ${report.inputs.mergeReportPath}`);
  lines.push("");
  lines.push("## Scope");
  lines.push("");
  lines.push(`- matched/imported products: ${report.summary.importedMatchedTotal}`);
  lines.push(`- compile errors: ${report.summary.errorCount}`);
  lines.push(`- iGEN official-signal checked: ${report.summary.igenSignalChecked}`);
  lines.push("");
  lines.push("## Buckets");
  lines.push("");
  for (const [bucket, count] of Object.entries(report.bucketCounts)) {
    lines.push(`- ${bucket}: ${count}`);
  }
  lines.push("");
  lines.push("## Samples");
  lines.push("");
  for (const [bucket, rows] of Object.entries(report.samples)) {
    lines.push(`### ${bucket}`);
    for (const row of rows) {
      lines.push(`- ${row.brandName} | ${row.productName} | ${row.iherbUrl ?? "no-url"}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const [stagingPayload, mergePayload] = await Promise.all([
    readJson(STAGING_PATH),
    readJson(MERGE_REPORT_PATH),
  ]);

  const products = Array.isArray(stagingPayload?.products) ? stagingPayload.products : [];
  const matchedIds = new Set(
    (Array.isArray(mergePayload?.rows) ? mergePayload.rows : [])
      .filter((row) => row?.mergeDecision === "matched")
      .map((row) => String(row?.productId ?? "")),
  );
  const imported = products.filter((row) => matchedIds.has(String(row?.productId ?? "")));

  const bucketCounts = {};
  const warningCounts = {};
  const strongestProgramCounts = {};
  const samples = {
    product_level_official_signal: [],
    brand_level_only_signal: [],
    checked_not_found: [],
    other_official_signal: [],
    no_official_signal: [],
  };
  let errorCount = 0;
  let igenSignalChecked = 0;

  for (let index = 0; index < imported.length; index += 1) {
    const row = imported[index];
    try {
      const overlayClaims = toOverlayClaims(row);
      const digest = toFactsDigest(row, overlayClaims);
      const payload = compileDecisionSupport({
        digest,
        factsDigestHash: computeFactsDigestHash(digest),
        viewMode: "details",
        locale: "en",
        flagsSnapshot: null,
        patchActivation: null,
        overlayClaims,
      });

      const bucket = classifyIgenSignal(payload);
      increment(bucketCounts, bucket);
      if (bucket !== "no_official_signal") igenSignalChecked += 1;
      const strongestProgramLabel = payload?.qualityMark?.verificationSummary?.strongestProgramLabel;
      if (strongestProgramLabel) increment(strongestProgramCounts, strongestProgramLabel);
      for (const warning of payload?.qualityMark?.verificationSummary?.warnings ?? []) increment(warningCounts, warning);
      if (samples[bucket].length < SAMPLE_LIMIT) {
        samples[bucket].push(buildSample({ row, payload, bucket }));
      }
    } catch (error) {
      errorCount += 1;
      increment(bucketCounts, "error");
      if (samples.no_official_signal.length < SAMPLE_LIMIT) {
        samples.no_official_signal.push({
          bucket: "error",
          productId: row?.productId ? String(row.productId) : null,
          barcode: row?.barcode_gtin14 ? String(row.barcode_gtin14) : null,
          brandName: row?.brandName ?? null,
          productName: row?.title ?? null,
          iherbUrl: row?.link ?? null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const processed = index + 1;
    if (processed % LOG_EVERY === 0 || processed === imported.length) {
      console.log(
        JSON.stringify(
          {
            phase: "week2_igen_official_signal_census",
            processed,
            total: imported.length,
          },
          null,
          2,
        ),
      );
    }
  }

  const report = {
    schemaVersion: "week2_igen_official_signal_census.v1",
    generatedAt: nowIso(),
    inputs: {
      stagingPath: STAGING_PATH,
      mergeReportPath: MERGE_REPORT_PATH,
    },
    summary: {
      importedMatchedTotal: imported.length,
      errorCount,
      igenSignalChecked,
    },
    bucketCounts: sortCounts(bucketCounts),
    strongestProgramCounts: sortCounts(strongestProgramCounts),
    warningCounts: sortCounts(warningCounts),
    samples,
  };

  await fs.writeFile(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(OUT_MD, toMarkdown(report), "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        importedMatchedTotal: imported.length,
        igenSignalChecked,
        outJson: OUT_JSON,
        outMd: OUT_MD,
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
