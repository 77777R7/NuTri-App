#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const args = process.argv.slice(2);

const getArg = (flag, fallback = null) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return fallback;
  return args[idx + 1] ?? fallback;
};

const resolvePath = (value) => {
  if (!value) return null;
  return path.isAbsolute(value) ? value : path.join(ROOT, value);
};

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

const normalizeBarcode14 = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length >= 14) return digits.slice(-14);
  return digits.padStart(14, "0");
};

const tokenize = (value) => String(value ?? "").toLowerCase();

const classifyLanes = (row, enabledLanes) => {
  const text = `${tokenize(row?.productName)} ${tokenize(row?.categoryName)} ${tokenize(row?.categoryBucket)}`;
  const out = [];

  const sourceType = String(row?.sourceType ?? "").toLowerCase();
  const scanned = Boolean(row?.scannedLabelEvidenceAvailable);
  if (!scanned || !["dsld", "lnhpd"].includes(sourceType)) return out;

  if (enabledLanes.has("patch_probiotics_strain_cfu_v1") && !row?.hasProbioticStrainCfu && /(probiotic|lactobac|bifido|cfu|strain)/.test(text)) {
    out.push("patch_probiotics_strain_cfu_v1");
  }
  if (enabledLanes.has("patch_vitamin_d_form_v1") && !row?.hasVitaminDForm && /(vitamin\s*d|\bd3\b|\bd2\b)/.test(text)) {
    out.push("patch_vitamin_d_form_v1");
  }
  if (enabledLanes.has("patch_magnesium_elemental_form_v1") && !row?.hasMagnesiumFormOrElemental && /(magnesium|glycinate|citrate|oxide)/.test(text)) {
    out.push("patch_magnesium_elemental_form_v1");
  }
  if (enabledLanes.has("patch_fish_oil_breakdown_v1") && !row?.hasFishOilBreakdown && /(fish\s*oil|omega\s*-?\s*3|\bdha\b|\bepa\b|krill|algal)/.test(text)) {
    out.push("patch_fish_oil_breakdown_v1");
  }

  return out;
};

const main = async () => {
  const nightlyDir = resolvePath(getArg("nightly-dir"));
  if (!nightlyDir) {
    console.error("[build-new-top100-lane2-candidates] missing --nightly-dir");
    process.exit(1);
  }

  const outDir = resolvePath(getArg("out-dir")) ?? path.join(nightlyDir, "next_phase");
  const scopeJson =
    resolvePath(getArg("scope-json"))
    ?? path.join(nightlyDir, "phase_b", "new_top100_brand_scope_products.json");
  const targetRelease = String(getArg("target-release", "v1.6.14-new-top100-lane2")).trim();
  const defaultOwner = String(getArg("default-owner", "stage-e-ops")).trim();
  const expiresAt = String(getArg("expires-at", "2026-06-01T00:00:00.000Z")).trim();
  const enabledLanes = new Set(
    String(
      getArg(
        "enabled-lanes",
        "patch_probiotics_strain_cfu_v1,patch_fish_oil_breakdown_v1,patch_vitamin_d_form_v1",
      ),
    )
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  );

  const scope = await readJson(scopeJson);
  const rows = Array.isArray(scope?.rows) ? scope.rows : [];

  const candidates = [];
  for (const row of rows) {
    const lanes = classifyLanes(row, enabledLanes);
    if (!lanes.length) continue;

    const identityKey = String(row?.identityKey ?? "").trim().toLowerCase();
    const barcode = normalizeBarcode14(row?.barcodeGtIn14);
    if (!identityKey || !barcode) continue;

    for (const laneId of lanes) {
      candidates.push({
        candidateId: `${laneId}:${identityKey}:${barcode}`,
        laneId,
        market: String(row?.seedMarket ?? "US").toUpperCase(),
        seedBrand: row?.seedBrand ?? row?.brandName ?? null,
        seedBrandNorm: String(row?.seedBrandNorm ?? "").trim() || null,
        sourceType: String(row?.sourceType ?? "").toLowerCase(),
        sourceId: String(row?.sourceId ?? "").trim() || null,
        identityKey,
        barcode_gtin14: barcode,
        brandName: row?.brandName ?? row?.seedBrand ?? null,
        productName: row?.productName ?? null,
        sourceTier: "scanned_label",
        confidence: 0.7,
        evidenceRef: {
          recordIdentity: identityKey,
          sourceType: String(row?.sourceType ?? "").toLowerCase(),
          sourceId: String(row?.sourceId ?? "").trim() || null,
          matchedBy: row?.matchedBy ?? null,
          matchedTerm: row?.matchedTerm ?? null,
        },
        owner: defaultOwner,
        status: "candidate_open",
        targetRelease,
        expiresAt,
        reviewAfterDays: 30,
        reasonCode: "lane2_readiness_missing",
        patchBatchId: "lane2-readiness-slice",
        candidateScopeHash: null,
        runtimeScopeHash: null,
      });
    }
  }

  const byLane = new Map();
  for (const row of candidates) {
    const k = row.laneId;
    byLane.set(k, (byLane.get(k) || 0) + 1);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    source: { nightlyDir, scopeJson },
    lane2Policy: {
      primary: "patch_probiotics_strain_cfu_v1",
      secondary: [
        "patch_vitamin_d_form_v1",
        "patch_magnesium_elemental_form_v1",
        "patch_fish_oil_breakdown_v1",
      ],
      readinessRules: {
        sourceType: ["dsld", "lnhpd"],
        sourceTier: "scanned_label",
        scannedLabelEvidenceRequired: true,
      },
    },
    summary: {
      totalCandidates: candidates.length,
      lanes: Object.fromEntries([...byLane.entries()].sort((a, b) => b[1] - a[1])),
    },
    rows: candidates,
  };

  const outJson = path.join(outDir, "new_top100_lane2_candidates.json");
  const outMd = path.join(outDir, "new_top100_lane2_candidates.md");
  await writeJson(outJson, report);

  await writeText(
    outMd,
    [
      "# New Top100 Lane2 Candidates",
      "",
      "## Summary / 摘要",
      `- totalCandidates: ${report.summary.totalCandidates}`,
      ...Object.entries(report.summary.lanes).map(([lane, count]) => `- ${lane}: ${count}`),
      "",
      "## Rules / 规则",
      "- sourceType in {dsld, lnhpd}",
      "- sourceTier=scanned_label",
      "- scannedLabelEvidenceAvailable=true",
      "- lane2 primary is probiotics; fish oil remains repair-branch candidate",
      "",
    ].join("\n"),
  );

  console.log("[build-new-top100-lane2-candidates] completed");
  console.log(JSON.stringify({ outJson, totalCandidates: report.summary.totalCandidates, lanes: report.summary.lanes }, null, 2));
};

main().catch((error) => {
  console.error("[build-new-top100-lane2-candidates] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
