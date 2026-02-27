import assert from "node:assert/strict";
import { test } from "node:test";

import {
  resolveDeterministicFormKey,
  tokenizeForSafeMatch,
} from "../build-formraw-alias-remediation-plan.ts";

test("deterministic resolver: exact normalized match wins", () => {
  const resolved = resolveDeterministicFormKey("ascorbic acid", [
    "ascorbic acid",
    "citric acid",
  ]);
  assert.equal(resolved.formKey, "ascorbic acid");
  assert.equal(resolved.rule, "exact_norm");
  assert.equal(resolved.confidence, 1);
});

test("deterministic resolver: token reordering is auto-resolved", () => {
  const resolved = resolveDeterministicFormKey("acid ascorbic", [
    "ascorbic acid",
    "citric acid",
  ]);
  assert.equal(resolved.formKey, "ascorbic acid");
  assert.equal(resolved.rule, "token_reorder_equivalence");
});

test("deterministic resolver: safe plural folding is auto-resolved", () => {
  const resolved = resolveDeterministicFormKey("berries blend", [
    "berry blend",
    "grape seed",
  ]);
  assert.equal(resolved.formKey, "berry blend");
  assert.equal(resolved.rule, "safe_plural_fold_equivalence");
});

test("deterministic resolver: strict subset unique resolves with confidence", () => {
  const resolved = resolveDeterministicFormKey("magnesium bisglycinate", [
    "magnesium bisglycinate chelate",
    "magnesium citrate",
  ]);
  assert.equal(resolved.formKey, "magnesium bisglycinate chelate");
  assert.equal(resolved.rule, "strict_subset_unique");
  assert.ok(resolved.confidence >= 0.5);
});

test("deterministic resolver: strict subset ambiguity remains blocked", () => {
  const resolved = resolveDeterministicFormKey("magnesium citrate", [
    "magnesium citrate chelate",
    "magnesium citrate malate",
  ]);
  assert.equal(resolved.formKey, null);
  assert.equal(resolved.rule, null);
  assert.equal(resolved.confidence, 0);
});

test("deterministic resolver: D2-style risky subset tokens stay blocked", () => {
  const resolved = resolveDeterministicFormKey("grape seed extract", [
    "grape seed extract standardized",
    "grape seed extract powder",
  ]);
  assert.equal(resolved.formKey, null);
  assert.equal(resolved.rule, null);
});

test("tokenization: fold + unique keeps stable lexical set", () => {
  const tokens = tokenizeForSafeMatch("Berries, berries and leafs", {
    fold: true,
    unique: true,
  });
  assert.deepEqual(tokens, ["berry", "leaf"]);
});
