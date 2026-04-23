import assert from "node:assert/strict";
import { test } from "node:test";

import { extractJsonObjectLoose } from "../dist/insights/summaryCompiler.js";

test("extractJsonObjectLoose parses direct JSON", () => {
  const raw = '{"tldr":"ok","highlights":[],"caveats":[]}';
  const result = extractJsonObjectLoose(raw);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.parsePath, "direct");
});

test("extractJsonObjectLoose parses JSON with leading text via brace extraction", () => {
  const raw =
    'Here is your payload:\n{"tldr":"ok","highlights":[],"caveats":[]}';
  const result = extractJsonObjectLoose(raw);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.parsePath, "brace_extract");
});

test("extractJsonObjectLoose fails with non_json when no braces are present", () => {
  const raw = "hello world";
  const result = extractJsonObjectLoose(raw);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "non_json");
});

test("extractJsonObjectLoose repairs trailing commas with safe_repair", () => {
  const raw = '```json\n{"tldr":"ok","highlights":["x",],"caveats":[]}\n```';
  const result = extractJsonObjectLoose(raw);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.parsePath, "safe_repair");
});

test("extractJsonObjectLoose rescues loose json with single quotes and unquoted keys", () => {
  const raw = "Here is your payload:\n{tldr:'ok',highlights:['x'],caveats:[]}";
  const result = extractJsonObjectLoose(raw);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.parsePath, "safe_repair");
});
