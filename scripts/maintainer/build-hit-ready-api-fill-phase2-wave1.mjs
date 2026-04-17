#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const QUEUE_PATH = getArg(
  "queue-json",
  path.join(ROOT, "output", "hit_ready_api_fill_phase1_current", "closure_audit_post_phase1", "hit_ready_closure_audit_queue.json"),
);
const OUT_DIR = getArg("out-dir", path.join(ROOT, "output", "hit_ready_api_fill_phase2_wave1_plan"));
const BRANDS = String(
  getArg(
    "brands",
    "NutriBiotic,MRM Nutrition,Source Naturals,Trace,Amazing Nutrition",
  ),
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const EXCLUDE_TITLE_PATTERNS = [
  /\bgum\b/i,
  /\bmints?\b/i,
  /\bmouth rinse\b/i,
  /\bmouthwash\b/i,
  /\bdental\b/i,
  /\bnasal spray\b/i,
  /\bprotein bars?\b/i,
  /\bchocolate\b/i,
  /\bcookies?\b/i,
  /\bsnacks?\b/i,
  /\bcoffee\b/i,
  /\btea\b/i,
  /\bchew(?:y|ies)?\b/i,
];

const SUPPLEMENT_SIGNAL_PATTERNS = [
  /\bcapsules?\b/i,
  /\btablets?\b/i,
  /\bsoftgels?\b/i,
  /\blozenges?\b/i,
  /\bpowder\b/i,
  /\bgummies?\b/i,
  /\bvitamin\b/i,
  /\bminerals?\b/i,
  /\bextract\b/i,
  /\bomega\b/i,
  /\bprobiotic\b/i,
  /\belectrolyte\b/i,
  /\bpre-?workout\b/i,
  /\bgreens?\b/i,
  /\bberberine\b/i,
  /\binositol\b/i,
  /\bcoq10\b/i,
];

const normalizeText = (value) =>
  String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const ensureDir = async (dirPath) => {
  await fs.mkdir(dirPath, { recursive: true });
};

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));
const writeJson = async (filePath, payload) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};
const writeText = async (filePath, body) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, body, "utf8");
};

const titleLooksSupplementLike = (title) => {
  const normalized = normalizeText(title);
  if (!normalized) return false;
  if (EXCLUDE_TITLE_PATTERNS.some((pattern) => pattern.test(normalized))) return false;
  return SUPPLEMENT_SIGNAL_PATTERNS.some((pattern) => pattern.test(normalized));
};

const toMarkdown = ({ summary, rows }) => {
  const lines = [
    "# Hit-Ready API Fill Phase 2 Wave 1",
    "",
    `- sourceQueue: ${QUEUE_PATH}`,
    `- includedBrands: ${BRANDS.join(", ")}`,
    "",
    "## Summary",
    "",
    `- selectedRows: ${summary.selectedRows}`,
    `- selectedBrands: ${summary.selectedBrands}`,
    `- skippedNonSupplementLike: ${summary.skippedNonSupplementLike}`,
    "",
    "## Brand Counts",
    "",
  ];

  for (const brand of summary.brandCounts) {
    lines.push(`- ${brand.brandName}: ${brand.count}`);
  }

  lines.push("", "## Sample", "");
  for (const row of rows.slice(0, 50)) {
    lines.push(`- ${row.brandName} | ${row.title} | ${row.barcode || "n/a"}`);
  }
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  const queue = await readJson(QUEUE_PATH);
  const selected = [];
  let skippedNonSupplementLike = 0;
  const brandCounts = new Map();

  for (const row of Array.isArray(queue) ? queue : []) {
    if (normalizeText(row?.closureBucket) !== "partial_overlay_requires_api_fill") continue;
    const brandName = normalizeText(row?.brandName);
    if (!BRANDS.includes(brandName)) continue;
    if (!titleLooksSupplementLike(row?.title)) {
      skippedNonSupplementLike += 1;
      continue;
    }
    selected.push(row);
    brandCounts.set(brandName, (brandCounts.get(brandName) ?? 0) + 1);
  }

  selected.sort((left, right) => {
    const brandCompare = normalizeText(left.brandName).localeCompare(normalizeText(right.brandName));
    if (brandCompare !== 0) return brandCompare;
    return normalizeText(left.title).localeCompare(normalizeText(right.title));
  });

  const summary = {
    selectedRows: selected.length,
    selectedBrands: brandCounts.size,
    skippedNonSupplementLike,
    brandCounts: [...brandCounts.entries()]
      .map(([brandName, count]) => ({ brandName, count }))
      .sort((left, right) => right.count - left.count || left.brandName.localeCompare(right.brandName)),
  };

  await ensureDir(OUT_DIR);
  await Promise.all([
    writeJson(path.join(OUT_DIR, "phase2_wave1_queue.json"), selected),
    writeJson(path.join(OUT_DIR, "phase2_wave1_summary.json"), summary),
    writeText(path.join(OUT_DIR, "phase2_wave1_summary.md"), toMarkdown({ summary, rows: selected })),
  ]);

  console.log(
    JSON.stringify(
      {
        ok: true,
        outDir: OUT_DIR,
        summary,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
