import assert from "node:assert/strict";
import test from "node:test";

import {
  batchGetScientificBackgroundEvidence,
  getScientificBackgroundEvidence,
} from "../../backend/src/insights/scientificBackgroundEvidencePackage";

test("scientific background evidence package loads reviewed rows for magnesium, iron, omega-3, protein, and fiber", () => {
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
  const omega3 = getScientificBackgroundEvidence(
    "omega_3",
    "broader_cardiovascular_context",
    "en",
  );
  const protein = getScientificBackgroundEvidence(
    "protein",
    "muscle_and_recovery_context",
    "en",
  );
  const fiber = getScientificBackgroundEvidence(
    "fiber",
    "digestive_regularity_context",
    "en",
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

  assert.ok(omega3);
  assert.equal(omega3.evidenceGrade, "B");
  assert.match(omega3.displayText ?? "", /cardiovascular|triglyceride/i);
  assert.equal(omega3.supportingReferences[0]?.id, "pmid:32114706");

  assert.ok(protein);
  assert.equal(protein.evidenceGrade, "B");
  assert.match(protein.displayText ?? "", /muscle|recovery|protein/i);
  assert.equal(protein.supportingReferences[0]?.id, "pmid:28698222");

  assert.ok(fiber);
  assert.equal(fiber.evidenceGrade, "B");
  assert.match(fiber.displayText ?? "", /digestive regularity|fiber/i);
  assert.equal(fiber.supportingReferences[0]?.id, "pmid:35816465");
});

test("scientific background evidence package loads next-wave rows for omega-3, protein, fiber, b12, folate, and calcium", () => {
  const omega3 = getScientificBackgroundEvidence(
    "omega_3",
    "lipid_and_triglyceride_research",
    "en",
  );
  const protein = getScientificBackgroundEvidence(
    "protein",
    "satiety_and_meal_support_context",
    "en",
  );
  const fiber = getScientificBackgroundEvidence(
    "fiber",
    "satiety_and_gut_context",
    "en",
  );
  const b12 = getScientificBackgroundEvidence(
    "b12",
    "deficiency_and_supplementation_context",
    "en",
  );
  const folate = getScientificBackgroundEvidence(
    "folate",
    "what_form_labeling_changes",
    "en",
  );
  const calcium = getScientificBackgroundEvidence(
    "calcium",
    "form_and_absorption_context",
    "en",
  );

  assert.ok(omega3);
  assert.match(omega3.displayText ?? "", /triglyceride|lipid/i);
  assert.equal(omega3.supportingReferences[0]?.id, "pmid:37264945");

  assert.ok(protein);
  assert.match(protein.displayText ?? "", /satiety|meal-support|protein/i);
  assert.equal(protein.supportingReferences[0]?.id, "pmid:33037427");

  assert.ok(fiber);
  assert.match(fiber.displayText ?? "", /satiety|gut-environment|fiber/i);
  assert.equal(fiber.supportingReferences[0]?.id, "pmid:36216214");

  assert.ok(b12);
  assert.match(b12.displayText ?? "", /supplementation|status-related|B12/i);
  assert.equal(b12.supportingReferences[0]?.id, "pmid:17959839");

  assert.ok(folate);
  assert.match(folate.displayText ?? "", /folic acid|5-MTHF|folate/i);
  assert.equal(folate.supportingReferences[0]?.id, "pmid:30010385");

  assert.ok(calcium);
  assert.match(calcium.displayText ?? "", /citrate|carbonate|calcium form/i);
  assert.equal(calcium.supportingReferences[0]?.id, "pmid:11329115");
});

test("scientific background evidence package loads b12 and calcium completion rows plus first-batch zinc, vitamin d, and melatonin rows", () => {
  const b12 = getScientificBackgroundEvidence(
    "b12",
    "nerve_and_blood_cell_context",
    "en",
  );
  const calcium = getScientificBackgroundEvidence(
    "calcium",
    "how_coformulation_changes_comparison",
    "en",
  );
  const zincImmune = getScientificBackgroundEvidence(
    "zinc",
    "immune_function_context",
    "en",
  );
  const zincSkin = getScientificBackgroundEvidence(
    "zinc",
    "skin_and_barrier_research",
    "en",
  );
  const vitaminDBone = getScientificBackgroundEvidence(
    "vitamin_d",
    "bone_and_calcium_regulation_context",
    "en",
  );
  const vitaminDImmune = getScientificBackgroundEvidence(
    "vitamin_d",
    "immune_and_broader_health_research",
    "en",
  );
  const melatoninTiming = getScientificBackgroundEvidence(
    "melatonin",
    "sleep_timing_and_onset_context",
    "en",
  );
  const melatoninDose = getScientificBackgroundEvidence(
    "melatonin",
    "what_dose_and_use_context_can_change",
    "en",
  );

  assert.ok(b12);
  assert.match(b12.displayText ?? "", /nerve|blood-cell|B12/i);
  assert.equal(b12.supportingReferences[0]?.id, "pmid:28660890");

  assert.ok(calcium);
  assert.match(calcium.displayText ?? "", /co-formulation|vitamin D|broader bone-support/i);
  assert.equal(calcium.supportingReferences[0]?.id, "pmid:29279934");

  assert.ok(zincImmune);
  assert.match(zincImmune.displayText ?? "", /immune-function|zinc lane/i);
  assert.equal(zincImmune.supportingReferences[0]?.id, "pmid:29186856");

  assert.ok(zincSkin);
  assert.match(zincSkin.displayText ?? "", /skin|barrier|dermatology/i);
  assert.equal(zincSkin.supportingReferences[0]?.id, "pmid:30801794");

  assert.ok(vitaminDBone);
  assert.match(vitaminDBone.displayText ?? "", /bone|calcium-regulation|vitamin D/i);
  assert.equal(vitaminDBone.supportingReferences[0]?.id, "pmid:30313003");

  assert.ok(vitaminDImmune);
  assert.match(vitaminDImmune.displayText ?? "", /immune|broader health|vitamin D/i);
  assert.equal(vitaminDImmune.supportingReferences[0]?.id, "pmid:28202713");

  assert.ok(melatoninTiming);
  assert.match(melatoninTiming.displayText ?? "", /sleep timing|onset|melatonin/i);
  assert.equal(melatoninTiming.supportingReferences[0]?.id, "pmid:36179487");

  assert.ok(melatoninDose);
  assert.match(melatoninDose.displayText ?? "", /dose|timing|use context|melatonin/i);
  assert.equal(melatoninDose.supportingReferences[0]?.id, "pmid:38888087");
});

test("scientific background evidence package loads vitamin d completion rows plus vitamin c and second-wave zinc and melatonin variants", () => {
  const vitaminDInterpretation = getScientificBackgroundEvidence(
    "vitamin_d",
    "what_interpretation_depends_on",
    "en",
  );
  const vitaminCImmune = getScientificBackgroundEvidence(
    "vitamin_c",
    "antioxidant_and_immune_research",
    "en",
  );
  const vitaminCCollagen = getScientificBackgroundEvidence(
    "vitamin_c",
    "collagen_and_tissue_support",
    "en",
  );
  const vitaminCIron = getScientificBackgroundEvidence(
    "vitamin_c",
    "iron_absorption_context",
    "en",
  );
  const vitaminCIronPair = getScientificBackgroundEvidence(
    "vitamin_c",
    "iron_absorption_context",
    "en",
    "with_iron",
  );
  const zincLozenge = getScientificBackgroundEvidence(
    "zinc",
    "immune_function_context",
    "en",
    "lozenge_short_term_context",
  );
  const melatoninExtended = getScientificBackgroundEvidence(
    "melatonin",
    "what_dose_and_use_context_can_change",
    "en",
    "extended_release",
  );

  assert.ok(vitaminDInterpretation);
  assert.match(vitaminDInterpretation.displayText ?? "", /dose|baseline status|vitamin D/i);
  assert.equal(vitaminDInterpretation.supportingReferences[0]?.id, "pmid:30313003");

  assert.ok(vitaminCImmune);
  assert.match(vitaminCImmune.displayText ?? "", /immune|antioxidant|vitamin C/i);
  assert.equal(vitaminCImmune.supportingReferences[0]?.id, "pmid:29099763");

  assert.ok(vitaminCCollagen);
  assert.match(vitaminCCollagen.displayText ?? "", /collagen|tissue-support|vitamin C/i);
  assert.equal(vitaminCCollagen.supportingReferences[0]?.id, "pmid:36009324");

  assert.ok(vitaminCIron);
  assert.match(vitaminCIron.displayText ?? "", /iron-absorption|vitamin C|context-specific/i);
  assert.equal(vitaminCIron.supportingReferences[0]?.id, "pmid:35755397");

  assert.ok(vitaminCIronPair);
  assert.equal(vitaminCIronPair.variantKey, "with_iron");
  assert.match(vitaminCIronPair.displayText ?? "", /paired with iron|co-formulation|vitamin C/i);
  assert.equal(vitaminCIronPair.supportingReferences[0]?.id, "pmid:32650997");

  assert.ok(zincLozenge);
  assert.equal(zincLozenge.variantKey, "lozenge_short_term_context");
  assert.match(zincLozenge.displayText ?? "", /lozenge-style|short-term immune-context|zinc/i);
  assert.equal(zincLozenge.supportingReferences[0]?.id, "pmid:23775705");

  assert.ok(melatoninExtended);
  assert.equal(melatoninExtended.variantKey, "extended_release");
  assert.match(melatoninExtended.displayText ?? "", /extended-release|release style|melatonin/i);
  assert.equal(melatoninExtended.supportingReferences[0]?.id, "pmid:38713204");
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
    {
      ingredientFamily: "lutein_zeaxanthin",
      sectionKey: "eye_and_macular_context",
      locale: "en",
    },
  ]);

  assert.equal(results[0]?.status, "ok");
  assert.equal(results[0]?.item?.ingredientFamily, "magnesium");
  assert.equal(results[1]?.status, "ok");
  assert.equal(results[1]?.item?.ingredientFamily, "omega_3");
  assert.equal(results[2]?.status, "not_found");
  assert.equal(results[2]?.reason, "no_entry_for_section_key");
});
