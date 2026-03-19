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

const IGEN_SIGNAL_SEED_PATH = getArg(
  "igen-seed",
  path.join(
    ROOT,
    "output",
    "quality_marks",
    `nutrasource_promotion_wave_full_v2_${TODAY}`,
    "igen_official_signal",
    "igen_official_signal_seed.json",
  ),
);
const HIGH_FREQUENCY_DETAILS_PATH = getArg(
  "high-frequency-details",
  path.join(
    ROOT,
    "output",
    "iherb_overlay_high_frequency_validation_full_p0p1_final",
    "high_frequency_hit_details.json",
  ),
);
const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", "quality_marks", `igen_official_signal_rollout_plan_${TODAY}`),
);
const OUT_JSON = getArg("out-json", path.join(OUT_DIR, "igen_official_signal_rollout_plan.json"));
const OUT_MD = getArg("out-md", path.join(OUT_DIR, "igen_official_signal_rollout_plan.md"));
const OUT_SEED_JSON = getArg("rollout-seed-json", path.join(OUT_DIR, "rollout_seed_high_frequency_first.json"));

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

const dedupeBy = (rows, keyFn) => {
  const seen = new Set();
  const next = [];
  for (const row of rows) {
    const key = keyFn(row);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    next.push(row);
  }
  return next;
};

const rankValidationOutcome = (value) => {
  switch (safeText(value)) {
    case "complete_hit":
      return 0;
    case "record_hit_only":
      return 1;
    case "active_queue":
      return 2;
    case "missing_from_staging":
      return 3;
    default:
      return 4;
  }
};

const buildPriorityTier = (row) => {
  const outcome = safeText(row?.validationOutcome);
  if (outcome && outcome !== "complete_hit") return "P0_high_frequency_gap_with_igen_signal";
  if (outcome === "complete_hit") return "P1_high_frequency_complete_with_igen_signal";
  return "P2_brand_rollout";
};

