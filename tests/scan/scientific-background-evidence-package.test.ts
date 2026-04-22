import assert from "node:assert/strict";
import fs from "node:fs";
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

test("scientific background evidence package loads vitamin d completion rows plus thicker vitamin c, b6, zinc, iron, and melatonin variants", () => {
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
  const vitaminCAltDelivery = getScientificBackgroundEvidence(
    "vitamin_c",
    "antioxidant_and_immune_research",
    "en",
    "alt_delivery",
  );
  const b6Cofactor = getScientificBackgroundEvidence(
    "b6",
    "cofactor_and_metabolism_context",
    "en",
  );
  const b6Nerve = getScientificBackgroundEvidence(
    "b6",
    "nerve_related_interpretation",
    "en",
  );
  const b6BComplex = getScientificBackgroundEvidence(
    "b6",
    "why_dose_context_matters",
    "en",
    "b_complex_pairing",
  );
  const zincWithVitaminC = getScientificBackgroundEvidence(
    "zinc",
    "immune_function_context",
    "en",
    "with_vitamin_c",
  );
  const ironWithCofactors = getScientificBackgroundEvidence(
    "iron",
    "what_product_comparison_depends_on",
    "en",
    "with_cofactor_blend",
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

  assert.ok(vitaminCAltDelivery);
  assert.equal(vitaminCAltDelivery.variantKey, "alt_delivery");
  assert.match(vitaminCAltDelivery.displayText ?? "", /liposomal|buffered|delivery-style|vitamin C/i);
  assert.equal(vitaminCAltDelivery.supportingReferences[0]?.id, "pmid:39861409");

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

  assert.ok(b6Cofactor);
  assert.match(b6Cofactor.displayText ?? "", /cofactor|metabolism|vitamin B6/i);
  assert.equal(b6Cofactor.supportingReferences[0]?.id, "pmid:27593095");

  assert.ok(b6Nerve);
  assert.match(b6Nerve.displayText ?? "", /nerve-related|vitamin B6|formula setting/i);
  assert.equal(b6Nerve.supportingReferences[0]?.id, "pmid:41609902");

  assert.ok(b6BComplex);
  assert.equal(b6BComplex.variantKey, "b_complex_pairing");
  assert.match(b6BComplex.displayText ?? "", /B-complex|multi-B|vitamin B6/i);
  assert.equal(b6BComplex.supportingReferences[0]?.id, "pmid:31915511");

  assert.ok(zincWithVitaminC);
  assert.equal(zincWithVitaminC.variantKey, "with_vitamin_c");
  assert.match(zincWithVitaminC.displayText ?? "", /paired with vitamin C|co-formulation|zinc/i);
  assert.equal(zincWithVitaminC.supportingReferences[0]?.id, "pmid:16373990");

  assert.ok(ironWithCofactors);
  assert.equal(ironWithCofactors.variantKey, "with_cofactor_blend");
  assert.match(ironWithCofactors.displayText ?? "", /vitamin C|folate|B12|iron/i);
  assert.equal(ironWithCofactors.supportingReferences[0]?.id, "pmid:10948381");

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

test("scientific background evidence json keeps variant candidate registry entries for vitamin c, iron, and zinc", () => {
  const raw = fs.readFileSync(
    new URL("../../backend/data/reviewed/scientific-background-evidence.v1.json", import.meta.url),
    "utf8",
  );
  const parsed = JSON.parse(raw) as {
    candidate_pubmed_searches: Array<{
      family: string;
      lane: string;
      variant_key?: string;
      source?: string;
      priority?: string;
      selection_notes?: string[];
      candidates?: Array<unknown>;
    }>;
  };

  const findCandidate = (family: string, lane: string, variantKey: string) =>
    parsed.candidate_pubmed_searches.find(
      (entry) =>
        entry.family === family && entry.lane === lane && (entry.variant_key ?? "") === variantKey,
    );

  const vitaminCAltDelivery = findCandidate(
    "vitamin_c",
    "antioxidant_and_immune_research",
    "alt_delivery",
  );
  const vitaminCWithIron = findCandidate("vitamin_c", "iron_absorption_context", "with_iron");
  const ironWithCofactors = findCandidate(
    "iron",
    "what_product_comparison_depends_on",
    "with_cofactor_blend",
  );
  const zincWithVitaminC = findCandidate("zinc", "immune_function_context", "with_vitamin_c");
  const zincLozenge = findCandidate(
    "zinc",
    "immune_function_context",
    "lozenge_short_term_context",
  );

  assert.equal(vitaminCAltDelivery?.source, "life-science-research:ncbi-entrez-skill");
  assert.equal(vitaminCAltDelivery?.priority, "P0");
  assert.ok((vitaminCAltDelivery?.selection_notes?.length ?? 0) >= 1);
  assert.ok((vitaminCAltDelivery?.candidates?.length ?? 0) >= 1);

  assert.equal(vitaminCWithIron?.source, "life-science-research:ncbi-entrez-skill");
  assert.equal(vitaminCWithIron?.priority, "P0");
  assert.ok((vitaminCWithIron?.selection_notes?.length ?? 0) >= 1);
  assert.ok((vitaminCWithIron?.candidates?.length ?? 0) >= 2);

  assert.equal(ironWithCofactors?.source, "life-science-research:ncbi-entrez-skill");
  assert.equal(ironWithCofactors?.priority, "P0");
  assert.ok((ironWithCofactors?.selection_notes?.length ?? 0) >= 1);
  assert.ok((ironWithCofactors?.candidates?.length ?? 0) >= 2);

  assert.equal(zincWithVitaminC?.source, "life-science-research:ncbi-entrez-skill");
  assert.equal(zincWithVitaminC?.priority, "P0");
  assert.ok((zincWithVitaminC?.selection_notes?.length ?? 0) >= 1);
  assert.ok((zincWithVitaminC?.candidates?.length ?? 0) >= 2);

  assert.equal(zincLozenge?.source, "life-science-research:ncbi-entrez-skill");
  assert.equal(zincLozenge?.priority, "P0");
  assert.ok((zincLozenge?.selection_notes?.length ?? 0) >= 1);
  assert.ok((zincLozenge?.candidates?.length ?? 0) >= 1);
});

test("scientific background evidence json seeds b-complex-aware candidate templates for b6, folate, and b12", () => {
  const raw = fs.readFileSync(
    new URL("../../backend/data/reviewed/scientific-background-evidence.v1.json", import.meta.url),
    "utf8",
  );
  const parsed = JSON.parse(raw) as {
    candidate_pubmed_searches: Array<{
      family: string;
      lane: string;
      variant_key?: string;
      source?: string;
      priority?: string;
      selection_notes?: string[];
      candidates?: Array<{ pmid?: string }>;
    }>;
  };

  const findTemplate = (family: string, lane: string) =>
    parsed.candidate_pubmed_searches.find(
      (entry) =>
        entry.family === family &&
        entry.lane === lane &&
        (entry.variant_key ?? "") === "b_complex_pairing",
    );

  const b6 = findTemplate("b6", "why_dose_context_matters");
  const folate = findTemplate("folate", "folate_status_and_supplementation_context");
  const b12 = findTemplate("b12", "deficiency_and_supplementation_context");

  assert.equal(b6?.source, "life-science-research:ncbi-entrez-skill");
  assert.equal(b6?.priority, "P0");
  assert.ok((b6?.selection_notes?.length ?? 0) >= 1);
  assert.ok((b6?.candidates?.length ?? 0) >= 3);
  assert.equal(b6?.candidates?.[0]?.pmid, "31915511");

  assert.equal(folate?.source, "life-science-research:ncbi-entrez-skill");
  assert.equal(folate?.priority, "P0");
  assert.ok((folate?.selection_notes?.length ?? 0) >= 1);
  assert.ok((folate?.candidates?.length ?? 0) >= 3);
  assert.equal(folate?.candidates?.[0]?.pmid, "41615824");

  assert.equal(b12?.source, "life-science-research:ncbi-entrez-skill");
  assert.equal(b12?.priority, "P0");
  assert.ok((b12?.selection_notes?.length ?? 0) >= 1);
  assert.ok((b12?.candidates?.length ?? 0) >= 3);
  assert.equal(b12?.candidates?.[0]?.pmid, "31915511");
});
