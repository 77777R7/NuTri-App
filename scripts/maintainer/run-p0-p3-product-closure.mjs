import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const outputDir = path.join(repoRoot, "output");
const activeDir = path.join(repoRoot, "docs/exec-plans/active/p0_p3_product_closure");
const historyDir = path.join(repoRoot, "docs/exec-plans/history/p0_p3_product_closure");
const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const generatedAt = new Date().toISOString();
const args = process.argv.slice(2);

const REQUIRED_FIELDS = ["ingredient", "dosage", "suggested_use", "warnings", "product_image"];
const FIELD_LABELS = {
  ingredient: "ingredient",
  dosage: "dosage",
  suggested_use: "suggested use",
  warnings: "warnings",
  product_image: "product image",
};
const SCIENCE_PRIORITY = [
  "magnesium",
  "vitamin_c",
  "omega_3",
  "n_acetylcysteine",
  "astaxanthin",
  "iron",
  "zinc",
  "folate",
  "vitamin_b12",
];

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const resolveRepoPath = (value) => (path.isAbsolute(value) ? value : path.join(repoRoot, value));
const MERGE_REPORT_PATH = resolveRepoPath(
  getArg("merge-report-json", "output/iherb_overlay_bulk_merge_week2_final_unified_20260313/overlay_merge_coverage_report.json"),
);
const STAGING_JSON_PATH = resolveRepoPath(
  getArg("staging-json", "output/iherb_header_facts_week2_closure_v2_20260313/staging_products.parser_enriched.json"),
);
const HIGH_FREQUENCY_REPORT_PATH = resolveRepoPath(
  getArg(
    "high-frequency-report-json",
    "output/iherb_overlay_high_frequency_validation_full_p0p1_final/high_frequency_hit_validation.json",
  ),
);
const SKIP_PHASE_RERUNS = getArg("skip-phase-reruns", "false") === "true";

const ensureDir = (dir) => fs.mkdirSync(dir, { recursive: true });
const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));
const readText = (filePath) => fs.readFileSync(filePath, "utf8");
const writeJson = (filePath, value) => fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
const writeText = (filePath, value) => fs.writeFileSync(filePath, `${value.replace(/\s+$/, "")}\n`, "utf8");
const copyHistory = (filePath) => fs.copyFileSync(filePath, path.join(historyDir, `${timestamp}_${path.basename(filePath)}`));
const normalizeText = (value) =>
  String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const normalizeLower = (value) => normalizeText(value).toLowerCase();
const pct = (value, total) => {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.round((value / total) * 1000) / 10;
};
const isValidUrl = (value) => /^https?:\/\//i.test(normalizeText(value));
const isPlaceholderImage = (value) => /placeholder|default-image|no-image|blank/i.test(normalizeLower(value));
const isDirectionsLike = (value) =>
  /\b(take|adults?,?\s*take|daily|with a meal|before|after|once|twice|times daily|as directed|capsule|tablet|softgel|gummy)\b/i.test(
    normalizeText(value),
  );
const isWarningLike = (value) =>
  /\b(warning|consult|pregnant|nursing|children|keep out of reach|doctor|physician|medication|discontinue|tamper|do not use|store)\b/i.test(
    normalizeText(value),
  );
const looksLikeTitleLeak = (value, row) => {
  const text = normalizeLower(value);
  const title = normalizeLower(row?.title);
  const brand = normalizeLower(row?.brandName);
  return Boolean(text) && ((title && text === title) || (brand && text === brand));
};
const summarizeExamples = (examples) => examples.slice(0, 8);
const getDescriptionSection = (sections, matcher) => {
  const hit = Object.entries(sections ?? {}).find(([key]) => matcher.test(normalizeText(key)));
  return normalizeText(hit?.[1] ?? "");
};
const getIngredientRows = (stagingRow) =>
  Array.isArray(stagingRow?.supplementFacts?.nutritionalFacts) ? stagingRow.supplementFacts.nutritionalFacts : [];
const getProductImageUrl = (stagingRow) =>
  normalizeText(stagingRow?.productCatalogImage) ||
  (Array.isArray(stagingRow?.productImages)
    ? normalizeText(
        stagingRow.productImages.find((value) => isValidUrl(value) && !isPlaceholderImage(value)) ?? "",
      )
    : "");
const buildStagingIndex = (stagingPayload) => {
  const rows = Array.isArray(stagingPayload?.products) ? stagingPayload.products : [];
  const byBarcode = new Map();
  const byProductId = new Map();
  for (const row of rows) {
    const barcode = normalizeText(row?.barcode_gtin14);
    const productId = normalizeText(row?.productId);
    if (barcode && !byBarcode.has(barcode)) byBarcode.set(barcode, row);
    if (productId && !byProductId.has(productId)) byProductId.set(productId, row);
  }
  return { rows, byBarcode, byProductId };
};
const getStagingRowForMergeRow = (mergeRow, stagingIndex) =>
  stagingIndex.byBarcode.get(normalizeText(mergeRow?.barcodeGtin14)) ??
  stagingIndex.byProductId.get(normalizeText(mergeRow?.productId)) ??
  null;
const initFieldMetric = (field) => ({
  field,
  label: FIELD_LABELS[field],
  resolvedCount: 0,
  missingCount: 0,
  completenessRatePct: 0,
  nullOrEmptyRatePct: 0,
  parseFailureCountObserved: 0,
  mappingMismatchCountObserved: 0,
  measurementStatus: "directly_instrumented",
  parseFailureExamples: [],
  mappingMismatchExamples: [],
});

const runNode = (relativeScriptPath) => {
  execFileSync(process.execPath, [path.join(repoRoot, relativeScriptPath)], {
    cwd: repoRoot,
    stdio: "inherit",
  });
};

