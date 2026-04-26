import assert from "node:assert/strict";
import test from "node:test";

import {
  attachRunOrder,
  classifyRetryOutcome,
  createServiceWindowTracker,
  extractCoreScoreSnapshot,
  findServer5xxWindows,
  buildCensus,
  buildServer5xxBucketRows,
  evaluateAiSummary,
  evaluateContentValue,
  inferFamily,
  isRetryableStreamTerminationAttempt,
  linkClientTimeoutTriggers,
  normalizeOverlayProduct,
  parseArgs,
  productKey,
  updateServiceWindowTracker,
} from "../../scripts/maintainer/lib/scan-result-full-corpus-audit.mjs";

test("full-corpus manifest normalizes overlay rows and classifies supplement gaps", () => {
  const row = normalizeOverlayProduct({
    product_id: "p1",
    upc_code: "123456789012",
    barcode_gtin14: "00123456789012",
    brand_name: "Test Brand",
    title: "Magnesium Glycinate 200 mg Capsules",
    categories: ["Supplements", "Minerals"],
    supplement_facts: {
      nutritionalFacts: [
        { substancy: "Magnesium (as magnesium glycinate)", amountPerServing: "200", unit: "mg", form: "glycinate" },
      ],
    },
    description_sections: {
      "Suggested Use": "Take 2 capsules daily.",
      Warnings: "Keep out of reach of children.",
    },
    link: "https://www.iherb.com/pr/test",
    source_zip_path: "iherb/test.zip",
  });

  assert.equal(row.productId, "p1");
  assert.equal(row.barcode, "00123456789012");
  assert.equal(row.family, "magnesium");
  assert.equal(row.factsStatus, "full");
  assert.equal(row.sourceTier, "iherb");
  assert.deepEqual(row.missingCriticalFields, []);
  assert.equal(row.likelySupplement, true);
});

test("family inference prefers product and ingredient pattern signals", () => {
  const family = inferFamily({
    productName: "SAM-e 400 mg",
    brand: "Example",
    category: "Supplements",
    categories: [],
    ingredientRows: [{ name: "S-Adenosylmethionine", form: null }],
    otherIngredients: null,
  });
  assert.equal(family.family, "same");
  assert.equal(family.source, "pattern_dictionary");
});

test("census captures barcode, productId-only, and missing critical data buckets", () => {
  const products = [
    normalizeOverlayProduct({ product_id: "p1", barcode_gtin14: "00123456789012", title: "Vitamin C", supplement_facts: [{ name: "Vitamin C", amountPerServing: "500", unit: "mg" }] }),
    normalizeOverlayProduct({ product_id: "p2", title: "Unknown supplement", supplement_facts: [] }),
  ];
  const census = buildCensus(products);
  assert.equal(census.totalSupplements, 2);
  assert.equal(census.barcodeCapableCount, 1);
  assert.equal(census.productIdOnlyCount, 1);
  assert.equal(census.missingActiveIngredientsCount, 1);
  assert.equal(census.missingBarcodeCount, 1);
});

test("AI summary audit flags visible unavailable as P0 and generic fallback as P1", () => {
  const product = { family: "omega_3", productName: "Fish Oil", brand: "Brand", activeIngredientNames: ["Fish Oil"] };
  const unavailable = evaluateAiSummary({
    type: "scientific_background",
    product,
    payload: { introLine: "Unavailable", sections: [] },
    source: "fallback",
    fallbackUsed: true,
    fallbackReason: "parse_failed",
  });
  assert.equal(unavailable.severity, "P0");
  assert.equal(unavailable.visibleUnavailableText, true);

  const generic = evaluateAiSummary({
    type: "scientific_background",
    product,
    payload: { introLine: "This supplement supports general wellness.", sections: [{ summary: "Broad support for a daily wellness routine." }] },
    source: "fallback",
    fallbackUsed: true,
    fallbackReason: "ai_not_configured",
  });
  assert.equal(generic.severity, "P1");
});

