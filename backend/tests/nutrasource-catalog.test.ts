import assert from "node:assert/strict";
import test from "node:test";

import {
  extractProgramsFromNutrasourceFlags,
  normalizeBrandKey,
  normalizeProductCore,
  parseNutrasourceBrandPageProducts,
  parseNutrasourceBrandSearchResults,
  parseNutrasourceProductDetail,
  scoreBrandNameMatch,
  scoreProductNameMatch,
} from "../src/qualityMarks/nutrasourceCatalog.js";

test("brand search results keep raw programs and select high-confidence rows", () => {
  const body = JSON.stringify({
    list: [
      { BrandId: "CRLL", Name: "Carlson Nutritional Supplements", HasIfos: true, HasIgen: true },
      { BrandId: "CAR2", Name: "Carlson Labs Europe", HasIgen: true },
    ],
  });

  const results = parseNutrasourceBrandSearchResults(body, "Carlson");
  assert.equal(results[0]?.brandId, "CRLL");
  assert.deepEqual(results[0]?.brandProgramsRaw, ["ifos", "igen"]);
  assert.equal(results[0]?.selectedForCrawl, true);
});

test("brand page products parse product ids and titles", () => {
  const products = parseNutrasourceBrandPageProducts(
    `
      <a href="/certified-products/product?id=BARL0001"><div>thumb</div></a>
      <div><h3 class="results__brand"><strong><a href="/certified-products/product?id=BARL0001">Ideal Omega 3</a></strong></h3></div>
      <a href="/certified-products/product?id=BARL0007"><div>thumb</div></a>
      <div><h3 class="results__brand"><strong><a href="/certified-products/product?id=BARL0007">Total Omega Vegan Pomegranate Blueberry Smoothie</a></strong></h3></div>
    `,
    "BARL",
    "Barlean's",
    ["ifos", "igen"],
  );

  assert.equal(products.length, 2);
  assert.equal(products[0]?.productNum, "BARL0001");
  assert.deepEqual(products[0]?.programsBrandRaw, ["ifos", "igen"]);
});

test("product detail parser resolves effective programs and lot options", () => {
  const detail = parseNutrasourceProductDetail(
    `
      <title>Ideal Omega 3 | Barlean's | Certifications by Nutrasource</title>
      <section>
        <h3>Product Summary</h3>
        <div class="certification-results certification-results--ifos">
          <h2 class="h2--lg">IFOS&trade; Testing Results</h2>
        </div>
        <select id="ReportIfos">
          <option value="">--Select--</option>
          <option value="lot-report.pdf">Lot #: 25002676 (Jul 31, 2028)</option>
        </select>
      </section>
      <footer></footer>
    `,
    "BARL0001",
    "https://certifications.nutrasource.ca/certified-products/product?id=BARL0001",
    "BARL",
    ["ifos", "igen"],
  );

  assert.equal(detail.productName, "Ideal Omega 3");
  assert.deepEqual(detail.programsProductRaw, ["ifos"]);
  assert.deepEqual(detail.programsEffective, ["ifos"]);
  assert.equal(detail.lotOptions.length, 1);
});

test("brand and product normalization stays deterministic for matching", () => {
  assert.equal(normalizeBrandKey("Carlson Nutritional Supplements"), "carlson");
  assert.equal(scoreBrandNameMatch("Act", "Arbee Biomarine Extracts Pvt Ltd.").highConfidence, false);
  assert.equal(
    normalizeProductCore("Carlson Elite Omega-3 Plus D & K, Natural Lemon, 180 Soft Gels", "Carlson"),
    "elite omega 3 plus d k",
  );
  assert.equal(scoreBrandNameMatch("Carlson", "Carlson Nutritional Supplements").highConfidence, true);
  assert.equal(
    scoreProductNameMatch(
      "Carlson",
      "Carlson Elite Omega-3 Plus D & K, Natural Lemon, 180 Soft Gels",
      "Elite Omega-3 Plus D & K",
    ).highConfidence,
    true,
  );
  assert.equal(
    scoreProductNameMatch("Sports Research", "Astaxanthin 12mg", "Astaxanthin 6mg").highConfidence,
    false,
  );
});

test("raw program flags only keep visible nutrasource booleans", () => {
  assert.deepEqual(
    extractProgramsFromNutrasourceFlags({
      HasIfos: true,
      HasIgen: true,
      HasNutraStrong: false,
      Name: "Barlean's",
    }),
    ["ifos", "igen"],
  );
});
