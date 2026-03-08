import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const DASHBOARD_FILE = path.join(process.cwd(), "components/scan/AnalysisDashboard.tsx");

const source = fs.readFileSync(DASHBOARD_FILE, "utf8");

test("simple mode keeps a single missing-info CTA in overview", () => {
  assert.ok(source.includes("const isSingleCtaAllowed = (sheetType: TileType): boolean => sheetType === 'overview';"));
  assert.ok(source.includes("scan_missing_info_cta_clicked"));

  const ctaToken = "Scan Supplement Facts + Warnings panel";
  const occurrences = source.split(ctaToken).length - 1;
  assert.equal(occurrences, 1, "CTA copy should only appear once in simple overview path");

  assert.ok(
    source.includes("Product-specific label warnings were not available in the official record."),
    "Safety notice should be message-only and explicit",
  );
});

test("simple mode keeps science sheet factual form semantics without low-confidence narration", () => {
  assert.ok(source.includes("Chemical Form"));
  assert.ok(source.includes("Delivery Type"));
  assert.ok(source.includes("title=\"Ingredient overview\""));
  assert.ok(source.includes("title=\"Scientific background\""));
  assert.equal(source.includes("Possible chemical form (low confidence):"), false);
});

test("simple taxonomy whitelist is enforced", () => {
  assert.ok(source.includes("const SIMPLE_TAXONOMY_WHITELIST = new Set("));
  assert.ok(source.includes("'Official record'"));
  assert.ok(source.includes("'Scanned label'"));
  assert.ok(source.includes("'Verified'"));
  assert.ok(source.includes("'General science (NIH ODS)'"));
  assert.ok(source.includes("'AI summary'"));
  assert.ok(source.includes("resolveSimpleTaxonomyLabel"));
});

test("scan UX events emit required event names", () => {
  const requiredEvents = [
    "scan_sheet_opened",
    "scan_sheet_closed",
    "scan_source_drawer_opened",
    "scan_missing_info_cta_clicked",
    "scan_summary_rendered",
  ];
  for (const eventName of requiredEvents) {
    assert.ok(source.includes(eventName), `missing event: ${eventName}`);
  }
});

test("single-ingredient mode hides selector by default", () => {
  assert.ok(
    source.includes("const showIngredientSelector = keyIngredientsForDetail.length > 1;"),
    "single-ingredient products should not render selector controls",
  );
});

test("scan summary telemetry includes required payload fields", () => {
  const requiredPayloadKeys = [
    "viewMode: SCAN_UX_VIEW_MODE",
    "variant: SCAN_UX_VARIANT",
    "sheetType:",
    "sourceType:",
    "sourceTypeFinal:",
    "dwellMs:",
    "maxScrollRatio:",
    "summaryVersion:",
    "guardApplied:",
    "fallbackUsed:",
  ];
  for (const key of requiredPayloadKeys) {
    assert.ok(source.includes(key), `missing telemetry payload key: ${key}`);
  }
});
