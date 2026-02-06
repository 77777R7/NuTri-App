#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

const RUNTIME_PATH = process.env.KB_RUNTIME_INDEX_PATH || path.join("backend", "data", "kb", "kb_runtime_index.json");
const MODE = process.env.KB_FILTER_MODE || "captured_only";

const loadJson = async (filePath) => {
  const raw = await fs.readFile(filePath, "utf-8");
  // Some generated KB files still contain NaN placeholders.
  const sanitized = raw.replace(/\bNaN\b/g, "null");
  return JSON.parse(sanitized);
};

const saveJson = async (filePath, json) => {
  const out = JSON.stringify(json, null, 2) + "\n";
  await fs.writeFile(filePath, out);
};

const filterSentences = (sentences) => {
  if (!Array.isArray(sentences)) return sentences;
  if (MODE === "captured_only") {
    return sentences.filter((s) => s?.evidence_excerpt_status === "captured");
  }
  return sentences;
};

const filterSegments = (segments) => {
  if (!segments || typeof segments !== "object") return segments;
  const next = {};
  for (const [segName, seg] of Object.entries(segments)) {
    if (!seg || typeof seg !== "object") continue;
    const en = filterSentences(seg.en);
    if (Array.isArray(en) && en.length > 0) {
      next[segName] = { ...seg, en };
    }
  }
  return Object.keys(next).length ? next : null;
};

async function main() {
  const json = await loadJson(RUNTIME_PATH);

  const ingredientFormIndex = json.ingredient_form_index ?? {};
  for (const [k, entry] of Object.entries(ingredientFormIndex)) {
    if (!entry || typeof entry !== "object") continue;
    const filtered = filterSegments(entry.segments);
    if (filtered) {
      ingredientFormIndex[k] = { ...entry, segments: filtered };
    } else {
      const { segments: _seg, ...rest } = entry;
      ingredientFormIndex[k] = rest;
    }
  }

  json.ingredient_form_index = ingredientFormIndex;
  json.meta = {
    ...(json.meta ?? {}),
    production_filter: {
      mode: MODE,
      note: "Segments are filtered so only evidence_excerpt_status=captured is shipped.",
      filtered_at: new Date().toISOString(),
    },
  };

  await saveJson(RUNTIME_PATH, json);
  console.log(`[kb] filtered runtime index: ${RUNTIME_PATH} mode=${MODE}`);
}

main().catch((err) => {
  console.error(`[kb] filter failed: ${String(err)}`);
  process.exit(1);
});

