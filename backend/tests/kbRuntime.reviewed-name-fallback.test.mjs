import assert from "node:assert/strict";
import { test } from "node:test";

import { lookupKbRuntimeFormInsights } from "../dist/kbRuntime.js";

test("kbRuntime falls back to reviewed package via ingredientName when UUID id misses", () => {
  const withoutName = lookupKbRuntimeFormInsights({
    ingredientId: "00000000-0000-4000-8000-000000000001",
    formKey: "citrate",
  });
  assert.equal(withoutName.status, "not_found");

  const withName = lookupKbRuntimeFormInsights({
    ingredientId: "00000000-0000-4000-8000-000000000001",
    formKey: "citrate",
    ingredientName: "Calcium",
  });

  assert.equal(withName.status, "ok");
  assert.equal(withName.meta.source, "reviewed_package");
  assert.ok(Array.isArray(withName.segments));
  assert.ok(withName.segments.length >= 1);
  assert.ok(Array.isArray(withName.debug.reviewedLookupTried));
  assert.ok(withName.debug.reviewedLookupTried.length >= 1);
});

test("kbRuntime formKey prefixed candidate resolves chromium citrate", () => {
  const result = lookupKbRuntimeFormInsights({
    ingredientId: "00000000-0000-4000-8000-0000000000aa",
    formKey: "citrate",
    ingredientName: "Chromium",
  });
  assert.equal(result.status, "ok");
  assert.equal(result.meta.source, "reviewed_package");
  assert.ok(result.debug.reviewedLookupTried.some((key) => key.includes("chromium_citrate")));
});

test("kbRuntime formKey prefixed candidate resolves copper citrate", () => {
  const result = lookupKbRuntimeFormInsights({
    ingredientId: "00000000-0000-4000-8000-0000000000bb",
    formKey: "citrate",
    ingredientName: "Copper",
  });
  assert.equal(result.status, "ok");
  assert.equal(result.meta.source, "reviewed_package");
  assert.ok(result.debug.reviewedLookupTried.some((key) => key.includes("copper_citrate")));
});

test("kbRuntime thiamine hcl variant resolves reviewed thiamin entry", () => {
  const result = lookupKbRuntimeFormInsights({
    ingredientId: "00000000-0000-4000-8000-0000000000cc",
    formKey: "hcl",
    ingredientName: "Thiamine",
  });
  assert.equal(result.status, "ok");
  assert.equal(result.meta.source, "reviewed_package");
  assert.ok(result.debug.reviewedLookupTried.some((key) => key.includes("thiamine_hcl")));
});
