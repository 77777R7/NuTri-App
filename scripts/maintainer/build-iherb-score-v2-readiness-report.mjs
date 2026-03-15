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

const STAGING_PATH = getArg(
  "staging",
  path.join(ROOT, "output", "iherb_healthy_origins_p0_official_ocr_final_20260313", "staging_products.official_refreshed.json"),
);
const MERGE_REPORT_PATH = getArg(
  "merge-report",
  path.join(ROOT, "output", "iherb_overlay_bulk_merge_healthy_origins_final_20260313", "overlay_merge_coverage_report.json"),
);
const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", `iherb_score_v2_readiness_${TODAY}`),
);

const {
  compileDecisionSupport,
} = await import("../../backend/src/decisionSupport.ts");
const {
  buildFactsDigestFromWeb,
  computeFactsDigestHash,
} = await import("../../backend/src/factsDigest.ts");
const {
  normalizeIherbSupplementFactsRows,
} = await import("../../backend/src/iherbOverlayIngredients.ts");

const readJson = async (targetPath) => JSON.parse(await fs.readFile(targetPath, "utf8"));
const safeText = (value) => String(value ?? "").trim();
const hasText = (value) => safeText(value).length > 0;

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

const isScoreV2Ready = (payload) => {
  const v2 = payload?.nutriScoreCardV2;
  const modules = Array.isArray(v2?.modules) ? v2.modules : [];
  return Number.isFinite(Number(v2?.overallScore))
    && hasText(v2?.overallBand)
    && Number.isFinite(Number(v2?.confidencePct))
    && modules.length === 6
    && modules.every((module) =>
      hasText(module?.id)
      && hasText(module?.title)
      && Number.isFinite(Number(module?.score))
      && hasText(module?.band)
      && Array.isArray(module?.checklist)
      && module.checklist.length > 0);
};

const isDeepContentReady = (payload) => {
  const overview = payload?.overviewBlock;
  const science = payload?.scienceBlock;
  const usage = payload?.usageBlock;
  const safety = payload?.safetyBlock;

  const overviewOk =
    Array.isArray(overview?.bestForBullets) && overview.bestForBullets.length > 0
    && Array.isArray(overview?.providesVerified?.keyIngredients) && overview.providesVerified.keyIngredients.length > 0;
  const scienceOk =
    Array.isArray(science?.ingredientRows) && science.ingredientRows.length > 0
    && Array.isArray(science?.aiSummaryContract3) && science.aiSummaryContract3.length === 3;
  const usageOk =
    hasText(usage?.directions?.text)
    && Array.isArray(usage?.directions?.lines) && usage.directions.lines.length > 0;
  const safetyOk =
    (Array.isArray(safety?.labelWarnings) && safety.labelWarnings.length > 0)
    || (Array.isArray(safety?.generalWatchouts) && safety.generalWatchouts.length > 0)
    || (Array.isArray(safety?.ulGuidance) && safety.ulGuidance.length > 0);

  return overviewOk && scienceOk && usageOk && safetyOk;
};

const increment = (map, key) => {
  map[key] = (map[key] ?? 0) + 1;
};

const pct = (part, total) => total > 0 ? Number(((part / total) * 100).toFixed(1)) : 0;

