import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runtimePath = path.resolve(__dirname, "../data/kb/kb_runtime_index.json");

const loadJson = () => {
  const raw = fs.readFileSync(runtimePath, "utf-8");
  // Some generated KB artifacts may include NaN placeholders; treat as null for parsing.
  const sanitized = raw.replace(/\bNaN\b/g, "null");
  return { raw: sanitized, json: JSON.parse(sanitized) };
};

const FORBIDDEN_SUBSTRINGS = ["needs_edit", "needs_capture", "needs_human_review"];

test("KB runtime index looks like a production package (no draft statuses)", () => {
  const { raw, json } = loadJson();

  for (const needle of FORBIDDEN_SUBSTRINGS) {
    assert.equal(
      raw.includes(needle),
      false,
      `kb_runtime_index.json should not contain ${needle} (filter to approved-only before packaging)`,
    );
  }

  const meta = json?.meta ?? {};
  assert.ok(meta && typeof meta === "object", "expected runtime meta object");
  const source = String(meta.source ?? "");
  const generatedFrom = String(meta.generated_from ?? "");
  assert.ok(source.includes("review_excerpts"), `expected meta.source to include review_excerpts (got ${source})`);
  assert.ok(
    generatedFrom.includes("review_excerpts"),
    `expected meta.generated_from to include review_excerpts (got ${generatedFrom})`,
  );

  const productionFilter = meta.production_filter ?? {};
  assert.ok(productionFilter && typeof productionFilter === "object", "expected meta.production_filter object");
  assert.equal(
    productionFilter.mode,
    "captured_and_approved",
    `expected production_filter.mode=captured_and_approved (got ${String(productionFilter.mode)})`,
  );

  const walk = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (typeof value !== "object") return;

    for (const [k, v] of Object.entries(value)) {
      if (k === "review_status") {
        assert.equal(v, "approved", `expected review_status=approved, got ${String(v)}`);
      }
      if (k === "source" && v === "curated_override") {
        // Overrides must be explicitly approved to ship in production.
        assert.equal(
          value.review_status,
          "approved",
          `expected curated_override review_status=approved (got ${String(value.review_status)})`,
        );
      }
      if (k === "evidence_excerpt_status") {
        assert.notEqual(v, "needs_capture", "production KB should not ship needs_capture evidence");
      }
      walk(v);
    }
  };

  walk(json);
});
