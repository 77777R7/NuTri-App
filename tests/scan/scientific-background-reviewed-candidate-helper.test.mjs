import assert from "node:assert/strict";
import test from "node:test";

import {
  loadScientificBackgroundCandidateRegistry,
  selectScientificBackgroundReviewSeeds,
} from "../../scripts/maintainer/lib/scientific-background-reviewed-candidate-helper.mjs";

test("scientific background reviewed candidate helper filters P0 b-complex seeds and carries selection notes", async () => {
  const registry = await loadScientificBackgroundCandidateRegistry();
  const rows = selectScientificBackgroundReviewSeeds({
    registry,
    priorities: ["P0"],
    families: ["b6", "folate", "b12"],
    maxPerEntry: 2,
  });

  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.map((row) => row.ingredientFamily),
    ["b12", "b6", "folate"],
  );

  for (const row of rows) {
    assert.equal(row.priority, "P0");
    assert.equal(row.variantKey, "b_complex_pairing");
    assert.ok((row.selectionNotes?.length ?? 0) >= 1);
    assert.equal(row.seedReferences.length, 2);
  }

  const folate = rows.find((row) => row.ingredientFamily === "folate");
  assert.equal(folate?.sectionKey, "folate_status_and_supplementation_context");
  assert.equal(folate?.seedReferences[0]?.pmid, "41615824");
});

test("scientific background reviewed candidate helper expands the b_complex family alias", async () => {
  const registry = await loadScientificBackgroundCandidateRegistry();
  const rows = selectScientificBackgroundReviewSeeds({
    registry,
    priorities: ["P0"],
    families: ["vitamin_c", "iron", "zinc", "b_complex"],
    maxPerEntry: 1,
  });

  assert.deepEqual(
    rows.map((row) => row.ingredientFamily),
    ["b12", "b6", "folate", "iron", "iron", "vitamin_c", "vitamin_c", "zinc", "zinc"],
  );
  assert.ok(rows.every((row) => row.seedReferences.length === 1));
  assert.equal(rows[3]?.sectionKey, "form_and_tolerability_context");
  assert.equal(rows[4]?.variantKey, "with_cofactor_blend");
});
