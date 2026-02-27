import assert from "node:assert/strict";
import { test } from "node:test";

import { lookupKbRuntimeFormInsights } from "../dist/kbRuntime.js";

test("botanical alias maps Valeriana officinalis to reviewed valerian", () => {
  const result = lookupKbRuntimeFormInsights({
    ingredientId: "00000000-0000-4000-8000-00000000aa01",
    ingredientName: "Valeriana officinalis",
    formKey: "extract",
  });

  assert.equal(result.status, "ok");
  assert.equal(result.meta.source, "reviewed_package");
  assert.ok(result.debug.reviewedLookupTried.some((key) => key.includes("valerian|extract")));
});

test("botanical suffix stripping resolves Valeriana officinalis root extract", () => {
  const result = lookupKbRuntimeFormInsights({
    ingredientId: "00000000-0000-4000-8000-00000000aa02",
    ingredientName: "Valeriana officinalis root extract",
    formKey: "extract",
  });

  assert.equal(result.status, "ok");
  assert.equal(result.meta.source, "reviewed_package");
  assert.ok(result.debug.reviewedLookupTried.some((key) => key.includes("valerian|extract")));
});

test("unsupported botanical does not force false reviewed match", () => {
  const result = lookupKbRuntimeFormInsights({
    ingredientId: "00000000-0000-4000-8000-00000000aa03",
    ingredientName: "Humulus lupulus",
    formKey: "extract",
  });

  assert.notEqual(result.status, "ok");
  assert.ok(result.reason === "ingredient_not_supported" || result.reason === "no_entry_for_form_key");
});
