#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

import { compileDecisionSupport } from "../../backend/src/decisionSupport.ts";
import { buildFactsDigestFromWeb, computeFactsDigestHash } from "../../backend/src/factsDigest.ts";
import { normalizeIherbSupplementFactsRows } from "../../backend/src/iherbOverlayIngredients.ts";
import { buildQualityMarkLookupKey } from "../../backend/src/qualityMarks/cache.ts";
import { detectQualityMarkFromHtml } from "../../backend/src/qualityMarks/detector.ts";
import {
  dedupeQualityMarkProgramMatches,
  mergeQualityMarkSummaries,
} from "../../backend/src/qualityMarks/matchers.ts";
import {
  buildNutrasourceBrandDetailSource,
  buildQualityMarkSourceCandidates,
  buildNutrasourceProductDetailSource,
  fetchQualityMarkSource,
  resolveNutrasourceBrandDetailSource,
  resolveNutrasourceProductDetailSource,
} from "../../backend/src/qualityMarks/provider.ts";

const ROOT = process.cwd();
const TODAY = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const STAGING_PATH = getArg(
  "staging",
  path.join(ROOT, "output", "iherb_header_facts_week2_closure_v2_20260313", "staging_products.parser_enriched.json"),
);
const MERGE_REPORT_PATH = getArg(
  "merge-report",
  path.join(ROOT, "output", "iherb_overlay_bulk_merge_week2_final_unified_20260313", "overlay_merge_coverage_report.json"),
);
const CACHE_PATH = getArg(
  "cache-json",
  path.join(ROOT, "output", "quality_marks", "quality_mark_cache.json"),
);
const AUDIT_PATH = getArg(
  "audit-json",
  path.join(ROOT, "output", "quality_marks", "quality_mark_audit.json"),
);
const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", "quality_marks", `week2_iherb_refresh_${TODAY}`),
);
const SELECTION_JSON = getArg("selection-json", path.join(OUT_DIR, "week2_iherb_quality_mark_selection.json"));
const SELECTION_MD = getArg("selection-md", path.join(OUT_DIR, "week2_iherb_quality_mark_selection.md"));
const REFRESH_JSON = getArg("refresh-json", path.join(OUT_DIR, "week2_iherb_quality_mark_refresh_report.json"));
const REFRESH_MD = getArg("refresh-md", path.join(OUT_DIR, "week2_iherb_quality_mark_refresh_report.md"));
const SELECTION_INPUT = getArg("selection-input", null);
const LIMIT = Math.max(1, Number(getArg("limit", "50")) || 50);
const CONCURRENCY = Math.max(1, Number(getArg("concurrency", "4")) || 4);
const TTL_DAYS = Math.max(1, Number(getArg("ttl-days", "30")) || 30);
const USP_TARGET = Math.max(0, Number(getArg("usp-target", "15")) || 15);
const NSF_TARGET = Math.max(0, Number(getArg("nsf-target", "15")) || 15);
const INFORMED_CHOICE_TARGET = Math.max(0, Number(getArg("informed-choice-target", "8")) || 8);
const INFORMED_SPORT_TARGET = Math.max(0, Number(getArg("informed-sport-target", "6")) || 6);
const IFOS_TARGET = Math.max(0, Number(getArg("ifos-target", "6")) || 6);

const PROGRAM_TARGETS = new Map([
  ["usp_verified", USP_TARGET],
  ["nsf_certified_for_sport", NSF_TARGET],
  ["informed_choice", INFORMED_CHOICE_TARGET],
  ["informed_sport", INFORMED_SPORT_TARGET],
  ["ifos", IFOS_TARGET],
]);

const PROGRAM_PRIORITY = [
  "usp_verified",
  "nsf_certified_for_sport",
  "informed_choice",
  "informed_sport",
  "ifos",
];

const EQUIVALENT_PROGRAMS = new Set(PROGRAM_PRIORITY);

const PROGRAM_SOURCE_FILTERS = {
  usp_verified: new Set(["usp_listing"]),
  nsf_certified_for_sport: new Set(["nsf_search"]),
  informed_choice: new Set(["informed_choice_search"]),
  informed_sport: new Set(["informed_sport_search"]),
  ifos: new Set([
    "nutrasource_brand_search",
    "nutrasource_brand_detail",
    "nutrasource_product_search",
    "nutrasource_product_detail",
  ]),
};

