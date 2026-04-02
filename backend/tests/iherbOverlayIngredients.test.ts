import assert from "node:assert/strict";
import test from "node:test";

import {
  iherbOverlayIngredientInternals,
  normalizeIherbSupplementFactsRows,
} from "../src/iherbOverlayIngredients";

test("overlay ingredient normalization keeps a single disclosed proprietary blend member with its dose", () => {
  const rows = normalizeIherbSupplementFactsRows([
    {
      substancy: "Proprietary Blend:Yerba Mate Leaf (Ilex Paraguariensis) ⓞ",
      amountPerServing: "1.5 ml",
    },
  ]);

  assert.deepEqual(rows, [
    {
      name: "Yerba Mate Leaf (Ilex Paraguariensis)",
      dose: "1.5 ml",
    },
  ]);
});

test("overlay ingredient normalization splits multi-member proprietary blends and clears shared blend dose", () => {
  const rows = normalizeIherbSupplementFactsRows([
    {
      substancy:
        "Proprietary Blend:Cranberry fruit W, Uva Ursi leaf O, Cleavers aerials O, Usnea lichen W",
      amountPerServing: "3 ml",
    },
  ]);

  assert.deepEqual(rows, [
    { name: "Cranberry fruit", dose: null },
    { name: "Uva Ursi leaf", dose: null },
    { name: "Cleavers aerials", dose: null },
    { name: "Usnea lichen", dose: null },
  ]);
});

test("overlay ingredient internals expand blend members deterministically", () => {
  const members = iherbOverlayIngredientInternals.expandBlendMemberRows(
    "Proprietary Blend:Passionflower aerials (o), Scullcap aerials (o), Hops strobile (o)",
    "3 ml",
  );

  assert.deepEqual(members, [
    { name: "Passionflower aerials", dose: null },
    { name: "Scullcap aerials", dose: null },
    { name: "Hops strobile", dose: null },
  ]);
});
