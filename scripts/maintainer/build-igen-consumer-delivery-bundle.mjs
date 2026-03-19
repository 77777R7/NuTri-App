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

const MASTER_SEED_PATH = getArg(
  "master-seed",
  path.join(
    ROOT,
    "output",
    "quality_marks",
    `igen_ready_master_seed_full_v2_complete_fixed_${TODAY}`,
    "igen_ready_master_seed.json",
  ),
);
const ROLLOUT_PLAN_PATH = getArg(
  "rollout-plan",
  path.join(
    ROOT,
    "output",
    "quality_marks",
    `igen_official_signal_rollout_plan_full_v2_${TODAY}`,
    "igen_official_signal_rollout_plan.json",
  ),
);
const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", "quality_marks", `igen_consumer_delivery_bundle_${TODAY}`),
);
const OUT_JSON = getArg("out-json", path.join(OUT_DIR, "igen_consumer_delivery_bundle.json"));
const OUT_MD = getArg("out-md", path.join(OUT_DIR, "igen_consumer_delivery_bundle.md"));
const OUT_WAVE1 = getArg("wave1-json", path.join(OUT_DIR, "consumer_delivery_wave1_high_frequency.json"));
const OUT_WAVE2 = getArg("wave2-json", path.join(OUT_DIR, "consumer_delivery_wave2_brand_bundles.json"));

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

const buildKey = (row) =>
  `${safeText(row?.productId)}::${safeText(row?.barcode)}::${safeText(row?.brandName)}::${safeText(
    row?.productName,
  )}`;

const toMarkdown = (report) => {
  const lines = [];
  lines.push("# iGEN Consumer Delivery Bundle");
  lines.push("");
  lines.push(`Generated at: ${report.generatedAt}`);
  lines.push(`Master seed: ${report.inputs.masterSeedPath}`);
  lines.push(`Rollout plan: ${report.inputs.rolloutPlanPath}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- total ready rows: ${report.summary.totalReadyRows}`);
  lines.push(`- brands: ${report.summary.brandCount}`);
  lines.push(`- high-frequency wave rows: ${report.summary.wave1Rows}`);
  lines.push(`- brand bundle rows: ${report.summary.wave2Rows}`);
  lines.push(`- recovered ready rows outside rollout buckets: ${report.summary.recoveredRows}`);
  lines.push(`- reserve rows in rollout plan: ${report.summary.rolloutReserveRows}`);
  lines.push(`- reserve rows consumed: ${report.summary.reserveRowsConsumed}`);
  lines.push(`- reserve rows remaining: ${report.summary.reserveRowsRemaining}`);
  lines.push("");
  lines.push("## Brand Counts");
  lines.push("");
  for (const [brand, count] of Object.entries(report.brandCounts)) {
    lines.push(`- ${brand}: ${count}`);
  }
  lines.push("");
  lines.push("## Recommendation");
  lines.push("");
  lines.push(`- ${report.nextAction}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const [masterSeed, rolloutPlan] = await Promise.all([
    fs.readFile(MASTER_SEED_PATH, "utf8").then(JSON.parse),
    fs.readFile(ROLLOUT_PLAN_PATH, "utf8").then(JSON.parse),
  ]);

  const masterRows = Array.isArray(masterSeed?.rows) ? masterSeed.rows : [];
  const p1Rows = Array.isArray(rolloutPlan?.p1Rows) ? rolloutPlan.p1Rows : [];
  const p2Rows = Array.isArray(rolloutPlan?.p2Rows) ? rolloutPlan.p2Rows : [];

  const p1Keys = new Set(p1Rows.map(buildKey));
  const p2Keys = new Set(p2Rows.map(buildKey));

  const wave1Rows = dedupeBy(masterRows.filter((row) => p1Keys.has(buildKey(row))), buildKey);
  const wave2Rows = dedupeBy(masterRows.filter((row) => p2Keys.has(buildKey(row))), buildKey);
  const assignedKeys = new Set([...wave1Rows, ...wave2Rows].map(buildKey));
  const recoveredRows = dedupeBy(
    masterRows.filter((row) => !assignedKeys.has(buildKey(row))),
    buildKey,
  );

  const wave2ByBrand = new Map();
  for (const row of wave2Rows) {
    const brand = safeText(row?.brandName) || "unknown";
    const bucket = wave2ByBrand.get(brand) ?? [];
    bucket.push(row);
    wave2ByBrand.set(brand, bucket);
  }

  const brandBundles = Array.from(wave2ByBrand.entries())
    .sort((a, b) => {
      if (b[1].length !== a[1].length) return b[1].length - a[1].length;
      return a[0].localeCompare(b[0]);
    })
    .map(([brand, rows], index) => ({
      batchLabel: `consumer_brand_bundle_${index + 1}`,
      brandName: brand,
      totalRows: rows.length,
      rows: rows
        .slice()
        .sort((a, b) => safeText(a.productName).localeCompare(safeText(b.productName))),
    }));

  const brandCounts = {};
  for (const row of masterRows) increment(brandCounts, safeText(row.brandName) || "unknown");

  const consumedReserveKeys = new Set(wave2Rows.map(buildKey));
  const reserveRowsRemaining = p2Rows.filter((row) => !consumedReserveKeys.has(buildKey(row))).length;

  const report = {
    schemaVersion: "igen_consumer_delivery_bundle.v1",
    generatedAt: nowIso(),
    inputs: {
      masterSeedPath: MASTER_SEED_PATH,
      rolloutPlanPath: ROLLOUT_PLAN_PATH,
    },
    summary: {
      totalReadyRows: masterRows.length,
      brandCount: Object.keys(brandCounts).length,
      wave1Rows: wave1Rows.length,
      wave2Rows: wave2Rows.length,
      recoveredRows: recoveredRows.length,
      rolloutReserveRows: p2Rows.length,
      reserveRowsConsumed: wave2Rows.length,
      reserveRowsRemaining,
    },
    brandCounts: sortCounts(brandCounts),
    wave1: {
      rows: wave1Rows,
    },
    wave2: {
      brandBundles,
    },
    recovered: {
      rows: recoveredRows,
    },
    nextAction:
      reserveRowsRemaining === 0
        ? "The iGEN rollout backlog is fully converted into a consumer-ready bundle. The next step is to hand off this bundle to the downstream consumer surface, not to keep expanding seed generation."
        : "Some reserve rows still remain; consume wave 1 now and continue brand bundle closure.",
  };

  await fs.writeFile(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(OUT_WAVE1, `${JSON.stringify({ schemaVersion: "igen_consumer_delivery_wave1.v1", generatedAt: report.generatedAt, rows: wave1Rows }, null, 2)}\n`, "utf8");
  await fs.writeFile(OUT_WAVE2, `${JSON.stringify({ schemaVersion: "igen_consumer_delivery_wave2.v1", generatedAt: report.generatedAt, brandBundles }, null, 2)}\n`, "utf8");
  await fs.writeFile(OUT_MD, toMarkdown(report), "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        totalReadyRows: report.summary.totalReadyRows,
        wave1Rows: report.summary.wave1Rows,
        wave2Rows: report.summary.wave2Rows,
        reserveRowsRemaining: report.summary.reserveRowsRemaining,
        outJson: OUT_JSON,
        outMd: OUT_MD,
        wave1Json: OUT_WAVE1,
        wave2Json: OUT_WAVE2,
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
