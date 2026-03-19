#!/usr/bin/env node
/* eslint-disable no-console */
import crypto from "node:crypto";
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

const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", "quality_marks", "overnight_loop"),
);
const REPORT_PATH = getArg("report-json", path.join(OUT_DIR, "latest.json"));
const MARKDOWN_PATH = getArg("report-md", path.join(OUT_DIR, "latest.md"));
const STATE_PATH = getArg(
  "demotion-state",
  path.join(OUT_DIR, "brand_demotions_state.json"),
);
const BASELINE_CENSUS_PATH = getArg(
  "baseline-census",
  path.join(OUT_DIR, "baseline_census_v12.json"),
);
const BASELINE_CACHE_META_PATH = getArg(
  "baseline-cache-meta",
  path.join(OUT_DIR, "baseline_cache_meta.json"),
);
const BASELINE_AUDIT_VERIFIED_PATH = getArg(
  "baseline-audit-verified",
  path.join(OUT_DIR, "baseline_audit_verified_count.json"),
);
const BASELINE_CACHE_SHA_PATH = getArg(
  "baseline-cache-sha",
  path.join(OUT_DIR, "baseline_cache_sha256.txt"),
);
const CURRENT_CENSUS_PATH = getArg("current-census", null);
const SELECTION_REPORT_PATH = getArg("selection-report", null);
const REFRESH_REPORT_PATH = getArg("refresh-report", null);
const CACHE_PATH = getArg(
  "cache-json",
  path.join(ROOT, "output", "quality_marks", "quality_mark_cache.json"),
);
const AUDIT_PATH = getArg(
  "audit-json",
  path.join(ROOT, "output", "quality_marks", "quality_mark_audit.json"),
);
const RUN_ID = getArg(
  "run-id",
  `week2-marks-loop-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`,
);
const FORCE_LEGACY_INFRA_REPAIR = getArg("repair-legacy-infra-state", "false") === "true";
const RESET_STATE = getArg("reset-state", "false") === "true";

if (!CURRENT_CENSUS_PATH || !SELECTION_REPORT_PATH || !REFRESH_REPORT_PATH) {
  console.error(
    "Missing required args: --current-census, --selection-report, and --refresh-report.",
  );
  process.exit(1);
}

const readJson = async (targetPath, fallback = null) => {
  try {
    return JSON.parse(await fs.readFile(targetPath, "utf8"));
  } catch (error) {
    if (fallback !== null) return fallback;
    throw error;
  }
};

const readText = async (targetPath, fallback = "") => {
  try {
    return (await fs.readFile(targetPath, "utf8")).trim();
  } catch (error) {
    return fallback;
  }
};

const hasInfraBlockedWarning = (warning) => {
  const text = String(warning ?? "");
  return [
    /could not resolve host/i,
    /failed to connect/i,
    /connection refused/i,
    /timed out/i,
    /timeout/i,
    /network is unreachable/i,
    /ssl/i,
    /tls/i,
    /registry[_ ]access[_ ]blocked/i,
    /\b403\b/i,
    /\b429\b/i,
    /\b5\d\d\b/i,
  ].some((pattern) => pattern.test(text));
};

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const safeText = (value) => String(value ?? "").trim();

const uniqueSorted = (values) =>
  [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));

const ifosNsfProgramIds = new Set(["ifos", "nsf_certified_for_sport"]);

const summarizeBrandAttempts = (registrySummary) => {
  const grouped = new Map();
  let programRowsConsidered = 0;

  for (const row of registrySummary) {
    const programId = safeText(row?.programId);
    if (!ifosNsfProgramIds.has(programId)) continue;
    const brandName = safeText(row?.brandName);
    if (!brandName) continue;
    programRowsConsidered += 1;
    const key = brandName.toLowerCase();
    const warnings = Array.isArray(row?.warnings) ? row.warnings.map(String) : [];
    const infraWarnings = warnings.filter(hasInfraBlockedWarning);
    const current =
      grouped.get(key) ?? {
        brandName,
        programs: new Set(),
        maxSafeMatches: 0,
        hasInfraBlocked: false,
        infraWarnings: [],
      };
    current.programs.add(programId);
    current.maxSafeMatches = Math.max(current.maxSafeMatches, toNumber(row?.matchedCount));
    if (infraWarnings.length > 0) {
      current.hasInfraBlocked = true;
      current.infraWarnings.push(...infraWarnings);
    }
    grouped.set(key, current);
  }

  const attempts = [...grouped.entries()].map(([key, value]) => {
    const programs = [...value.programs].sort();
    const infraWarnings = uniqueSorted(value.infraWarnings);
    let outcome = "zero_safe";
    if (value.maxSafeMatches > 0) outcome = "safe_match";
    else if (value.hasInfraBlocked) outcome = "infra_blocked";
    return {
      key,
      brandName: value.brandName,
      programs,
      maxSafeMatches: value.maxSafeMatches,
      infraWarnings,
      hasInfraBlocked: value.hasInfraBlocked,
      outcome,
    };
  });

  attempts.sort((a, b) => a.brandName.localeCompare(b.brandName));
  return { attempts, programRowsConsidered };
};