const toMarkdown = (report) => {
  const lines = [];
  lines.push("# iHerb Score V2 Readiness Report");
  lines.push("");
  lines.push(`- generatedAt: ${report.generatedAt}`);
  lines.push(`- stagingPath: ${report.inputs.stagingPath}`);
  lines.push(`- mergeReportPath: ${report.inputs.mergeReportPath}`);
  lines.push(`- importedTotal: ${report.summary.importedTotal}`);
  lines.push("");
  lines.push("## Readiness");
  lines.push("");
  lines.push(`- score_v2_ready: ${report.summary.scoreV2Ready.count}/${report.summary.importedTotal} (${report.summary.scoreV2Ready.percent}%)`);
  lines.push(`- deep_content_ready: ${report.summary.deepContentReady.count}/${report.summary.importedTotal} (${report.summary.deepContentReady.percent}%)`);
  lines.push(`- category_specialization_hit: ${report.summary.categorySpecializationHit.count}/${report.summary.importedTotal} (${report.summary.categorySpecializationHit.percent}%)`);
  lines.push("");
  lines.push("## Category Distribution");
  lines.push("");
  Object.entries(report.categoryDistribution)
    .sort((a, b) => b[1] - a[1])
    .forEach(([key, value]) => {
      lines.push(`- ${key}: ${value}`);
    });
  lines.push("");
  lines.push("## Source Type Distribution");
  lines.push("");
  Object.entries(report.sourceTypeDistribution)
    .sort((a, b) => b[1] - a[1])
    .forEach(([key, value]) => {
      lines.push(`- ${key}: ${value}`);
    });
  lines.push("");
  lines.push("## Examples");
  lines.push("");
  for (const sample of report.samples) {
    lines.push(`- ${sample.label}: barcode=${sample.barcode} | categoryId=${sample.categoryId} | score=${sample.overallScore}/${sample.overallBand} | score_v2_ready=${sample.scoreV2Ready} | deep_content_ready=${sample.deepContentReady}`);
  }
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  const stagingPayload = await readJson(STAGING_PATH);
  const mergePayload = await readJson(MERGE_REPORT_PATH);
  const products = Array.isArray(stagingPayload?.products) ? stagingPayload.products : [];
  const matchedIds = new Set(
    (Array.isArray(mergePayload?.rows) ? mergePayload.rows : [])
      .filter((row) => row?.mergeDecision === "matched")
      .map((row) => String(row?.productId ?? "")),
  );
  const imported = products.filter((row) => matchedIds.has(String(row?.productId ?? "")));

  const categoryDistribution = {};
  const sourceTypeDistribution = {};
  const readySamples = [];
  const specialSamples = [];

  let scoreV2ReadyCount = 0;
  let deepContentReadyCount = 0;
  let categorySpecializationHitCount = 0;
  let errorCount = 0;

  for (const row of imported) {
    try {
      const overlayClaims = toOverlayClaims(row);
      const digest = toFactsDigest(row, overlayClaims);
      const factsDigestHash = computeFactsDigestHash(digest);
      const payload = compileDecisionSupport({
        digest,
        factsDigestHash,
        viewMode: "details",
        locale: "en",
        flagsSnapshot: null,
        patchActivation: null,
        overlayClaims,
      });

      const scoreV2Ready = isScoreV2Ready(payload);
      const deepContentReady = isDeepContentReady(payload);
      const categoryId = safeText(payload?.categoryId) || "unknown";
      const sourceType = safeText(payload?.decisionDebug?.sourceType) || safeText(digest?.sourceType) || "unknown";

      if (scoreV2Ready) scoreV2ReadyCount += 1;
      if (deepContentReady) deepContentReadyCount += 1;
      if (categoryId !== "unknown") categorySpecializationHitCount += 1;

      increment(categoryDistribution, categoryId);
      increment(sourceTypeDistribution, sourceType);

      if (readySamples.length < 5) {
        readySamples.push({
          label: safeText(row.title),
          barcode: safeText(row.barcode_gtin14),
          categoryId,
          overallScore: Number(payload?.nutriScoreCardV2?.overallScore ?? 0),
          overallBand: safeText(payload?.nutriScoreCardV2?.overallBand),
          scoreV2Ready,
          deepContentReady,
        });
      }
      if (categoryId !== "unknown" && specialSamples.length < 10) {
        specialSamples.push({
          label: safeText(row.title),
          barcode: safeText(row.barcode_gtin14),
          categoryId,
          overallScore: Number(payload?.nutriScoreCardV2?.overallScore ?? 0),
          overallBand: safeText(payload?.nutriScoreCardV2?.overallBand),
          scoreV2Ready,
          deepContentReady,
        });
      }
    } catch (error) {
      errorCount += 1;
      if (errorCount <= 5) {
        console.warn("[score-v2-readiness] failed row", {
          productId: row?.productId ?? null,
          title: row?.title ?? null,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const report = {
    schemaVersion: "iherb_score_v2_readiness.v1",
    generatedAt: new Date().toISOString(),
    inputs: {
      stagingPath: path.relative(ROOT, STAGING_PATH),
      mergeReportPath: path.relative(ROOT, MERGE_REPORT_PATH),
    },
    summary: {
      importedTotal: imported.length,
      errorCount,
      scoreV2Ready: {
        count: scoreV2ReadyCount,
        percent: pct(scoreV2ReadyCount, imported.length),
      },
      deepContentReady: {
        count: deepContentReadyCount,
        percent: pct(deepContentReadyCount, imported.length),
      },
      categorySpecializationHit: {
        count: categorySpecializationHitCount,
        percent: pct(categorySpecializationHitCount, imported.length),
      },
    },
    categoryDistribution,
    sourceTypeDistribution,
    samples: specialSamples.length > 0 ? specialSamples : readySamples,
  };

  await fs.mkdir(OUT_DIR, { recursive: true });
  const outJson = path.join(OUT_DIR, "score_v2_readiness_report.json");
  const outMd = path.join(OUT_DIR, "score_v2_readiness_report.md");
  await fs.writeFile(outJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(outMd, toMarkdown(report), "utf8");

  console.log(JSON.stringify({
    ok: true,
    summary: report.summary,
    outputs: {
      json: path.relative(ROOT, outJson),
      md: path.relative(ROOT, outMd),
    },
  }, null, 2));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
