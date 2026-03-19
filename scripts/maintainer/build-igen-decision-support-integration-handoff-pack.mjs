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

const INLINE_PACK_PATH = getArg(
  "inline-pack",
  path.join(
    ROOT,
    "output",
    "quality_marks",
    `igen_decision_support_inline_response_pack_full_v2_${TODAY}`,
    "igen_decision_support_inline_response_pack.json",
  ),
);
const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", "quality_marks", `igen_decision_support_integration_handoff_pack_${TODAY}`),
);
const OUT_JSON = getArg(
  "out-json",
  path.join(OUT_DIR, "igen_decision_support_integration_handoff_pack.json"),
);
const OUT_MD = getArg(
  "out-md",
  path.join(OUT_DIR, "igen_decision_support_integration_handoff_pack.md"),
);
const OUT_WAVE1_JSON = getArg(
  "wave1-json",
  path.join(OUT_DIR, "wave1_request_response_fixtures.json"),
);
const OUT_BRAND_INDEX_JSON = getArg(
  "brand-index-json",
  path.join(OUT_DIR, "wave2_brand_fixture_index.json"),
);

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

const buildFixtureRow = (row) => ({
  identity: row?.identity ?? null,
  product: row?.product ?? null,
  priority: row?.priority ?? "normal",
  deliveryLane: row?.deliveryLane ?? null,
  surfaceSignal: row?.surfaceSignal ?? null,
  request: {
    barcode: row?.identity?.barcode ?? null,
    viewMode: "details",
  },
  expectedResponse: row?.apiResponse ?? null,
  qualityMarkAuditSummary: row?.qualityMarkAuditSummary ?? null,
});

const toMarkdown = (report) => {
  const lines = [];
  lines.push("# iGEN Decision Support Integration Handoff Pack");
  lines.push("");
  lines.push(`Generated at: ${report.generatedAt}`);
  lines.push(`Inline pack: ${report.inputs.inlinePackPath}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- fixture rows: ${report.summary.fixtureRows}`);
  lines.push(`- brands: ${report.summary.brandCount}`);
  lines.push(`- wave1 high-frequency rows: ${report.summary.wave1Rows}`);
  lines.push(`- recovered rows: ${report.summary.recoveredRows}`);
  lines.push(`- wave2 brand rows: ${report.summary.wave2Rows}`);
  lines.push("");
  lines.push("## Brand Counts");
  lines.push("");
  for (const [brand, count] of Object.entries(report.brandCounts)) {
    lines.push(`- ${brand}: ${count}`);
  }
  lines.push("");
  lines.push("## Handoff Note");
  lines.push("");
  lines.push(`- ${report.handoffNote}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const inlinePack = JSON.parse(await fs.readFile(INLINE_PACK_PATH, "utf8"));
  const rows = Array.isArray(inlinePack?.rows) ? inlinePack.rows : [];
  const fixtures = rows.map(buildFixtureRow);

  const brandCounts = {};
  const laneCounts = {};
  const brandFixtureIndex = {};

  for (const row of fixtures) {
    const brand = safeText(row?.product?.brandName) || "unknown";
    const lane = safeText(row?.deliveryLane) || "unknown";
    increment(brandCounts, brand);
    increment(laneCounts, lane);
    const bucket = brandFixtureIndex[brand] ?? [];
    bucket.push({
      barcode: row?.request?.barcode ?? null,
      productId: row?.identity?.productId ?? null,
      productName: row?.product?.productName ?? null,
      priority: row?.priority ?? "normal",
      deliveryLane: row?.deliveryLane ?? null,
      evidenceRef: row?.expectedResponse?.qualityMark?.evidenceRef ?? null,
      digest: row?.expectedResponse?.decisionSupportDigest ?? null,
    });
    brandFixtureIndex[brand] = bucket;
  }

  const wave1Rows = fixtures.filter((row) => safeText(row?.deliveryLane) === "wave1_high_frequency");
  const recoveredRows = fixtures.filter(
    (row) => safeText(row?.deliveryLane) === "wave1_recovered_gap_ready",
  );

  const report = {
    schemaVersion: "igen_decision_support_integration_handoff_pack.v1",
    generatedAt: nowIso(),
    inputs: {
      inlinePackPath: INLINE_PACK_PATH,
    },
    summary: {
      fixtureRows: fixtures.length,
      brandCount: Object.keys(brandCounts).length,
      wave1Rows: wave1Rows.length,
      recoveredRows: recoveredRows.length,
      wave2Rows: fixtures.length - wave1Rows.length - recoveredRows.length,
    },
    laneCounts: sortCounts(laneCounts),
    brandCounts: sortCounts(brandCounts),
    handoffNote:
      "This pack gives downstream teams a ready-to-wire request/response fixture set grouped by high-frequency rollout first, then by brand expansion batches.",
    rows: fixtures,
  };

  await fs.writeFile(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(OUT_WAVE1_JSON, `${JSON.stringify(wave1Rows, null, 2)}\n`, "utf8");
  await fs.writeFile(
    OUT_BRAND_INDEX_JSON,
    `${JSON.stringify({ generatedAt: report.generatedAt, brandFixtureIndex }, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(OUT_MD, toMarkdown(report), "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        fixtureRows: report.summary.fixtureRows,
        brandCount: report.summary.brandCount,
        wave1Rows: report.summary.wave1Rows,
        outJson: OUT_JSON,
        outMd: OUT_MD,
        wave1Json: OUT_WAVE1_JSON,
        brandIndexJson: OUT_BRAND_INDEX_JSON,
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
