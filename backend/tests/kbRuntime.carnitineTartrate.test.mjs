import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { lookupKbFormExplain } from "../dist/kbRuntime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Ensure KB paths resolve regardless of the runner cwd.
process.env.KB_RUNTIME_INDEX_PATH = path.resolve(__dirname, "../data/kb/kb_runtime_index.json");
process.env.KB_FORM_ALIAS_PATH = path.resolve(__dirname, "../data/kb/form_alias_map.json");

test("Carnitine Tartrate resolves via reverse-token parsing (tartrate)", () => {
  const result = lookupKbFormExplain({
    ingredientName: "Carnitine Tartrate",
    chemicalForm: null,
    chemicalFormConfidence: null,
    chemicalFormSource: "none",
    chemicalFormEvidence: null,
  });

  assert.ok(result.sentence, "expected KB sentence");
  assert.equal(result.resolveSource !== "none", true, "expected non-none resolveSource");
  assert.ok(result.sentenceId, "expected sentenceId");
  assert.ok(result.excerptId, "expected excerptId");
  assert.ok(result.referenceId, "expected referenceId");
  assert.ok(
    String(result.sentence).toLowerCase().includes("tartrate"),
    "expected sentence to mention tartrate",
  );
});

