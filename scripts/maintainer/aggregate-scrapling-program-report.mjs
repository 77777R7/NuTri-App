#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const OUTPUT_ROOT = getArg("reports-root", path.join(ROOT, "output"));
const REGISTRY_PATH = getArg(
  "lane-registry-json",
  path.join(ROOT, "docs", "exec-plans", "active", "p0_p3_product_closure", "scrapling_lane_registry.json"),
);
const MANIFEST_PATH = getArg("manifest-json", null);
const PROGRAM_SUMMARY_PATH = getArg("program-summary-json", null);
const OUT_DIR = getArg(
  "out-dir",
  path.join(
    ROOT,
    "output",
    `scrapling_program_report_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`,
  ),
);

const normalizeText = (value) => String(value ?? "").trim();
const normalizeLower = (value) => normalizeText(value).toLowerCase();
const slugify = (value) =>
  normalizeLower(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
const toArray = (value) => (Array.isArray(value) ? value : []);

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));
const exists = async (filePath) =>
  fs
    .access(filePath)
    .then(() => true)
    .catch(() => false);

const writeJson = async (filePath, payload) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const writeText = async (filePath, body) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, body, "utf8");
};

const walkFiles = async (dirPath, predicate, out = []) => {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const nextPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(nextPath, predicate, out);
      continue;
    }
    if (predicate(nextPath)) out.push(nextPath);
  }
  return out;
};

const latestByMtime = async (paths) => {
  const stats = await Promise.all(
    paths.map(async (filePath) => ({
      filePath,
      mtimeMs: (await fs.stat(filePath)).mtimeMs,
    })),
  );
  stats.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return stats[0]?.filePath ?? null;
};

const resolveManifestPath = async () => {
  if (MANIFEST_PATH) return path.resolve(ROOT, MANIFEST_PATH);
  if (PROGRAM_SUMMARY_PATH) {
    const summary = await readJson(path.resolve(ROOT, PROGRAM_SUMMARY_PATH));
    const candidate = normalizeText(summary?.inputs?.manifestPath ?? null);
    if (candidate) return candidate;
  }
  const candidates = await walkFiles(
    OUTPUT_ROOT,
    (filePath) => path.basename(filePath) === "scrapling_wave_manifest.json",
    [],
  );
  return latestByMtime(candidates);
};

const reportPathsFromProgramSummary = async (summaryPath) => {
  const summary = await readJson(path.resolve(ROOT, summaryPath));
  const reportPaths = [];
  for (const brand of toArray(summary?.brands)) {
    for (const lane of toArray(brand?.lanes)) {
      for (const wave of toArray(lane?.waves)) {
        const reportPath = normalizeText(wave?.waveReportPath ?? null);
        if (!reportPath) continue;
        const absPath = path.resolve(ROOT, reportPath);
        if (await exists(absPath)) reportPaths.push(absPath);
      }
    }
  }
  return [...new Set(reportPaths)];
};

const baseNameNoExt = (filePath) => path.basename(filePath, path.extname(filePath));

const loadManifestIndex = (manifest) => {
  const byWaveId = new Map();
  const byConfigPath = new Map();
  for (const brand of toArray(manifest?.brands)) {
    const brandName = normalizeText(brand?.brandName ?? null);
    const directWaves = toArray(brand?.waves).map((wave) => ({
      ...wave,
      brandName: normalizeText(wave?.brandName ?? brandName),
    }));
    const laneWaves = toArray(brand?.lanes).flatMap((lane) =>
      toArray(lane?.waves).map((wave) => ({
        ...wave,
        brandName: normalizeText(wave?.brandName ?? brandName),
        sourceBucket: normalizeText(wave?.sourceBucket ?? lane?.sourceBucket ?? null) || null,
        sourcePreference: normalizeText(wave?.sourcePreference ?? lane?.sourcePreference ?? null) || null,
        laneName: normalizeText(wave?.laneName ?? lane?.name ?? null) || null,
      })),
    );
    for (const enriched of [...directWaves, ...laneWaves]) {
      const waveId = normalizeText(enriched.waveId);
      if (waveId) byWaveId.set(waveId, enriched);
      const configPath = normalizeText(enriched.configPath);
      if (configPath) byConfigPath.set(path.resolve(ROOT, configPath), enriched);
    }
  }
  return { byWaveId, byConfigPath };
};

