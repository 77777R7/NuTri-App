import assert from "node:assert/strict";
import test from "node:test";

import { buildFactsDigestFromLnhpd } from "../../backend/src/factsDigest";

test("buildFactsDigestFromLnhpd parses population/dose/frequency from LNHPD dose lines", () => {
  const digest = buildFactsDigestFromLnhpd({
    identityValue: "00335940",
    facts: {
      brandName: "Jamieson",
      productName: "Vitamin B12 250 mcg",
      npn: "00335940",
      servingSize: null,
      servingsPerContainer: null,
      actives: [
        {
          name: "Vitamin B12",
          amount: 250,
          unit: "mcg",
        },
      ],
      inactive: [],
      purposes: [],
      routes: [],
      doses: ["Adults: 1 tablet, once daily"],
      datasetVersion: null,
      extractedAt: null,
    },
  });

  assert.equal(digest.labelDosing.length, 1);
  assert.equal(digest.labelDosing[0]?.population, "Adults");
  assert.equal(digest.labelDosing[0]?.dose, "1 tablet");
  assert.equal(digest.labelDosing[0]?.frequency, "once daily");
  assert.equal(digest.labelDosing[0]?.rawText, "Adults: 1 tablet, once daily");
});