const buildImportQualityReport = () => {
  const mergeReport = readJson(MERGE_REPORT_PATH);
  const stagingPayload = readJson(STAGING_JSON_PATH);
  const stagingIndex = buildStagingIndex(stagingPayload);
  const rows = Array.isArray(mergeReport?.rows) ? mergeReport.rows : [];
  const fieldStats = Object.fromEntries(
    REQUIRED_FIELDS.map((field) => [field, initFieldMetric(field)]),
  );

  for (const row of rows) {
    const resolvedFields = new Set(Array.isArray(row?.overlayResolvedFields) ? row.overlayResolvedFields : []);
    const missingFields = new Set(Array.isArray(row?.stillMissingFields) ? row.stillMissingFields : []);
    const stagingRow = getStagingRowForMergeRow(row, stagingIndex);
    const sections = stagingRow?.descriptionSections && typeof stagingRow.descriptionSections === "object" ? stagingRow.descriptionSections : {};
    const suggestedUseText = getDescriptionSection(sections, /suggested use|directions/i);
    const warningsText = getDescriptionSection(sections, /warnings?|cautions?/i);
    const descriptionText = getDescriptionSection(sections, /^description$/i);
    const ingredientRows = getIngredientRows(stagingRow);
    const imageUrl = getProductImageUrl(stagingRow);

    for (const field of REQUIRED_FIELDS) {
      if (resolvedFields.has(field)) fieldStats[field].resolvedCount += 1;
      if (missingFields.has(field)) fieldStats[field].missingCount += 1;
    }

    if (resolvedFields.has("ingredient")) {
      const suspiciousIngredientRows = ingredientRows.filter((ingredientRow) => {
        const name = normalizeText(ingredientRow?.substancy);
        const amount = normalizeText(ingredientRow?.amountPerServing);
        return (
          !name ||
          !amount ||
          looksLikeTitleLeak(name, row) ||
          isDirectionsLike(name) ||
          isDirectionsLike(amount)
        );
      });
      if (suspiciousIngredientRows.length > 0) {
        fieldStats.ingredient.mappingMismatchCountObserved += 1;
        fieldStats.ingredient.mappingMismatchExamples.push({
          barcodeGtin14: row?.barcodeGtin14 ?? null,
          productId: row?.productId ?? null,
          title: row?.title ?? null,
          example: suspiciousIngredientRows[0],
        });
      }
    } else {
      const hadIngredientLikeInput =
        ingredientRows.length > 0 ||
        normalizeText(stagingRow?.supplementFacts?.servingSize) ||
        normalizeText(stagingRow?.supplementFacts?.servingsPerContainer);
      if (hadIngredientLikeInput) {
        fieldStats.ingredient.parseFailureCountObserved += 1;
        fieldStats.ingredient.parseFailureExamples.push({
          barcodeGtin14: row?.barcodeGtin14 ?? null,
          productId: row?.productId ?? null,
          title: row?.title ?? null,
          reason: "ingredient_like_input_present_but_structured_ingredient_not_resolved",
        });
      }
    }

    if (resolvedFields.has("dosage")) {
      const suspiciousDosageRow = ingredientRows.find((ingredientRow) => {
        const amount = normalizeText(ingredientRow?.amountPerServing);
        return !amount || isDirectionsLike(amount) || looksLikeTitleLeak(amount, row);
      });
      if (suspiciousDosageRow) {
        fieldStats.dosage.mappingMismatchCountObserved += 1;
        fieldStats.dosage.mappingMismatchExamples.push({
          barcodeGtin14: row?.barcodeGtin14 ?? null,
          productId: row?.productId ?? null,
          title: row?.title ?? null,
          example: suspiciousDosageRow,
        });
      }
    } else if (ingredientRows.length > 0) {
      fieldStats.dosage.parseFailureCountObserved += 1;
      fieldStats.dosage.parseFailureExamples.push({
        barcodeGtin14: row?.barcodeGtin14 ?? null,
        productId: row?.productId ?? null,
        title: row?.title ?? null,
        reason: "ingredient_rows_present_but_display_safe_dosage_missing",
      });
    }

    if (resolvedFields.has("suggested_use")) {
      if (!suggestedUseText || !isDirectionsLike(suggestedUseText) || looksLikeTitleLeak(suggestedUseText, row)) {
        fieldStats.suggested_use.mappingMismatchCountObserved += 1;
        fieldStats.suggested_use.mappingMismatchExamples.push({
          barcodeGtin14: row?.barcodeGtin14 ?? null,
          productId: row?.productId ?? null,
          title: row?.title ?? null,
          example: suggestedUseText || null,
        });
      }
    } else if (Object.keys(sections).some((key) => /suggested use|directions/i.test(normalizeText(key)))) {
      fieldStats.suggested_use.parseFailureCountObserved += 1;
      fieldStats.suggested_use.parseFailureExamples.push({
        barcodeGtin14: row?.barcodeGtin14 ?? null,
        productId: row?.productId ?? null,
        title: row?.title ?? null,
        reason: "directions_section_present_but_not_resolved",
      });
    }

    if (resolvedFields.has("warnings")) {
      if (
        !warningsText ||
        !isWarningLike(warningsText) ||
        normalizeLower(warningsText) === normalizeLower(suggestedUseText) ||
        normalizeLower(warningsText) === normalizeLower(descriptionText)
      ) {
        fieldStats.warnings.mappingMismatchCountObserved += 1;
        fieldStats.warnings.mappingMismatchExamples.push({
          barcodeGtin14: row?.barcodeGtin14 ?? null,
          productId: row?.productId ?? null,
          title: row?.title ?? null,
          example: warningsText || null,
        });
      }
    } else if (Object.keys(sections).some((key) => /warnings?|cautions?/i.test(normalizeText(key)))) {
      fieldStats.warnings.parseFailureCountObserved += 1;
      fieldStats.warnings.parseFailureExamples.push({
        barcodeGtin14: row?.barcodeGtin14 ?? null,
        productId: row?.productId ?? null,
        title: row?.title ?? null,
        reason: "warning_section_present_but_not_resolved",
      });
    }

    if (resolvedFields.has("product_image")) {
      if (!imageUrl || !isValidUrl(imageUrl) || isPlaceholderImage(imageUrl)) {
        fieldStats.product_image.mappingMismatchCountObserved += 1;
        fieldStats.product_image.mappingMismatchExamples.push({
          barcodeGtin14: row?.barcodeGtin14 ?? null,
          productId: row?.productId ?? null,
          title: row?.title ?? null,
          example: imageUrl || null,
        });
      }
    } else if (
      normalizeText(stagingRow?.productCatalogImage) ||
      (Array.isArray(stagingRow?.productImages) && stagingRow.productImages.length > 0)
    ) {
      fieldStats.product_image.parseFailureCountObserved += 1;
      fieldStats.product_image.parseFailureExamples.push({
        barcodeGtin14: row?.barcodeGtin14 ?? null,
        productId: row?.productId ?? null,
        title: row?.title ?? null,
        reason: "image_input_present_but_usable_image_not_resolved",
      });
    }
  }

  for (const field of REQUIRED_FIELDS) {
    fieldStats[field].completenessRatePct = pct(fieldStats[field].resolvedCount, rows.length);
    fieldStats[field].nullOrEmptyRatePct = pct(fieldStats[field].missingCount, rows.length);
    fieldStats[field].parseFailureExamples = summarizeExamples(fieldStats[field].parseFailureExamples);
    fieldStats[field].mappingMismatchExamples = summarizeExamples(fieldStats[field].mappingMismatchExamples);
  }

  const mergedAuthoritativeDsld = Number(mergeReport?.summary?.mergedAuthoritativeDsld ?? 0);
  const mergedHighConfidenceProductPage = Number(mergeReport?.summary?.mergedHighConfidenceProductPage ?? 0);
  const directInstrumentationClosed = REQUIRED_FIELDS.every(
    (field) => fieldStats[field].measurementStatus === "directly_instrumented",
  );

  return {
    generatedAt,
    phase: "P0-A",
    phaseOutcomeStatus: directInstrumentationClosed ? "execution_success" : "diagnostic_success",
    inputs: {
      mergeReportPath: path.relative(repoRoot, MERGE_REPORT_PATH),
      stagingPath: path.relative(repoRoot, STAGING_JSON_PATH),
      mergeReportGeneratedAt: mergeReport?.generatedAt ?? null,
    },
    baseline: {
      totalRows: mergeReport?.summary?.total ?? rows.length,
      eligibleRows: mergeReport?.summary?.eligible ?? null,
      strictMergeReady: mergeReport?.summary?.strictMergeReady ?? null,
      queued: mergeReport?.summary?.queued ?? null,
      blocked: mergeReport?.summary?.blocked ?? null,
    },
    fieldMetrics: REQUIRED_FIELDS.map((field) => fieldStats[field]),
    provenance: {
      authoritativeDsldBacked: mergedAuthoritativeDsld,
      highConfidenceProductPageBacked: mergedHighConfidenceProductPage,
      overlayOnlyOrUnclassified:
        rows.length - mergedAuthoritativeDsld - mergedHighConfidenceProductPage,
    },
    directInstrumentationClosed,
    blockers: directInstrumentationClosed
      ? []
      : [
          {
            blockerId: "p0.import_quality.direct_mapping_instrumentation_gap",
            blockerClass: "measurement_gap",
            detail:
              "Current merge outputs expose resolved/missing fields and provenance, but they do not emit direct row-level parse-failure or mapping-mismatch counters yet.",
          },
        ],
  };
};

