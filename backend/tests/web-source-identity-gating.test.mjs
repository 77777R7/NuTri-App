import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildProviderVerdict,
  selectBestWebCandidates,
} from "../dist/webIdentityProviders.js";

test("authoritative candidate blocks marketplace from becoming best", () => {
  const selection = selectBestWebCandidates([
    {
      url: "https://www.ebay.ca/itm/123",
      domain: "ebay.ca",
      isMarketplace: true,
      isAuthoritative: false,
      strongOwnership: true,
      rankScore: 90,
    },
    {
      url: "https://nationalnutrition.ca/product",
      domain: "nationalnutrition.ca",
      isMarketplace: false,
      isAuthoritative: true,
      strongOwnership: false,
      rankScore: 70,
    },
  ]);

  assert.equal(selection.authoritativeCandidatePresent, true);
  assert.equal(selection.selected[0]?.domain, "nationalnutrition.ca");
  assert.ok(selection.marketplaceRejectedCount >= 1);
});

test("marketplace candidate without strong ownership is rejected", () => {
  const selection = selectBestWebCandidates([
    {
      url: "https://www.ebay.ca/itm/123",
      domain: "ebay.ca",
      isMarketplace: true,
      isAuthoritative: false,
      strongOwnership: false,
      rankScore: 99,
    },
    {
      url: "https://example.org/info",
      domain: "example.org",
      isMarketplace: false,
      isAuthoritative: false,
      strongOwnership: false,
      rankScore: 70,
    },
  ]);

  assert.equal(selection.authoritativeCandidatePresent, false);
  assert.equal(selection.selected[0]?.domain, "example.org");
  assert.equal(selection.marketplaceRejectedCount, 1);
});

test("provider gtin match upgrades ownership verdict to strong", () => {
  const verdict = buildProviderVerdict(
    {
      hasBarcodeMatch: false,
      hasRegulatoryIdMatch: false,
      hasBrandSignal: true,
      hasNameSignal: true,
      providerGtinMatch: true,
    },
    {
      provider: "openfoodfacts",
      brand: "Jamieson",
      productName: "Melatonin",
      gtinMatched: true,
      confidence: "strong",
      sourceUrl: "https://world.openfoodfacts.org/product/00064642059000",
    },
  );

  assert.equal(verdict.ownershipVerdict, "strong");
  assert.equal(verdict.providerUsed, "openfoodfacts");
  assert.equal(verdict.providerGtinMatch, true);
});
