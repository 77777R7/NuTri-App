import assert from "node:assert/strict";
import { test } from "node:test";

import { buildFactsDigestFromLnhpd } from "../dist/factsDigest.js";
import { mapLnhpdFactsToFactsDTO } from "../dist/insights/factsMapper.js";
import { inferLnhpdActivesFromProductName } from "../dist/lnhpd/inferredActives.js";

test("LNHPD inferred actives are emitted with low confidence and explicit inferred evidence text", () => {
  const inferred = inferLnhpdActivesFromProductName("L-Glutamine");
  assert.equal(inferred.length, 1);

  const digest = buildFactsDigestFromLnhpd({
    identityValue: "80010311",
    facts: {
      brandName: "Example Brand",
      productName: "L-Glutamine",
      npn: "80010311",
      servingSize: null,
      servingsPerContainer: null,
      actives: inferred,
      inactive: [],
      purposes: [],
      routes: [],
      doses: [],
      datasetVersion: null,
      extractedAt: null,
    },
    snapshot: null,
  });

  assert.equal(digest.actives.length, 1);
  assert.equal(digest.actives[0].name, "L-Glutamine");
  assert.equal(digest.actives[0].confidence, 0.35);
  assert.match(
    digest.actives[0].evidenceText ?? "",
    /inferred from product name/i,
  );
});

test("facts mapper carries inferred attribution note for LNHPD product-name inference", () => {
  const inferred = inferLnhpdActivesFromProductName("Pau D'arco (Capsules)");
  assert.equal(inferred.length, 1);

  const dto = mapLnhpdFactsToFactsDTO({
    npn: "80043836",
    productName: "Pau D'arco (Capsules)",
    brandName: "Example Brand",
    actives: inferred,
    inactive: [],
    purposes: [],
    routes: [],
    doses: [],
    datasetVersion: null,
    extractedAt: null,
    isComplete: false,
    missingFields: [],
    factsJson: null,
  });

  assert.equal(dto.ingredients.actives.length, 1);
  assert.ok(
    dto.ingredients.actives[0].notes?.includes("inferred_from_product_name_low_confidence"),
  );
});

