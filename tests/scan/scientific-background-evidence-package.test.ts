import assert from "node:assert/strict";
import test from "node:test";

import {
  batchGetScientificBackgroundEvidence,
  getScientificBackgroundEvidence,
} from "../../backend/src/insights/scientificBackgroundEvidencePackage";

test("scientific background evidence package loads first-pass magnesium and iron rows", () => {
  const magnesium = getScientificBackgroundEvidence(
    "magnesium",
    "form_and_tolerability_context",
    "en",
    "citrate_vs_oxide",
  );
  const iron = getScientificBackgroundEvidence(
    "iron",
    "form_and_tolerability_context",
    "en",
    "ferrous_bisglycinate_anchor",
  );

  assert.ok(magnesium);
  assert.equal(magnesium.variantKey, "citrate_vs_oxide");
  assert.equal(magnesium.evidenceGrade, "B");
  assert.match(magnesium.displayText ?? "", /citrate/i);
  assert.equal(magnesium.supportingReferences[0]?.id, "pmid:2407766");
  assert.ok(magnesium.meta.packageSha256.length > 0);

  assert.ok(iron);
  assert.equal(iron.variantKey, "ferrous_bisglycinate_anchor");
  assert.equal(iron.evidenceGrade, "B");
  assert.match(iron.displayText ?? "", /bisglycinate/i);
  assert.equal(iron.supportingReferences[0]?.id, "pmid:24152889");
  assert.ok(iron.meta.packageSha256.length > 0);
});

test("scientific background evidence package falls back from missing variant rows to generic section rows", () => {
  const magnesium = getScientificBackgroundEvidence(
    "magnesium",
    "what_product_comparison_depends_on",
    "en",
    "missing_variant",
  );
  const iron = getScientificBackgroundEvidence(
    "iron",
    "what_product_comparison_depends_on",
    "en",
    "missing_variant",
  );

  assert.ok(magnesium);
  assert.equal(magnesium.variantKey, "generic_form_comparison");
  assert.match(magnesium.segments.shopperMeaningSupport?.[0]?.text ?? "", /magnesium amount/i);

  assert.ok(iron);
  assert.equal(iron.variantKey, "generic_form_comparison");
  assert.match(iron.segments.shopperMeaningSupport?.[0]?.text ?? "", /elemental iron amount/i);
});

test("scientific background evidence package batch lookup returns ok and not_found states", () => {
  const results = batchGetScientificBackgroundEvidence([
    {
      ingredientFamily: "magnesium",
      sectionKey: "form_and_tolerability_context",
      variantKey: "generic_form_comparison",
      locale: "en",
    },
    {
      ingredientFamily: "omega_3",
      sectionKey: "inflammation_and_recovery_context",
      locale: "en",
    },
  ]);

  assert.equal(results[0]?.status, "ok");
  assert.equal(results[0]?.item?.ingredientFamily, "magnesium");
  assert.equal(results[1]?.status, "not_found");
  assert.equal(results[1]?.reason, "no_entry_for_section_key");
});
