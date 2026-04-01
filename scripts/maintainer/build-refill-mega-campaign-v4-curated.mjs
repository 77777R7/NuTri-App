#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

import { normalizeLower, normalizeText } from "./lib/iherb-overlay-utils.mjs";

const ROOT = process.cwd();
const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const INPUT_PATH = getArg(
  "input-json",
  path.join(ROOT, "output", "refill_mega_04", "miner_v4_v2", "combined.queue.rows.json"),
);
const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", "refill_mega_04", "miner_v4_curated"),
);

const BRAND_ALLOWLIST = new Set(
  [
    "Aurora Nutrascience",
    "Carlson",
    "CATALO",
    "Christopher's Original Formulas",
    "Country Life",
    "Double Wood Supplements",
    "Eclectic Herb",
    "Garden of Life",
    "Global Healing",
    "Himalaya",
    "Host Defense",
    "Ilhwa",
    "Jamieson Vitamins",
    "Metagenics",
    "Natural Factors",
    "New Chapter",
    "North American Herb & Spice",
    "Nature's Truth",
    "Nutricost",
    "NutraChamps",
    "Organic India",
    "Protocol for Life Balance",
    "Source Naturals",
    "Trace",
    "Triquetra Health",
    "Universal U",
    "Vibrant Health",
    "Whole World Botanicals",
  ].map((value) => normalizeText(value)),
);

const HARD_EXCLUDE_PATTERNS = [
  /\bhomeopathy\b/i,
  /\bmedicine cabinet\b/i,
  /\bbug\b/i,
  /\binsect\b/i,
  /\brepel(?:s|lent)?\b/i,
  /\bsuppositor(?:y|ies)\b/i,
  /\bvaginal\b/i,
  /\bmouthwash\b/i,
  /\btoothpaste\b/i,
  /\bsoap\b/i,
  /\bcleanser\b/i,
  /\bscrub\b/i,
  /\bserum\b/i,
  /\bcream\b/i,
  /\bointment\b/i,
  /\bdeodorant\b/i,
  /\bdishwashing\b/i,
  /\bhand soap\b/i,
  /\bbody wash\b/i,
  /\bfacial\b/i,
  /\bessential oils?\b/i,
  /\bsolutions\b/i,
  /\breal food\b/i,
  /\bempty capsules\b/i,
  /\btea\b/i,
  /\bcoffee\b/i,
  /\bcandy\b/i,
  /\bgummy bears?\b/i,
  /\bchews?\b/i,
  /\bpastilles?\b/i,
  /\bsyrup\b/i,
  /\bhoney\b/i,
  /\bsea salt\b/i,
  /\bspice\b/i,
  /\bseasoning\b/i,
  /\bpepper blend\b/i,
  /\bartichoke\b/i,
  /\bsun-dried\b/i,
  /\bjuice of wild oregano\b/i,
  /\boil of wild oregano\b/i,
  /\bliquid coconut oil\b/i,
  /\bexpectorant\b/i,
  /\bpain reliever\b/i,
];

const ITEM_EXCLUDE_PATTERNS = {
  "Source Naturals": [/\bwellguard\b/i],
  "Eclectic Herb": [/\bkids?\b/i, /\bspray\b/i],
  "New Chapter": [/\bliquid multivitamin\b/i],
  "Universal U": [/\bchews?\b/i],
  "Nutricost": [/\bboric acid\b/i, /\bzinc oxide\b/i],
  "Trace": [/\bflakes\b/i],
  "Country Life": [],
  "Organic India": [],
};

const readJson = async (filePath) => JSON.parse(await fs.readFile(path.resolve(ROOT, filePath), "utf8"));
const writeJson = async (filePath, payload) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};
const writeText = async (filePath, body) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, body, "utf8");
};

const summarizeByBrand = (rows) => {
  const byBrand = {};
  for (const row of rows) {
    const brand = normalizeText(row?.brandName || "Unknown");
    byBrand[brand] = (byBrand[brand] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(byBrand).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])),
  );
};

