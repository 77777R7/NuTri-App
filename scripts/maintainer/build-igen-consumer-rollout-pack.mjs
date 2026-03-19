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

const CONSUMER_SEED_PATH = getArg(
  "consumer-seed",
  path.join(
    ROOT,
    "output",
    "quality_marks",
    `igen_high_frequency_consumer_seed_full_v2_${TODAY}`,
    "igen_high_frequency_consumer_seed.json",
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
  path.join(ROOT, "output", "quality_marks", `igen_consumer_rollout_pack_${TODAY}`),
);
const OUT_JSON = getArg("out-json", path.join(OUT_DIR, "igen_consumer_rollout_pack.json"));
const OUT_MD = getArg("out-md", path.join(OUT_DIR, "igen_consumer_rollout_pack.md"));
const OUT_WAVE1 = getArg("wave1-json", path.join(OUT_DIR, "wave1_high_frequency_consumer_seed.json"));
const OUT_WAVE2 = getArg("wave2-json", path.join(OUT_DIR, "wave2_brand_expansion_batches.json"));

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

const toBatchKey = (row) => `${safeText(row.brandName)}::${safeText(row.productId)}::${safeText(row.barcode)}`;

const toMarkdown = (report) => {
  const lines = [];
  lines.push("# iGEN Consumer Rollout Pack");
  lines.push("");
  lines.push(`Generated at: ${report.generatedAt}`);
  lines.push(`Consumer seed: ${report.inputs.consumerSeedPath}`);
  lines.push(`Rollout plan: ${report.inputs.rolloutPlanPath}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- wave 1 high-frequency consumer-ready rows: ${report.summary.wave1Rows}`);
  lines.push(`- wave 1 brands: ${report.summary.wave1Brands}`);
  lines.push(`- wave 2 reserve rows: ${report.summary.wave2Rows}`);
  lines.push(`- wave 2 brands: ${report.summary.wave2Brands}`);
  lines.push(`- recommended next brand batch size: ${report.summary.recommendedBrandBatchSize}`);
  lines.push("");
  lines.push("## Wave 1 Brands");
  lines.push("");
  for (const [brand, count] of Object.entries(report.wave1.brandCounts)) {
    lines.push(`- ${brand}: ${count}`);
  }
  lines.push("");
  lines.push("## Wave 2 Batches");
  lines.push("");
  for (const batch of report.wave2.batches) {
    lines.push(`- ${batch.batchLabel}: ${batch.totalRows} rows (${batch.brands.join(", ")})`);
  }
  lines.push("");
  lines.push("## Next Action");
  lines.push("");
  lines.push(`- ${report.nextAction}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const consumerSeed = JSON.parse(await fs.readFile(CONSUMER_SEED_PATH, "utf8"));
  const rolloutPlan = JSON.parse(await fs.readFile(ROLLOUT_PLAN_PATH, "utf8"));

  const consumerRows = Array.isArray(consumerSeed?.rows) ? consumerSeed.rows : [];
  const reserveRows = Array.isArray(rolloutPlan?.p2Rows) ? rolloutPlan.p2Rows : [];

  const wave1Rows = dedupeBy(
    consumerRows
      .slice()
      .sort((a, b) => {
        const scoreDelta = Number(b.patchPriorityScore ?? 0) - Number(a.patchPriorityScore ?? 0);
        if (scoreDelta !== 0) return scoreDelta;
        return `${a.brandName ?? ""}|${a.productName ?? ""}`.localeCompare(`${b.brandName ?? ""}|${b.productName ?? ""}`);
      }),
    toBatchKey,
  );

  const wave1BrandCounts = {};
  for (const row of wave1Rows) increment(wave1BrandCounts, safeText(row.brandName) || "unknown");

  const reserveByBrand = new Map();
  for (const row of reserveRows) {
    const brand = safeText(row.brandName) || "unknown";
    const bucket = reserveByBrand.get(brand) ?? [];
    bucket.push(row);
    reserveByBrand.set(brand, bucket);
  }

  const sortedReserveBrands = Array.from(reserveByBrand.entries()).sort((a, b) => {
    if (b[1].length !== a[1].length) return b[1].length - a[1].length;
    return a[0].localeCompare(b[0]);
  });

  const topBrandEntries = sortedReserveBrands.slice(0, 4);
  const wave2Batches = topBrandEntries.map(([brand, rows], index) => ({
    batchLabel: `wave2_brand_batch_${index + 1}`,
    brands: [brand],
    totalRows: rows.length,
    rows: rows
      .slice()
      .sort((a, b) => {
        const scoreDelta = Number(b.patchPriorityScore ?? 0) - Number(a.patchPriorityScore ?? 0);
        if (scoreDelta !== 0) return scoreDelta;
        return `${a.productName ?? ""}`.localeCompare(`${b.productName ?? ""}`);
      })
      .map((row) => ({
        key: row.key ?? null,
        productId: row.productId ?? null,
        barcode: row.barcode ?? null,
        brandName: row.brandName ?? null,
        productName: row.productName ?? null,
        iherbUrl: row.iherbUrl ?? null,
        officialSignalProgramId: row.officialSignalProgramId ?? "igen",
        officialSignalState: row.officialSignalState ?? null,
        officialRegistryEvidenceUrl: row.officialRegistryEvidenceUrl ?? null,
      })),
  }));

  const report = {
    schemaVersion: "igen_consumer_rollout_pack.v1",
    generatedAt: nowIso(),
    inputs: {
      consumerSeedPath: CONSUMER_SEED_PATH,
      rolloutPlanPath: ROLLOUT_PLAN_PATH,
    },
    summary: {
      wave1Rows: wave1Rows.length,
      wave1Brands: Object.keys(wave1BrandCounts).length,
      wave2Rows: reserveRows.length,
      wave2Brands: sortedReserveBrands.length,
      recommendedBrandBatchSize: 1,
    },
    wave1: {
      brandCounts: sortCounts(wave1BrandCounts),
      rows: wave1Rows,
    },
    wave2: {
      brandCounts: sortCounts(
        Object.fromEntries(sortedReserveBrands.map(([brand, rows]) => [brand, rows.length])),
      ),
      batches: wave2Batches,
    },
    nextAction:
      wave1Rows.length > 0
        ? "Consume wave 1 first as the high-frequency iGEN official-signal pack, then expand with wave 2 one brand batch at a time starting from the largest reserve brand."
        : "No wave 1 rows are ready; start with the largest wave 2 brand batch.",
  };

  await fs.writeFile(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(OUT_WAVE1, `${JSON.stringify({ schemaVersion: "igen_consumer_rollout_wave1.v1", generatedAt: report.generatedAt, rows: wave1Rows }, null, 2)}\n`, "utf8");
  await fs.writeFile(OUT_WAVE2, `${JSON.stringify({ schemaVersion: "igen_consumer_rollout_wave2.v1", generatedAt: report.generatedAt, batches: wave2Batches }, null, 2)}\n`, "utf8");
  await fs.writeFile(OUT_MD, toMarkdown(report), "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        wave1Rows: report.summary.wave1Rows,
        wave2Rows: report.summary.wave2Rows,
        wave2Brands: report.summary.wave2Brands,
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
