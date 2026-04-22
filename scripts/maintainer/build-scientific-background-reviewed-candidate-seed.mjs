#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

import {
  getScientificBackgroundCandidateHelperDefaults,
  loadScientificBackgroundCandidateRegistry,
  selectScientificBackgroundReviewSeeds,
} from "./lib/scientific-background-reviewed-candidate-helper.mjs";

const ROOT = process.cwd();
const TODAY = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const defaults = getScientificBackgroundCandidateHelperDefaults();
const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const parseList = (value, fallback) => {
  if (!value) return fallback;
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

const PRIORITIES = parseList(getArg("priorities", null), ["P0"]);
const FAMILIES = parseList(getArg("families", null), null);
const MAX_PER_ENTRY = Number(getArg("max-per-entry", "3"));
const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", "scientific_background_review_candidate_seed", `run_${TODAY}`),
);
const OUT_JSON = getArg(
  "out-json",
  path.join(OUT_DIR, "scientific_background_review_candidate_seed.json"),
);

const main = async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const registry = await loadScientificBackgroundCandidateRegistry({
    evidencePath: defaults.evidencePath,
  });
  const rows = selectScientificBackgroundReviewSeeds({
    registry,
    priorities: PRIORITIES,
    families: FAMILIES,
    maxPerEntry: MAX_PER_ENTRY,
  });

  const report = {
    schemaVersion: "scientific_background_review_candidate_seed.v1",
    generatedAt: new Date().toISOString(),
    inputs: {
      evidencePath: defaults.evidencePath,
      priorities: PRIORITIES,
      families: FAMILIES,
      maxPerEntry: MAX_PER_ENTRY,
    },
    summary: {
      rowCount: rows.length,
      families: [...new Set(rows.map((row) => row.ingredientFamily).filter(Boolean))],
    },
    rows,
  };

  await fs.writeFile(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify(
      {
        ok: true,
        rowCount: report.summary.rowCount,
        families: report.summary.families,
        outJson: OUT_JSON,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
