import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { lookupKbFormExplain } from "../dist/kbRuntime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Ensure KB paths resolve regardless of the runner cwd.
process.env.KB_RUNTIME_INDEX_PATH = path.resolve(__dirname, "../data/kb/kb_runtime_index.json");
process.env.KB_FORM_ALIAS_PATH = path.resolve(__dirname, "../data/kb/form_alias_map.json");

const run = (ingredientName, chemicalForm) =>
  lookupKbFormExplain({
    ingredientName,
    chemicalForm,
    chemicalFormConfidence: 0.9,
    chemicalFormSource: "ingredient_name",
    chemicalFormEvidence: ingredientName,
  });

test("Vitamin C forms resolve to vitamin_c scope (ascorbate/ascorbic acid)", () => {
  const cases = [
    { ingredientName: "Calcium Ascorbate", chemicalForm: "calcium_ascorbate" },
    { ingredientName: "Sodium Ascorbate", chemicalForm: "sodium_ascorbate" },
    { ingredientName: "Ascorbic Acid", chemicalForm: "ascorbic_acid" },
    // DSLD meta strings can appear with a leading "as ".
    { ingredientName: "as Calcium Ascorbate", chemicalForm: "Calcium Ascorbate" },
    { ingredientName: "as Sodium Ascorbate", chemicalForm: "Sodium Ascorbate" },
  ];

  for (const c of cases) {
    const result = run(c.ingredientName, c.chemicalForm);
    assert.ok(result.sentence, `expected KB sentence for ${c.ingredientName}`);
    assert.equal(result.resolveSource !== "none", true, `expected non-none resolveSource for ${c.ingredientName}`);
    assert.ok(result.sentenceId, `expected sentenceId for ${c.ingredientName}`);
    assert.ok(result.excerptId, `expected excerptId for ${c.ingredientName}`);
    assert.ok(result.referenceId, `expected referenceId for ${c.ingredientName}`);
  }
});
