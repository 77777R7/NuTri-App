import assert from "node:assert/strict";
import test from "node:test";

import {
  qualifiesHighConfidenceUsProductPage,
  resolveCurrentCompleteness,
} from "../../scripts/maintainer/lib/iherb-overlay-utils.mjs";

test("resolveCurrentCompleteness ignores stale queue completeness when current staging payload is complete", () => {
  const record = {
    productId: "1096",
    barcode_gtin14: "00021078009597",
    link: "https://www.iherb.com/pr/source-naturals-ccm-calcium-300-mg-120-tablets/1096",
    productCatalogImage: "https://example.test/source-naturals.jpg",
    sourceSummary: {
      hasUsIherbPage: true,
      sourceTypes: ["iherb_product_page"],
    },
    supplementFacts: {
      servingSize: "4 Tablets",
      servingsPerContainer: "30",
      nutritionalFacts: [
        {
          substancy: "Calcium",
          amountPerServing: "1,200 mg",
          dailyValuePercent: "92%",
        },
      ],
    },
    descriptionSections: {
      "Suggested use": "1 to 4 tablets daily, before going to bed or with a meal.",
      Warnings: "If you are pregnant, may become pregnant, or breastfeeding, consult your health care professional.",
    },
    completeness: {
      status: "partial_overlay",
      coreResolvedFields: ["ingredient", "dosage", "suggested_use", "product_image"],
      coreMissingFields: ["warnings"],
    },
  };

  const completeness = resolveCurrentCompleteness(record);

  assert.equal(completeness.status, "full_overlay_ready");
  assert.deepEqual(completeness.coreMissingFields, []);
  assert.ok(completeness.coreResolvedFields.includes("warnings"));
  assert.equal(qualifiesHighConfidenceUsProductPage(record, completeness), true);
});
