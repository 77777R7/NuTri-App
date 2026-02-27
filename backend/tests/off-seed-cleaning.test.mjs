import assert from "node:assert/strict";
import { test } from "node:test";

import { buildOffSeedCandidates } from "../dist/offSeedCandidates.js";

test("OFF cleaning splits primary and US/CA shadow lanes and applies supplement gate", () => {
  const existing = new Set(["00000000000001"]);
  const input = [
    {
      code: "00000000000001",
      product_name: "Vitamin D3 1000 IU",
      brands: "Brand A",
      categories: "supplements",
      countries_tags: ["en:france"],
      url: "https://world.openfoodfacts.org/product/00000000000001",
    },
    {
      code: "00000000000002",
      product_name: "Vitamin C Gummies",
      brands: "Brand B",
      categories: "dietary supplements",
      countries_tags: ["en:france"],
      url: "https://world.openfoodfacts.org/product/00000000000002",
    },
    {
      code: "00000000000003",
      product_name: "Omega 3 Softgels",
      brands: "Brand C",
      categories: "dietary supplements",
      countries_tags: ["en:united-states"],
      url: "https://world.openfoodfacts.org/product/00000000000003",
    },
    {
      code: "00000000000004",
      product_name: "Body Lotion",
      brands: "Brand D",
      categories: "beauty",
      countries_tags: ["en:canada"],
      url: "https://world.openfoodfacts.org/product/00000000000004",
    },
  ];

  const out = buildOffSeedCandidates({ records: input, existingBarcodes: existing });
  assert.equal(out.primary.length, 1);
  assert.equal(out.primary[0]?.barcode_gtin14, "00000000000002");
  assert.equal(out.shadowUsCa.length, 1);
  assert.equal(out.shadowUsCa[0]?.barcode_gtin14, "00000000000003");
  assert.ok(out.rejected.some((row) => row.reason === "existing_in_registry"));
  assert.ok(out.rejected.some((row) => row.reason === "non_supplement_signals"));
});

