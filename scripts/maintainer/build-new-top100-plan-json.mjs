#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const ROOT_DIR = process.cwd();
const args = process.argv.slice(2);

const getArg = (flag, fallback = null) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return fallback;
  return args[idx + 1] ?? fallback;
};

const resolvePath = (value) => {
  if (!value) return null;
  return path.isAbsolute(value) ? value : path.join(ROOT_DIR, value);
};

const ensureDir = async (dirPath) => {
  await fs.mkdir(dirPath, { recursive: true });
};

const writeJson = async (filePath, payload) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const writeText = async (filePath, body) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, body, "utf8");
};

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

const normalizeBrand = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[’'`.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const main = async () => {
  const analysisJson =
    resolvePath(getArg("analysis-json"))
    ?? path.join(ROOT_DIR, "output", "v1.6.14-brand-discovery", "new_top100_brands_analysis.json");
  const diversityAuditJson =
    resolvePath(getArg("source-diversity-audit-json"))
    ?? path.join(ROOT_DIR, "output", "v1.6.14-new-top100-nightly-latest", "phase_a2", "source_diversity_audit.json");
  const qualityGateJson =
    resolvePath(getArg("quality-gate-json"))
    ?? path.join(ROOT_DIR, "output", "v1.6.14-new-top100-nightly-latest", "phase_a1", "new_top100_crossdb_quality_gate.json");

  const outDir =
    resolvePath(getArg("out-dir"))
    ?? path.join(ROOT_DIR, "output", `v1.6.14-new-top100-nightly-${new Date().toISOString().replace(/[:.]/g, "-")}`, "phase_b");

  const analysisRaw = await fs.readFile(analysisJson, "utf8");
  const diversityRaw = await fs.readFile(diversityAuditJson, "utf8").catch(() => JSON.stringify({ rows: [] }));
  const qualityRaw = await fs.readFile(qualityGateJson, "utf8").catch(() => JSON.stringify({ rows: [] }));
  const analysis = JSON.parse(analysisRaw);
  const diversityAudit = JSON.parse(diversityRaw);
  const qualityGate = JSON.parse(qualityRaw);

  const brands = Array.isArray(analysis?.finalBrands) ? analysis.finalBrands : [];
  if (brands.length === 0) {
    console.error("[build-new-top100-plan-json] finalBrands empty");
    process.exit(1);
  }

  const diversityByNorm = new Map((Array.isArray(diversityAudit?.rows) ? diversityAudit.rows : [])
    .map((row) => [normalizeBrand(row?.brandName), row]));
  const qualityByNorm = new Map((Array.isArray(qualityGate?.rows) ? qualityGate.rows : [])
    .map((row) => [normalizeBrand(row?.brandName), row]));

  const us = [];
  const ca = [];

  for (const row of brands) {
    const brand = String(row?.display ?? row?.key ?? "").trim();
    if (!brand) continue;
    const brandNorm = normalizeBrand(brand);
    const usCount = Number(row?.usCount ?? 0) || 0;
    const caCount = Number(row?.caCount ?? 0) || 0;

    const diversity = diversityByNorm.get(brandNorm) || {};
    const quality = qualityByNorm.get(brandNorm) || {};

    const patchPriorityScore = Math.max(
      1,
      Math.round(100 * Number(diversity?.weighted_brand_heat ?? 0.5)),
    );

    const basePayload = {
      brand,
      brand_norm: brandNorm,
      patch_priority_score: patchPriorityScore,
      source_diversity_score: Number(diversity?.source_diversity_score ?? 0),
      weighted_brand_heat: Number(diversity?.weighted_brand_heat ?? 0),
      execution_eligible: Boolean(quality?.execution_eligible ?? diversity?.execution_eligible ?? true),
      low_ca_presence: Boolean(quality?.isLowCaPresence ?? diversity?.low_ca_presence ?? (caCount <= 2)),
      only_iherb: Boolean(diversity?.only_iherb ?? false),
      us_count: usCount,
      ca_count: caCount,
      total_count: Number(row?.totalCount ?? (usCount + caCount)) || 0,
    };

    if (usCount > 0) us.push(basePayload);
    if (caCount > 0) ca.push(basePayload);
  }

  us.sort((a, b) => b.patch_priority_score - a.patch_priority_score || b.us_count - a.us_count || a.brand.localeCompare(b.brand));
  ca.sort((a, b) => b.patch_priority_score - a.patch_priority_score || b.ca_count - a.ca_count || a.brand.localeCompare(b.brand));

  const withRank = (rows) => rows.map((row, idx) => ({ rank: idx + 1, ...row }));
  const usRanked = withRank(us);
  const caRanked = withRank(ca);

  const sourceSitesHistogram = {};
  const fetchedSources = Array.isArray(analysis?.fetchedSources) ? analysis.fetchedSources : [];
  for (const row of fetchedSources) {
    const key = String(row?.source || "unknown").trim().toLowerCase();
    if (!key) continue;
    const current = sourceSitesHistogram[key] || { total: 0, ok: 0, failed: 0 };
    current.total += 1;
    if (row?.ok) current.ok += 1;
    else current.failed += 1;
    sourceSitesHistogram[key] = current;
  }

  const brandListSnapshot = {
    generatedAt: new Date().toISOString(),
    brands: [
      ...usRanked.map((row) => ({ market: "US", rank: row.rank, brand: row.brand, brand_norm: row.brand_norm })),
      ...caRanked.map((row) => ({ market: "CA", rank: row.rank, brand: row.brand, brand_norm: row.brand_norm })),
    ],
  };
  const brandListCanonical = JSON.stringify(brandListSnapshot.brands);
  const brandListSha256 = sha256(brandListCanonical);

  const provenanceInputs = {
    analysisJson: path.resolve(analysisJson),
    diversityAuditJson: path.resolve(diversityAuditJson),
    qualityGateJson: path.resolve(qualityGateJson),
    analysisSha256: sha256(analysisRaw),
    diversityAuditSha256: sha256(diversityRaw),
    qualityGateSha256: sha256(qualityRaw),
  };
  const generationInputsHash = sha256(JSON.stringify(provenanceInputs));

  const snapshotDir = path.join(outDir, "seed");
  const planSnapshotPath = path.join(snapshotDir, "plan_snapshot.json");
  const planSnapshotShaPath = path.join(snapshotDir, "plan_snapshot.sha256");
  const brandListSnapshotPath = path.join(snapshotDir, "brand_list_snapshot.json");
  const brandListSnapshotShaPath = path.join(snapshotDir, "brand_list_snapshot.sha256");

  const outputPlan = {
    generatedAt: new Date().toISOString(),
    planVersion: "v1.6.14-nightly-final-plus-new-top100-1",
    source: {
      analysisJson,
      diversityAuditJson,
      qualityGateJson,
    },
    brand_priority_lists: {
      us: {
        brands: usRanked,
      },
      canada: {
        brands: caRanked,
      },
    },
    provenance: {
      new_plan_source: path.resolve(analysisJson),
      discovery_generated_at: analysis?.generatedAt || null,
      new_plan_source_sites_histogram: sourceSitesHistogram,
      new_plan_brand_list_sha256: brandListSha256,
      new_plan_snapshot_path: planSnapshotPath,
      brand_list_snapshot_path: brandListSnapshotPath,
      generation_inputs_hash: generationInputsHash,
    },
    notes: {
      intent: "new_top100_nightly_final_plus",
      execution_policy: "lane1_only",
      watchlist_policy: "low_ca_pass_tier2_only;low_ca_fail_blocked",
    },
  };

  const planPath = path.join(outDir, "new_top100_plan.json");

  await writeJson(brandListSnapshotPath, brandListSnapshot);
  await writeText(brandListSnapshotShaPath, `${brandListSha256}  ${brandListSnapshotPath}\n`);
  await writeJson(planPath, outputPlan);
  const planSnapshotRaw = await fs.readFile(planPath, "utf8");
  const planSnapshotSha256 = sha256(planSnapshotRaw);
  await writeJson(planSnapshotPath, outputPlan);
  await writeText(planSnapshotShaPath, `${planSnapshotSha256}  ${planSnapshotPath}\n`);

  await writeText(
    path.join(outDir, "new_top100_plan.md"),
    [
      "# New Top100 Plan JSON",
      "",
      `- us brands: ${us.length}`,
      `- ca brands: ${ca.length}`,
      `- execution_eligible us: ${us.filter((row) => row.execution_eligible).length}`,
      `- execution_eligible ca: ${ca.filter((row) => row.execution_eligible).length}`,
      `- source: ${outputPlan.provenance.new_plan_source}`,
      `- plan_snapshot_sha256: ${planSnapshotSha256}`,
      `- brand_list_sha256: ${brandListSha256}`,
      `- output: ${planPath}`,
    ].join("\n") + "\n",
  );

  console.log("[build-new-top100-plan-json] completed");
  console.log(JSON.stringify({
    planPath,
    usBrands: us.length,
    caBrands: ca.length,
  }, null, 2));
};

main().catch((error) => {
  console.error("[build-new-top100-plan-json] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
