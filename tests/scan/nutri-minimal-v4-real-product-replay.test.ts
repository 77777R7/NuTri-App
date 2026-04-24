import assert from "node:assert/strict";
import test from "node:test";

import { runNutriMinimalV4RealProductReplay } from "../../backend/scripts/run-nutri-minimal-v4-real-product-replay";

const REQUIRED_PRIORITY_FAMILIES = [
  "same",
  "tocotrienols",
  "devil_s_claw",
  "schisandra_chinensis",
  "red_yeast_rice",
  "pygeum",
  "milk_thistle",
  "tribulus_terrestris",
  "chaga_mushroom",
  "nadh",
] as const;

test("real product replay validates priority high-risk family coverage and grounding gates", async () => {
  const artifact = await runNutriMinimalV4RealProductReplay({
    writeArtifacts: false,
  });
  const rows = artifact.replay_rows;
  const requiredRows = rows.filter((row) => row.required);

  assert.equal(artifact.failures.length, 0);
  assert.equal(requiredRows.length, REQUIRED_PRIORITY_FAMILIES.length);
  assert.equal(artifact.summary.registry_traceability_warnings, 0);

  for (const family of REQUIRED_PRIORITY_FAMILIES) {
    const row = requiredRows.find((candidate) => candidate.family === family);
    assert.ok(row, `${family} should have a real product replay row`);
    assert.ok(row.replay_product.source_file, `${family} should use a real source file`);
    assert.equal(row.replay_product.facts_quality, "structured_ingredients");
    assert.equal(row.inference.pass, true, `${family} should infer correctly`);
    assert.equal(
      row.scientific_background.pass,
      true,
      `${family} should render family-specific Scientific Background`,
    );
    assert.equal(
      row.evidence_grounding.pass,
      true,
      `${family} should pass grounding gate`,
    );
    assert.equal(
      row.safety_claim_gate.pass,
      true,
      `${family} should not leak medical, superiority, or treatment claims`,
    );
  }

  for (const blockedFamily of ["chaga_mushroom", "nadh"]) {
    const row = requiredRows.find((candidate) => candidate.family === blockedFamily);
    assert.ok(row, `${blockedFamily} replay row should exist`);
    assert.equal(row.evidence_grounding.registry_review_status, "rejected");
    assert.equal(row.evidence_grounding.reviewed_evidence_found, false);
    assert.equal(
      row.evidence_grounding.live_grounding_status,
      "blocked_no_reviewed_row",
    );
  }

  for (const approvedFamily of [
    "red_yeast_rice",
    "pygeum",
    "milk_thistle",
    "tribulus_terrestris",
  ]) {
    const row = requiredRows.find((candidate) => candidate.family === approvedFamily);
    assert.ok(row, `${approvedFamily} replay row should exist`);
    assert.equal(row.evidence_grounding.registry_review_status, "approved");
    assert.equal(row.evidence_grounding.reviewed_evidence_found, true);
    assert.equal(
      row.evidence_grounding.live_grounding_status,
      "approved_reviewed_row",
    );
  }
});
