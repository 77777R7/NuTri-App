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

const FIXTURE_PACK_PATH = getArg(
  "fixture-pack",
  path.join(
    ROOT,
    "output",
    "quality_marks",
    `igen_decision_support_fixture_pack_full_v2_${TODAY}`,
    "igen_decision_support_fixture_pack.json",
  ),
);
const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", "quality_marks", `igen_decision_support_consumer_pack_${TODAY}`),
);
const OUT_JSON = getArg("out-json", path.join(OUT_DIR, "igen_decision_support_consumer_pack.json"));
const OUT_MD = getArg("out-md", path.join(OUT_DIR, "igen_decision_support_consumer_pack.md"));
const OUT_HIGH_JSON = getArg("high-json", path.join(OUT_DIR, "high_priority_rows.json"));
const OUT_BRANDS_JSON = getArg("brand-bundles-json", path.join(OUT_DIR, "brand_bundle_index.json"));

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

const buildConsumerRow = (row) => ({
  identity: row?.identity ?? null,
  product: row?.product ?? null,
  deliveryLane: row?.deliveryLane ?? null,
  priority: row?.priority ?? "normal",
  surfaceSignal: row?.surfaceSignal ?? null,
  decisionSupportPayload: {
    qualityMark: row?.qualityMark ?? null,
    extraTrustSignals: Array.isArray(row?.extraTrustSignals) ? row.extraTrustSignals : [],
  },
  qualityMarkAuditSummary: row?.qualityMarkAuditSummary ?? null,
});

const toMarkdown = (report) => {
  const lines = [];
  lines.push("# iGEN Decision Support Consumer Pack");
  lines.push("");
  lines.push(`Generated at: ${report.generatedAt}`);
  lines.push(`Fixture pack: ${report.inputs.fixturePackPath}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- consumer rows: ${report.summary.consumerRows}`);
  lines.push(`- brands: ${report.summary.brandCount}`);
  lines.push(`- high priority rows: ${report.summary.highPriorityRows}`);
  lines.push(`- medium priority rows: ${report.summary.mediumPriorityRows}`);
  lines.push(`- normal priority rows: ${report.summary.normalPriorityRows}`);
  lines.push("");
  lines.push("## Brand Counts");
  lines.push("");
  for (const [brand, count] of Object.entries(report.brandCounts)) {
    lines.push(`- ${brand}: ${count}`);
  }
  lines.push("");
  lines.push("## Integration Note");
  lines.push("");
  lines.push(`- ${report.integrationNote}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const fixturePack = JSON.parse(await fs.readFile(FIXTURE_PACK_PATH, "utf8"));
  const rows = Array.isArray(fixturePack?.rows) ? fixturePack.rows : [];

  const consumerRows = rows.map(buildConsumerRow);
  const brandCounts = {};
  const priorityCounts = {};
  const brandBundleIndex = {};

  for (const row of consumerRows) {
    const brand = safeText(row?.product?.brandName) || "unknown";
    increment(brandCounts, brand);
    increment(priorityCounts, safeText(row?.priority) || "unknown");
    const bucket = brandBundleIndex[brand] ?? [];
    bucket.push({
      productId: row?.identity?.productId ?? null,
      barcode: row?.identity?.barcode ?? null,
      productName: row?.product?.productName ?? null,
      priority: row?.priority ?? "normal",
      deliveryLane: row?.deliveryLane ?? null,
      evidenceRef: row?.decisionSupportPayload?.qualityMark?.evidenceRef ?? null,
    });
    brandBundleIndex[brand] = bucket;
  }

  const highPriorityRows = consumerRows.filter((row) => safeText(row?.priority) === "high");

  const report = {
    schemaVersion: "igen_decision_support_consumer_pack.v1",
    generatedAt: nowIso(),
    inputs: {
      fixturePackPath: FIXTURE_PACK_PATH,
    },
    summary: {
      consumerRows: consumerRows.length,
      brandCount: Object.keys(brandCounts).length,
      highPriorityRows: priorityCounts.high ?? 0,
      mediumPriorityRows: priorityCounts.medium ?? 0,
      normalPriorityRows: priorityCounts.normal ?? 0,
    },
    brandCounts: sortCounts(brandCounts),
    priorityCounts: sortCounts(priorityCounts),
    integrationNote:
      "This pack is ready to feed any downstream consumer that needs decisionSupport-style qualityMark data plus delivery priority and surface copy.",
    rows: consumerRows,
  };

  await fs.writeFile(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(OUT_HIGH_JSON, `${JSON.stringify(highPriorityRows, null, 2)}\n`, "utf8");
  await fs.writeFile(
    OUT_BRANDS_JSON,
    `${JSON.stringify({ generatedAt: report.generatedAt, brandBundleIndex }, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(OUT_MD, toMarkdown(report), "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        consumerRows: report.summary.consumerRows,
        brandCount: report.summary.brandCount,
        highPriorityRows: report.summary.highPriorityRows,
        outJson: OUT_JSON,
        outMd: OUT_MD,
        highJson: OUT_HIGH_JSON,
        brandBundlesJson: OUT_BRANDS_JSON,
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
