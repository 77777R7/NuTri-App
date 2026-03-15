#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import { detectQualityMarkFromHtml } from "../../backend/src/qualityMarks/detector.ts";
import {
  dedupeQualityMarkProgramMatches,
  mergeQualityMarkSummaries,
} from "../../backend/src/qualityMarks/matchers.ts";
import {
  buildQualityMarkSourceCandidates,
  fetchQualityMarkSource,
} from "../../backend/src/qualityMarks/provider.ts";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const scope = String(getArg("scope", "top53")).trim().toLowerCase();
const nightlyDir = getArg(
  "nightly-dir",
  path.join(ROOT, "output", "v1.6.14-new-top100-nightly-20260302T103930Z"),
);
const impactPath = getArg(
  "impact-json",
  path.join(nightlyDir, "next_phase", "new_top100_product_level_ux_impact.json"),
);
const outputDir = getArg("out-dir", path.join(ROOT, "output", "quality_marks"));
const cachePath = getArg("cache-json", path.join(outputDir, "quality_mark_cache.json"));
const auditPath = getArg("audit-json", path.join(outputDir, "quality_mark_audit.json"));
const ttlDays = Math.max(1, Number(getArg("ttl-days", "30")) || 30);

const normalize = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const nowIso = () => new Date().toISOString();

const buildKey = (row) => {
  const sourceType = normalize(row.sourceType || "unknown");
  const identityType = normalize((row.identityKey || "").split(":")[0] || "unknown");
  const identityValue = normalize((row.identityKey || "").split(":").slice(1).join(":") || row.barcode_gtin14 || "unknown");
  const brand = normalize(row.brandName || "unknown");
  const product = normalize(row.productName || "unknown");
  return `${sourceType}:${identityType}:${identityValue}:${brand}:${product}`;
};

const makeExpiresAt = () => new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();

const confidenceBucket = (confidence) =>
  confidence >= 0.85 ? "high" : confidence >= 0.65 ? "medium" : "low";

const buildSummaryNote = (summary) => {
  if (!summary) return "Third-party quality mark status is unknown until verified web evidence is available.";
  if (summary.overallStatus === "verified") {
    return `Official ${summary.strongestProgramLabel ?? "registry"} verification matched this product.`;
  }
  if (summary.warnings.includes("registry_access_blocked")) {
    return `Official ${summary.strongestProgramLabel ?? "registry"} access was blocked, so third-party verification remains unproven.`;
  }
  if (summary.warnings.includes("brand_level_only_match")) {
    return `Official ${summary.strongestProgramLabel ?? "registry"} results only support a brand-level match so far.`;
  }
  if (summary.overallStatus === "claimed" && summary.warnings.includes("registry_checked_not_found")) {
    return `A ${summary.strongestProgramLabel ?? "program-specific"} claim was detected, but official registry checks did not confirm a product-level match.`;
  }
  if (summary.overallStatus === "claimed") {
    return `A ${summary.strongestProgramLabel ?? "program-specific"} claim was detected, but official registry verification has not been completed yet.`;
  }
  if (summary.warnings.includes("registry_checked_not_found")) {
    return `Official ${summary.strongestProgramLabel ?? "registry"} verification was checked and no product-level match was found.`;
  }
  if (summary.warnings.includes("program_not_equivalent_to_generic_third_party")) {
    return "A quality program was mentioned, but it is not treated as generic third-party testing proof.";
  }
  if (summary.warnings.includes("search_only_evidence")) {
    return "Search-only evidence is available, but no verified mark page or registry match has been confirmed yet.";
  }
  if (summary.overallStatus === "not_proven") {
    return "Third-party verification was checked and is not currently proven from the available evidence.";
  }
  return "Third-party quality mark check is inconclusive.";
};

const pickBestDetection = (detections, summary) => {
  if (!detections.length) return null;
  if (summary?.strongestProgramId) {
    const strongestProgramDetection = detections.find((item) =>
      item.detection.programMatches?.some((match) => match.programId === summary.strongestProgramId)
    );
    if (strongestProgramDetection) return strongestProgramDetection;
  }
  if (summary?.officialRegistryVerified) {
    return detections.find((item) => item.detection.verificationSummary?.officialRegistryVerified) ?? detections[0];
  }
  if (summary?.overallStatus === "claimed") {
    return detections.find((item) => item.detection.status === "detected") ?? detections[0];
  }
  if (summary?.officialRegistryChecked) {
    return (
      detections.find((item) => item.source.sourceType === "official_registry" && item.detection.checked) ??
      detections[0]
    );
  }
  return detections.find((item) => item.detection.checked) ?? detections[0];
};