test("content value scoring produces weighted 0-100 overall score", () => {
  const product = {
    family: "vitamin_c",
    productName: "Vitamin C 500 mg",
    brand: "Brand",
    activeIngredientNames: ["Vitamin C"],
    labelDirections: "Take 1 tablet daily.",
    warnings: "Consult a clinician if pregnant.",
  };
  const score = evaluateContentValue({
    product,
    decisionSupport: {
      personalizedResultLane: { safety: "Vitamin C context for this label." },
      nutriScoreCardV2: { overallScore: 80 },
      usageBlock: { dosage: "1 tablet daily" },
      safetyBlock: { warning: "Label warning is present." },
    },
    sidecars: {
      ingredient_overview: { payload: { titleLine: "Vitamin C", compareHint: "Compare form and 500 mg dose." } },
      scientific_background: { payload: { introLine: "Research evidence is stronger for vitamin C deficiency contexts; compare dose and form." } },
    },
  });
  assert.ok(score.overall_scan_result_value_score >= 60);
  assert.ok(score.overall_scan_result_value_score <= 100);
});

test("CLI args default to configured Render target and live AI stays opt-in", () => {
  const args = parseArgs(["--run-id", "abc", "--limit", "5", "--mode", "sidecar"]);
  assert.equal(args.runId, "abc");
  assert.equal(args.limit, 5);
  assert.equal(args.mode, "sidecar");
  assert.equal(args.confirmLiveAi, false);
  assert.match(args.stagingUrl, /^https:\/\/nutri-app-qn0u\.onrender\.com/);
});

test("product keys are stable for barcode and productId-only rows", () => {
  assert.equal(productKey({ barcode: "00123456789012", productId: "p1" }), "barcode:00123456789012");
  assert.equal(productKey({ barcode: null, productId: "p2" }), "product:p2");
});

test("family inference does not let inactive magnesium stearate steal the anchor", () => {
  const row = normalizeOverlayProduct({
    product_id: "p-calcium",
    title: "Calcium Citrate & Vitamin D3",
    categories: ["Supplements", "Calcium"],
    supplement_facts: [
      { substancy: "Calcium", amountPerServing: "300", unit: "mg", form: "citrate" },
      { substancy: "Vitamin D3", amountPerServing: "1000", unit: "IU" },
    ],
    description_sections: {
      "Other Ingredients": "Cellulose, magnesium stearate.",
    },
  });

  assert.equal(row.family, "calcium");
  assert.notEqual(row.family, "magnesium");
});

test("family inference skips macro nutrition rows before choosing a family", () => {
  const row = normalizeOverlayProduct({
    product_id: "p-protein",
    title: "Whey Protein Isolate",
    supplement_facts: [
      { substancy: "Calories", amountPerServing: "120" },
      { substancy: "Total Carbohydrate", amountPerServing: "2", unit: "g" },
      { substancy: "Whey Protein Isolate", amountPerServing: "25", unit: "g" },
    ],
  });

  assert.equal(row.family, "protein");
  assert.notEqual(row.family, "calories");
});

test("unmapped first active text does not become a fake runtime family", () => {
  const row = normalizeOverlayProduct({
    product_id: "p-noisy",
    title: "Generic Daily Supplement",
    supplement_facts: [
      { substancy: "Includes 0 g Added Sugars", amountPerServing: "0", unit: "g" },
    ],
  });

  assert.equal(row.family, "unclassified");
  assert.equal(row.familyMatchSource, "first_active_candidate_unmapped");
});

test("P0 analyzer detects contiguous 5xx service windows over manifest order", () => {
  const products = [
    { barcode: "00000000000001" },
    { barcode: "00000000000002" },
    { barcode: "00000000000003" },
    { barcode: "00000000000004" },
    { barcode: "00000000000005" },
  ];
  const rows = attachRunOrder([
    { productKey: productKey(products[0]), httpStatus: 200, pass: true, family: "omega_3", brand: "A" },
    { productKey: productKey(products[1]), httpStatus: null, clientTimeout: true, failureClass: "client_timeout", family: "magnesium", brand: "B" },
    { productKey: productKey(products[2]), httpStatus: 502, failureClass: "server_5xx", family: "iron", brand: "C" },
    { productKey: productKey(products[3]), httpStatus: 502, failureClass: "server_5xx", family: "zinc", brand: "D" },
    { productKey: productKey(products[4]), httpStatus: 200, pass: true, family: "b12", brand: "E" },
  ], products);

  const windows = findServer5xxWindows(rows, { largeWindowMin: 2 });
  assert.equal(windows.length, 1);
  assert.equal(windows[0].startRunOrder, 3);
  assert.equal(windows[0].endRunOrder, 4);
  assert.equal(windows[0].previousWasClientTimeout, true);
  assert.equal(windows[0].recoveredAfterWindow, true);
  assert.equal(windows[0].preliminaryClassification, "service_window_5xx");
});