const updateDemotionState = async (attemptSummary) => {
  const previousState = RESET_STATE
    ? { byBrand: {}, demotedBrands: [] }
    : await readJson(STATE_PATH, { byBrand: {}, demotedBrands: [] });
  const previousByBrand = previousState?.byBrand ?? {};
  const previousPolicy = safeText(previousState?.policy);
  const legacyInfraUnsafeState =
    FORCE_LEGACY_INFRA_REPAIR ||
    !previousPolicy.includes("infra failures do not count");
  const nextByBrand = { ...previousByBrand };
  const runAttemptedBrands = [];
  const infraBlockedBrandsThisRun = [];
  const eligibleZeroSafeBrandsThisRun = [];
  const safeMatchBrandsThisRun = [];

  const runTimestamp = new Date().toISOString();

  for (const attempt of attemptSummary.attempts) {
    const { key, brandName, programs, maxSafeMatches, infraWarnings, outcome } = attempt;
    runAttemptedBrands.push(brandName);

    const previous = nextByBrand[key] ?? {
      brandName,
      attempts: 0,
      infraBlockedAttempts: 0,
      zeroSafeStreak: 0,
      lastSafeMatches: 0,
      lastPrograms: [],
      lastRun: null,
      lastOutcome: null,
      lastInfraWarnings: [],
    };

    const next = {
      ...previous,
      brandName,
      lastSafeMatches: maxSafeMatches,
      lastPrograms: programs,
      lastRun: runTimestamp,
      lastRunId: RUN_ID,
      lastOutcome: outcome,
      lastInfraWarnings: infraWarnings,
    };

    if (safeText(previous.lastRunId) === RUN_ID) {
      if (outcome === "infra_blocked") infraBlockedBrandsThisRun.push(brandName);
      if (outcome === "zero_safe") eligibleZeroSafeBrandsThisRun.push(brandName);
      if (outcome === "safe_match") safeMatchBrandsThisRun.push(brandName);
      nextByBrand[key] = next;
      continue;
    }

    if (outcome === "infra_blocked") {
      if (
        legacyInfraUnsafeState &&
        toNumber(previous.attempts) > 0 &&
        toNumber(previous.lastSafeMatches) === 0
      ) {
        next.attempts = Math.max(0, toNumber(previous.attempts) - 1);
        next.zeroSafeStreak = Math.max(0, toNumber(previous.zeroSafeStreak) - 1);
      }
      next.infraBlockedAttempts = toNumber(previous.infraBlockedAttempts) + 1;
      infraBlockedBrandsThisRun.push(brandName);
    } else {
      next.attempts = toNumber(previous.attempts) + 1;
      next.zeroSafeStreak =
        outcome === "zero_safe" ? toNumber(previous.zeroSafeStreak) + 1 : 0;
      if (outcome === "zero_safe") eligibleZeroSafeBrandsThisRun.push(brandName);
      if (outcome === "safe_match") safeMatchBrandsThisRun.push(brandName);
    }

    nextByBrand[key] = next;
  }

  const previousDemoted = Array.isArray(previousState?.demotedBrands)
    ? previousState.demotedBrands
    : [];
  const allDemotedBrands = Object.values(nextByBrand)
    .filter((entry) => toNumber(entry?.zeroSafeStreak) >= 2)
    .map((entry) => entry.brandName)
    .sort((a, b) => a.localeCompare(b));
  const newlyDemotedBrands = allDemotedBrands.filter(
    (brandName) => !previousDemoted.includes(brandName),
  );

  const state = {
    updatedAt: runTimestamp,
    byBrand: nextByBrand,
    demotedBrands: allDemotedBrands,
    policy:
      "Demote brands after two consecutive zero-safe-match runs with successful registry query completion; infra failures do not count toward zero-safe streak.",
  };

  await fs.writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);

  return {
    state,
    runAttemptedBrands: uniqueSorted(runAttemptedBrands),
    infraBlockedBrandsThisRun: uniqueSorted(infraBlockedBrandsThisRun),
    eligibleZeroSafeBrandsThisRun: uniqueSorted(eligibleZeroSafeBrandsThisRun),
    safeMatchBrandsThisRun: uniqueSorted(safeMatchBrandsThisRun),
    newlyDemotedBrands,
    allDemotedBrands,
  };
};

