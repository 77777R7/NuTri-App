#!/usr/bin/env node
/* eslint-disable no-console */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

// Build a provenance index (graph-shaped JSON) from the shipped production KB package.
//
// Goal: make audit/tracing cheap without introducing a new database or changing runtime behavior.
// This is intended as an artifact for CI/scorecard/debug, not a user-facing API payload.

const RUNTIME_PATH =
  process.env.KB_RUNTIME_INDEX_PATH || path.join("backend", "data", "kb", "kb_runtime_index.json");
const EVIDENCE_PATH =
  process.env.KB_EVIDENCE_EXCERPTS_PATH || path.join("backend", "data", "kb", "kb_evidence_excerpts.json");
const OUT_PATH =
  process.env.KB_PROV_INDEX_PATH || path.join("artifacts", "kb", "kb_prov_index.json");

const loadJson = async (filePath) => {
  const raw = await fs.readFile(filePath, "utf-8");
  const sanitized = String(raw).replace(/\bNaN\b/g, "null");
  return JSON.parse(sanitized);
};

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

async function main() {
  const runtimeRaw = await fs.readFile(RUNTIME_PATH, "utf-8");
  const runtime = JSON.parse(String(runtimeRaw).replace(/\bNaN\b/g, "null"));
  const runtimeSha = sha256(runtimeRaw);

  let evidence = null;
  let evidenceSha = null;
  try {
    const evidenceRaw = await fs.readFile(EVIDENCE_PATH, "utf-8");
    evidence = JSON.parse(String(evidenceRaw).replace(/\bNaN\b/g, "null"));
    evidenceSha = sha256(evidenceRaw);
  } catch {
    // evidence file is optional for this index; keep nulls in meta.
  }

  const edges = [];
  const ingredientFormIndex = runtime?.ingredient_form_index ?? {};
  for (const [key, entry] of Object.entries(ingredientFormIndex)) {
    const ingredientId = String(entry?.ingredient_id ?? "").trim() || null;
    const ingredient = String(entry?.ingredient ?? "").trim() || null;
    const formKey = String(entry?.form_key ?? "").trim() || null;
    const formDisplay = String(entry?.form_display ?? "").trim() || null;
    const segments = entry?.segments;
    if (!segments || typeof segments !== "object") continue;

    for (const [segmentName, seg] of Object.entries(segments)) {
      const en = seg?.en;
      if (!Array.isArray(en)) continue;
      for (const s of en) {
        if (!s || typeof s !== "object") continue;
        const sentenceId = String(s.sentence_id ?? "").trim() || null;
        const excerptId = String(s.evidence_snippet_id ?? "").trim() || null;
        const referenceId = String(s.evidence_reference_id ?? "").trim() || null;
        if (!sentenceId || !excerptId || !referenceId) continue;
        edges.push({
          ingredientFormKey: key,
          ingredientId,
          ingredient,
          formKey,
          formDisplay,
          segment: segmentName,
          lang: "en",
          sentenceId,
          excerptId,
          referenceId,
          source: s.source ?? null,
          reviewStatus: s.review_status ?? null,
          evidenceGrade: s.evidence_grade ?? null,
          evidenceExcerptStatus: s.evidence_excerpt_status ?? null,
        });
      }
    }
  }

  const prov = {
    meta: {
      generated_at: new Date().toISOString(),
      runtime: {
        path: RUNTIME_PATH,
        sha256: runtimeSha,
        production_filter: runtime?.meta?.production_filter ?? null,
        review_policy: runtime?.meta?.review_policy ?? null,
        generated_from: runtime?.meta?.generated_from ?? null,
        source: runtime?.meta?.source ?? null,
      },
      evidence: evidenceSha
        ? {
            path: EVIDENCE_PATH,
            sha256: evidenceSha,
            ref_count: evidence?.meta?.ref_count ?? null,
            source: evidence?.meta?.source ?? null,
          }
        : null,
      note:
        "Graph-shaped provenance index from the shipped production KB. Edges connect ingredient|form -> sentence -> excerpt -> reference.",
    },
    edges,
  };

  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify(prov, null, 2) + "\n");
  console.log(`[kb] wrote prov index: ${OUT_PATH} (edges=${edges.length})`);
}

main().catch((err) => {
  console.error(`[kb] prov build failed: ${String(err)}`);
  process.exit(1);
});