const getText = (row) =>
  [
    row?.brandName,
    row?.title,
    row?.dosageForm,
    ...(Array.isArray(row?.categories) ? row.categories : []),
  ]
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .join(" | ");

const classifyReason = (row) => {
  const brand = normalizeText(row?.brandName);
  if (!BRAND_ALLOWLIST.has(brand)) return "brand_not_allowlisted";

  const text = getText(row);
  if (HARD_EXCLUDE_PATTERNS.some((pattern) => pattern.test(text))) return "hard_excluded_pattern";
  if (/\bpowder\b/i.test(text) && /\b(curry|garlic|onion|xanthan|clay|bath|flakes?|spice|seasoning|sea salt)\b/i.test(text)) {
    return "hard_excluded_powder_pattern";
  }

  const brandSpecificPatterns = ITEM_EXCLUDE_PATTERNS[brand] ?? [];
  if (brandSpecificPatterns.some((pattern) => pattern.test(text))) return "brand_specific_exclusion";

  const missing = new Set((row?.coreMissingFields ?? []).map((value) => normalizeLower(value)));
  if (!missing.size) return "no_missing_fields";

  return null;
};

const buildMarkdown = ({ curatedRows, excludedRows, summary }) => {
  const lines = [
    "# Refill Mega Campaign v4 Curated",
    "",
    `- generated_at: ${summary.generatedAt}`,
    `- input_rows: ${summary.inputRows}`,
    `- curated_rows: ${summary.curatedRows}`,
    `- excluded_rows: ${summary.excludedRows}`,
    "",
    "## Curated Brands",
    "",
  ];

  for (const [brandName, count] of Object.entries(summary.curatedByBrand)) {
    lines.push(`- ${brandName}: ${count}`);
  }

  lines.push("", "## Exclusion Reasons", "");
  for (const [reason, count] of Object.entries(summary.excludedByReason)) {
    lines.push(`- ${reason}: ${count}`);
  }

  lines.push("", "## Sample Curated Rows", "");
  for (const row of curatedRows.slice(0, 20)) {
    lines.push(`- ${row.brandName} | ${row.productId} | ${row.title} | missing=${(row.coreMissingFields ?? []).join(", ") || "none"}`);
  }

  lines.push("", "## Sample Excluded Rows", "");
  for (const row of excludedRows.slice(0, 20)) {
    lines.push(`- ${row.brandName} | ${row.productId} | ${row.title} | reason=${row.excludeReason}`);
  }

  return `${lines.join("\n")}\n`;
};

const main = async () => {
  const inputRows = await readJson(INPUT_PATH);
  const curatedRows = [];
  const excludedRows = [];

  for (const row of inputRows) {
    const excludeReason = classifyReason(row);
    if (excludeReason) {
      excludedRows.push({
        ...row,
        excludeReason,
      });
      continue;
    }
    curatedRows.push(row);
  }

  const excludedByReason = {};
  for (const row of excludedRows) {
    excludedByReason[row.excludeReason] = (excludedByReason[row.excludeReason] ?? 0) + 1;
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    inputPath: path.resolve(ROOT, INPUT_PATH),
    inputRows: inputRows.length,
    curatedRows: curatedRows.length,
    excludedRows: excludedRows.length,
    curatedByBrand: summarizeByBrand(curatedRows),
    excludedByReason: Object.fromEntries(
      Object.entries(excludedByReason).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])),
    ),
  };

  await writeJson(path.resolve(ROOT, OUT_DIR, "curated.queue.rows.json"), curatedRows);
  await writeJson(path.resolve(ROOT, OUT_DIR, "excluded.rows.json"), excludedRows);
  await writeJson(path.resolve(ROOT, OUT_DIR, "summary.json"), summary);
  await writeText(path.resolve(ROOT, OUT_DIR, "summary.md"), buildMarkdown({ curatedRows, excludedRows, summary }));

  console.log(JSON.stringify({ ok: true, outDir: path.resolve(ROOT, OUT_DIR), summary }, null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
