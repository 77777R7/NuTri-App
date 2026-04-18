import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOverlayCandidateFromScrapling,
  normalizeScraplingResult,
} from "../../scripts/maintainer/lib/scrapling-normalizers.mjs";

test("scrapling iHerb candidates preserve US iHerb readiness from source URLs", () => {
  const normalizedResult = normalizeScraplingResult({
    pageUrl: "https://www.iherb.com/pr/now-foods-omega-3-6-9-250-softgels/723",
    finalUrl: "https://ca.iherb.com/pr/now-foods-omega-3-6-9-250-softgels/723",
    title: "NOW Foods, Omega 3-6-9, 250 Softgels",
    sections: {
      "Suggested use": "Take 2 softgels daily with food.",
      Warnings: "For adults only.",
    },
    nutritionalFacts: [
      { substancy: "Omega 3-6-9", amountPerServing: "2,000 mg" },
    ],
    productCatalogImage: "https://cloudinary.images-iherb.com/image/upload/example.jpg",
  });

  const candidate = buildOverlayCandidateFromScrapling({
    normalizedResult,
    queueEntry: {
      productId: "723",
      brandName: "NOW Foods",
      title: "NOW Foods, Omega 3-6-9, 250 Softgels",
      barcode_gtin14: "00733739018373",
      link: "https://www.iherb.com/pr/now-foods-omega-3-6-9-250-softgels/723",
    },
  });

  assert.equal(candidate.sourceSummary.hasUsIherbPage, true);
  assert.deepEqual(candidate.sourceSummary.marketSources, ["us"]);
});