test("P0 analyzer links client timeout triggers to the next 5xx window", () => {
  const rows = [
    { productKey: "a", runOrder: 1, clientTimeout: true, failureClass: "client_timeout" },
    { productKey: "b", runOrder: 2, httpStatus: 502, failureClass: "server_5xx" },
    { productKey: "c", runOrder: 3, httpStatus: 502, failureClass: "server_5xx" },
  ];
  const windows = findServer5xxWindows(rows, { largeWindowMin: 2 });
  const triggers = linkClientTimeoutTriggers(rows, windows);
  assert.equal(triggers.length, 1);
  assert.equal(triggers[0].next5xxWindowId, "w1");
  assert.equal(triggers[0].immediatelyPrecedesWindow, true);
});

test("P0 bucket rows include run-order segments and barcode prefixes", () => {
  const rows = [
    { runOrder: 1, barcode: "00123456789012", httpStatus: 502, failureClass: "server_5xx", family: "omega_3", brand: "A", sourceTier: "iherb", factsStatus: "full" },
    { runOrder: 1001, barcode: "00999956789012", httpStatus: 503, failureClass: "server_5xx", family: "iron", brand: "B", sourceTier: "official", factsStatus: "partial" },
  ];
  const buckets = buildServer5xxBucketRows(rows, { segmentSize: 1000 });
  assert.ok(buckets.some((row) => row.dimension === "barcodePrefix6" && row.bucket === "001234"));
  assert.ok(buckets.some((row) => row.dimension === "runOrderSegment" && row.bucket === "1001-2000"));
});

test("score extraction follows frontend-aligned inline decision support score path", () => {
  const snapshot = extractCoreScoreSnapshot({
    meta: {
      decisionSupportInline: {
        nutriScoreCardV2: {
          overallScore: 82,
          overallBand: "Strong",
          modules: [{ id: "ingredient_safety", score: 80 }],
        },
      },
    },
  });
  assert.equal(snapshot.available, true);
  assert.equal(snapshot.path, "bundle.meta.decisionSupportInline.nutriScoreCardV2");
  assert.equal(snapshot.overallScore, 82);
  assert.equal(snapshot.moduleCount, 1);
});

test("retry outcome records transient 5xx recovery without treating it as final product failure", () => {
  const outcome = classifyRetryOutcome([
    { httpStatus: 502, failureClass: "server_5xx" },
    { httpStatus: 200, failureClass: null },
  ]);
  assert.equal(outcome, "transient_5xx_retry_recovered");
});

test("retry outcome records transient stream termination recovery", () => {
  const first = {
    httpStatus: 200,
    terminal: "REQUEST_ERROR",
    failureClass: "terminal_state",
    serverError: "terminated",
    eventCount: 0,
  };
  assert.equal(isRetryableStreamTerminationAttempt(first), true);
  const outcome = classifyRetryOutcome([
    first,
    { httpStatus: 200, terminal: "DONE", failureClass: null, eventCount: 2 },
  ]);
  assert.equal(outcome, "transient_stream_retry_recovered");
});

test("service window tracker assigns one window id after consecutive 5xx and resets on recovery", () => {
  const tracker = createServiceWindowTracker({ maxConsecutive5xx: 2 });
  assert.equal(updateServiceWindowTracker(tracker, { httpStatus: 502 }).serviceWindowId, null);
  const opened = updateServiceWindowTracker(tracker, { httpStatus: 503 });
  assert.equal(opened.serviceWindowId, "sw-1");
  assert.equal(opened.circuitBreakerOpen, true);
  assert.equal(updateServiceWindowTracker(tracker, { httpStatus: 504 }).serviceWindowId, "sw-1");
  const recovered = updateServiceWindowTracker(tracker, { httpStatus: 200 });
  assert.equal(recovered.serviceWindowId, null);
  assert.equal(recovered.circuitBreakerOpen, false);
});