const inferSourceBucket = ({ configPath, configName, sourcePreference, firstPageUrl, firstTargetUrl }) => {
  const corpus = [
    normalizeLower(configPath),
    normalizeLower(configName),
    normalizeLower(sourcePreference),
    normalizeLower(firstPageUrl),
    normalizeLower(firstTargetUrl),
  ].join(" | ");
  if (corpus.includes("smartq")) return "smartq-product";
  if (corpus.includes("atriumpro")) return "atriumpro-product";
  if (corpus.includes("iherb") || corpus.includes("ca.iherb.com/pr/") || corpus.includes("www.iherb.com/pr/")) {
    return "iherb-confirmed";
  }
  if (corpus.includes("/products/") || corpus.includes("/product/") || normalizeLower(sourcePreference) === "official") {
    return "official-product";
  }
  return null;
};

const findMergeValidationPath = async (reportPath) => {
  const reportDir = path.dirname(reportPath);
  for (const dirName of ["merge_validation", "merge_validation_v2"]) {
    const candidate = path.join(reportDir, dirName, "scrapling_merge_validation_report.json");
    if (await exists(candidate)) return candidate;
  }
  return null;
};

const isUnavailableTitle = (value) => {
  const text = normalizeLower(value);
  return (
    text.includes("this site is temporarily unavailable") ||
    text.includes("page is not found") ||
    text.includes("404 not found")
  );
};

