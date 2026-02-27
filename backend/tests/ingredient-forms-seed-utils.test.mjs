import assert from "node:assert/strict";
import { test } from "node:test";

import {
  dedupeSeedRows,
  inferExistingLayer,
  partitionSeedRowsByExisting,
} from "../dist/ingredientFormsSeedUtils.js";

const baseSeed = {
  ingredient_id: "ing-1",
  form_key: "citrate",
  form_label: "Citrate",
  relative_factor: 1,
  confidence: 0.5,
  evidence_grade: "C",
  audit_status: "derived",
  source_reason: "test",
  target_origin: "r1",
  source_refs: [],
};

test("dedupe keeps highest-priority source per (ingredient_id, form_key)", () => {
  const rows = dedupeSeedRows([
    {
      ...baseSeed,
      source_layer: "unspecified_fallback",
      form_key: "Citrate",
      confidence: 0.2,
      audit_status: "derived",
      evidence_grade: "D",
    },
    {
      ...baseSeed,
      source_layer: "explicit_as_form",
      form_key: "citrate ",
      confidence: 0.9,
      audit_status: "verified",
      evidence_grade: "B",
    },
    {
      ...baseSeed,
      source_layer: "reviewed_package",
      form_key: "citrate",
      confidence: 0.7,
      audit_status: "verified",
      evidence_grade: "A",
    },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].source_layer, "reviewed_package");
  assert.equal(rows[0].form_key, "citrate");
});

test("dedupe keeps higher confidence when source layer is the same", () => {
  const rows = dedupeSeedRows([
    {
      ...baseSeed,
      source_layer: "explicit_as_form",
      confidence: 0.72,
      source_reason: "rule-1",
    },
    {
      ...baseSeed,
      source_layer: "explicit_as_form",
      confidence: 0.91,
      source_reason: "rule-2",
    },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].source_layer, "explicit_as_form");
  assert.equal(rows[0].confidence, 0.91);
  assert.equal(rows[0].source_reason, "rule-2");
});

test("partition is idempotent: second apply becomes all skipped", () => {
  const deduped = dedupeSeedRows([
    {
      ...baseSeed,
      source_layer: "explicit_as_form",
      form_key: "citrate",
    },
    {
      ...baseSeed,
      ingredient_id: "ing-2",
      form_key: "unspecified",
      form_label: "Unspecified form",
      source_layer: "unspecified_fallback",
      confidence: 0.2,
      evidence_grade: "D",
    },
  ]);

  const firstPass = partitionSeedRowsByExisting(deduped, new Set());
  assert.equal(firstPass.skippedExisting.length, 0);
  assert.equal(firstPass.toUpsert.length, 2);

  const existingKeys = new Set(firstPass.toUpsert.map((row) => `${row.ingredient_id}:${row.form_key}`));
  const secondPass = partitionSeedRowsByExisting(deduped, existingKeys);
  assert.equal(secondPass.toUpsert.length, 0);
  assert.equal(secondPass.skippedExisting.length, 2);
});

test("inferExistingLayer classifies unspecified and verified tiers conservatively", () => {
  assert.equal(
    inferExistingLayer({
      ingredient_id: "ing-1",
      form_key: "unspecified",
      audit_status: "derived",
    }),
    "unspecified_fallback",
  );

  assert.equal(
    inferExistingLayer({
      ingredient_id: "ing-1",
      form_key: "citrate",
      audit_status: "verified",
      confidence: 0.9,
      evidence_grade: "B",
      relative_factor: 1,
    }),
    "explicit_as_form",
  );

  assert.equal(
    inferExistingLayer({
      ingredient_id: "ing-1",
      form_key: "glycinate",
      audit_status: "verified",
      confidence: 0.74,
      evidence_grade: "A",
      relative_factor: 1.12,
    }),
    "reviewed_package",
  );
});

test("partition allows priority upgrades and blocks downgrade", () => {
  const incoming = dedupeSeedRows([
    {
      ...baseSeed,
      ingredient_id: "ing-1",
      form_key: "unspecified",
      form_label: "Unspecified form",
      source_layer: "explicit_as_form",
      audit_status: "verified",
      evidence_grade: "B",
      confidence: 0.9,
    },
    {
      ...baseSeed,
      ingredient_id: "ing-2",
      form_key: "citrate",
      form_label: "Citrate",
      source_layer: "reviewed_package",
      audit_status: "verified",
      evidence_grade: "A",
      confidence: 0.85,
      relative_factor: 1.15,
    },
    {
      ...baseSeed,
      ingredient_id: "ing-3",
      form_key: "glycinate",
      form_label: "Glycinate",
      source_layer: "explicit_as_form",
      audit_status: "verified",
      evidence_grade: "B",
      confidence: 0.9,
      relative_factor: 1,
    },
  ]);

  const existingMap = new Map([
    [
      "ing-1:unspecified",
      {
        ingredient_id: "ing-1",
        form_key: "unspecified",
        form_label: "Unspecified form",
        audit_status: "derived",
        confidence: 0.2,
        evidence_grade: "D",
        relative_factor: 1,
      },
    ],
    [
      "ing-2:citrate",
      {
        ingredient_id: "ing-2",
        form_key: "citrate",
        form_label: "Citrate",
        audit_status: "verified",
        confidence: 0.9,
        evidence_grade: "B",
        relative_factor: 1,
      },
    ],
    [
      "ing-3:glycinate",
      {
        ingredient_id: "ing-3",
        form_key: "glycinate",
        form_label: "Glycinate",
        audit_status: "verified",
        confidence: 0.8,
        evidence_grade: "A",
        relative_factor: 1.1,
      },
    ],
  ]);

  const partition = partitionSeedRowsByExisting(incoming, existingMap);

  assert.equal(partition.toInsert.length, 0);
  assert.equal(partition.toUpdate.length, 2);
  assert.equal(partition.toUpsert.length, 2);
  assert.equal(partition.skippedExisting.length, 1);
  assert.ok(
    partition.toUpdate.some((row) => row.ingredient_id === "ing-1" && row.form_key === "unspecified"),
  );
  assert.ok(
    partition.toUpdate.some((row) => row.ingredient_id === "ing-2" && row.form_key === "citrate"),
  );
  assert.ok(
    partition.skippedExisting.some((row) => row.ingredient_id === "ing-3" && row.form_key === "glycinate"),
  );
});
