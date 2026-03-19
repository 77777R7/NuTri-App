#!/usr/bin/env node
/* eslint-disable no-console */
import { createHash } from "node:crypto";
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

const CONSUMER_PACK_PATH = getArg(
  "consumer-pack",
  path.join(
    ROOT,
    "output",
    "quality_marks",
    `igen_decision_support_consumer_pack_full_v2_${TODAY}`,
    "igen_decision_support_consumer_pack.json",
  ),
);
const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", "quality_marks", `igen_decision_support_inline_response_pack_${TODAY}`),
);
const OUT_JSON = getArg(
  "out-json",
  path.join(OUT_DIR, "igen_decision_support_inline_response_pack.json"),
);
const OUT_MD = getArg(
  "out-md",
  path.join(OUT_DIR, "igen_decision_support_inline_response_pack.md"),
);
const OUT_HIGH_JSON = getArg(
  "high-json",
  path.join(OUT_DIR, "high_priority_inline_rows.json"),
);
const OUT_BRANDS_JSON = getArg(
  "brand-bundles-json",
  path.join(OUT_DIR, "brand_bundle_index.json"),
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

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const buildDigest = (row) => {
  const seed = [
    safeText(row?.identity?.productId),
    safeText(row?.identity?.barcode),
    safeText(row?.product?.brandName),
    safeText(row?.product?.productName),
    safeText(row?.decisionSupportPayload?.qualityMark?.evidenceRef),
  ].join("|");
  return sha256(seed);
};

const buildInline = (row) => {
  const note =
    row?.surfaceSignal?.consumerNote ??
    row?.decisionSupportPayload?.qualityMark?.note ??
    "Official iGEN registry evidence matched this product.";
  return {
    verdict: "reasonable_but_incomplete",
    subscores: [],
    topBlockers: [],
    overviewBlock: {
      sourceStrip: ["Official Nutrasource registry evidence", "Quality-mark focused fixture"],
      bestForBullets: [],
      providesVerified: {
        servingSize: null,
        servingsPerContainer: null,
        keyIngredients: [],
        dosageForm: null,
        count: null,
      },
      missingInfo: [
        "This fixture focuses on official iGEN trust evidence only.",
        "Use runtime decision support if you need full formula, usage, or safety scoring.",
      ],
      singleCta: null,
    },
    scienceBlock: {
      ingredientSourceTier: "official_record",
      ingredientRows: [],
      ingredientSnapshotNames: [],
      formMatters: {
        ingredientChemicalForm: null,
        dosageForm: null,
      },
      odsGeneralScienceBullets: [],
      aiSummaryContract3: [
        "Official iGEN registry evidence was matched to this product.",
        "This fixture is intended for trust-signal integration, not formula evaluation.",
        "Combine with the runtime decision-support payload when deeper scoring is required.",
      ],
    },
    usageBlock: {
      directions: {
        text: "",
        lines: [],
        sourceTier: "missing",
        hasDirectionsTextVisible: false,
      },
      timingTip: "Refer to the product label for directions.",
      conservativeGuidance: "Treat this as an official trust signal, not a dosage recommendation.",
    },
    safetyBlock: {
      labelWarnings: [],
      ulGuidance: [],
      generalWatchouts: ["This fixture does not add new label warnings or dosage safety guidance."],
      dataStatusRef: note,
    },
    qualityMark: row?.decisionSupportPayload?.qualityMark ?? null,
  };
};

const buildApiResponseRow = (row) => {
  const digest = buildDigest(row);
  const inputsHash = sha256(`${digest}|inputs`);
  const inline = buildInline(row);
  return {
    identity: row?.identity ?? null,
    product: row?.product ?? null,
    priority: row?.priority ?? "normal",
    deliveryLane: row?.deliveryLane ?? null,
    surfaceSignal: row?.surfaceSignal ?? null,
    qualityMarkAuditSummary: row?.qualityMarkAuditSummary ?? null,
    apiResponse: {
      status: "ok",
      barcode: row?.identity?.barcode ?? null,
      decisionSupportDigest: digest,
      decisionInputsHash: inputsHash,
      decisionContractVersion: "fixture.igen_quality_mark_inline.v1",
      viewMode: "details",
      verdict: inline.verdict,
      extraTrustSignals: Array.isArray(row?.decisionSupportPayload?.extraTrustSignals)
        ? row.decisionSupportPayload.extraTrustSignals
        : [],
      qualityMark: row?.decisionSupportPayload?.qualityMark ?? null,
      decisionSupportInline: inline,
      fixtureMeta: {
        scope: "quality_mark_focused",
        program: safeText(
          row?.decisionSupportPayload?.qualityMark?.verificationSummary?.strongestProgramLabel,
        ) || "iGEN",
      },
    },
  };
};

const toMarkdown = (report) => {
  const lines = [];
  lines.push("# iGEN Decision Support Inline Response Pack");
  lines.push("");
  lines.push(`Generated at: ${report.generatedAt}`);
  lines.push(`Consumer pack: ${report.inputs.consumerPackPath}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- response rows: ${report.summary.responseRows}`);
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

  const consumerPack = JSON.parse(await fs.readFile(CONSUMER_PACK_PATH, "utf8"));
  const rows = Array.isArray(consumerPack?.rows) ? consumerPack.rows : [];
  const responseRows = rows.map(buildApiResponseRow);

  const brandCounts = {};
  const priorityCounts = {};
  const brandBundleIndex = {};

  for (const row of responseRows) {
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
      evidenceRef: row?.apiResponse?.qualityMark?.evidenceRef ?? null,
      decisionSupportDigest: row?.apiResponse?.decisionSupportDigest ?? null,
    });
    brandBundleIndex[brand] = bucket;
  }

  const highPriorityRows = responseRows.filter((row) => safeText(row?.priority) === "high");

  const report = {
    schemaVersion: "igen_decision_support_inline_response_pack.v1",
    generatedAt: nowIso(),
    inputs: {
      consumerPackPath: CONSUMER_PACK_PATH,
    },
    summary: {
      responseRows: responseRows.length,
      brandCount: Object.keys(brandCounts).length,
      highPriorityRows: priorityCounts.high ?? 0,
      mediumPriorityRows: priorityCounts.medium ?? 0,
      normalPriorityRows: priorityCounts.normal ?? 0,
    },
    brandCounts: sortCounts(brandCounts),
    priorityCounts: sortCounts(priorityCounts),
    integrationNote:
      "This pack is shaped like a quality-mark-focused decisionSupport API response so downstream consumers can validate contract wiring before touching runtime scan flows.",
    rows: responseRows,
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
        responseRows: report.summary.responseRows,
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