const isStaleUrl = (result) => {
  const candidateTitle = normalizeText(result?.candidate?.title ?? null);
  const title = normalizeText(result?.title ?? null);
  const pageUrl = normalizeText(result?.pageUrl ?? result?.targetUrl ?? null);
  return (
    result?.outcome === "stale_known_url" ||
    isUnavailableTitle(candidateTitle) ||
    isUnavailableTitle(title) ||
    /\/404(?:[/?#]|$)/i.test(pageUrl)
  );
};

const staleReasonForResult = (result) => {
  if (result?.outcome === "stale_known_url") return "stale_known_url";
  if (isUnavailableTitle(result?.candidate?.title ?? null)) return "stale_or_unavailable_product_page";
  if (isUnavailableTitle(result?.title ?? null)) return "stale_or_unavailable_title";
  if (/\/404(?:[/?#]|$)/i.test(normalizeText(result?.pageUrl ?? result?.targetUrl ?? null))) return "404_url";
  return "stale_url";
};

const buildObservedReasonSet = ({ report, mergeValidation, staleUrls }) => {
  const reasons = new Set();
  for (const stale of staleUrls) reasons.add(stale.reason);
  const results = toArray(report?.results);
  if (report?.inputs?.execute === true && Number(report?.selectedCount ?? 0) === 0) {
    reasons.add("no_candidates_selected");
  }
  if (report?.inputs?.execute === true && results.length > 0 && !mergeValidation) {
    reasons.add("merge_validation_missing");
  }
  for (const result of results) {
    for (const warning of toArray(result?.extractionWarnings)) {
      reasons.add(normalizeLower(warning));
    }
    if (!result?.hasPrimaryImage) reasons.add("missing_primary_image");
  }
  if (mergeValidation?.summary?.processed > 0 && Number(mergeValidation?.summary?.becameFullOverlayReady ?? 0) === 0) {
    reasons.add("no_full_overlay_ready_uplift");
  }
  return [...reasons].sort();
};

const buildWaveContext = async ({ reportPath, report, manifestIndex }) => {
  const configPath = normalizeText(report?.inputs?.configPath ?? null);
  const configJson = configPath && (await exists(configPath)) ? await readJson(configPath) : null;
  const configName = configPath ? baseNameNoExt(configPath) : null;
  const waveMeta =
    (configPath && manifestIndex.byConfigPath.get(path.resolve(configPath))) ||
    (configName && manifestIndex.byWaveId.get(configName)) ||
    null;

  const brandName =
    normalizeText(report?.inputs?.brandFilter ?? null) ||
    normalizeText(report?.results?.[0]?.brandName ?? null) ||
    normalizeText(waveMeta?.brandName ?? null);
  const laneName = normalizeText(configJson?.name ?? null) || null;
  const waveId = normalizeText(waveMeta?.waveId ?? configName ?? null) || null;
  const firstResult = report?.results?.[0] ?? null;
  const sourceBucket =
    normalizeText(waveMeta?.sourceBucket ?? null) ||
    inferSourceBucket({
      configPath,
      configName,
      sourcePreference: report?.inputs?.sourcePreference ?? configJson?.sourcePreference ?? waveMeta?.sourcePreference ?? null,
      firstPageUrl: firstResult?.pageUrl ?? null,
      firstTargetUrl: firstResult?.targetUrl ?? null,
    }) ||
    null;
  const sourcePreference =
    normalizeText(report?.inputs?.sourcePreference ?? configJson?.sourcePreference ?? waveMeta?.sourcePreference ?? null) ||
    null;
  const laneKey =
    laneName && !/_human_supplement_wave_\d+$/i.test(laneName)
      ? laneName
      : brandName && sourceBucket
        ? `${slugify(brandName)}::${sourceBucket}`
        : laneName || configName || `${slugify(brandName || "unknown")}::${slugify(sourcePreference || "auto")}`;

  return {
    reportPath,
    configPath: configPath || null,
    configName,
    brandName: brandName || null,
    laneName,
    waveId,
    sourceBucket,
    sourcePreference,
    laneKey,
  };
};

const matchRegistryRule = (rule, lane) => {
  const match = rule?.match ?? {};
  const pairs = Object.entries(match);
  if (pairs.length === 0) return false;
  return pairs.every(([key, expected]) => {
    const expectedText = normalizeLower(expected);
    if (key === "configPathIncludes") return normalizeLower(lane.configPath).includes(expectedText);
    if (key === "reportPathIncludes") return normalizeLower(lane.reportPath).includes(expectedText);
    return normalizeLower(lane[key]) === expectedText;
  });
};

const pickRegistryRule = (rules, lane) => {
  const matches = rules
    .filter((rule) => matchRegistryRule(rule, lane))
    .map((rule) => ({ rule, specificity: Object.keys(rule?.match ?? {}).length }))
    .sort((left, right) => right.specificity - left.specificity);
  return matches[0]?.rule ?? null;
};

const deriveDecision = ({ lane, latestWave, observedReasons }) => {
  const executedWaveCount = Number(lane.executedWaveCount ?? 0);
  const totalSelected = Number(lane.totalSelectedCount ?? 0);
  const totalProcessed = Number(lane.totalProcessedRows ?? 0);
  const totalImproved = Number(lane.totalImprovedRows ?? 0);
  const totalUplift = Number(lane.totalFullOverlayReadyUplift ?? 0);
  const totalStaleUrls = Number(lane.totalStaleUrls ?? 0);
  const selected = Number(latestWave.selectedCount ?? 0);
  const processed = Number(latestWave.processedRows ?? 0);
  const improved = Number(latestWave.improvedRows ?? 0);
  const uplift = Number(latestWave.becameFullOverlayReady ?? 0);
  const staleUrlCount = Number(latestWave.staleUrlCount ?? 0);
  const staticGatesPass = latestWave.staticGatesPass !== false;
  const latestUpliftRate = processed > 0 ? uplift / processed : 0;
  const totalUpliftRate = totalProcessed > 0 ? totalUplift / totalProcessed : 0;
  const lowStaleBurden = totalProcessed >= 10 ? totalStaleUrls <= 1 : totalStaleUrls <= 1;
  const sourceUnavailable =
    observedReasons.includes("distributor_or_unavailable_source") ||
    observedReasons.includes("stale_or_unavailable_product_page");

  if (selected > 0 && staleUrlCount === selected) return "STOP";
  if (selected === 0) return "HOLD";
  if (lane.sourceBucket === "smartq-product") return "STOP";

  const onlySoftObservedReasons = observedReasons.every((reason) =>
    ["missing_primary_image", "missing_supplement_facts_rows"].includes(reason),
  );

  // Small but clean iHerb-confirmed lanes often finish in one wave and should
  // not be stranded in HOLD when every processed row reached full overlay.
  if (
    lane.sourceBucket === "iherb-confirmed" &&
    staticGatesPass &&
    lowStaleBurden &&
    processed > 0 &&
    uplift === processed &&
    onlySoftObservedReasons
  ) {
    return "GO";
  }

  if (
    lane.sourceBucket === "iherb-confirmed" &&
    staticGatesPass &&
    lowStaleBurden &&
    totalProcessed > 0 &&
    totalUplift >= 1 &&
    totalUpliftRate >= 0.8 &&
    observedReasons.every((reason) =>
      [
        "missing_primary_image",
        "missing_supplement_facts_rows",
        "stale_known_url",
        "no_full_overlay_ready_uplift",
      ].includes(reason),
    )
  ) {
    return "GO";
  }

  // Promote only after we have enough evidence that the lane repeatedly creates
  // real full-overlay uplift, not just a one-off 1/1 or 2/2 success.
  if (
    staticGatesPass &&
    lowStaleBurden &&
    (
      (totalProcessed >= 4 && totalUplift >= 2 && totalUpliftRate >= 0.5) ||
      (executedWaveCount >= 2 && totalProcessed >= 6 && totalUplift >= 3 && totalUpliftRate >= 0.4) ||
      (processed >= 8 && uplift >= 3 && latestUpliftRate >= 0.35)
    )
  ) {
    return "GO";
  }

  // Only quarantine a lane after enough failed evidence accumulates.
  if (processed >= 4 && improved === 0 && uplift === 0) return "STOP";
  if (executedWaveCount >= 2 && totalProcessed >= 6 && totalImproved === 0 && totalUplift === 0) return "STOP";
  if (sourceUnavailable && totalUplift === 0 && totalProcessed >= 1) return "STOP";
  if (
    observedReasons.includes("stale_or_unavailable_product_page") &&
    observedReasons.includes("missing_primary_image") &&
    totalUplift === 0
  ) {
    return "STOP";
  }
  return "HOLD";
};

const buildMarkdown = (payload) => {
  const lines = [
    "# Scrapling Program Report",
    "",
    `- generatedAt: ${payload.generatedAt}`,
    `- manifestPath: ${payload.inputs.manifestPath ?? "none"}`,
    `- laneRegistryPath: ${payload.inputs.laneRegistryPath}`,
    `- reportsRoot: ${payload.inputs.reportsRoot}`,
    "",
    "## Summary",
    "",
    `- executed_waves: ${payload.summary.executedWaveCount}`,
    `- planned_only_waves: ${payload.summary.plannedOnlyWaveCount}`,
    `- lanes: ${payload.summary.laneCount}`,
    `- go: ${payload.summary.statusCounts.GO}`,
    `- hold: ${payload.summary.statusCounts.HOLD}`,
    `- stop: ${payload.summary.statusCounts.STOP}`,
    `- stale_urls: ${payload.summary.staleUrlCount}`,
    `- full_overlay_ready_uplift: ${payload.summary.fullOverlayReadyUplift}`,
    "",
    "## Lane Decisions",
    "",
  ];

  for (const lane of payload.lanes) {
    lines.push(
      `- ${lane.laneKey} | decision=${lane.decision} | source=${lane.decisionSource} | waves=${lane.executedWaveCount} | latest_uplift=${lane.latestWave?.becameFullOverlayReady ?? 0} | stale_urls=${lane.totalStaleUrls} | quarantine=${lane.quarantineActive ? lane.quarantinedReasons.join(", ") || "active" : "none"}`,
    );
  }

  if (payload.staleUrls.length > 0) {
    lines.push("", "## Stale URLs", "");
    for (const item of payload.staleUrls) {
      lines.push(
        `- ${item.laneKey} | ${item.waveId ?? "manual"} | ${item.productId ?? "unknown"} | ${item.targetUrl ?? item.pageUrl ?? "n/a"} | reason=${item.reason}`,
      );
    }
  }

  if (payload.summary.quarantinedReasonCounts.length > 0) {
    lines.push("", "## Quarantined Reasons", "");
    for (const item of payload.summary.quarantinedReasonCounts) {
      lines.push(`- ${item.reason}: ${item.count}`);
    }
  }

  lines.push("", "## Executed Waves", "");
  for (const wave of payload.executedWaves) {
    lines.push(
      `- ${wave.waveId ?? "manual"} | lane=${wave.laneKey} | selected=${wave.selectedCount} | processed=${wave.processedRows} | became_full_overlay_ready=${wave.becameFullOverlayReady} | stale_urls=${wave.staleUrlCount} | merge_validation=${wave.mergeValidationPresent}`,
    );
  }

  return `${lines.join("\n")}\n`;
};

const main = async () => {
  const manifestPath = await resolveManifestPath();
  const manifest = manifestPath ? await readJson(manifestPath) : null;
  const manifestIndex = loadManifestIndex(manifest ?? {});
  const laneRegistry = await readJson(REGISTRY_PATH);
  const rules = toArray(laneRegistry?.rules);

  const reportPaths = PROGRAM_SUMMARY_PATH
    ? await reportPathsFromProgramSummary(PROGRAM_SUMMARY_PATH)
    : await walkFiles(
        OUTPUT_ROOT,
        (filePath) => path.basename(filePath) === "scrapling_official_fallback_report.json",
        [],
      );

  const executedWaves = [];
  const plannedOnlyWaves = [];
  const laneMap = new Map();

  for (const reportPath of reportPaths.sort()) {
    const report = await readJson(reportPath);
    const lane = await buildWaveContext({ reportPath, report, manifestIndex });
    const mergeValidationPath = await findMergeValidationPath(reportPath);
    const mergeValidation = mergeValidationPath ? await readJson(mergeValidationPath) : null;
    const staleUrls = toArray(report?.results)
      .filter((result) => isStaleUrl(result))
      .map((result) => ({
        laneKey: lane.laneKey,
        waveId: lane.waveId,
        productId: result?.productId ?? null,
        brandName: result?.brandName ?? lane.brandName ?? null,
        targetUrl: result?.targetUrl ?? null,
        pageUrl: result?.pageUrl ?? null,
        reason: staleReasonForResult(result),
      }));
    const outcomes = toArray(report?.results).reduce((acc, result) => {
      const key = normalizeText(result?.outcome ?? "unknown") || "unknown";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
    const observedReasons = buildObservedReasonSet({ report, mergeValidation, staleUrls });
    const executed =
      report?.inputs?.execute === true ||
      Boolean(mergeValidationPath) ||
      Number(mergeValidation?.summary?.processed ?? 0) > 0;

    const waveSummary = {
      laneKey: lane.laneKey,
      laneName: lane.laneName,
      brandName: lane.brandName,
      waveId: lane.waveId,
      sourceBucket: lane.sourceBucket,
      sourcePreference: lane.sourcePreference,
      generatedAt: report.generatedAt ?? null,
      reportPath,
      configPath: lane.configPath,
      selectedCount: Number(report?.selectedCount ?? 0),
      execute: executed,
      mergeValidationPresent: Boolean(mergeValidationPath),
      mergeValidationPath,
      processedRows: Number(mergeValidation?.summary?.processed ?? 0),
      improvedRows: Number(mergeValidation?.summary?.improvedRows ?? 0),
      becameFullOverlayReady: Number(mergeValidation?.summary?.becameFullOverlayReady ?? 0),
      staleUrlCount: staleUrls.length,
      staleUrls,
      outcomes,
      observedReasons,
      staticGatesPass: mergeValidation?.productSurfaceValidation?.staticGatesPass ?? null,
    };

    if (waveSummary.execute) executedWaves.push(waveSummary);
    else plannedOnlyWaves.push(waveSummary);

    if (!laneMap.has(lane.laneKey)) {
      laneMap.set(lane.laneKey, {
        laneKey: lane.laneKey,
        laneName: lane.laneName,
        brandName: lane.brandName,
        sourceBucket: lane.sourceBucket,
        sourcePreference: lane.sourcePreference,
        executedWaves: [],
        plannedOnlyWaves: [],
      });
    }
    const bucket = laneMap.get(lane.laneKey);
    if (waveSummary.execute) bucket.executedWaves.push(waveSummary);
    else bucket.plannedOnlyWaves.push(waveSummary);
  }

  const lanes = [...laneMap.values()]
    .map((lane) => {
      lane.executedWaves.sort((left, right) => normalizeText(right.generatedAt).localeCompare(normalizeText(left.generatedAt)));
      lane.plannedOnlyWaves.sort((left, right) => normalizeText(right.generatedAt).localeCompare(normalizeText(left.generatedAt)));

      const latestWave = lane.executedWaves[0] ?? lane.plannedOnlyWaves[0] ?? null;
      const summarizedLane = {
        ...lane,
        executedWaveCount: lane.executedWaves.length,
        plannedOnlyWaveCount: lane.plannedOnlyWaves.length,
        totalSelectedCount: lane.executedWaves.reduce((sum, wave) => sum + wave.selectedCount, 0),
        totalProcessedRows: lane.executedWaves.reduce((sum, wave) => sum + wave.processedRows, 0),
        totalImprovedRows: lane.executedWaves.reduce((sum, wave) => sum + wave.improvedRows, 0),
        totalFullOverlayReadyUplift: lane.executedWaves.reduce((sum, wave) => sum + wave.becameFullOverlayReady, 0),
        totalStaleUrls: lane.executedWaves.reduce((sum, wave) => sum + wave.staleUrlCount, 0),
      };
      const registryRule = latestWave ? pickRegistryRule(rules, latestWave) : null;
      const observedReasons = [...new Set(lane.executedWaves.flatMap((wave) => wave.observedReasons))].sort();
      const configuredQuarantineReasons = toArray(registryRule?.quarantine?.reasons).map((reason) => normalizeLower(reason));
      const decision =
        normalizeText(registryRule?.decision ?? null).toUpperCase() ||
        deriveDecision({ lane: summarizedLane, latestWave: latestWave ?? {}, observedReasons });
      const decisionSource = registryRule ? "registry_override" : "derived_from_runs";
      const quarantinedReasons = [...new Set([...configuredQuarantineReasons, ...(decision === "GO" ? [] : observedReasons)])].sort();

      return {
        laneKey: lane.laneKey,
        laneName: lane.laneName,
        brandName: lane.brandName,
        sourceBucket: lane.sourceBucket,
        sourcePreference: lane.sourcePreference,
        decision,
        decisionSource,
        registryRuleId: registryRule?.ruleId ?? null,
        quarantineActive: Boolean(registryRule?.quarantine?.active) || (decision !== "GO" && quarantinedReasons.length > 0),
        configuredQuarantineReasons,
        observedQuarantineReasons: decision === "GO" ? [] : observedReasons,
        quarantinedReasons,
        executedWaveCount: summarizedLane.executedWaveCount,
        plannedOnlyWaveCount: summarizedLane.plannedOnlyWaveCount,
        totalSelectedCount: summarizedLane.totalSelectedCount,
        totalProcessedRows: summarizedLane.totalProcessedRows,
        totalImprovedRows: summarizedLane.totalImprovedRows,
        totalFullOverlayReadyUplift: summarizedLane.totalFullOverlayReadyUplift,
        totalStaleUrls: summarizedLane.totalStaleUrls,
        latestWave: latestWave
          ? {
              waveId: latestWave.waveId,
              generatedAt: latestWave.generatedAt,
              reportPath: latestWave.reportPath,
              mergeValidationPath: latestWave.mergeValidationPath,
              selectedCount: latestWave.selectedCount,
              processedRows: latestWave.processedRows,
              improvedRows: latestWave.improvedRows,
              becameFullOverlayReady: latestWave.becameFullOverlayReady,
              staleUrlCount: latestWave.staleUrlCount,
              staticGatesPass: latestWave.staticGatesPass,
            }
          : null,
        executedWaves: lane.executedWaves,
      };
    })
    .sort((left, right) => left.laneKey.localeCompare(right.laneKey));

  const staleUrls = lanes.flatMap((lane) => lane.executedWaves.flatMap((wave) => wave.staleUrls));
  const quarantinedReasonCounts = [...new Set(lanes.flatMap((lane) => lane.quarantinedReasons))]
    .map((reason) => ({
      reason,
      count: lanes.filter((lane) => lane.quarantinedReasons.includes(reason)).length,
    }))
    .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason));

  const manifestWaveIds = new Set(manifestIndex.byWaveId.keys());
  const executedManifestWaveIds = new Set(
    executedWaves.map((wave) => wave.waveId).filter((waveId) => waveId && manifestWaveIds.has(waveId)),
  );

  const report = {
    generatedAt: new Date().toISOString(),
    inputs: {
      manifestPath,
      programSummaryPath: PROGRAM_SUMMARY_PATH ? path.resolve(ROOT, PROGRAM_SUMMARY_PATH) : null,
      laneRegistryPath: path.resolve(REGISTRY_PATH),
      reportsRoot: path.resolve(OUTPUT_ROOT),
    },
    summary: {
      executedWaveCount: executedWaves.length,
      plannedOnlyWaveCount: plannedOnlyWaves.length,
      laneCount: lanes.length,
      statusCounts: {
        GO: lanes.filter((lane) => lane.decision === "GO").length,
        HOLD: lanes.filter((lane) => lane.decision === "HOLD").length,
        STOP: lanes.filter((lane) => lane.decision === "STOP").length,
      },
      staleUrlCount: staleUrls.length,
      fullOverlayReadyUplift: lanes.reduce((sum, lane) => sum + lane.totalFullOverlayReadyUplift, 0),
      quarantinedReasonCounts,
      manifestSummary: manifest
        ? {
            totalBrands: toArray(manifest?.brands).length,
            totalWaves: manifestWaveIds.size,
            executedWaves: executedManifestWaveIds.size,
            unexecutedWaves: manifestWaveIds.size - executedManifestWaveIds.size,
          }
        : null,
    },
    lanes,
    staleUrls,
    executedWaves: executedWaves.sort(
      (left, right) => normalizeText(right.generatedAt).localeCompare(normalizeText(left.generatedAt)),
    ),
  };

  const currentRegistry = {
    schemaVersion: "scrapling_lane_registry_current.v1",
    generatedAt: report.generatedAt,
    sourceRegistryPath: path.resolve(REGISTRY_PATH),
    lanes: lanes.map((lane) => ({
      laneKey: lane.laneKey,
      laneName: lane.laneName,
      brandName: lane.brandName,
      sourceBucket: lane.sourceBucket,
      sourcePreference: lane.sourcePreference,
      decision: lane.decision,
      decisionSource: lane.decisionSource,
      registryRuleId: lane.registryRuleId,
      quarantineActive: lane.quarantineActive,
      quarantinedReasons: lane.quarantinedReasons,
      executedWaveCount: lane.executedWaveCount,
      totalFullOverlayReadyUplift: lane.totalFullOverlayReadyUplift,
      totalStaleUrls: lane.totalStaleUrls,
      latestWave: lane.latestWave,
    })),
  };

  await writeJson(path.join(OUT_DIR, "scrapling_program_report.json"), report);
  await writeJson(path.join(OUT_DIR, "scrapling_lane_registry_current.json"), currentRegistry);
  await writeText(path.join(OUT_DIR, "scrapling_program_report.md"), buildMarkdown(report));
  console.log(`Wrote Scrapling program report to ${path.join(OUT_DIR, "scrapling_program_report.json")}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
