#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

// Build the shipped production KB runtime index from an editable source file.
//
// Why: we need a place to keep draft KB edits (needs_edit / needs_capture) without shipping them,
// while still committing a production package that is safe and deterministic.

const SOURCE_PATH =
  process.env.KB_RUNTIME_SOURCE_PATH || path.join("kb", "source", "kb_runtime_index.source.json");
const OUTPUT_PATH =
  process.env.KB_RUNTIME_INDEX_PATH || path.join("backend", "data", "kb", "kb_runtime_index.json");

const MODE = process.env.KB_FILTER_MODE || "captured_and_approved";

const loadJson = async (filePath) => {
  const raw = await fs.readFile(filePath, "utf-8");
  const sanitized = raw.replace(/\bNaN\b/g, "null");
  return JSON.parse(sanitized);
};

const saveJson = async (filePath, json) => {
  const out = JSON.stringify(json, null, 2) + "\n";
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, out);
};

const annotateSentences = (sentences) => {
  if (!Array.isArray(sentences)) return sentences;
  return sentences.map((s) => {
    if (!s || typeof s !== "object") return s;
    const source = String(s.source ?? "");
    // Governance rule:
    // - form_library is treated as pre-reviewed ("approved")
    // - curated_override must be explicitly approved in source before shipping
    if (source === "form_library" && s.review_status == null) return { ...s, review_status: "approved" };
    return s;
  });
};

const annotateSegments = (segments) => {
  if (!segments || typeof segments !== "object") return segments;
  const next = {};
  for (const [segName, seg] of Object.entries(segments)) {
    if (!seg || typeof seg !== "object") continue;
    next[segName] = { ...seg, en: annotateSentences(seg.en) };
  }
  return next;
};

const filterSentences = (sentences) => {
  if (!Array.isArray(sentences)) return sentences;
  if (MODE === "captured_only") return sentences.filter((s) => s?.evidence_excerpt_status === "captured");
  if (MODE === "captured_and_approved") {
    return sentences.filter((s) => {
      if (s?.evidence_excerpt_status !== "captured") return false;
      const source = String(s?.source ?? "");
      // Library content is treated as pre-reviewed; overrides require explicit approval.
      if (source === "curated_override") return s?.review_status === "approved";
      if (source === "form_library") return true;
      // Default: if review_status exists, require approved; otherwise keep.
      return s?.review_status == null ? true : s?.review_status === "approved";
    });
  }
  return sentences;
};

const filterSegments = (segments) => {
  if (!segments || typeof segments !== "object") return segments;
  const next = {};
  for (const [segName, seg] of Object.entries(segments)) {
    if (!seg || typeof seg !== "object") continue;
    const en = filterSentences(seg.en);
    if (Array.isArray(en) && en.length > 0) next[segName] = { ...seg, en };
  }
  return Object.keys(next).length ? next : null;
};

async function main() {
  const source = await loadJson(SOURCE_PATH);

  // Work on a deep clone to avoid accidental mutation of the source file.
  const json = JSON.parse(JSON.stringify(source));

  const ingredientFormIndex = json.ingredient_form_index ?? {};
  for (const [k, entry] of Object.entries(ingredientFormIndex)) {
    if (!entry || typeof entry !== "object") continue;
    const annotated = { ...entry, segments: annotateSegments(entry.segments) };
    const filtered = filterSegments(annotated.segments);
    if (filtered) {
      ingredientFormIndex[k] = { ...annotated, segments: filtered };
    } else {
      const { segments: _seg, ...rest } = annotated;
      ingredientFormIndex[k] = rest;
    }
  }
  json.ingredient_form_index = ingredientFormIndex;

  const { change_log: _changeLog, ...metaWithoutChangeLog } = json.meta ?? {};
  json.meta = {
    ...metaWithoutChangeLog,
    production_filter: {
      mode: MODE,
      note:
        MODE === "captured_and_approved"
          ? "Segments are filtered so only evidence_excerpt_status=captured is shipped; curated_override sentences must be review_status=approved."
          : "Segments are filtered so only evidence_excerpt_status=captured is shipped.",
      filtered_at: new Date().toISOString(),
    },
    review_policy: {
      library: "pre_reviewed",
      curated_override: "approved_required",
      annotated_at: new Date().toISOString(),
    },
  };

  await saveJson(OUTPUT_PATH, json);
  console.log(`[kb] built production runtime index: ${OUTPUT_PATH} from ${SOURCE_PATH} mode=${MODE}`);
}

main().catch((err) => {
  console.error(`[kb] build failed: ${String(err)}`);
  process.exit(1);
});
