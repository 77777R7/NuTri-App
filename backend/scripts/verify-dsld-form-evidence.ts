import { buildFactsDigestFromDsld, type DsldFactsInput } from "../src/factsDigest.js";
import { lookupKbFormExplain } from "../src/kbRuntime.js";

const dsldFacts: DsldFactsInput = {
  brandName: "Test Brand",
  productName: "Form Evidence Smoke",
  servingSize: "2 Capsule(s)",
  servingsPerContainer: 30,
  actives: [
    // Guaranteed-hit set based on current KB coverage.
    { name: "Magnesium (as magnesium sulfate)", amount: 200, unit: "mg" },
    { name: "Zinc (as zinc acetate)", amount: 15, unit: "mg" },
    { name: "Vitamin C (as calcium ascorbate)", amount: 250, unit: "mg" },
    { name: "Vitamin C (as sodium ascorbate)", amount: 250, unit: "mg" },
    // Observation-only set from common labels; may miss if KB form coverage is incomplete.
    { name: "Magnesium (as magnesium oxide)", amount: 200, unit: "mg" },
    { name: "Zinc (as zinc citrate)", amount: 15, unit: "mg" },
    { name: "Iron (as ferrous bisglycinate)", amount: 18, unit: "mg" },
  ],
  inactive: [],
  proprietaryBlends: [],
  datasetVersion: "dsld-smoke-v1",
  extractedAt: new Date().toISOString(),
};

const digest = buildFactsDigestFromDsld({
  facts: dsldFacts,
  identityValue: "smoke_dsld_001",
});

const rows = digest.actives.map((active) => {
  const kb = lookupKbFormExplain({
    ingredientName: active.name,
    chemicalForm: active.chemicalForm ?? null,
    chemicalFormConfidence: active.chemicalFormConfidence ?? null,
    chemicalFormSource: active.chemicalFormSource ?? "none",
    chemicalFormEvidence: active.chemicalFormEvidence ?? null,
  });
  return {
    ingredient: active.name,
    chemicalForm: active.chemicalForm,
    chemicalFormSource: active.chemicalFormSource ?? "none",
    chemicalFormEvidence: active.chemicalFormEvidence ?? null,
    resolveSource: kb.resolveSource,
    evidenceText: kb.evidenceText,
    kbSentenceFound: Boolean(kb.sentence),
  };
});

console.log(JSON.stringify(rows, null, 2));

const resolvedRows = rows.filter((row) => row.resolveSource !== "none" && row.kbSentenceFound);
if (resolvedRows.length < 3) {
  console.error("Expected at least 3 DSLD actives with formResolveSource != none and KB sentence.");
  process.exit(1);
}
