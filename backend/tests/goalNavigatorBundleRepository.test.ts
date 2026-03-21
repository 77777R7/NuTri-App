import assert from "node:assert/strict";
import test from "node:test";

import { goalNavigatorBundleRepositoryInternals } from "../src/personalization/goalNavigatorBundleRepository";

test("goal navigator bundle repository prioritizes actionable gap classes over generic low disclosure", () => {
  const priorities = goalNavigatorBundleRepositoryInternals.buildGapPriorities([
    {
      id: "gap_1",
      productId: "80733",
      sourceProductId: "80733",
      title: "Carlson Serrapeptase",
      brandName: "Carlson",
      factsStatus: "partial",
      gapCodes: ["missing_unit", "low_disclosure"],
      details: {
        missingDoseCount: 0,
      },
      createdAt: "2026-03-21T00:00:00.000Z",
    },
    {
      id: "gap_2",
      productId: "116630",
      sourceProductId: "116630",
      title: "WishGarden Sleepy Nights",
      brandName: "WishGarden Herbs",
      factsStatus: "partial",
      gapCodes: ["missing_dose", "unresolved_ingredient", "low_disclosure"],
      details: {
        missingDoseCount: 3,
      },
      createdAt: "2026-03-21T00:00:00.000Z",
    },
  ]);

  assert.deepEqual(priorities, [
    {
      key: "missing_unit",
      affectedProducts: 1,
      recommendedAction:
        "Extend dose parsing for supported label units like SPU, IU, CFU, and ingredient-level mL disclosures.",
      sampleTitles: ["Carlson Serrapeptase"],
    },
    {
      key: "unresolved_ingredient",
      affectedProducts: 1,
      recommendedAction:
        "Split overlay blend rows into real ingredient members and expand alias cleanup for label-heavy ingredient names.",
      sampleTitles: ["WishGarden Sleepy Nights"],
    },
    {
      key: "missing_dose",
      affectedProducts: 1,
      recommendedAction:
        "Preserve ingredient identity but backfill per-ingredient dose disclosure before allowing these products into coverage-ready ranking.",
      sampleTitles: ["WishGarden Sleepy Nights"],
    },
  ]);
});