const safeText = (value) => String(value ?? "").trim();
const hasText = (value) => safeText(value).length > 0;
const nowIso = () => new Date().toISOString();
const OMEGA_KEYWORD_REGEX = /\b(omega|fish oil|dha|epa|cod liver|krill|algae omega|algal oil)\b/i;

const toObjectRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};

const readSectionText = (sections, keys) => {
  for (const key of keys) {
    const value = sections[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
};

const readJson = async (targetPath, fallback = null) => {
  try {
    return JSON.parse(await fs.readFile(targetPath, "utf8"));
  } catch (error) {
    if (fallback !== null) return fallback;
    throw error;
  }
};

const normalizeSelectionRows = (selectionInput) => {
  if (Array.isArray(selectionInput)) return selectionInput;
  if (Array.isArray(selectionInput?.rows)) return selectionInput.rows;
  return [];
};

const toOverlayClaims = (row) => {
  const descriptionSections = toObjectRecord(row.descriptionSections);
  const supplementFacts = toObjectRecord(row.supplementFacts);
  const nutritionalFactsRaw = Array.isArray(supplementFacts.nutritionalFacts)
    ? supplementFacts.nutritionalFacts
    : [];

  return {
    provider: "iherb",
    productId: hasText(row.productId) ? String(row.productId) : null,
    brandName: hasText(row.brandName) ? String(row.brandName) : null,
    title: hasText(row.title) ? String(row.title) : null,
    link: hasText(row.link) ? String(row.link) : null,
    categories: Array.isArray(row.categories)
      ? row.categories.map((item) => safeText(item)).filter(Boolean)
      : [],
    description: readSectionText(descriptionSections, ["Description"]),
    suggestedUse: readSectionText(descriptionSections, ["Suggested use", "Suggested Use", "Suggested usage"]),
    otherIngredients: readSectionText(descriptionSections, ["Other ingredients", "Other Ingredients"]),
    warnings: readSectionText(descriptionSections, ["Warnings", "Warning"]),
    disclaimer: readSectionText(descriptionSections, ["Disclaimer"]),
    nutritionalFacts: nutritionalFactsRaw
      .map((item) => ({
        substancy: safeText(item?.substancy ?? item?.substance ?? item?.substance_name ?? item?.name),
        amountPerServing: safeText(item?.amountPerServing ?? item?.amount_per_serving ?? item?.amount),
        dailyValuePercent: safeText(item?.dailyValuePercent ?? item?.daily_value_percent ?? item?.dailyValue) || null,
      }))
      .filter((item) => item.substancy || item.amountPerServing || item.dailyValuePercent),
  };
};

const toIngredientsText = (overlayClaims) =>
  normalizeIherbSupplementFactsRows(overlayClaims?.nutritionalFacts)
    .map((row) => [safeText(row?.name), safeText(row?.dose)].filter(Boolean).join(" "))
    .filter(Boolean)
    .join("\n");

const toFactsDigest = (row, overlayClaims) => {
  const serving = toObjectRecord(row.serving);
  const supplementFacts = toObjectRecord(row.supplementFacts);
  const digest = buildFactsDigestFromWeb({
    facts: {
      barcode: safeText(row.barcode_gtin14),
      canonical: {
        name: hasText(row.title) ? String(row.title) : null,
        brand: hasText(row.brandName) ? String(row.brandName) : null,
        url: hasText(row.link) ? String(row.link) : null,
        domain: "iherb.com",
      },
      identifiers: { npn: null },
      textFacts: {
        ingredientsText: toIngredientsText(overlayClaims) || null,
        directionsText: overlayClaims?.suggestedUse ?? null,
        warningsText: overlayClaims?.warnings ?? null,
        servingSizeText:
          safeText(supplementFacts.servingSize) ||
          safeText(serving.servingSize) ||
          null,
      },
      coverageScore: 1,
      missingFields: [],
    },
    identityType: "gtin14",
    identityValue: safeText(row.barcode_gtin14),
    regionTags: ["us"],
  });

  digest.product.dosageForm =
    safeText(row.dosageForm) && safeText(row.dosageForm).toLowerCase() !== "n/a"
      ? safeText(row.dosageForm)
      : digest.product.dosageForm;
  digest.product.route = null;
  return digest;
};

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

const runQualityMarkSource = async (source) => {
  const fetched = await fetchQualityMarkSource(source);
  const detection = detectQualityMarkFromHtml(fetched, source);
  return { source, fetched, detection };
};

const buildSelectionDirectSources = (row) => {
  const sources = [];
  const detailProgramIds = Array.from(
    new Set(
      (Array.isArray(row?.detailProgramIds) ? row.detailProgramIds : [row?.strongestProgramId])
        .map((value) => safeText(value).toLowerCase())
        .filter((value) => value === "ifos" || value === "igen"),
    ),
  );
  if (detailProgramIds.length > 0) {
    if (hasText(row?.brandSearchUrl)) {
      sources.push({
        url: String(row.brandSearchUrl),
        sourceType: "official_registry",
        title: "Nutrasource brand search (selection)",
        programId: row?.strongestProgramId ?? detailProgramIds[0],
        adapterKind: "nutrasource_brand_search",
        responseFormat: "json",
        brandName: row?.brandName ?? null,
        productName: row?.productName ?? null,
        queryText: row?.brandSearchQuery ?? row?.brandName ?? null,
      });
    }
    if (hasText(row?.productSearchUrl)) {
      sources.push({
        url: String(row.productSearchUrl),
        sourceType: "official_registry",
        title: "Nutrasource product search (selection)",
        programId: row?.strongestProgramId ?? detailProgramIds[0],
        adapterKind: "nutrasource_product_search",
        responseFormat: "json",
        brandName: row?.brandName ?? null,
        productName: row?.productName ?? null,
        queryText: row?.productSearchQuery ?? row?.productName ?? null,
      });
    }
    if (hasText(row?.detailPageUrl) && hasText(row?.detailProductNum)) {
      for (const programId of detailProgramIds) {
        sources.push(
          buildNutrasourceProductDetailSource({
            programId,
            productNum: String(row.detailProductNum),
            brandName: row?.brandName ?? null,
            productName: row?.productName ?? null,
            queryText: row?.detailQueryText ?? row?.productName ?? null,
          }),
        );
      }
    }
    if (hasText(row?.brandDetailUrl) && hasText(row?.detailBrandId)) {
      for (const programId of detailProgramIds) {
        sources.push(
          buildNutrasourceBrandDetailSource({
            programId,
            brandId: String(row.detailBrandId),
            brandName: row?.brandName ?? null,
            productName: row?.productName ?? null,
            queryText: row?.brandSearchQuery ?? row?.brandName ?? null,
          }),
        );
      }
    }
  }
  return sources;
};

const programRank = (programId) => {
  const index = PROGRAM_PRIORITY.indexOf(programId);
  return index === -1 ? 999 : index;
};

const categoryWeight = (categoryId, programId) => {
  if (programId === "ifos") return categoryId === "fish_oil_omega3" ? 0 : 1;
  return 0;
};

const buildSelectionCandidate = (row) => {
  const overlayClaims = toOverlayClaims(row);
  const digest = toFactsDigest(row, overlayClaims);
  const payload = compileDecisionSupport({
    digest,
    factsDigestHash: computeFactsDigestHash(digest),
    viewMode: "details",
    locale: "en",
    flagsSnapshot: null,
    patchActivation: null,
    overlayClaims,
  });
  const testingModule = Array.isArray(payload?.nutriScoreCardV2?.modules)
    ? payload.nutriScoreCardV2.modules.find((module) => module?.id === "testing_verification")
    : null;
  const thirdPartyItem = Array.isArray(testingModule?.checklist)
    ? testingModule.checklist.find((item) => item?.key === "testing_verification:third_party_tested_claim")
    : null;
  const verificationSummary = payload?.qualityMark?.verificationSummary ?? null;
  const strongestProgramId = verificationSummary?.strongestProgramId ?? null;
  const categoryId = payload?.categoryId ?? null;
  const omegaLikeTitle = OMEGA_KEYWORD_REGEX.test(String(row?.title ?? ""));
  const ifosProbeEligible = categoryId === "fish_oil_omega3" || omegaLikeTitle;
  const claimBackedEquivalent =
    EQUIVALENT_PROGRAMS.has(strongestProgramId) &&
    (thirdPartyItem?.state === "verified" || verificationSummary?.overallStatus === "claimed");

  if (!claimBackedEquivalent && !ifosProbeEligible) return null;

  const normalizedProgramId = claimBackedEquivalent ? strongestProgramId : "ifos";
  const normalizedProgramLabel =
    claimBackedEquivalent ? (verificationSummary?.strongestProgramLabel ?? strongestProgramId) : "IFOS";
  const selectionReason = claimBackedEquivalent
    ? "claim_backed_program"
    : "ifos_fish_oil_probe";

  return {
    key: buildQualityMarkLookupKey({
      sourceType: digest.sourceType,
      identityType: digest.identity.type,
      identityValue: digest.identity.value,
      brandName: digest.product.brandDisplay,
      productName: digest.product.name,
    }),
    productId: row?.productId ? String(row.productId) : null,
    barcode: row?.barcode_gtin14 ? String(row.barcode_gtin14) : null,
    brandName: row?.brandName ?? null,
    productName: row?.title ?? null,
    iherbUrl: row?.link ?? null,
    categoryId,
    strongestProgramId: normalizedProgramId,
    strongestProgramLabel: normalizedProgramLabel,
    thirdPartyChecklistState: thirdPartyItem?.state ?? null,
    verificationSummary,
    selectionReason,
    ifosProbeEligible,
    omegaLikeTitle,
  };
};

const selectCandidates = (candidates, brandLevelHintBrands) => {
  const grouped = new Map();
  for (const candidate of candidates) {
    if (!grouped.has(candidate.strongestProgramId)) grouped.set(candidate.strongestProgramId, []);
    grouped.get(candidate.strongestProgramId).push(candidate);
  }

  for (const items of grouped.values()) {
    items.sort((a, b) => {
      const brandLevelHintDelta =
        Number(brandLevelHintBrands.has(String(b.brandName ?? "").toLowerCase())) -
        Number(brandLevelHintBrands.has(String(a.brandName ?? "").toLowerCase()));
      if (brandLevelHintDelta !== 0) return brandLevelHintDelta;
      const ifosProbeDelta = Number(Boolean(b.ifosProbeEligible)) - Number(Boolean(a.ifosProbeEligible));
      if (ifosProbeDelta !== 0) return ifosProbeDelta;
      const noClaimDelta =
        Number(a.selectionReason === "ifos_fish_oil_probe") - Number(b.selectionReason === "ifos_fish_oil_probe");
      if (noClaimDelta !== 0) return noClaimDelta;
      const categoryDelta = categoryWeight(a.categoryId, a.strongestProgramId) - categoryWeight(b.categoryId, b.strongestProgramId);
      if (categoryDelta !== 0) return categoryDelta;
      return `${a.brandName ?? ""}|${a.productName ?? ""}`.localeCompare(`${b.brandName ?? ""}|${b.productName ?? ""}`);
    });
  }

  const selected = [];
  const seen = new Set();
  for (const [programId, target] of PROGRAM_TARGETS.entries()) {
    const pool = grouped.get(programId) ?? [];
    for (const candidate of pool) {
      if (selected.length >= LIMIT) break;
      if (selected.filter((item) => item.strongestProgramId === programId).length >= target) break;
      if (seen.has(candidate.key)) continue;
      selected.push(candidate);
      seen.add(candidate.key);
    }
  }

  if (selected.length < LIMIT) {
    const remaining = candidates
      .slice()
      .sort((a, b) => {
        const brandLevelHintDelta =
          Number(brandLevelHintBrands.has(String(b.brandName ?? "").toLowerCase())) -
          Number(brandLevelHintBrands.has(String(a.brandName ?? "").toLowerCase()));
        if (brandLevelHintDelta !== 0) return brandLevelHintDelta;
        const programDelta = programRank(a.strongestProgramId) - programRank(b.strongestProgramId);
        if (programDelta !== 0) return programDelta;
        const ifosProbeDelta = Number(Boolean(b.ifosProbeEligible)) - Number(Boolean(a.ifosProbeEligible));
        if (ifosProbeDelta !== 0) return ifosProbeDelta;
        const categoryDelta = categoryWeight(a.categoryId, a.strongestProgramId) - categoryWeight(b.categoryId, b.strongestProgramId);
        if (categoryDelta !== 0) return categoryDelta;
        return `${a.brandName ?? ""}|${a.productName ?? ""}`.localeCompare(`${b.brandName ?? ""}|${b.productName ?? ""}`);
      });
    for (const candidate of remaining) {
      if (selected.length >= LIMIT) break;
      if (seen.has(candidate.key)) continue;
      selected.push(candidate);
      seen.add(candidate.key);
    }
  }

  return selected;
};

const mapLimit = async (items, limit, worker) => {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
};

const sourceQueueKey = (source) =>
  [
    source?.url ?? "",
    source?.adapterKind ?? "",
    source?.programId ?? "",
    source?.brandId ?? "",
    source?.productNum ?? "",
  ].join("::");

const selectOfficialSourcesForProgram = (sources, programId) => {
  const allowedAdapters = PROGRAM_SOURCE_FILTERS[programId] ?? null;
  if (!allowedAdapters) {
    return sources.filter((source) => source.sourceType === "official_registry");
  }
  return sources.filter((source) =>
    source.sourceType === "official_registry" &&
    source.programId === programId &&
    (!source.adapterKind || allowedAdapters.has(source.adapterKind))
  );
};

const buildRegistryFirstDirectSources = (row) => {
  const explicitSelectionSources = buildSelectionDirectSources(row);
  if (explicitSelectionSources.length > 0) return explicitSelectionSources;
  if (row?.selectionReason !== "registry_first_positive_control" || !hasText(row?.officialRegistryEvidenceUrl)) {
    return [];
  }
  return [
    {
      url: String(row.officialRegistryEvidenceUrl),
      sourceType: "official_registry",
      title: `${row?.strongestProgramLabel ?? row?.strongestProgramId ?? "Official registry"} positive-control evidence`,
      programId: row?.strongestProgramId ?? null,
      responseFormat: "html",
      brandName: hasText(row?.officialRegistryBrandName) ? String(row.officialRegistryBrandName) : row?.brandName ?? null,
      productName: hasText(row?.officialRegistryProductName) ? String(row.officialRegistryProductName) : row?.productName ?? null,
      queryText: hasText(row?.officialRegistryProductName) ? String(row.officialRegistryProductName) : row?.productName ?? null,
    },
  ];
};

const toSelectionMarkdown = (report) => {
  const lines = [];
  lines.push("# Week 2 iHerb Quality-Mark Refresh Selection");
  lines.push("");
  lines.push(`Generated at: ${report.generatedAt}`);
  lines.push(`Selected products: ${report.selectedCount}`);
  lines.push("");
  lines.push("## Program Mix");
  lines.push("");
  for (const [program, count] of Object.entries(report.programCounts)) {
    lines.push(`- ${program}: ${count}`);
  }
  lines.push("");
  lines.push("## Selected Products");
  lines.push("");
  for (const row of report.rows) {
    lines.push(`- ${row.strongestProgramLabel} | ${row.brandName} | ${row.productName} | reason=${row.selectionReason} | ${row.iherbUrl}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const toRefreshMarkdown = (report) => {
  const lines = [];
  lines.push("# Week 2 iHerb Quality-Mark Refresh Report");
  lines.push("");
  lines.push(`Generated at: ${report.generatedAt}`);
  lines.push(`Products refreshed: ${report.refreshedCount}`);
  lines.push("");
  lines.push("## Outcomes");
  lines.push("");
  for (const [key, value] of Object.entries(report.summaryStatusCounts)) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("");
  lines.push("## Warnings");
  lines.push("");
  for (const [key, value] of Object.entries(report.warningCounts)) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("");
  lines.push("## Sample Results");
  lines.push("");
  for (const row of report.rows.slice(0, 20)) {
    lines.push(
      `- ${row.brandName} | ${row.productName} | overall=${row.verificationSummary?.overallStatus ?? "none"} | strongest=${row.verificationSummary?.strongestProgramLabel ?? "none"} | warnings=${(row.verificationSummary?.warnings ?? []).join(", ") || "none"} | evidence=${row.evidenceRef ?? "none"}`,
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const [stagingPayload, mergePayload, cachePayloadRaw, auditPayloadRaw] = await Promise.all([
    readJson(STAGING_PATH),
    readJson(MERGE_REPORT_PATH),
    readJson(CACHE_PATH, {
      schemaVersion: "quality_mark_cache.v2",
      ttlDays: TTL_DAYS,
      updatedAt: nowIso(),
      entries: {},
    }),
    readJson(AUDIT_PATH, {
      schemaVersion: "quality_mark_audit.v1",
      generatedAt: nowIso(),
      cachePath: CACHE_PATH,
      rows: [],
    }),
  ]);

  const products = Array.isArray(stagingPayload?.products) ? stagingPayload.products : [];
  const matchedIds = new Set(
    (Array.isArray(mergePayload?.rows) ? mergePayload.rows : [])
      .filter((row) => row?.mergeDecision === "matched")
      .map((row) => String(row?.productId ?? "")),
  );
  const brandLevelHintBrands = new Set(
    (Array.isArray(auditPayloadRaw.rows) ? auditPayloadRaw.rows : [])
      .filter((row) => row?.verificationSummary?.warnings?.includes("brand_level_only_match"))
      .map((row) => String(row?.brandName ?? "").trim().toLowerCase())
      .filter(Boolean),
  );
  const imported = products.filter((row) => matchedIds.has(String(row?.productId ?? "")));
  const candidates =
    SELECTION_INPUT
      ? []
      : imported
          .map((row) => buildSelectionCandidate(row))
          .filter(Boolean);
  const selected = SELECTION_INPUT
    ? normalizeSelectionRows(await readJson(SELECTION_INPUT, []))
    : selectCandidates(candidates, brandLevelHintBrands);

  const selectionReport = {
    schemaVersion: "week2_iherb_quality_mark_selection.v1",
    generatedAt: nowIso(),
    selectionMode: SELECTION_INPUT ? "precomputed_input" : "claim_and_ifos_targeted",
    selectionInput: SELECTION_INPUT,
    selectedCount: selected.length,
    candidateCount: candidates.length,
    programCounts: sortCounts(
      selected.reduce((acc, row) => {
        increment(acc, row.strongestProgramLabel ?? row.strongestProgramId ?? "unknown");
        return acc;
      }, {}),
    ),
    rows: selected,
    brandLevelHintBrands: Array.from(brandLevelHintBrands).sort(),
  };
  await fs.writeFile(SELECTION_JSON, `${JSON.stringify(selectionReport, null, 2)}\n`, "utf8");
  await fs.writeFile(SELECTION_MD, toSelectionMarkdown(selectionReport), "utf8");

  const refreshedRows = await mapLimit(selected, CONCURRENCY, async (row, index) => {
    const directSources = buildRegistryFirstDirectSources(row);
    const sources = directSources.length > 0
      ? directSources
      : selectOfficialSourcesForProgram(buildQualityMarkSourceCandidates({
          identityType: "gtin14",
          identityValue: row.barcode,
          sourceType: "web",
          brandName: row.brandName,
          productName: row.productName,
        }), row.strongestProgramId);

    const detections = [];
    const summaries = [];
    const programMatches = [];
    const errors = [];
    let pageFetchCount = 0;
    let searchFetchCount = 0;
    const tried = [];

    const queue = [...sources];
    const seenSourceKeys = new Set();

    while (queue.length > 0) {
      const source = queue.shift();
      const sourceKey = sourceQueueKey(source);
      if (!source || seenSourceKeys.has(sourceKey)) continue;
      seenSourceKeys.add(sourceKey);
      const result = await runQualityMarkSource(source);
      tried.push(result.source.url);
      if (result.fetched.error) errors.push(result.fetched.error);
      detections.push(result);
      pageFetchCount += result.detection.pagesFetchedCount || 0;
      searchFetchCount += result.detection.searchPagesFetchedCount || 0;
      if (Array.isArray(result.detection.programMatches)) programMatches.push(...result.detection.programMatches);
      if (result.detection.verificationSummary) summaries.push(result.detection.verificationSummary);

      const brandDetailSource = resolveNutrasourceBrandDetailSource({
        source: result.source,
        fetchResult: result.fetched,
      });
      if (brandDetailSource && !seenSourceKeys.has(sourceQueueKey(brandDetailSource))) {
        queue.push(brandDetailSource);
      }

      const detailSource = resolveNutrasourceProductDetailSource({
        source: result.source,
        fetchResult: result.fetched,
      });
      if (detailSource && !seenSourceKeys.has(sourceQueueKey(detailSource))) {
        queue.push(detailSource);
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

    console.log(
      JSON.stringify(
        {
          phase: "week2_iherb_quality_mark_refresh",
          processed: index + 1,
          total: selected.length,
          brandName: row.brandName,
          productName: row.productName,
          overallStatus: verificationSummary?.overallStatus ?? null,
          strongestProgram: verificationSummary?.strongestProgramLabel ?? null,
        },
        null,
        2,
      ),
    );

    return {
      ...row,
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
      sourcePriority: ["official_registry"],
      directRegistryEvidenceUsed: directSources.length > 0,
      programMatches: final.programMatches,
      verificationSummary: final.verificationSummary ?? null,
      note: final.note,
      error: final.error,
      checkedAt: nowIso(),
      expiresAt: new Date(Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    };
  });

  const nextCacheEntries = { ...(cachePayloadRaw.entries ?? {}) };
  const existingAuditRows = Array.isArray(auditPayloadRaw.rows) ? auditPayloadRaw.rows : [];
  const auditRowMap = new Map(existingAuditRows.map((row) => [row.key, row]));

  for (const row of refreshedRows) {
    nextCacheEntries[row.key] = {
      key: row.key,
      status: row.status,
      checked: row.checked,
      confidence: row.confidence,
      confidenceBucket: row.confidenceBucket,
      evidenceRef: row.evidenceRef,
      evidenceType: row.evidenceType,
      checkedMode: row.checkedMode,
      pagesFetchedCount: row.pagesFetchedCount,
      searchPagesFetchedCount: row.searchPagesFetchedCount,
      sourcesTried: row.sourcesTried,
      sourcePriority: row.sourcePriority,
      programMatches: row.programMatches,
      verificationSummary: row.verificationSummary,
      checkedAt: row.checkedAt,
      expiresAt: row.expiresAt,
      error: row.error,
    };
    auditRowMap.set(row.key, {
      key: row.key,
      brandName: row.brandName,
      productName: row.productName,
      barcode_gtin14: row.barcode,
      identityKey: row.barcode ? `gtin14:${row.barcode}` : null,
      status: row.status,
      checked: row.checked,
      confidence: row.confidence,
      confidenceBucket: row.confidenceBucket,
      evidenceRef: row.evidenceRef,
      evidenceType: row.evidenceType,
      checkedMode: row.checkedMode,
      pagesFetchedCount: row.pagesFetchedCount,
      searchPagesFetchedCount: row.searchPagesFetchedCount,
      sourcesTried: row.sourcesTried,
      sourcePriority: row.sourcePriority,
      programMatches: row.programMatches,
      verificationSummary: row.verificationSummary,
      checkedAt: row.checkedAt,
      expiresAt: row.expiresAt,
      error: row.error,
    });
  }

  const cachePayload = {
    schemaVersion: "quality_mark_cache.v2",
    ttlDays: TTL_DAYS,
    updatedAt: nowIso(),
    entryCount: Object.keys(nextCacheEntries).length,
    entries: nextCacheEntries,
  };
  const auditPayload = {
    schemaVersion: "quality_mark_audit.v1",
    generatedAt: nowIso(),
    cachePath: CACHE_PATH,
    rows: Array.from(auditRowMap.values()),
  };

  await fs.writeFile(CACHE_PATH, `${JSON.stringify(cachePayload, null, 2)}\n`, "utf8");
  await fs.writeFile(AUDIT_PATH, `${JSON.stringify(auditPayload, null, 2)}\n`, "utf8");

  const summaryStatusCounts = {};
  const warningCounts = {};
  for (const row of refreshedRows) {
    increment(summaryStatusCounts, row.verificationSummary?.overallStatus ?? "none");
    for (const warning of row.verificationSummary?.warnings ?? []) increment(warningCounts, warning);
  }

  const refreshReport = {
    schemaVersion: "week2_iherb_quality_mark_refresh_report.v1",
    generatedAt: nowIso(),
    refreshedCount: refreshedRows.length,
    summaryStatusCounts: sortCounts(summaryStatusCounts),
    warningCounts: sortCounts(warningCounts),
    rows: refreshedRows,
    outputs: {
      cachePath: CACHE_PATH,
      auditPath: AUDIT_PATH,
    },
  };
  await fs.writeFile(REFRESH_JSON, `${JSON.stringify(refreshReport, null, 2)}\n`, "utf8");
  await fs.writeFile(REFRESH_MD, toRefreshMarkdown(refreshReport), "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        selected: selected.length,
        refreshed: refreshedRows.length,
        selectionJson: SELECTION_JSON,
        refreshJson: REFRESH_JSON,
        cachePath: CACHE_PATH,
        auditPath: AUDIT_PATH,
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
