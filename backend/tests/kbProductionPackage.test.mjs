import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runtimePath = path.resolve(__dirname, "../data/kb/kb_runtime_index.json");
const evidenceExcerptsPath = path.resolve(__dirname, "../data/kb/kb_evidence_excerpts.json");

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

test("KB evidence excerpts cover all shipped KB sentences (captured + non-search URLs)", () => {
  const { json: runtime } = loadJson();

  const rawExcerpts = fs.readFileSync(evidenceExcerptsPath, "utf-8").replace(/\bNaN\b/g, "null");
  const excerptsJson = JSON.parse(rawExcerpts);
  const evidenceExcerpts = excerptsJson?.evidence_excerpts ?? [];
  assert.ok(Array.isArray(evidenceExcerpts), "expected kb_evidence_excerpts.json evidence_excerpts array");

  const byRef = new Map();
  for (const row of evidenceExcerpts) {
    if (!row || typeof row !== "object") continue;
    const ref = String(row.citation_id || "");
    if (!ref) continue;
    byRef.set(ref, row);
  }

  const errors = [];
  const ingredientFormIndex = runtime?.ingredient_form_index ?? {};
  for (const [key, entry] of Object.entries(ingredientFormIndex)) {
    const segments = entry?.segments;
    if (!segments || typeof segments !== "object") continue;
    for (const seg of Object.values(segments)) {
      const en = seg?.en;
      if (!Array.isArray(en)) continue;
      for (const s of en) {
        const ref = String(s?.evidence_reference_id || "");
        const snippet = String(s?.evidence_snippet_id || "");
        if (!ref || !snippet) {
          errors.push(`${key}: missing evidence_reference_id/evidence_snippet_id`);
          continue;
        }
        const row = byRef.get(ref);
        if (!row) {
          errors.push(`${key}: missing citation_id=${ref} in kb_evidence_excerpts.json`);
          continue;
        }
        if (String(row.excerpt_id || "") !== snippet) {
          errors.push(`${key}: excerpt_id mismatch for ${ref} (runtime=${snippet} excerpts=${String(row.excerpt_id || "")})`);
        }
        if (row.capture_status !== "captured") {
          errors.push(`${key}: citation_id=${ref} capture_status must be captured (got ${String(row.capture_status)})`);
        }
        const excerptText = String(row.excerpt_text || "").trim();
        if (!excerptText) {
          errors.push(`${key}: citation_id=${ref} excerpt_text must be non-empty`);
        }
        const url = String(row.url || "");
        if (url.includes("pubmed.ncbi.nlm.nih.gov/?term=")) {
          errors.push(`${key}: citation_id=${ref} must not use PubMed search URLs (${url})`);
        }
      }
    }
  }

  assert.equal(errors.length, 0, `KB evidence excerpt coverage errors:\\n- ${errors.join("\\n- ")}`);
});