const toMarkdown = (report) => {
  const lines = [];
  lines.push("# iGEN Official Signal Rollout Plan");
  lines.push("");
  lines.push(`Generated at: ${report.generatedAt}`);
  lines.push(`iGEN seed: ${report.inputs.igenSignalSeedPath}`);
  lines.push(`High-frequency details: ${report.inputs.highFrequencyDetailsPath}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- total iGEN seed rows: ${report.summary.totalIgenSeedRows}`);
  lines.push(`- high-frequency overlaps: ${report.summary.highFrequencyOverlapRows}`);
  lines.push(`- non-complete high-frequency overlaps: ${report.summary.nonCompleteHighFrequencyOverlapRows}`);
  lines.push(`- complete-hit high-frequency overlaps: ${report.summary.completeHighFrequencyOverlapRows}`);
  lines.push(`- brand rollout reserve rows: ${report.summary.brandRolloutReserveRows}`);
  lines.push("");
  lines.push("## Top High-Frequency Brands");
  lines.push("");
  for (const [brand, count] of Object.entries(report.highFrequencyOverlapBrandCounts).slice(0, 20)) {
    lines.push(`- ${brand}: ${count}`);
  }
  lines.push("");
  lines.push("## P0");
  lines.push("");
  for (const row of report.p0Rows.slice(0, 25)) {
    lines.push(`- ${row.brandName} | ${row.productName} | outcome=${row.validationOutcome ?? "none"} | barcode=${row.barcode ?? "none"}`);
  }
  lines.push("");
  lines.push("## P1");
  lines.push("");
  for (const row of report.p1Rows.slice(0, 25)) {
    lines.push(`- ${row.brandName} | ${row.productName} | complete_hit | barcode=${row.barcode ?? "none"}`);
  }
  lines.push("");
  lines.push("## P2 Brands");
  lines.push("");
  for (const [brand, count] of Object.entries(report.brandReserveCounts).slice(0, 20)) {
    lines.push(`- ${brand}: ${count}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const igenSeedPayload = JSON.parse(await fs.readFile(IGEN_SIGNAL_SEED_PATH, "utf8"));
  const highFrequencyDetails = JSON.parse(await fs.readFile(HIGH_FREQUENCY_DETAILS_PATH, "utf8"));

  const igenRows = Array.isArray(igenSeedPayload?.rows) ? igenSeedPayload.rows : [];
  const highFrequencyRows = Array.isArray(highFrequencyDetails) ? highFrequencyDetails : [];

  const highFrequencyByBarcode = new Map();
  for (const row of highFrequencyRows) {
    const barcode = safeText(row?.barcode_gtin14);
    if (!barcode) continue;
    const bucket = highFrequencyByBarcode.get(barcode) ?? [];
    bucket.push(row);
    highFrequencyByBarcode.set(barcode, bucket);
  }

  const decorated = igenRows.map((row) => {
    const barcode = safeText(row?.barcode);
    const overlaps = highFrequencyByBarcode.get(barcode) ?? [];
    const bestOverlap = overlaps
      .slice()
      .sort((a, b) => {
        const priorityDelta = Number(b?.patchPriorityScore ?? 0) - Number(a?.patchPriorityScore ?? 0);
        if (priorityDelta !== 0) return priorityDelta;
        return rankValidationOutcome(safeText(a?.validationOutcome)) - rankValidationOutcome(safeText(b?.validationOutcome));
      })[0] ?? null;

    return {
      ...row,
      highFrequencyOverlap: Boolean(bestOverlap),
      validationOutcome: bestOverlap?.validationOutcome ?? null,
      patchPriorityScore: bestOverlap?.patchPriorityScore ?? null,
      sourceReasonCode: bestOverlap?.sourceReasonCode ?? null,
      mergeDecision: bestOverlap?.mergeDecision ?? null,
      status: bestOverlap?.status ?? null,
      recommendedAction: bestOverlap?.recommendedAction ?? null,
      priorityTier: buildPriorityTier(bestOverlap ?? row),
    };
  });

  const uniqueDecorated = dedupeBy(
    decorated.sort((a, b) => {
      const tierOrder = { P0_high_frequency_gap_with_igen_signal: 0, P1_high_frequency_complete_with_igen_signal: 1, P2_brand_rollout: 2 };
      const tierDelta = (tierOrder[a.priorityTier] ?? 9) - (tierOrder[b.priorityTier] ?? 9);
      if (tierDelta !== 0) return tierDelta;
      const priorityDelta = Number(b.patchPriorityScore ?? 0) - Number(a.patchPriorityScore ?? 0);
      if (priorityDelta !== 0) return priorityDelta;
      return `${a.brandName ?? ""}|${a.productName ?? ""}`.localeCompare(`${b.brandName ?? ""}|${b.productName ?? ""}`);
    }),
    (row) => `${safeText(row.barcode)}::${safeText(row.productId)}`,
  );

  const p0Rows = uniqueDecorated.filter((row) => row.priorityTier === "P0_high_frequency_gap_with_igen_signal");
  const p1Rows = uniqueDecorated.filter((row) => row.priorityTier === "P1_high_frequency_complete_with_igen_signal");
  const p2Rows = uniqueDecorated.filter((row) => row.priorityTier === "P2_brand_rollout");

  const highFrequencyOverlapBrandCounts = {};
  const brandReserveCounts = {};
  const validationOutcomeCounts = {};

  for (const row of uniqueDecorated) {
    if (row.highFrequencyOverlap) {
      increment(highFrequencyOverlapBrandCounts, safeText(row.brandName) || "unknown");
      increment(validationOutcomeCounts, safeText(row.validationOutcome) || "unknown");
    } else {
      increment(brandReserveCounts, safeText(row.brandName) || "unknown");
    }
  }

  const rolloutSeed = {
    schemaVersion: "igen_official_signal_rollout_seed.v1",
    generatedAt: nowIso(),
    inputs: {
      igenSignalSeedPath: IGEN_SIGNAL_SEED_PATH,
      highFrequencyDetailsPath: HIGH_FREQUENCY_DETAILS_PATH,
    },
    summary: {
      totalRows: uniqueDecorated.length,
      p0Rows: p0Rows.length,
      p1Rows: p1Rows.length,
      p2Rows: p2Rows.length,
    },
    rows: uniqueDecorated,
  };

  const report = {
    schemaVersion: "igen_official_signal_rollout_plan.v1",
    generatedAt: rolloutSeed.generatedAt,
    inputs: rolloutSeed.inputs,
    summary: {
      totalIgenSeedRows: igenRows.length,
      highFrequencyOverlapRows: p0Rows.length + p1Rows.length,
      nonCompleteHighFrequencyOverlapRows: p0Rows.length,
      completeHighFrequencyOverlapRows: p1Rows.length,
      brandRolloutReserveRows: p2Rows.length,
    },
    validationOutcomeCounts: sortCounts(validationOutcomeCounts),
    highFrequencyOverlapBrandCounts: sortCounts(highFrequencyOverlapBrandCounts),
    brandReserveCounts: sortCounts(brandReserveCounts),
    p0Rows,
    p1Rows,
    p2Rows,
  };

  await fs.writeFile(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(OUT_SEED_JSON, `${JSON.stringify(rolloutSeed, null, 2)}\n`, "utf8");
  await fs.writeFile(OUT_MD, toMarkdown(report), "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        totalIgenSeedRows: report.summary.totalIgenSeedRows,
        highFrequencyOverlapRows: report.summary.highFrequencyOverlapRows,
        nonCompleteHighFrequencyOverlapRows: report.summary.nonCompleteHighFrequencyOverlapRows,
        brandRolloutReserveRows: report.summary.brandRolloutReserveRows,
        outJson: OUT_JSON,
        outMd: OUT_MD,
        rolloutSeedJson: OUT_SEED_JSON,
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
