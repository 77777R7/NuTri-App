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

const HANDOFF_PATH = getArg(
  "handoff-json",
  path.join(
    ROOT,
    "output",
    "quality_marks",
    `igen_consumer_surface_handoff_full_v2_fixed_${TODAY}`,
    "igen_consumer_surface_handoff.json",
  ),
);
const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", "quality_marks", `igen_decision_support_fixture_pack_${TODAY}`),
);
const OUT_JSON = getArg("out-json", path.join(OUT_DIR, "igen_decision_support_fixture_pack.json"));
const OUT_MD = getArg("out-md", path.join(OUT_DIR, "igen_decision_support_fixture_pack.md"));

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

const buildPriority = (deliveryLane) => {
  if (deliveryLane === "wave1_high_frequency") return "high";
  if (deliveryLane === "wave1_recovered_gap_ready") return "medium";
  return "normal";
};

const buildQualityMark = (row) => {
  const evidenceRef = row?.evidenceRef ?? null;
  const note = row?.consumerNote ?? "Official iGEN registry evidence matched this product.";
  return {
    code: "quality_mark_status",
    status: "detected",
    checked: true,
    confidence: 0.95,
    confidenceBucket: "high",
    evidenceRef,
    sourcesTried: ["official_registry"],
    lastCheckedAt: null,
    checkedMode: "page_fetch",
    pagesFetchedCount: 1,
    searchPagesFetchedCount: 0,
    evidenceType: "official_registry",
    note,
    programMatches: [
      {
        programId: row?.officialSignalProgramId ?? "igen",
        programLabel: row?.officialSignalProgramLabel ?? "iGEN",
        registryFamily: "nutrasource",
        status: "verified_registry_match",
        matchLevel: "product",
        evidenceUrl: evidenceRef,
        evidenceType: "official_registry",
        lotNumber: null,
        brandMatched: true,
        productMatched: true,
        confidence: 0.95,
        mapsToGenericThirdPartyClaim: false,
        note,
      },
    ],
    verificationSummary: {
      overallStatus: "ambiguous",
      strongestProgramId: row?.officialSignalProgramId ?? "igen",
      strongestProgramLabel: row?.officialSignalProgramLabel ?? "iGEN",
      strongestMatchLevel: "product",
      officialRegistryChecked: true,
      officialRegistryVerified: false,
      productPageClaimDetected: false,
      catalogClaimDetected: false,
      genericThirdPartyClaimDetected: false,
      brandLevelOfficialProgramDetected: false,
      brandLevelOfficialProgramLabels: [],
      blockedProgramIds: [],
      blockedProgramLabels: [],
      warnings: ["program_not_equivalent_to_generic_third_party"],
    },
  };
};

const toFixtureRow = (row) => ({
  identity: {
    productId: row?.productId ?? null,
    barcode: row?.barcode ?? null,
  },
  product: {
    brandName: row?.brandName ?? null,
    productName: row?.productName ?? null,
    iherbUrl: row?.iherbUrl ?? null,
  },
  deliveryLane: row?.deliveryLane ?? null,
  priority: buildPriority(safeText(row?.deliveryLane)),
  qualityMark: buildQualityMark(row),
  extraTrustSignals: [],
  qualityMarkAuditSummary: row?.qualityMarkAuditSummary ?? null,
  surfaceSignal: {
    displayLabel: row?.displayLabel ?? "Official iGEN signal",
    displayBadge: row?.displayBadge ?? "Official iGEN Non-GMO Tested",
    consumerNote: row?.consumerNote ?? null,
  },
});

const toMarkdown = (report) => {
  const lines = [];
  lines.push("# iGEN Decision Support Fixture Pack");
  lines.push("");
  lines.push(`Generated at: ${report.generatedAt}`);
  lines.push(`Handoff input: ${report.inputs.handoffPath}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- fixture rows: ${report.summary.fixtureRows}`);
  lines.push(`- brands: ${report.summary.brandCount}`);
  lines.push(`- high priority: ${report.summary.highPriorityRows}`);
  lines.push(`- medium priority: ${report.summary.mediumPriorityRows}`);
  lines.push(`- normal priority: ${report.summary.normalPriorityRows}`);
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

  const handoff = JSON.parse(await fs.readFile(HANDOFF_PATH, "utf8"));
  const rows = Array.isArray(handoff?.rows) ? handoff.rows : [];
  const fixtureRows = rows.map(toFixtureRow);

  const brandCounts = {};
  const priorityCounts = {};
  for (const row of fixtureRows) {
    increment(brandCounts, safeText(row?.product?.brandName) || "unknown");
    increment(priorityCounts, safeText(row?.priority) || "unknown");
  }

  const report = {
    schemaVersion: "igen_decision_support_fixture_pack.v1",
    generatedAt: nowIso(),
    inputs: {
      handoffPath: HANDOFF_PATH,
    },
    summary: {
      fixtureRows: fixtureRows.length,
      brandCount: Object.keys(brandCounts).length,
      highPriorityRows: priorityCounts.high ?? 0,
      mediumPriorityRows: priorityCounts.medium ?? 0,
      normalPriorityRows: priorityCounts.normal ?? 0,
    },
    brandCounts: sortCounts(brandCounts),
    priorityCounts: sortCounts(priorityCounts),
    integrationNote:
      "This fixture pack mirrors the decisionSupport qualityMark shape closely enough for downstream UI and API integration work without touching runtime scan flows.",
    rows: fixtureRows,
  };

  await fs.writeFile(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(OUT_MD, toMarkdown(report), "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        fixtureRows: report.summary.fixtureRows,
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