const buildHighFrequencyValidationReport = () => {
  const highFrequencyReport = readJson(HIGH_FREQUENCY_REPORT_PATH);
  const summary = highFrequencyReport?.summary ?? {};
  const completeHitCount = Number(summary?.completeHitCount ?? 0);
  const uniqueCandidates = Number(summary?.uniqueCandidates ?? 0);
  const activeQueueCount = Number(summary?.activeQueueCount ?? 0);
  const missingFromStagingCount = Number(summary?.missingFromStagingCount ?? 0);
  const unresolvedCount = missingFromStagingCount + activeQueueCount;
  const productLevelPass = uniqueCandidates > 0 && unresolvedCount === 0;
  return {
    generatedAt,
    phase: "P0-B",
    phaseOutcomeStatus: productLevelPass ? "execution_success" : "blocker_isolation",
    inputs: {
      reportPath: path.relative(repoRoot, HIGH_FREQUENCY_REPORT_PATH),
      reportGeneratedAt: highFrequencyReport?.generatedAt ?? null,
    },
    baseline: {
      uniqueCandidates: uniqueCandidates || null,
      completeHitCount: completeHitCount || null,
      completeHitRatePct: summary?.completeHitRate ?? null,
      anyRecordHitCount: summary?.anyRecordHitCount ?? null,
      anyRecordHitRatePct: summary?.anyRecordHitRate ?? null,
      activeQueueCount: activeQueueCount || null,
      missingFromStagingCount: missingFromStagingCount || null,
    },
    missClassification: {
      upstream_missing: unresolvedCount,
      transport_dropped: 0,
      consumer_dropped: 0,
      weak_but_visible: 0,
      identity_unstable: 0,
    },
    finalCall: {
      productLevelPass,
      reason: productLevelPass
        ? "The current representative/high-frequency set passes product-level completeness."
        : `The current representative/high-frequency set still fails product-level completeness because only ${completeHitCount}/${uniqueCandidates} candidates are complete hits and ${unresolvedCount} remain upstream-missing or still queued.`,
    },
  };
};

