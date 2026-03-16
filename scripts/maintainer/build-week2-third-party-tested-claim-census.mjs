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
  path.join(ROOT, "output", `iherb_third_party_tested_claim_census_week2_final_unified_${TODAY}`),
);
const OUT_JSON = getArg("out-json", path.join(OUT_DIR, "third_party_tested_claim_census.json"));
const OUT_MD = getArg("out-md", path.join(OUT_DIR, "third_party_tested_claim_census.md"));
const SAMPLE_LIMIT = Math.max(1, Number(getArg("sample-limit", "12")) || 12);
const LOG_EVERY = Math.max(100, Number(getArg("log-every", "1000")) || 1000);

const {
  compileDecisionSupport,
} = await import("../../backend/src/decisionSupport.ts");
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

const pct = (part, total) => (total > 0 ? Number(((part / total) * 100).toFixed(1)) : 0);

const classifyThirdPartyBucket = ({ thirdPartyItem, verificationSummary }) => {
  const warnings = verificationSummary?.warnings ?? [];
  if (verificationSummary?.officialRegistryVerified) return "verified";
  if (warnings.includes("registry_access_blocked")) {
    return "registry_blocked";
  }
  if (
    verificationSummary?.brandLevelOfficialProgramDetected &&
    !verificationSummary?.genericThirdPartyClaimDetected
  ) {
    return "brand_level_program_signal_only";
  }
  if (
    thirdPartyItem?.state === "verified" ||
    verificationSummary?.overallStatus === "claimed" ||
    verificationSummary?.productPageClaimDetected ||
    verificationSummary?.catalogClaimDetected ||
    verificationSummary?.genericThirdPartyClaimDetected
  ) {
    return "claimed";
  }
  return "not_proven";
};

const buildSample = ({ row, payload, thirdPartyItem, bucket }) => ({
  bucket,
  productId: row?.productId ? String(row.productId) : null,
  barcode: row?.barcode_gtin14 ? String(row.barcode_gtin14) : null,
  brandName: row?.brandName ?? null,
  productName: row?.title ?? null,
  iherbUrl: row?.link ?? null,
  categoryId: payload?.categoryId ?? null,
  thirdPartyChecklistState: thirdPartyItem?.state ?? null,
  overallScore: payload?.nutriScoreCardV2?.overallScore ?? null,
  overallBand: payload?.nutriScoreCardV2?.overallBand ?? null,
  verificationSummary: payload?.qualityMark?.verificationSummary ?? null,
  qualityMarkStatus: payload?.qualityMark?.status ?? null,
  qualityMarkChecked: Boolean(payload?.qualityMark?.checked),
  qualityMarkEvidenceRef: payload?.qualityMark?.evidenceRef ?? null,
  extraTrustSignals: Array.isArray(payload?.extraTrustSignals)
    ? payload.extraTrustSignals.map((signal) => ({
        code: signal?.code ?? null,
        status: signal?.status ?? null,
        note: signal?.note ?? null,
      }))
    : [],
});

