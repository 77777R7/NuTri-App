#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const TODAY = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const getMultiArg = (name) => {
  const flag = `--${name}`;
  const values = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === flag && i + 1 < args.length) values.push(args[i + 1]);
  }
  return values;
};

const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", "quality_marks", `igen_ready_master_seed_${TODAY}`),
);
const OUT_JSON = getArg("out-json", path.join(OUT_DIR, "igen_ready_master_seed.json"));
const OUT_MD = getArg("out-md", path.join(OUT_DIR, "igen_ready_master_seed.md"));

const defaultInputPaths = [
  path.join(
    ROOT,
    "output",
    "quality_marks",
    `igen_consumer_rollout_pack_full_v2_${TODAY}`,
    "wave1_high_frequency_consumer_seed.json",
  ),
  path.join(
    ROOT,
    "output",
    "quality_marks",
    `igen_brand_expansion_wave1_nordic_final_full_v2_${TODAY}`,
    "consumer_ready_rows.json",
  ),
  path.join(
    ROOT,
    "output",
    "quality_marks",
    `igen_brand_expansion_wave2_carlson_final_full_v2_${TODAY}`,
    "consumer_ready_rows.json",
  ),
  path.join(
    ROOT,
    "output",
    "quality_marks",
    `igen_brand_expansion_wave3_country_life_probe_full_v2_${TODAY}`,
    "consumer_ready_rows.json",
  ),
  path.join(
    ROOT,
    "output",
    "quality_marks",
    `igen_brand_expansion_wave4_sports_research_final_full_v2_${TODAY}`,
    "consumer_ready_rows.json",
  ),
  path.join(
    ROOT,
    "output",
    "quality_marks",
    `igen_brand_expansion_wave5_garden_of_life_probe_full_v2_${TODAY}`,
    "consumer_ready_rows.json",
  ),
];

const INPUT_PATHS = getMultiArg("input-json");
const effectiveInputPaths = INPUT_PATHS.length > 0 ? INPUT_PATHS : defaultInputPaths;

const safeText = (value) => String(value ?? "").trim();
const nowIso = () => new Date().toISOString();

const increment = (map, key, by = 1) => {
  map[key] = (map[key] ?? 0) + by;
};

const sortCounts = (counts) =>
  Object.fromEntries(
    Object.entries(counts).sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    }),
  );

const toKey = (row) =>
  `${safeText(row?.productId)}::${safeText(row?.barcode)}::${safeText(row?.brandName)}::${safeText(
    row?.productName ?? row?.title,
  )}`;

const toMarkdown = (report) => {
  const lines = [];
  lines.push("# iGEN Ready Master Seed");
  lines.push("");
  lines.push(`Generated at: ${report.generatedAt}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- input files: ${report.summary.inputFiles}`);
  lines.push(`- unique ready rows: ${report.summary.uniqueReadyRows}`);
  lines.push(`- brands: ${report.summary.brandCount}`);
  lines.push("");
  lines.push("## Brand Counts");
  lines.push("");
  for (const [brand, count] of Object.entries(report.brandCounts)) {
    lines.push(`- ${brand}: ${count}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const readRows = async (targetPath) => {
  const payload = JSON.parse(await fs.readFile(targetPath, "utf8"));
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload)) return payload;
  return [];
};

const main = async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const rows = [];
  const seen = new Set();

  for (const inputPath of effectiveInputPaths) {
    try {
      const sourceRows = await readRows(inputPath);
      for (const row of sourceRows) {
        const key = toKey(row);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        rows.push({
          productId: row?.productId ?? null,
          barcode: row?.barcode ?? null,
          brandName: row?.brandName ?? null,
          productName: row?.productName ?? row?.title ?? null,
          iherbUrl: row?.iherbUrl ?? row?.link ?? null,
          officialSignalProgramId: row?.officialSignalProgramId ?? "igen",
          officialSignalProgramLabel: row?.officialSignalProgramLabel ?? "iGEN",
          officialSignalState: row?.officialSignalState ?? "product_level_official_signal",
          officialRegistryEvidenceUrl: row?.officialRegistryEvidenceUrl ?? null,
          sourceClassification: row?.sourceClassification ?? "brand_expansion_consumer_ready",
          sourceFile: inputPath,
        });
      }
    } catch {
      // Missing optional inputs are ignored so the script can run incrementally.
    }
  }

  rows.sort((a, b) => {
    const brandDelta = safeText(a.brandName).localeCompare(safeText(b.brandName));
    if (brandDelta !== 0) return brandDelta;
    return safeText(a.productName).localeCompare(safeText(b.productName));
  });

  const brandCounts = {};
  for (const row of rows) increment(brandCounts, safeText(row.brandName) || "unknown");

  const report = {
    schemaVersion: "igen_ready_master_seed.v1",
    generatedAt: nowIso(),
    inputs: {
      inputPaths: effectiveInputPaths,
    },
    summary: {
      inputFiles: effectiveInputPaths.length,
      uniqueReadyRows: rows.length,
      brandCount: Object.keys(brandCounts).length,
    },
    brandCounts: sortCounts(brandCounts),
    rows,
  };

  await fs.writeFile(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(OUT_MD, toMarkdown(report), "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        uniqueReadyRows: report.summary.uniqueReadyRows,
        brandCount: report.summary.brandCount,
        outJson: OUT_JSON,
        outMd: OUT_MD,
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