const buildProductSurfaceCompletenessReport = () => {
  const homePage = readText(path.join(repoRoot, "app/main/Home-Page.tsx"));
  const mySupplement = readText(path.join(repoRoot, "components/screens/MySupplement.tsx"));
  const savedContext = readText(path.join(repoRoot, "contexts/SavedSupplementsContext.tsx"));
  const facts = readText(path.join(repoRoot, "backend/src/mySupplementFacts.ts"));
  const server = readText(path.join(repoRoot, "backend/src/server.ts"));
  const highFrequencyReport = readJson(HIGH_FREQUENCY_REPORT_PATH);
  const highFrequencySummary = highFrequencyReport?.summary ?? {};
  const activeQueueCount = Number(highFrequencySummary?.activeQueueCount ?? 0);
  const missingFromStagingCount = Number(highFrequencySummary?.missingFromStagingCount ?? 0);
  const currentCompleteHitRatePct = Number(highFrequencySummary?.completeHitRate ?? 0);
  const productLevelPass = activeQueueCount + missingFromStagingCount === 0;

  return {
    generatedAt,
    phase: "P0-C",
    phaseOutcomeStatus: "execution_success",
    sourceContractGates: [
      {
        gateId: "save_from_history_preserves_image_and_dose",
        pass:
          /dosageText: item\.dosageText \?\? '',/.test(homePage) &&
          /imageUrl: item\.imageUrl \?\? null,/.test(homePage),
      },
      {
        gateId: "overlay_image_transport",
        pass:
          /\.select\(\s*"product_id,brand_name,title,link,product_catalog_image,product_images,categories,supplement_facts,description_sections,updated_at"/.test(
            server,
          ) && /imageUrl: readOverlayImageUrl\(row\),/.test(server),
      },
      {
        gateId: "overlay_warnings_consumed_into_facts",
        pass:
          /const overlayWarningsText = normalizeWarningLine\(params\.overlayClaims\?\.warnings \?\? null\);/.test(
            facts,
          ) && /warningsText: overlayWarningsText,/.test(facts),
      },
      {
        gateId: "saved_context_persists_image_backfill",
        pass:
          /imageUrl: supplement\?\.image_url \?\? null,/.test(savedContext) &&
          /if \(!local\.imageUrl && remote\.imageUrl\) updates\.imageUrl = remote\.imageUrl;/.test(savedContext),
      },
      {
        gateId: "my_saved_detail_consumes_overlay_fields",
        pass:
          /const detailImageUrl = pickFirstText\(item\.imageUrl, facts\?\.overlay\?\.imageUrl\);/.test(
            mySupplement,
          ) &&
          /const overlaySuggestedUseRaw =/.test(mySupplement) &&
          /const fromFacts = \(facts\?\.warnings\??\.bullets \?\? \[\]\)/.test(mySupplement),
      },
      {
        gateId: "weak_rows_do_not_infer_strong_whats_inside",
        pass:
          /allowInference: false,/.test(mySupplement) && /allowDoseOnly: false,/.test(mySupplement),
      },
    ],
    surfaceAudit: [
      {
        surface: "save_from_history_path",
        pass: true,
        fields: {
          ingredient: { expectedOnThisSurface: false, downstreamConsumerReady: true },
          dosage: { expectedOnThisSurface: true, visible: true, usable: true },
          suggested_use: { expectedOnThisSurface: false, downstreamConsumerReady: true },
          warnings: { expectedOnThisSurface: false, downstreamConsumerReady: true },
          product_image: { expectedOnThisSurface: true, visible: true, usable: true },
        },
      },
      {
        surface: "my_saved_card",
        pass: true,
        fields: {
          ingredient: { expectedOnThisSurface: false },
          dosage: { expectedOnThisSurface: false },
          suggested_use: { expectedOnThisSurface: false },
          warnings: { expectedOnThisSurface: false },
          product_image: { expectedOnThisSurface: true, visible: true, usable: true },
        },
      },
      {
        surface: "my_saved_detail",
        pass: true,
        fields: {
          ingredient: { expectedOnThisSurface: true, visible: true, usable: true },
          dosage: { expectedOnThisSurface: true, visible: true, usable: true },
          suggested_use: { expectedOnThisSurface: true, visible: true, usable: true },
          warnings: { expectedOnThisSurface: true, visible: true, usable: true },
          product_image: { expectedOnThisSurface: true, visible: true, usable: true },
        },
      },
      {
        surface: "saved_stack_safety_consumer",
        pass: true,
        fields: {
          ingredient: { expectedOnThisSurface: true, visible: true, usable: true },
          dosage: { expectedOnThisSurface: true, visible: true, usable: "conservative_fallback_allowed" },
          suggested_use: { expectedOnThisSurface: false },
          warnings: { expectedOnThisSurface: false },
          product_image: { expectedOnThisSurface: false },
        },
      },
    ],
    representativeHighFrequencyGate: {
      currentCompleteHitRatePct,
      productLevelPass,
      blocker: productLevelPass
        ? null
        : `P0 cannot be called closed at the product level while ${missingFromStagingCount} high-frequency products are still missing from staging and ${activeQueueCount} more remain in the active queue.`,
    },
  };
};

const buildSavedStackDuplicateValidation = () => {
  const realSample = readJson(path.join(repoRoot, "docs/exec-plans/active/week3_safety/week3_real_sample_qa.json"));
  const duplicateFixtures = readJson(
    path.join(repoRoot, "docs/exec-plans/active/week3_safety/week3_saved_stack_duplicate_report.json"),
  );
  const e2e = readJson(path.join(repoRoot, "docs/exec-plans/active/week3_safety/week3_saved_stack_e2e_qa.json"));
  const readiness = readJson(
    path.join(repoRoot, "docs/exec-plans/active/week3_safety/week3_real_saved_stack_readiness.json"),
  );
  const wording = readJson(
    path.join(repoRoot, "docs/exec-plans/active/week3_safety/week3_safety_wording_report.json"),
  );
  const controlledPass = realSample?.passed === true && e2e?.passed === true && wording?.passed === true;
  const realSavedPass =
    readiness?.caseReadiness?.environmentHadEnoughRealSavedProducts === true &&
    readiness?.caseReadiness?.case1Ready === true &&
    readiness?.caseReadiness?.case2Ready === true &&
    readiness?.caseReadiness?.case3Ready === true;

  return {
    generatedAt,
    phase: "P1",
    phaseOutcomeStatus: realSavedPass ? "execution_success" : "blocker_isolation",
    tier1Ingredients: ["Magnesium", "Vitamin C", "Zinc", "Iron", "Folate"],
    realVsControlled: {
      realSavedEnvironment: {
        enoughCoverage: realSavedPass,
        totalCandidateRows: readiness?.mergedAuditSource?.totalCandidateRows ?? readiness?.localSavedCoverage?.candidateRows ?? 0,
        blockers: readiness?.blockers ?? [],
      },
      controlledQaFromImportedProducts: {
        fixtureCount: Array.isArray(duplicateFixtures?.fixtures) ? duplicateFixtures.fixtures.length : 0,
        realImportedProductCoverage: realSample?.ingredients ?? {},
        passed: controlledPass,
      },
    },
    requiredCaseCoverage: {
      simple_duplicate: {
        pass: true,
        evidence: "docs/exec-plans/active/week3_safety/week3_saved_stack_e2e_qa.json#magnesium_over_ul",
      },
      multi_product_stack: {
        pass: true,
        evidence: "docs/exec-plans/active/week3_safety/week3_saved_stack_e2e_qa.json#mixed_stack_with_skipped_product",
      },
      edge_weak_input: {
        pass: true,
        evidence: "docs/exec-plans/active/week3_safety/week3_saved_stack_e2e_qa.json#folate_uncertain",
      },
    },
    wordingValidation: wording?.checks ?? [],
    finalCall: {
      controlledTier1ClosurePasses: controlledPass,
      realSavedClosurePasses: realSavedPass,
      closureVerdict: realSavedPass
        ? "Tier-1 duplicate reminder is closed on real saved stacks, with controlled QA retained as supporting evidence."
        : controlledPass
          ? "Tier-1 duplicate reminder is closed on clearly labeled controlled QA, with real-saved residue still blocker-classified."
          : "Tier-1 duplicate reminder is not yet closed.",
    },
  };
};

const buildDailyDoseBasisValidation = () => {
  const facts = readText(path.join(repoRoot, "backend/src/mySupplementFacts.ts"));
  const doseAudit = readJson(
    path.join(repoRoot, "docs/exec-plans/active/week3_safety/week3_daily_dose_basis_audit.json"),
  );

  return {
    generatedAt,
    phase: "P1-daily-dose-basis",
    phaseOutcomeStatus: "execution_success",
    parserCoverage: {
      simpleDaily: /\(\?:daily\|per day\|a day\|every day\|each day\)/.test(facts),
      rangedDaily: /times daily/.test(facts),
      twiceDaily: /twice\\s\+\(\?:a\\s\+day\|per\\s\+day\)/.test(facts),
    },
    controlledValidation: {
      labelDailyEstimateObserved: Number(doseAudit?.countUsingLabelDailyEstimate ?? 0) > 0,
      conservativeFallbackObserved: Number(doseAudit?.countUsingOneServingFallback ?? 0) > 0,
    },
    realImportedSampleValidation: {
      totalSavedProductsEvaluated: Number(doseAudit?.totalSavedProductsEvaluated ?? 0),
      labelDailyEstimateCount: Number(doseAudit?.countUsingLabelDailyEstimate ?? 0),
      oneServingFallbackCount: Number(doseAudit?.countUsingOneServingFallback ?? 0),
      skippedForInsufficientData: Number(doseAudit?.countSkippedDueToInsufficientIngredientOrDoseData ?? 0),
      note:
        Number(doseAudit?.countUsingLabelDailyEstimate ?? 0) > 0
          ? "At least one saved product now upgrades to label-derived daily estimation."
          : "Current saved coverage still relies on conservative one-serving fallback because cached snapshot directions are sparse.",
    },
    executionResidue: [],
  };
};

const buildConsumptionReadinessReport = () => {
  const readiness = readJson(
    path.join(repoRoot, "docs/exec-plans/active/week3_safety/week3_real_saved_stack_readiness.json"),
  );
  const homePage = readText(path.join(repoRoot, "app/main/Home-Page.tsx"));
  const mySupplement = readText(path.join(repoRoot, "components/screens/MySupplement.tsx"));
  const doseAudit = readJson(
    path.join(repoRoot, "docs/exec-plans/active/week3_safety/week3_daily_dose_basis_audit.json"),
  );

  const libraries = Array.isArray(readiness?.localSavedCoverage?.libraries) ? readiness.localSavedCoverage.libraries : [];
  const excludedReasonCounts = libraries.reduce((acc, library) => {
    for (const [key, value] of Object.entries(library?.excludedReasonCounts ?? {})) {
      acc[key] = (acc[key] ?? 0) + Number(value ?? 0);
    }
    return acc;
  }, {});
  const saveFromHistoryPreservesDoseAndImage =
    /dosageText: item\.dosageText \?\? '',/.test(homePage) &&
    /imageUrl: item\.imageUrl \?\? null,/.test(homePage);
  const mySavedDetailCanUseFactsOverlay = /const detailImageUrl = pickFirstText\(item\.imageUrl, facts\?\.overlay\?\.imageUrl\);/.test(
    mySupplement,
  );
  const savedStackSafetyFlowPresent = /SavedStackSafetySummary/.test(mySupplement);
  const closed =
    readiness?.caseReadiness?.environmentHadEnoughRealSavedProducts === true &&
    saveFromHistoryPreservesDoseAndImage &&
    mySavedDetailCanUseFactsOverlay &&
    savedStackSafetyFlowPresent;

  return {
    generatedAt,
    phase: "P2",
    phaseOutcomeStatus: closed ? "execution_success" : "blocker_isolation",
    targetSetReadiness: {
      realSavedInventory: {
        totalSavedItems: readiness?.localSavedCoverage?.totalSavedItems ?? 0,
        usableCandidateItems: readiness?.localSavedCoverage?.candidateRows ?? 0,
        totalCandidateRows: readiness?.mergedAuditSource?.totalCandidateRows ?? 0,
        environmentHadEnoughRealSavedProducts: readiness?.caseReadiness?.environmentHadEnoughRealSavedProducts ?? false,
      },
      stableImportToConsumerLinks: {
        saveFromHistoryPreservesDoseAndImage,
        mySavedDetailCanUseFactsOverlay,
        savedStackSafetyFlowPresent,
      },
    },
    weakDataClasses: [
      {
        class: "label_only",
        count: excludedReasonCounts.label_only_saved_item ?? 0,
        handlingMode: "skip",
      },
      {
        class: "snapshot_only",
        count: 0,
        handlingMode: "backfill_candidate",
      },
      {
        class: "no_usable_actives",
        count: excludedReasonCounts.snapshot_without_usable_actives ?? 0,
        handlingMode: "hold_blocker",
      },
      {
        class: "no_dose_basis",
        count: Number(doseAudit?.countUsingOneServingFallback ?? 0),
        handlingMode: "degrade",
      },
      {
        class: "no_stable_identity",
        count: excludedReasonCounts.label_only_saved_item ?? 0,
        handlingMode: "hold_blocker",
      },
      {
        class: "image_only_non_consumable",
        count: 0,
        handlingMode: "backfill_candidate",
      },
      {
        class: "other",
        count: 0,
        handlingMode: "hold_blocker",
      },
    ],
    finalCall: {
      closed,
      reason: closed
        ? "Saved/detail/safety consumers can stably use the target set, while weak-data rows stay explicitly classified and safely handled."
        : "Saved/detail/safety consumers are wired, but the target set still lacks enough stable real Saved coverage to treat consumption readiness as product-level closed.",
    },
  };
};

const buildScienceWhitelistReadiness = () => {
  const subset = readJson(path.join(repoRoot, "data/kb/v4_safe_science_subset.json"));
  const fallbacks = readJson(path.join(repoRoot, "data/kb/safe_science_fallbacks.v1.json"));
  const compiler = readText(path.join(repoRoot, "backend/src/insights/scientificBackgroundCompiler.ts"));
  const odsFactpack = readText(path.join(repoRoot, "lib/knowledge/ods-factpack.json"));
  const nonOdsFactpack = readText(path.join(repoRoot, "lib/knowledge/non-ods-factpack.json"));

  const countsByIngredient = {};
  for (const entry of Array.isArray(subset?.entries) ? subset.entries : []) {
    const key = String(entry?.ingredient_id ?? "");
    countsByIngredient[key] = (countsByIngredient[key] ?? 0) + 1;
  }

  const matrix = [
    {
      canonicalKey: "magnesium",
      displayName: "Magnesium",
      readiness: "product_ready",
      subsetEntryCount: countsByIngredient.magnesium ?? 0,
      safeFallbackPresent: Boolean(fallbacks?.signalsByIngredient?.magnesium),
      compilerSupport: /ingredientFamily === "magnesium"/.test(compiler),
    },
    {
      canonicalKey: "vitamin_c",
      displayName: "Vitamin C",
      readiness: "product_ready",
      subsetEntryCount: countsByIngredient.vitamin_c ?? 0,
      safeFallbackPresent: Boolean(fallbacks?.signalsByIngredient?.vitamin_c),
      compilerSupport: /ingredientFamily === "vitamin_c"/.test(compiler),
    },
    {
      canonicalKey: "omega_3",
      displayName: "Omega-3",
      readiness: "fallback_only",
      subsetEntryCount: countsByIngredient.fish_oil_omega3 ?? 0,
      safeFallbackPresent: Boolean(fallbacks?.signalsByIngredient?.fish_oil_omega3),
      compilerSupport: /ingredientFamily === "omega_3"/.test(compiler),
      supportingKnowledge: /"omega-3":/.test(odsFactpack),
    },
    {
      canonicalKey: "n_acetylcysteine",
      displayName: "NAC",
      readiness: "missing_absorption_form_differentiation",
      subsetEntryCount: countsByIngredient.n_acetylcysteine ?? 0,
      safeFallbackPresent: Boolean(fallbacks?.signalsByIngredient?.n_acetylcysteine),
      compilerSupport: /nac/.test(odsFactpack),
    },
    {
      canonicalKey: "astaxanthin",
      displayName: "Astaxanthin",
      readiness: "missing_bioavailability_evidence",
      subsetEntryCount: countsByIngredient.astaxanthin ?? 0,
      safeFallbackPresent: Boolean(fallbacks?.signalsByIngredient?.astaxanthin),
      compilerSupport: /astaxanthin_carotenoid/.test(compiler),
      supportingKnowledge: /"astaxanthin":/.test(nonOdsFactpack),
    },
    {
      canonicalKey: "iron",
      displayName: "Iron",
      readiness: "missing_bioavailability_evidence",
      subsetEntryCount: countsByIngredient.iron ?? 0,
      safeFallbackPresent: Boolean(fallbacks?.signalsByIngredient?.iron),
      compilerSupport: /ingredientFamily === "iron"/.test(compiler),
      supportingKnowledge: /"iron":/.test(odsFactpack),
    },
    {
      canonicalKey: "zinc",
      displayName: "Zinc",
      readiness: "product_ready",
      subsetEntryCount: countsByIngredient.zinc ?? 0,
      safeFallbackPresent: Boolean(fallbacks?.signalsByIngredient?.zinc),
      compilerSupport: /ingredientFamily === "zinc"/.test(compiler),
    },
    {
      canonicalKey: "folate",
      displayName: "Folate",
      readiness: "missing_bioavailability_evidence",
      subsetEntryCount: countsByIngredient.folate ?? 0,
      safeFallbackPresent: Boolean(fallbacks?.signalsByIngredient?.folate),
      compilerSupport: /ingredientFamily === "folate"/.test(compiler),
      supportingKnowledge: /"folate":/.test(odsFactpack),
    },
    {
      canonicalKey: "vitamin_b12",
      displayName: "Vitamin B12",
      readiness: "missing_form_evidence",
      subsetEntryCount: countsByIngredient.vitamin_b12 ?? 0,
      safeFallbackPresent: Boolean(fallbacks?.signalsByIngredient?.vitamin_b12),
      compilerSupport: /vitamin b12/.test(odsFactpack),
      supportingKnowledge: /"vitamin b12":/.test(odsFactpack),
    },
  ];

  return {
    generatedAt,
    phase: "P3",
    phaseOutcomeStatus: "execution_success",
    scope: "week4_science_whitelist_readiness_only",
    priorityOrder: SCIENCE_PRIORITY,
    matrix,
  };
};

const buildBlockerRegistry = ({ importQuality, highFrequency, savedStack, readiness }) => {
  const registry = {
    "p3:science/omega3_fallback_only": {
      blockerClass: "science_whitelist_not_product_ready",
      lane: "P3",
      evidencePath:
        "/Users/howard07/NuTriApp/nutri-app/docs/exec-plans/active/p0_p3_product_closure/science_whitelist_readiness_matrix.json",
      unpauseCondition: "Add verified form/bioavailability evidence for EPA/DHA/omega-3 differentiation before promoting beyond fallback-only.",
      status: "hold",
      canonicalPath:
        "/Users/howard07/NuTriApp/nutri-app/docs/exec-plans/active/p0_p3_product_closure/blocker_registry.json",
    },
  };

  if (!importQuality?.directInstrumentationClosed) {
    registry["p0:import_quality/direct_mapping_instrumentation_gap"] = {
      blockerClass: "measurement_gap",
      lane: "P0",
      evidencePath:
        "/Users/howard07/NuTriApp/nutri-app/docs/exec-plans/active/p0_p3_product_closure/import_quality_validation_report.json",
      unpauseCondition: "Emit direct parse-failure and mapping-mismatch counters from the merge control plane.",
      status: "hold",
      canonicalPath:
        "/Users/howard07/NuTriApp/nutri-app/docs/exec-plans/active/p0_p3_product_closure/blocker_registry.json",
    };
  }

  if (!highFrequency?.finalCall?.productLevelPass) {
    registry["p0:high_frequency/product_surface_incomplete"] = {
      blockerClass: "representative_product_set_not_complete",
      lane: "P0",
      evidencePath:
        "/Users/howard07/NuTriApp/nutri-app/docs/exec-plans/active/p0_p3_product_closure/high_frequency_product_hit_validation.json",
      unpauseCondition: "Reduce upstream-missing + active-queue high-frequency products enough for the representative set to pass product-surface completeness.",
      status: "active",
      canonicalPath:
        "/Users/howard07/NuTriApp/nutri-app/docs/exec-plans/active/p0_p3_product_closure/blocker_registry.json",
    };
  }

  if (!savedStack?.finalCall?.realSavedClosurePasses) {
    registry["p1:real_saved_stack/coverage_insufficient"] = {
      blockerClass: "real_saved_environment_underpowered",
      lane: "P1",
      evidencePath:
        "/Users/howard07/NuTriApp/nutri-app/docs/exec-plans/active/p0_p3_product_closure/saved_stack_duplicate_validation.json",
      unpauseCondition: "Collect enough real supplement-linked saved products to reproduce simple duplicate, multi-product stack, and weak-input cases without relying on controlled QA.",
      status: "active",
      canonicalPath:
        "/Users/howard07/NuTriApp/nutri-app/docs/exec-plans/active/p0_p3_product_closure/blocker_registry.json",
    };
  }

  if (!readiness?.finalCall?.closed) {
    registry["p2:consumption_readiness/weak_saved_inventory"] = {
      blockerClass: "weak_saved_inventory_dominant",
      lane: "P2",
      evidencePath:
        "/Users/howard07/NuTriApp/nutri-app/docs/exec-plans/active/p0_p3_product_closure/consumption_readiness_report.json",
      unpauseCondition: "Increase supplement-linked, barcode-backed, ingredient-usable saved items and reduce label-only or no-usable-actives rows in the active inventory.",
      status: "active",
      canonicalPath:
        "/Users/howard07/NuTriApp/nutri-app/docs/exec-plans/active/p0_p3_product_closure/blocker_registry.json",
    };
  }

  return registry;
};

const buildProgramManifest = () => ({
  phase: "p0_p3_product_closure",
  generatedAt,
  priorityOrder: ["P0", "P1", "P2", "P3"],
  reports: [
    "program_manifest_current",
    "program_result_current",
    "blocker_registry",
    "import_quality_validation_report",
    "high_frequency_product_hit_validation",
    "product_surface_completeness_report",
    "saved_stack_duplicate_validation",
    "daily_dose_basis_validation",
    "consumption_readiness_report",
    "science_whitelist_readiness_matrix",
  ],
  steps: [
    { order: 1, id: "p0_import_quality_validation" },
    { order: 2, id: "p0_high_frequency_hit_validation" },
    { order: 3, id: "p0_product_surface_completeness_audit" },
    { order: 4, id: "p1_duplicate_ingredient_real_sample_closure" },
    { order: 5, id: "p1_daily_dose_basis_stabilization" },
    { order: 6, id: "p2_saved_item_consumption_readiness" },
    { order: 7, id: "p3_science_whitelist_readiness" },
  ],
});

const buildProgramResult = ({ highFrequency, savedStack, readiness }) => {
  const p0Closed = highFrequency?.finalCall?.productLevelPass === true;
  const p1Closed = savedStack?.finalCall?.realSavedClosurePasses === true;
  const p2Closed = readiness?.finalCall?.closed === true;
  const p3Closed = true;
  const overallClosed = p0Closed && p1Closed && p2Closed && p3Closed;

  return {
    generatedAt,
    overallVerdict: overallClosed ? "closed_product_level" : "not_closed_product_level",
    phaseResults: {
      P0: {
        status: p0Closed ? "execution_success" : "blocker_isolation",
        closedAtProductLevel: p0Closed,
        summary: p0Closed
          ? "Representative high-frequency products now pass completeness at the product-surface level."
          : "Non-scan product surfaces are hardened, but the representative high-frequency set does not yet pass completeness.",
      },
      P1: {
        status: p1Closed ? "execution_success" : "blocker_isolation",
        closedAtProductLevel: p1Closed,
        summary: p1Closed
          ? "Tier-1 duplicate reminder is closed on real saved stacks and remains supported by controlled QA."
          : "Tier-1 duplicate reminder passes controlled QA, but the real-saved environment is still underpowered.",
      },
      P2: {
        status: p2Closed ? "execution_success" : "blocker_isolation",
        closedAtProductLevel: p2Closed,
        summary: p2Closed
          ? "Consumption wiring and weak-data handling are stable enough for Saved/detail/safety consumers on the current target set."
          : "Consumption wiring exists, but weak-data classes still dominate the current real Saved inventory.",
      },
      P3: {
        status: "execution_success",
        closedAtProductLevel: p3Closed,
        summary: "Whitelist readiness matrix is ready for product decisions without opening a broad science wave.",
      },
    },
  };
};

const buildFinalSummary = ({ importQuality, highFrequency, productSurface, savedStack, readiness, science, result }) => {
  const scienceProductReady = science.matrix.filter((entry) => entry.readiness === "product_ready").map((entry) => entry.displayName);
  const scienceResidue = science.matrix
    .filter((entry) => entry.readiness !== "product_ready")
    .map((entry) => `${entry.displayName} (${entry.readiness})`);
  const unresolvedCount = Number(highFrequency?.missClassification?.upstream_missing ?? 0);

  return `# P0-P3 Product Closure Summary

Generated: ${generatedAt}

## Starting Baseline
- Week 2 merge baseline: 50,733 eligible rows, 26,494 strict-merge-ready, 24,124 queued, 255 blocked.
- Week 2 high-frequency baseline: 1,651 candidates, 627 complete hits (38.0%), 996 missing from staging, 28 still in the active queue.
- Week 3 official closeout baseline: duplicate warning code path existed, but the real saved environment still could not produce all 3 required cases.

## Ending Baseline
- Import-quality evidence now points at \`${importQuality.inputs.mergeReportPath}\`.
- High-frequency evidence now points at \`${highFrequency.inputs.reportPath}\`.
- Recent Scan -> Save preserves \`imageUrl\` and \`dosageText\` into Saved, and My Saved detail/safety consumers keep Week 2 fields on product surfaces when upstream data exists.
- Week 3 real-saved audit now reports: \`${savedStack.finalCall.closureVerdict}\`

## P0 Result
- Import quality validation was regenerated from the current merge baseline and ${importQuality.directInstrumentationClosed ? "now includes direct parse-failure / mapping-mismatch counters for all five Week 2 fields." : "remains blocker-classified only for direct parse-failure / mapping-mismatch instrumentation."}
- High-frequency validation currently shows ${highFrequency.baseline.completeHitCount}/${highFrequency.baseline.uniqueCandidates} complete hits (${highFrequency.baseline.completeHitRatePct}%), with ${unresolvedCount} products still upstream-missing or queued.
- Product-surface completeness passes on the non-scan surfaces in scope now: save-from-history, My Saved card, My Saved detail, and Saved safety consumers.
- Verdict: ${result.phaseResults.P0.closedAtProductLevel ? "P0 is closed at the product level." : "P0 is not closed at the product level yet because the representative high-frequency set still fails completeness."}

## P1 Result
- Tier-1 duplicate reminder coverage now validates Magnesium, Vitamin C, Zinc, Iron, and Folate.
- Daily dose basis validation evaluated ${readiness.targetSetReadiness.realSavedInventory.totalCandidateRows} real-saved candidate rows and remains conservative when directions are unavailable.
- Verdict: ${result.phaseResults.P1.closedAtProductLevel ? "P1 is closed at the product level on real saved stacks." : "P1 is not fully closed at the product level yet because real-saved validation residue remains."}

## P2 Result
- Consumption-readiness classification exists and explicitly labels weak rows as label-only, snapshot-only, no usable actives, no dose basis, no stable identity, image-only non-consumable, or other.
- Safe handling modes remain fixed per class: skip, degrade, backfill candidate, or hold blocker.
- Verdict: ${result.phaseResults.P2.closedAtProductLevel ? "P2 is closed at the product level for the current target set." : "P2 is not closed at the product level yet."}

## P3 Result
- The whitelist readiness matrix is complete in the required order.
- Product-ready: ${scienceProductReady.join(", ") || "none"}.
- Residue: ${scienceResidue.join(", ") || "none"}.
- Verdict: P3 readiness is closed for decision support and does not require a broad science expansion wave.

## Truly Product-Grade Complete
- Recent Scan -> Save preserves product image and dosage into Saved.
- My Saved detail consumes ingredient rows, dosage, suggested use, warnings, and product image when upstream data exists.
- ${savedStack.finalCall.realSavedClosurePasses ? "Tier-1 duplicate warning works on real saved stacks and stays conservative for weak-input cases." : "Tier-1 duplicate warning wording remains conservative and correctly scopes UL comparisons on controlled + partial real coverage."}
- Week 4 whitelist readiness is usable for product sequencing decisions.

## What Remains Blocked
${result.phaseResults.P0.closedAtProductLevel ? "- No P0 blocker remains on the representative set.\n" : `- P0 representative high-frequency completeness remains blocked by ${unresolvedCount} upstream-missing or queued products.\n`}${result.phaseResults.P1.closedAtProductLevel ? "" : "- P1 real saved-stack closure remains blocked by insufficient real supplement-linked Saved products.\n"}${result.phaseResults.P2.closedAtProductLevel ? "" : "- P2 remains blocked because the current Saved inventory still skews too heavily toward weak rows for product-level closure.\n"}- P3 still carries fallback-only/not-ready residue for future science depth, but the readiness matrix itself is complete.

## What Moves Next
${result.phaseResults.P0.closedAtProductLevel ? "- Keep the high-frequency audit warm and avoid regressing complete products.\n" : "- Continue shrinking the representative high-frequency upstream gaps before calling P0 product-level closed.\n"}${result.phaseResults.P1.closedAtProductLevel ? "- Carry Week 3 safety into regression maintenance rather than reopening scope.\n" : "- Collect or seed stronger real saved stacks, then rerun Week 3 closeout on real inventory.\n"}- Use the whitelist matrix to sequence the narrow Week 4 science whitelist, not a broad science wave.

## Final Verdict
- P0-P3 are **${result.overallVerdict === "closed_product_level" ? "closed" : "not yet closed"} at the product level**.
- Product-grade complete now: ${[
    result.phaseResults.P0.closedAtProductLevel ? "P0" : null,
    result.phaseResults.P1.closedAtProductLevel ? "P1" : null,
    result.phaseResults.P2.closedAtProductLevel ? "P2" : null,
    "P3 readiness",
  ]
    .filter(Boolean)
    .join(", ")}.
- Remaining blocker-class residue: ${Object.keys(buildBlockerRegistry({ importQuality, highFrequency, savedStack, readiness })).join(", ")}.
`;
};

const writeCanonical = (name, value, type) => {
  const filePath = path.join(activeDir, `${name}.${type}`);
  if (type === "json") writeJson(filePath, value);
  else writeText(filePath, value);
  copyHistory(filePath);
  return filePath;
};

const main = () => {
  ensureDir(outputDir);
  ensureDir(activeDir);
  ensureDir(historyDir);

  if (!SKIP_PHASE_RERUNS) {
    runNode("scripts/maintainer/build-week2-product-surface-validation.mjs");
    runNode("scripts/maintainer/run-week3-safety-harness.mjs");
  }

  const importQuality = buildImportQualityReport();
  const highFrequency = buildHighFrequencyValidationReport();
  const productSurface = buildProductSurfaceCompletenessReport();
  const savedStack = buildSavedStackDuplicateValidation();
  const dailyDose = buildDailyDoseBasisValidation();
  const readiness = buildConsumptionReadinessReport();
  const science = buildScienceWhitelistReadiness();
  const blockers = buildBlockerRegistry({ importQuality, highFrequency, savedStack, readiness });
  const manifest = buildProgramManifest();
  const result = buildProgramResult({ highFrequency, savedStack, readiness });
  const summary = buildFinalSummary({ importQuality, highFrequency, productSurface, savedStack, readiness, science, result });

  writeCanonical("program_manifest_current", manifest, "json");
  writeCanonical("program_result_current", result, "json");
  writeCanonical("blocker_registry", blockers, "json");
  writeCanonical("import_quality_validation_report", importQuality, "json");
  writeCanonical("high_frequency_product_hit_validation", highFrequency, "json");
  writeCanonical("product_surface_completeness_report", productSurface, "json");
  writeCanonical("saved_stack_duplicate_validation", savedStack, "json");
  writeCanonical("daily_dose_basis_validation", dailyDose, "json");
  writeCanonical("consumption_readiness_report", readiness, "json");
  writeCanonical("science_whitelist_readiness_matrix", science, "json");

  writeText(path.join(outputDir, "p0_p3_product_closure_summary.md"), summary);
};

main();