const buildMarkdown = (report) => {
  const lines = [];
  lines.push("# Week 2 NuTri Score Third-Party Tested Claim Census");
  lines.push("");
  lines.push(`Generated at: ${report.generatedAt}`);
  lines.push(`Staging path: ${report.inputs.stagingPath}`);
  lines.push(`Merge report path: ${report.inputs.mergeReportPath}`);
  lines.push("");
  lines.push("## Scope");
  lines.push("");
  lines.push(`- matched/imported products: ${report.summary.importedMatchedTotal}`);
  lines.push(`- decision support compile errors: ${report.summary.errorCount}`);
  lines.push(`- quality-mark registry checked subset: ${report.summary.officialRegistryChecked}`);
  lines.push("");
  lines.push("## Bucket Definitions");
  lines.push("");
  lines.push("- `verified`: product-level official registry verification exists.");
  lines.push("- `claimed`: third-party claim is present in the current NuTri Score path, but not officially product-verified.");
  lines.push("- `brand_level_program_signal_only`: official program evidence exists only at brand level, not product level.");
  lines.push("- `registry_blocked`: official registry check was blocked and there is no stronger claim/program evidence.");
  lines.push("- `not_proven`: no claim/program evidence is currently proven under the latest Week 2 path.");
  lines.push("");
  lines.push("## Bucket Counts");
  lines.push("");
  for (const [bucket, count] of Object.entries(report.bucketCounts)) {
    lines.push(`- ${bucket}: ${count} (${report.bucketPercents[bucket]}%)`);
  }
  lines.push("");
  lines.push("## Third-Party Checklist States");
  lines.push("");
  for (const [state, count] of Object.entries(report.thirdPartyChecklistStateCounts)) {
    lines.push(`- ${state}: ${count}`);
  }
  lines.push("");
  lines.push("## Summary Status");
  lines.push("");
  for (const [state, count] of Object.entries(report.verificationSummaryStatusCounts)) {
    lines.push(`- ${state}: ${count}`);
  }
  lines.push("");
  lines.push("## Warning Overlaps");
  lines.push("");
  for (const [warning, count] of Object.entries(report.warningCounts)) {
    lines.push(`- ${warning}: ${count}`);
  }
  lines.push("");
  lines.push("## Samples");
  lines.push("");
  for (const bucket of report.bucketOrder) {
    lines.push(`### ${bucket}`);
    lines.push("");
    const rows = report.samples[bucket] ?? [];
    if (rows.length === 0) {
      lines.push("- none");
      lines.push("");
      continue;
    }
    for (const row of rows) {
      const summary = row.verificationSummary ?? {};
      lines.push(
        `- ${row.brandName ?? "Unknown brand"} | ${row.productName ?? "Unknown product"} | checklist=${row.thirdPartyChecklistState ?? "none"} | summary=${summary.overallStatus ?? "none"} | strongest=${summary.strongestProgramLabel ?? "none"} | warnings=${(summary.warnings ?? []).join(", ") || "none"} | url=${row.iherbUrl ?? "none"}`,
      );
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

  const bucketOrder = [
    "verified",
    "claimed",
    "brand_level_program_signal_only",
    "registry_blocked",
    "not_proven",
  ];
  const bucketCounts = Object.fromEntries(bucketOrder.map((bucket) => [bucket, 0]));
  const bucketSamples = Object.fromEntries(bucketOrder.map((bucket) => [bucket, []]));
  const verificationSummaryStatusCounts = {};
  const thirdPartyChecklistStateCounts = {};
  const warningCounts = {};
  const strongestProgramCounts = {};

  let errorCount = 0;
  let officialRegistryChecked = 0;

  for (let index = 0; index < imported.length; index += 1) {
    const row = imported[index];
    try {
      const overlayClaims = toOverlayClaims(row);
      const digest = toFactsDigest(row, overlayClaims);
      const factsDigestHash = computeFactsDigestHash(digest);
      const payload = compileDecisionSupport({
        digest,
        factsDigestHash,
        viewMode: "details",
        locale: "en",
        flagsSnapshot: null,
        patchActivation: null,
        overlayClaims,
      });
      const testingModule = Array.isArray(payload?.nutriScoreCardV2?.modules)
        ? payload.nutriScoreCardV2.modules.find((module) => module?.id === "testing_verification")
        : null;
      const thirdPartyItem = Array.isArray(testingModule?.checklist)
        ? testingModule.checklist.find((item) => item?.key === "testing_verification:third_party_tested_claim")
        : null;
      const verificationSummary = payload?.qualityMark?.verificationSummary ?? null;
      const bucket = classifyThirdPartyBucket({ thirdPartyItem, verificationSummary });

      bucketCounts[bucket] += 1;
      increment(thirdPartyChecklistStateCounts, thirdPartyItem?.state ?? "missing_item");
      increment(verificationSummaryStatusCounts, verificationSummary?.overallStatus ?? "none");
      if (verificationSummary?.officialRegistryChecked) officialRegistryChecked += 1;
      if (verificationSummary?.strongestProgramLabel) increment(strongestProgramCounts, verificationSummary.strongestProgramLabel);
      for (const warning of verificationSummary?.warnings ?? []) increment(warningCounts, warning);

      if (bucketSamples[bucket].length < SAMPLE_LIMIT) {
        bucketSamples[bucket].push(buildSample({ row, payload, thirdPartyItem, bucket }));
      }
    } catch (error) {
      errorCount += 1;
      if (bucketSamples.not_proven.length < SAMPLE_LIMIT) {
        bucketSamples.not_proven.push({
          bucket: "not_proven",
          productId: row?.productId ? String(row.productId) : null,
          barcode: row?.barcode_gtin14 ? String(row.barcode_gtin14) : null,
          brandName: row?.brandName ?? null,
          productName: row?.title ?? null,
          iherbUrl: row?.link ?? null,
          categoryId: null,
          thirdPartyChecklistState: null,
          overallScore: null,
          overallBand: null,
          verificationSummary: null,
          qualityMarkStatus: null,
          qualityMarkChecked: false,
          qualityMarkEvidenceRef: null,
          extraTrustSignals: [],
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if ((index + 1) % LOG_EVERY === 0 || index + 1 === imported.length) {
      console.log(
        JSON.stringify(
          {
            phase: "week2_third_party_tested_claim_census",
            processed: index + 1,
            total: imported.length,
          },
          null,
          2,
        ),
      );
    }
  }

  const bucketPercents = Object.fromEntries(
    bucketOrder.map((bucket) => [bucket, pct(bucketCounts[bucket], imported.length)]),
  );

  const report = {
    schemaVersion: "week2_third_party_tested_claim_census.v1",
    generatedAt: nowIso(),
    inputs: {
      stagingPath: STAGING_PATH,
      mergeReportPath: MERGE_REPORT_PATH,
      qualityMarkCachePath: path.join(ROOT, "output", "quality_marks", "quality_mark_cache.json"),
    },
    summary: {
      importedMatchedTotal: imported.length,
      errorCount,
      officialRegistryChecked,
    },
    bucketOrder,
    bucketCounts,
    bucketPercents,
    thirdPartyChecklistStateCounts: sortCounts(thirdPartyChecklistStateCounts),
    verificationSummaryStatusCounts: sortCounts(verificationSummaryStatusCounts),
    strongestProgramCounts: sortCounts(strongestProgramCounts),
    warningCounts: sortCounts(warningCounts),
    samples: bucketSamples,
  };

  await fs.writeFile(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(OUT_MD, buildMarkdown(report), "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        importedMatchedTotal: imported.length,
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
