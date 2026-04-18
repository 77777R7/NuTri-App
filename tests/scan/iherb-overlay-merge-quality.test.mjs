import assert from "node:assert/strict";
import test from "node:test";

import { mergeOverlayRecords } from "../../scripts/maintainer/lib/iherb-overlay-utils.mjs";

const buildBaseRecord = () => ({
  brandName: "Schiff",
  title: "Schiff, Move Free Joint Health, Ultra Pro, 120 Coated Tablets",
  normalizedTitle: "schiff, move free joint health, ultra pro, 120 coated tablets",
  productId: "122302",
  upcCode: "020525101457",
  barcode_gtin14: "00020525101457",
  link: "https://www.iherb.com/pr/schiff-move-free-joint-health-ultra-pro-120-coated-tablets/122302",
  productCatalogImage: "https://example.com/front.jpg",
  productImages: [],
  categories: [],
  count: "120 count",
  dosageForm: "tablets",
  serving: {
    servingType: null,
    servingDescription: null,
    servingSize: "4 Tablets",
    servingsPerContainer: 30,
  },
  descriptionSections: {
    Description: "Joint support formula.",
  },
});

test("mergeOverlayRecords keeps cleaner current supplement facts over noisier OCR supplement facts", () => {
  const current = {
    ...buildBaseRecord(),
    supplementFacts: {
      servingSize: "4 Tablets",
      servingsPerContainer: "30",
      nutritionalFacts: [
        {
          substancy: "Manganese (as manganese gluconate)",
          amountPerServing: "2.3 mg",
          dailyValuePercent: "100%*",
        },
        {
          substancy: "MSM (Methylsulfonylmethane)",
          amountPerServing: "1,500 mg",
          dailyValuePercent: "†",
        },
        {
          substancy: "Calcium Fructoborate",
          amountPerServing: "216 mg",
          dailyValuePercent: "†",
        },
        {
          substancy:
            "Proprietary Cartilage Blend (cartilage and potassium chloride) (providing undenatured type II collagen)",
          amountPerServing: "40 mg",
          dailyValuePercent: "†",
        },
      ],
    },
    sourceSummary: {
      sourceKind: "zip_iherb_us",
      sourceTypes: ["iherb_us_product_page"],
      marketSources: ["us"],
      sourceUrls: ["https://www.iherb.com/pr/schiff-move-free-joint-health-ultra-pro-120-coated-tablets/122302"],
      sourceNotes: ["rapidapi:schiff:missing_brand_wave"],
      npnIgnored: false,
      hasUsIherbPage: true,
      sourceRank: 100,
    },
  };

  const incoming = {
    ...buildBaseRecord(),
    supplementFacts: {
      servingSize: "4 Tablets",
      servingsPerContainer: "30",
      nutritionalFacts: [
        {
          substancy: "Manganese",
          amountPerServing: "2.3 mg",
          dailyValuePercent: "100%",
        },
        {
          substancy: "MSM (Methylsulfonylmethane)",
          amountPerServing: "1,500 mg",
          dailyValuePercent: null,
        },
        {
          substancy: "Calcium Fructoborate",
          amountPerServing: "216 mg",
          dailyValuePercent: null,
        },
        {
          substancy: "cartilage and potassium",
          amountPerServing: "40 mg",
          dailyValuePercent: null,
        },
        {
          substancy: "Proprietary Cartilage Blend",
          amountPerServing: "216 mg",
          dailyValuePercent: null,
        },
        {
          substancy: "Amount % Daily Manganese (as manganese gluconate)",
          amountPerServing: "2.3 mg",
          dailyValuePercent: null,
        },
        {
          substancy: "T Calcium Fructoborate",
          amountPerServing: "216 mg",
          dailyValuePercent: null,
        },
        {
          substancy: "Proprietary Cartilage Blend (cartilage and potassium",
          amountPerServing: "40 mg",
          dailyValuePercent: null,
        },
      ],
    },
    sourceSummary: {
      sourceKind: "seed_catalog",
      sourceTypes: ["official_product_page", "official_product_label_image_ocr"],
      marketSources: ["us"],
      sourceUrls: ["https://www.schiffvitamins.com/products/move-free-ultra"],
      sourceNotes: ["official_image_ocr"],
      npnIgnored: false,
      hasUsIherbPage: true,
      sourceRank: 90,
    },
  };

  const merged = mergeOverlayRecords(current, incoming);
  assert.deepEqual(merged.supplementFacts, current.supplementFacts);
});