const finalizeDetection = (params) => {
  const { detections, programMatches, verificationSummary, pageFetchCount, searchFetchCount, errors } = params;
  const best = pickBestDetection(detections, verificationSummary);

  let status = best?.detection.status ?? "unknown";
  if (verificationSummary?.officialRegistryVerified) status = "detected";
  else if (verificationSummary?.overallStatus === "claimed") status = "detected";
  else if (verificationSummary?.overallStatus === "not_proven") status = "not_detected";
  else if (verificationSummary?.overallStatus === "ambiguous") status = "unknown";

  const confidence =
    verificationSummary?.officialRegistryVerified
      ? 0.97
      : verificationSummary?.overallStatus === "claimed"
        ? Math.max(best?.detection.confidence ?? 0.92, 0.92)
        : verificationSummary?.overallStatus === "not_proven"
          ? Math.max(best?.detection.confidence ?? 0.88, 0.88)
          : best?.detection.confidence ?? (searchFetchCount > 0 ? 0.55 : null);

  const evidenceType =
    verificationSummary?.officialRegistryVerified || verificationSummary?.officialRegistryChecked
      ? "official_registry"
      : best?.detection.evidenceType ?? null;
  const checkedMode = pageFetchCount > 0 ? "page_fetch" : searchFetchCount > 0 ? "search_only" : "search_only";

  return {
    status,
    checked: pageFetchCount > 0 || searchFetchCount > 0,
    confidence,
    confidenceBucket: confidence === null ? "low" : confidenceBucket(confidence),
    evidenceRef: best?.detection.evidenceRef ?? null,
    evidenceType,
    checkedMode,
    pagesFetchedCount: pageFetchCount,
    searchPagesFetchedCount: searchFetchCount,
    note: buildSummaryNote(verificationSummary),
    programMatches: dedupeQualityMarkProgramMatches(programMatches),
    verificationSummary,
    error: errors[0] ?? null,
  };
};

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));

const runQualityMarkSource = async (source) => {
  const fetched = await fetchQualityMarkSource(source);
  const detection = detectQualityMarkFromHtml(fetched, source);
  return { source, fetched, detection };
};

const main = async () => {
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  const impact = await readJson(impactPath);
  const rawProducts = Array.isArray(impact?.products) ? impact.products : [];
  const top53Scoped = rawProducts.filter((row) => row?.executionScope === "top53");
  const products =
    scope === "top53"
      ? (top53Scoped.length > 0 ? top53Scoped : rawProducts.slice(0, 53))
      : rawProducts;
  const entries = {};
  const rows = [];
  for (const row of products.slice(0, scope === "top53" ? 53 : 120)) {
    const key = buildKey(row);
    const sources = buildQualityMarkSourceCandidates({
      identityType: (row.identityKey || "").split(":")[0] || null,
      identityValue: (row.identityKey || "").split(":").slice(1).join(":") || row.barcode_gtin14 || null,
      sourceType: row.sourceType ?? null,
      brandName: row.brandName ?? null,
      productName: row.productName ?? null,
    });
    const tried = [];
    const detections = [];
    const summaries = [];
    const programMatches = [];
    const errors = [];
    let pageFetchCount = 0;
    let searchFetchCount = 0;

    const officialSources = sources.filter((source) => source.sourceType === "official_registry");
    const fallbackSources = sources.filter((source) => source.sourceType !== "official_registry");
    const sourceBatches = [officialSources, fallbackSources];

    for (const batch of sourceBatches) {
      if (batch.length === 0) continue;
      if (batch[0]?.sourceType !== "official_registry" && summaries.some((summary) => summary?.officialRegistryChecked)) {
        break;
      }

      const batchResults = await Promise.all(batch.map(runQualityMarkSource));
      for (const result of batchResults) {
        tried.push(result.source.url);
        if (result.fetched.error) errors.push(result.fetched.error);
        detections.push(result);
        pageFetchCount += result.detection.pagesFetchedCount || 0;
        searchFetchCount += result.detection.searchPagesFetchedCount || 0;
        if (Array.isArray(result.detection.programMatches)) programMatches.push(...result.detection.programMatches);
        if (result.detection.verificationSummary) summaries.push(result.detection.verificationSummary);
      }

      if (summaries.some((summary) => summary?.officialRegistryVerified)) {
        break;
      }
    }

    const verificationSummary = mergeQualityMarkSummaries(...summaries);
    const final = finalizeDetection({
      detections,
      programMatches,
      verificationSummary,
      pageFetchCount,
      searchFetchCount,
      errors,
    });

    const checkedAt = nowIso();
    const entry = {
      key,
      status: final.status,
      checked: final.checked,
      confidence: final.confidence,
      confidenceBucket: final.confidenceBucket,
      evidenceRef: final.evidenceRef,
      evidenceType: final.evidenceType,
      checkedMode: final.checkedMode,
      pagesFetchedCount: final.pagesFetchedCount,
      searchPagesFetchedCount: final.searchPagesFetchedCount,
      sourcesTried: tried,
      sourcePriority: Array.from(new Set(sources.map((source) => source.sourceType))),
      programMatches: final.programMatches,
      verificationSummary: final.verificationSummary ?? null,
      checkedAt,
      expiresAt: makeExpiresAt(),
      error: final.error,
    };
    entries[key] = entry;
    rows.push({
      brandName: row?.brandName ?? null,
      productName: row?.productName ?? null,
      barcode_gtin14: row?.barcode_gtin14 ?? null,
      identityKey: row?.identityKey ?? null,
      ...entry,
    });
  }

  const cachePayload = {
    schemaVersion: "quality_mark_cache.v2",
    ttlDays,
    updatedAt: nowIso(),
    entryCount: Object.keys(entries).length,
    entries,
  };
  await fs.writeFile(cachePath, `${JSON.stringify(cachePayload, null, 2)}\n`, "utf8");

  const auditPayload = {
    schemaVersion: "quality_mark_audit.v1",
    generatedAt: nowIso(),
    cachePath,
    cacheSha256: crypto.createHash("sha256").update(JSON.stringify(cachePayload)).digest("hex"),
    rows,
  };
  await fs.writeFile(auditPath, `${JSON.stringify(auditPayload, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        scope,
        processed: rows.length,
        cachePath,
        auditPath,
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