const buildMarkdown = (report) => {
  const lines = [];
  lines.push("# Week 2 third_party_tested_claim Overnight Loop");
  lines.push("");
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- Run id: ${report.runId}`);
  lines.push("");
  lines.push("## Headline Deltas");
  lines.push("");
  lines.push(
    `- verified: ${report.deltas.censusVerifiedHeadline.before} -> ${report.deltas.censusVerifiedHeadline.after} (delta ${report.deltas.censusVerifiedHeadline.delta >= 0 ? "+" : ""}${report.deltas.censusVerifiedHeadline.delta})`,
  );
  lines.push(
    `- claimed: ${report.deltas.censusClaimedHeadline.before} -> ${report.deltas.censusClaimedHeadline.after} (delta ${report.deltas.censusClaimedHeadline.delta >= 0 ? "+" : ""}${report.deltas.censusClaimedHeadline.delta})`,
  );
  lines.push(
    `- officialRegistryChecked: ${report.deltas.registryChecked.before} -> ${report.deltas.registryChecked.after} (delta ${report.deltas.registryChecked.delta >= 0 ? "+" : ""}${report.deltas.registryChecked.delta})`,
  );
  lines.push(
    `- cache entries: ${report.deltas.cacheEntryCount.before} -> ${report.deltas.cacheEntryCount.after} (delta ${report.deltas.cacheEntryCount.delta >= 0 ? "+" : ""}${report.deltas.cacheEntryCount.delta})`,
  );
  lines.push(`- cache SHA changed: ${report.deltas.cacheSha256.changed}`);
  lines.push("");
  lines.push("## Reconciliation Check");
  lines.push("");
  lines.push(
    `- pre-run gap (audit verified - census verified): ${report.reconciliation.gapBefore}`,
  );
  lines.push(`- post-run gap: ${report.reconciliation.gapAfter}`);
  lines.push(`- fixed this run: ${report.reconciliation.fixedThisRun}`);
  lines.push(`- note: ${report.reconciliation.investigation}`);
  lines.push("");
  lines.push("## Expansion Status (IFOS + NSF high-yield only)");
  lines.push("");
  lines.push(`- registry-first selected rows: ${report.expansion.registryFirstRowsSelected}`);
  lines.push(`- targeted refreshed rows: ${report.expansion.refreshedRows}`);
  lines.push(`- IFOS/NSF unique brands attempted: ${report.expansion.ifosNsfBrandAttempts}`);
  lines.push(
    `- IFOS/NSF program rows considered: ${report.expansion.ifosNsfProgramRowsConsidered}`,
  );
  lines.push("");
  lines.push("## Newly Verified SKUs");
  lines.push("");
  if (report.newlyVerifiedSkus.length === 0) {
    lines.push("- none this run");
  } else {
    for (const sku of report.newlyVerifiedSkus) {
      lines.push(
        `- ${sku.brandName ?? "Unknown brand"} | ${sku.productName ?? "Unknown product"} | program=${sku.strongestProgramLabel ?? "unknown"} | evidence=${sku.evidenceRef ?? "none"}`,
      );
    }
  }
  lines.push("");
  lines.push("## Unresolved Blockers");
  lines.push("");
  if (report.unresolvedBlockers.length === 0) {
    lines.push("- none");
  } else {
    for (const blocker of report.unresolvedBlockers) {
      lines.push(`- ${blocker.code}: ${blocker.detail}`);
      for (const sample of blocker.samples ?? []) {
        lines.push(`  - ${String(sample).trim()}`);
      }
    }
  }
  lines.push("");
  lines.push("## Brand Demotions");
  lines.push("");
  lines.push(
    `- attempted brands this run: ${report.demotions.attemptedBrandsThisRun.length ? report.demotions.attemptedBrandsThisRun.join(", ") : "none"}`,
  );
  lines.push(
    `- infra-blocked brands this run: ${report.demotions.infraBlockedBrandsThisRun.length ? report.demotions.infraBlockedBrandsThisRun.join(", ") : "none"}`,
  );
  lines.push(
    `- eligible zero-safe brands this run: ${report.demotions.eligibleZeroSafeBrandsThisRun.length ? report.demotions.eligibleZeroSafeBrandsThisRun.join(", ") : "none"}`,
  );
  lines.push(
    `- safe-match brands this run: ${report.demotions.safeMatchBrandsThisRun.length ? report.demotions.safeMatchBrandsThisRun.join(", ") : "none"}`,
  );
  lines.push(
    `- newly demoted: ${report.demotions.newlyDemotedBrands.length ? report.demotions.newlyDemotedBrands.join(", ") : "none"}`,
  );
  lines.push(
    `- all demoted: ${report.demotions.allDemotedBrands.length ? report.demotions.allDemotedBrands.join(", ") : "none"}`,
  );
  lines.push(`- policy: ${report.demotions.policy}`);
  lines.push("");
  lines.push("## Next Recommended Action");
  lines.push("");
  lines.push(`- ${report.nextRecommendedAction}`);
  lines.push("");
  return lines.join("\n");
};

await fs.mkdir(OUT_DIR, { recursive: true });

const [
  baselineCensus,
  baselineCacheMeta,
  currentCensus,
  currentCache,
  currentAudit,
  selectionReport,
  refreshReport,
  baselineAuditVerifiedText,
  baselineCacheSha,
] = await Promise.all([
  readJson(BASELINE_CENSUS_PATH, {}),
  readJson(BASELINE_CACHE_META_PATH, {}),
  readJson(CURRENT_CENSUS_PATH, {}),
  readJson(CACHE_PATH, {}),
  readJson(AUDIT_PATH, {}),
  readJson(SELECTION_REPORT_PATH, {}),
  readJson(REFRESH_REPORT_PATH, {}),
  readText(BASELINE_AUDIT_VERIFIED_PATH, "0"),
  readText(BASELINE_CACHE_SHA_PATH, ""),
]);

const currentAuditVerified = Array.isArray(currentAudit?.rows)
  ? currentAudit.rows.filter(
      (row) => row?.verificationSummary?.officialRegistryVerified === true,
    ).length
  : 0;

const currentCacheSha = crypto
  .createHash("sha256")
  .update(await fs.readFile(CACHE_PATH))
  .digest("hex");

const baselineCensusVerified = toNumber(baselineCensus?.bucketCounts?.verified);
const currentCensusVerified = toNumber(currentCensus?.bucketCounts?.verified);
const preGap = toNumber(baselineAuditVerifiedText) - baselineCensusVerified;
const postGap = currentAuditVerified - currentCensusVerified;

const registrySummary = Array.isArray(selectionReport?.registryQuerySummary)
  ? selectionReport.registryQuerySummary
  : [];
const attemptSummary = summarizeBrandAttempts(registrySummary);
const demotionSummary = await updateDemotionState(attemptSummary);

const dnsBlockers = uniqueSorted(
  registrySummary.flatMap((row) =>
    (Array.isArray(row?.warnings) ? row.warnings : [])
      .map(String)
      .filter(hasInfraBlockedWarning),
  ),
);

const unresolvedBlockers = dnsBlockers.length
  ? [
      {
        code: "registry_dns_blocked",
        detail:
          "Registry hosts hit infrastructure or access blockers during registry-first queries.",
        samples: dnsBlockers.slice(0, 8),
      },
    ]
  : [];

const refreshedRows = Array.isArray(refreshReport?.rows) ? refreshReport.rows : [];
const newlyVerifiedSkus = refreshedRows
  .filter((row) => row?.verificationSummary?.officialRegistryVerified === true)
  .map((row) => ({
    brandName: row?.brandName ?? null,
    productName: row?.productName ?? null,
    strongestProgramId: row?.strongestProgramId ?? null,
    strongestProgramLabel: row?.strongestProgramLabel ?? null,
    evidenceRef: row?.evidenceRef ?? row?.officialRegistryEvidenceUrl ?? null,
  }));

const report = {
  schemaVersion: "week2_marks_overnight_loop_report.v1",
  generatedAt: new Date().toISOString(),
  runId: RUN_ID,
  inputs: {
    baselineCensusPath: path.relative(ROOT, BASELINE_CENSUS_PATH),
    registrySelectionPath: path.relative(ROOT, SELECTION_REPORT_PATH),
    refreshReportPath: path.relative(ROOT, REFRESH_REPORT_PATH),
    currentCensusPath: path.relative(ROOT, CURRENT_CENSUS_PATH),
  },
  deltas: {
    cacheEntryCount: {
      before: toNumber(baselineCacheMeta?.entryCount),
      after: toNumber(currentCache?.entryCount),
      delta: toNumber(currentCache?.entryCount) - toNumber(baselineCacheMeta?.entryCount),
    },
    cacheSha256: {
      before: baselineCacheSha,
      after: currentCacheSha,
      changed: baselineCacheSha !== currentCacheSha,
    },
    censusVerifiedHeadline: {
      before: baselineCensusVerified,
      after: currentCensusVerified,
      delta: currentCensusVerified - baselineCensusVerified,
    },
    censusClaimedHeadline: {
      before: toNumber(baselineCensus?.bucketCounts?.claimed),
      after: toNumber(currentCensus?.bucketCounts?.claimed),
      delta:
        toNumber(currentCensus?.bucketCounts?.claimed) -
        toNumber(baselineCensus?.bucketCounts?.claimed),
    },
    registryChecked: {
      before: toNumber(baselineCensus?.summary?.officialRegistryChecked),
      after: toNumber(currentCensus?.summary?.officialRegistryChecked),
      delta:
        toNumber(currentCensus?.summary?.officialRegistryChecked) -
        toNumber(baselineCensus?.summary?.officialRegistryChecked),
    },
  },
  reconciliation: {
    gapBefore: preGap,
    gapAfter: postGap,
    hadGap: preGap > 0,
    fixedThisRun: preGap > 0 && postGap === 0,
    investigation:
      preGap > 0
        ? "Detected stale headline census (verified bucket lagged audit/cache verified rows). Rebuilt Week 2 census against latest cache/audit to reconcile."
        : "No pre-refresh reconciliation gap detected.",
  },
  expansion: {
    registryFirstRowsSelected: toNumber(selectionReport?.selectedCount),
    refreshedRows: toNumber(refreshReport?.refreshedCount),
    ifosNsfBrandAttempts: demotionSummary.runAttemptedBrands.length,
    ifosNsfProgramRowsConsidered: attemptSummary.programRowsConsidered,
    highYieldFilterApplied: true,
    directRegistryEvidencePreferred: true,
  },
  newlyVerifiedSkus,
  unresolvedBlockers,
  demotions: {
    attemptedBrandsThisRun: demotionSummary.runAttemptedBrands,
    infraBlockedBrandsThisRun: demotionSummary.infraBlockedBrandsThisRun,
    eligibleZeroSafeBrandsThisRun: demotionSummary.eligibleZeroSafeBrandsThisRun,
    safeMatchBrandsThisRun: demotionSummary.safeMatchBrandsThisRun,
    newlyDemotedBrands: demotionSummary.newlyDemotedBrands,
    allDemotedBrands: demotionSummary.allDemotedBrands,
    policy:
      "Demote brands after two consecutive zero-safe-match runs with successful registry query completion; infra failures do not count toward zero-safe streak.",
  },
  nextRecommendedAction: unresolvedBlockers.length
    ? "Restore DNS/network access to official registries, then rerun registry-first selection (IFOS+NSF only) and targeted refresh. Infra-blocked runs should not affect demotion streaks."
    : "Proceed to expand IFOS omega and NSF sports pools using registry-first direct evidence, then rerun targeted refresh and census.",
};

await fs.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
await fs.writeFile(MARKDOWN_PATH, `${buildMarkdown(report)}\n`);

console.log(
  JSON.stringify(
    {
      ok: true,
      reportPath: REPORT_PATH,
      markdownPath: MARKDOWN_PATH,
      demotionStatePath: STATE_PATH,
      attemptedBrands: demotionSummary.runAttemptedBrands.length,
      infraBlockedBrands: demotionSummary.infraBlockedBrandsThisRun.length,
      newlyDemotedBrands: demotionSummary.newlyDemotedBrands.length,
    },
    null,
    2,
  ),
);
