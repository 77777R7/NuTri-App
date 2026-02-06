#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

const RUNTIME_PATH =
  process.env.KB_RUNTIME_INDEX_PATH || path.join("backend", "data", "kb", "kb_runtime_index.json");

const loadJson = async (filePath) => {
  const raw = await fs.readFile(filePath, "utf-8");
  const sanitized = raw.replace(/\bNaN\b/g, "null");
  return { raw: sanitized, json: JSON.parse(sanitized) };
};

const saveJson = async (filePath, json) => {
  const out = JSON.stringify(json, null, 2) + "\n";
  await fs.writeFile(filePath, out);
};

const annotateSentences = (sentences) => {
  if (!Array.isArray(sentences)) return sentences;
  return sentences.map((s) => {
    if (!s || typeof s !== "object") return s;
    const source = String(s.source ?? "");
    // Governance rule:
    // - form_library is treated as pre-reviewed ("approved")
    // - curated_override is human-reviewed; existing shipped overrides are treated as approved
    //   and future workflows should set needs_edit -> approved in the source KB before packaging.
    if (source === "form_library" && s.review_status == null) return { ...s, review_status: "approved" };
    if (source === "curated_override" && s.review_status == null) return { ...s, review_status: "approved" };
    return s;
  });
};

const annotateSegments = (segments) => {
  if (!segments || typeof segments !== "object") return segments;
  const next = {};
  for (const [segName, seg] of Object.entries(segments)) {
    if (!seg || typeof seg !== "object") continue;
    const en = annotateSentences(seg.en);
    next[segName] = { ...seg, en };
  }
  return next;
};

async function main() {
  const { json } = await loadJson(RUNTIME_PATH);
  const ingredientFormIndex = json.ingredient_form_index ?? {};
  for (const [k, entry] of Object.entries(ingredientFormIndex)) {
    if (!entry || typeof entry !== "object") continue;
    ingredientFormIndex[k] = { ...entry, segments: annotateSegments(entry.segments) };
  }

  json.ingredient_form_index = ingredientFormIndex;
  json.meta = {
    ...(json.meta ?? {}),
    review_policy: {
      library: "pre_reviewed",
      curated_override: "approved_required",
      annotated_at: new Date().toISOString(),
    },
  };

  await saveJson(RUNTIME_PATH, json);
  console.log(`[kb] annotated review_status in runtime index: ${RUNTIME_PATH}`);
}

main().catch((err) => {
  console.error(`[kb] annotate failed: ${String(err)}`);
  process.exit(1);
});

