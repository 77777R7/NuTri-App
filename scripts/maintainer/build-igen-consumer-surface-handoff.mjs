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

const DELIVERY_BUNDLE_PATH = getArg(
  "delivery-bundle",
  path.join(
    ROOT,
    "output",
    "quality_marks",
    `igen_consumer_delivery_bundle_full_v2_${TODAY}`,
    "igen_consumer_delivery_bundle.json",
  ),
);
const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", "quality_marks", `igen_consumer_surface_handoff_${TODAY}`),
);
const OUT_JSON = getArg("out-json", path.join(OUT_DIR, "igen_consumer_surface_handoff.json"));
const OUT_MD = getArg("out-md", path.join(OUT_DIR, "igen_consumer_surface_handoff.md"));

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

const buildDisplayLabel = (row) => {
  const program = safeText(row?.officialSignalProgramLabel) || "iGEN";
  return `Official ${program} signal`;
};

const buildConsumerNote = (row, deliveryLane) => {
  const base = `Official ${safeText(row?.officialSignalProgramLabel) || "iGEN"} registry evidence matched this product.`;
  if (deliveryLane === "wave1_high_frequency") return `${base} Prioritize this in high-frequency consumer surfaces first.`;
  return base;
};

const toSurfaceRow = (row, deliveryLane, bundleLabel) => ({
  productId: row?.productId ?? null,
  barcode: row?.barcode ?? null,
  brandName: row?.brandName ?? null,
  productName: row?.productName ?? null,
  iherbUrl: row?.iherbUrl ?? null,
  officialSignalProgramId: row?.officialSignalProgramId ?? "igen",
  officialSignalProgramLabel: row?.officialSignalProgramLabel ?? "iGEN",
  officialSignalState: row?.officialSignalState ?? "product_level_official_signal",
  evidenceRef: row?.officialRegistryEvidenceUrl ?? null,
  deliveryLane,
  bundleLabel,
  displayLabel: buildDisplayLabel(row),
  displayBadge: "Official iGEN Non-GMO Tested",
  consumerNote: buildConsumerNote(row, deliveryLane),
  qualityMarkAuditSummary: {
    status: "detected",
    checked: true,
    evidenceRef: row?.officialRegistryEvidenceUrl ?? null,
    sourcesTried: ["official_registry"],
    checkedMode: "page_fetch",
    pagesFetchedCount: 1,
    searchPagesFetchedCount: 0,
    evidenceType: "official_registry",
    note: buildConsumerNote(row, deliveryLane),
  },
});

const toMarkdown = (report) => {
  const lines = [];
  lines.push("# iGEN Consumer Surface Handoff");
  lines.push("");
  lines.push(`Generated at: ${report.generatedAt}`);
  lines.push(`Delivery bundle: ${report.inputs.deliveryBundlePath}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- total surface rows: ${report.summary.totalSurfaceRows}`);
  lines.push(`- wave1 high-frequency rows: ${report.summary.wave1Rows}`);
  lines.push(`- recovered gap-ready rows: ${report.summary.recoveredRows}`);
  lines.push(`- wave2 brand bundle rows: ${report.summary.wave2Rows}`);
  lines.push(`- brands: ${report.summary.brandCount}`);
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

  const deliveryBundle = JSON.parse(await fs.readFile(DELIVERY_BUNDLE_PATH, "utf8"));
  const wave1Rows = Array.isArray(deliveryBundle?.wave1?.rows) ? deliveryBundle.wave1.rows : [];
  const brandBundles = Array.isArray(deliveryBundle?.wave2?.brandBundles) ? deliveryBundle.wave2.brandBundles : [];
  const recoveredRows = Array.isArray(deliveryBundle?.recovered?.rows) ? deliveryBundle.recovered.rows : [];

  const surfaceRows = [];
  const brandCounts = {};

  for (const row of wave1Rows) {
    const next = toSurfaceRow(row, "wave1_high_frequency", "wave1_high_frequency");
    surfaceRows.push(next);
    increment(brandCounts, safeText(next.brandName) || "unknown");
  }

  for (const row of recoveredRows) {
    const next = toSurfaceRow(row, "wave1_recovered_gap_ready", "wave1_recovered_gap_ready");
    surfaceRows.push(next);
    increment(brandCounts, safeText(next.brandName) || "unknown");
  }

  for (const bundle of brandBundles) {
    for (const row of bundle.rows ?? []) {
      const next = toSurfaceRow(row, "wave2_brand_bundle", safeText(bundle.brandName) || safeText(bundle.batchLabel));
      surfaceRows.push(next);
      increment(brandCounts, safeText(next.brandName) || "unknown");
    }
  }

  const report = {
    schemaVersion: "igen_consumer_surface_handoff.v1",
    generatedAt: nowIso(),
    inputs: {
      deliveryBundlePath: DELIVERY_BUNDLE_PATH,
    },
    summary: {
      totalSurfaceRows: surfaceRows.length,
      wave1Rows: wave1Rows.length,
      recoveredRows: recoveredRows.length,
      wave2Rows: surfaceRows.length - wave1Rows.length - recoveredRows.length,
      brandCount: Object.keys(brandCounts).length,
    },
    brandCounts: sortCounts(brandCounts),
    handoffNote:
      "This payload is ready for downstream consumer surfaces. It preserves evidence links, delivery priority, and concise display copy without requiring more seed generation.",
    rows: surfaceRows,
  };

  await fs.writeFile(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(OUT_MD, toMarkdown(report), "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        totalSurfaceRows: report.summary.totalSurfaceRows,
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
