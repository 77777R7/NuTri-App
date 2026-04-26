import assert from "node:assert/strict";
import test from "node:test";

import {
  hasProductOverviewAiForbiddenContent,
  passesProductOverviewWhatIsItGate,
  repairProductOverviewWhatIsItForGate,
} from "../../backend/src/insights/productOverviewAiGate.js";
import type { ProductOverviewWhatIsIt } from "../../backend/src/deepseek.js";

const gateContext = {
  primaryIngredient: "Devil's Claw",
  productTypeHint: "devil_s_claw",
  keyIngredients: [{ name: "Devil's Claw" }],
  allIngredientRows: [{ name: "Devil's Claw" }],
  servingStrength: null,
  form: null,
  count: null,
};

test("product overview gate repair keeps API copy safe without loosening banned patterns", () => {
  const ai: ProductOverviewWhatIsIt = {
    mode: "short",
    lead: "Devil's Claw is a supplement commonly promoted to treat joint pain.",
    whatItIs: "It is a root extract and is clinically proven as the best form for high absorption.",
    whyPeopleTakeIt:
      "People take it with food. Some use it to prevent discomfort. Others use it for general wellness routines.",
  };

  assert.equal(passesProductOverviewWhatIsItGate({ ...gateContext, ...ai }), false);

  const repaired = repairProductOverviewWhatIsItForGate(ai, gateContext);
  assert.ok(repaired);
  assert.equal(passesProductOverviewWhatIsItGate({ ...gateContext, ...repaired }), true);
  const combined = [repaired.lead, repaired.whatItIs, repaired.whyPeopleTakeIt].join(" ");
  assert.equal(hasProductOverviewAiForbiddenContent(combined), false);
  assert.doesNotMatch(combined, /treat|prevent|clinically proven|best form|high absorption|with food/i);
  assert.match(combined, /Devil's Claw/i);
});

test("product overview gate repair injects the product anchor for generic API copy", () => {
  const ai: ProductOverviewWhatIsIt = {
    mode: "short",
    lead: "This is a dietary supplement.",
    whatItIs: "The label presents a simple formula.",
    whyPeopleTakeIt: "People compare products like this by reading the label.",
  };

  assert.equal(passesProductOverviewWhatIsItGate({ ...gateContext, ...ai }), false);

  const repaired = repairProductOverviewWhatIsItForGate(ai, gateContext);
  assert.ok(repaired);
  assert.equal(passesProductOverviewWhatIsItGate({ ...gateContext, ...repaired }), true);
  assert.match([repaired.lead, repaired.whatItIs, repaired.whyPeopleTakeIt].join(" "), /Devil's Claw/i);
});
