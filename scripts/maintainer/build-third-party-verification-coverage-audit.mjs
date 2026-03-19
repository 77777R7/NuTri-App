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

const cachePath = getArg("cache-json", path.join(ROOT, "output", "quality_marks", "quality_mark_cache.json"));
const auditPath = getArg("audit-json", path.join(ROOT, "output", "quality_marks", "quality_mark_audit.json"));
const outJson = getArg(
  "out-json",
  path.join(ROOT, "output", "quality_marks", "third_party_verification_coverage_audit.json"),
);
const outMd = getArg(
  "out-md",
  path.join(ROOT, "output", "quality_marks", "third_party_verification_coverage_audit.md"),
);

const nowIso = () => new Date().toISOString();

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));

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

const topRowsByPredicate = (rows, predicate, limit = 10) =>
  rows
    .filter(predicate)
    .map((row) => ({
      key: row.key,
      brandName: row.brandName ?? null,
      productName: row.productName ?? null,
      barcode: row.barcode_gtin14 ?? null,
      evidenceRef: row.evidenceRef ?? null,
      strongestProgram: row.verificationSummary?.strongestProgramLabel ?? null,
      warnings: row.verificationSummary?.warnings ?? [],
      sourcesTriedCount: Array.isArray(row.sourcesTried) ? row.sourcesTried.length : 0,
    }))
    .slice(0, limit);

const buildMarkdown = (report) => {
  const lines = [];
  lines.push("# Third-Party Verification Coverage Audit");
  lines.push("");
  lines.push(`Generated at: ${report.generatedAt}`);
  lines.push(`Cache source: ${report.input.cachePath}`);
  lines.push(`Audit source: ${report.input.auditPath}`);
  lines.push("");
  lines.push("## Totals");
  lines.push("");
  lines.push(`- total entries: ${report.totals.totalEntries}`);
  lines.push(`- checked entries: ${report.totals.checkedEntries}`);
  lines.push(`- official registry checked: ${report.totals.officialRegistryChecked}`);
  lines.push(`- official registry verified: ${report.totals.officialRegistryVerified}`);
  lines.push(`- product page claim detected: ${report.totals.productPageClaimDetected}`);
  lines.push(`- generic third-party signal detected: ${report.totals.genericThirdPartyClaimDetected}`);
  lines.push(`- brand-level official program signal detected: ${report.totals.brandLevelOfficialProgramDetected}`);
  lines.push("");
  lines.push("## Entry Status");
  lines.push("");
  for (const [key, value] of Object.entries(report.statusCounts)) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("");
  lines.push("## Verification Summary Status");
  lines.push("");
  for (const [key, value] of Object.entries(report.summaryStatusCounts)) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("");
  lines.push("## Strongest Program");
  lines.push("");
  for (const [key, value] of Object.entries(report.strongestProgramCounts)) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("");
  lines.push("## Brand Distribution");
  lines.push("");
  for (const [key, value] of Object.entries(report.brandCounts)) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("");
  lines.push("## Warning Distribution");
  lines.push("");
  for (const [key, value] of Object.entries(report.warningCounts)) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("");
  lines.push("## Program Outcome Matrix");
  lines.push("");
  for (const [programId, statuses] of Object.entries(report.programOutcomeMatrix)) {
    const parts = Object.entries(statuses)
      .map(([status, count]) => `${status}=${count}`)
      .join(", ");
    lines.push(`- ${programId}: ${parts}`);
  }
  lines.push("");
  lines.push("## Key Cohorts");
  lines.push("");
  lines.push(`- ambiguous due to registry block: ${report.cohorts.registryAccessBlocked.length}`);
  lines.push(`- ambiguous due to brand-level-only official match: ${report.cohorts.brandLevelOnly.length}`);
  lines.push(`- claimed but not officially confirmed: ${report.cohorts.claimedButNotVerified.length}`);
  lines.push(`- checked not found in registry: ${report.cohorts.registryCheckedNotFound.length}`);
  lines.push("");
  lines.push("## Sample Rows");
  lines.push("");
  const sections = [
    ["Registry Access Blocked", report.cohorts.registryAccessBlocked],
    ["Brand-Level Only Matches", report.cohorts.brandLevelOnly],
    ["Claimed But Not Verified", report.cohorts.claimedButNotVerified],
    ["Registry Checked Not Found", report.cohorts.registryCheckedNotFound],
  ];
  for (const [title, rows] of sections) {
    lines.push(`### ${title}`);
    lines.push("");
    if (!rows.length) {
      lines.push("- none");
      lines.push("");
      continue;
    }
    for (const row of rows) {
      lines.push(
        `- ${row.brandName ?? "Unknown brand"} | ${row.productName ?? "Unknown product"} | strongest=${row.strongestProgram ?? "none"} | warnings=${row.warnings.join(", ") || "none"} | evidence=${row.evidenceRef ?? "none"}`,
      );
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  const [cachePayload, auditPayload] = await Promise.all([readJson(cachePath), readJson(auditPath)]);
  const rows = Array.isArray(auditPayload?.rows) ? auditPayload.rows : [];
  const entries = Object.values(cachePayload?.entries ?? {});

  const statusCounts = {};
  const summaryStatusCounts = {};
  const strongestProgramCounts = {};
  const warningCounts = {};
  const programOutcomeMatrix = {};
  const brandCounts = {};

  let checkedEntries = 0;
  let officialRegistryChecked = 0;
  let officialRegistryVerified = 0;
  let productPageClaimDetected = 0;
  let genericThirdPartyClaimDetected = 0;
  let brandLevelOfficialProgramDetected = 0;

  for (const entry of entries) {
    increment(statusCounts, entry.status ?? "unknown");
    const parts = String(entry.key ?? "").split(":");
    if (parts.length >= 5) increment(brandCounts, parts[3] || "unknown");
    if (entry.checked) checkedEntries += 1;
    const summary = entry.verificationSummary ?? null;
    if (!summary) continue;
    increment(summaryStatusCounts, summary.overallStatus ?? "none");
    if (summary.strongestProgramLabel) increment(strongestProgramCounts, summary.strongestProgramLabel);
    if (summary.officialRegistryChecked) officialRegistryChecked += 1;
    if (summary.officialRegistryVerified) officialRegistryVerified += 1;
    if (summary.productPageClaimDetected) productPageClaimDetected += 1;
    if (summary.genericThirdPartyClaimDetected) genericThirdPartyClaimDetected += 1;
    if (summary.brandLevelOfficialProgramDetected) brandLevelOfficialProgramDetected += 1;
    for (const warning of summary.warnings ?? []) {
      increment(warningCounts, warning);
    }
    for (const match of entry.programMatches ?? []) {
      programOutcomeMatrix[match.programId] ??= {};
      increment(programOutcomeMatrix[match.programId], match.status);
    }
  }

  const cohorts = {
    registryAccessBlocked: topRowsByPredicate(
      rows,
      (row) => row.verificationSummary?.warnings?.includes("registry_access_blocked"),
    ),
    brandLevelOnly: topRowsByPredicate(
      rows,
      (row) => row.verificationSummary?.warnings?.includes("brand_level_only_match"),
    ),
    claimedButNotVerified: topRowsByPredicate(
      rows,
      (row) =>
        row.verificationSummary?.overallStatus === "claimed" &&
        !row.verificationSummary?.officialRegistryVerified,
    ),
    registryCheckedNotFound: topRowsByPredicate(
      rows,
      (row) => row.verificationSummary?.warnings?.includes("registry_checked_not_found"),
    ),
  };

  const report = {
    schemaVersion: "third_party_verification_coverage_audit.v1",
    generatedAt: nowIso(),
    input: {
      cachePath,
      auditPath,
      cacheUpdatedAt: cachePayload?.updatedAt ?? null,
      auditGeneratedAt: auditPayload?.generatedAt ?? null,
      cacheEntryCount: cachePayload?.entryCount ?? entries.length,
    },
    totals: {
      totalEntries: entries.length,
      checkedEntries,
      officialRegistryChecked,
      officialRegistryVerified,
      productPageClaimDetected,
      genericThirdPartyClaimDetected,
      brandLevelOfficialProgramDetected,
    },
    statusCounts: sortCounts(statusCounts),
    summaryStatusCounts: sortCounts(summaryStatusCounts),
    strongestProgramCounts: sortCounts(strongestProgramCounts),
    brandCounts: sortCounts(brandCounts),
    warningCounts: sortCounts(warningCounts),
    programOutcomeMatrix: Object.fromEntries(
      Object.entries(programOutcomeMatrix).map(([programId, counts]) => [programId, sortCounts(counts)]),
    ),
    cohorts,
  };

  await fs.mkdir(path.dirname(outJson), { recursive: true });
  await Promise.all([
    fs.writeFile(outJson, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
    fs.writeFile(outMd, buildMarkdown(report), "utf8"),
  ]);

  console.log(
    JSON.stringify(
      {
        ok: true,
        outJson,
        outMd,
        totalEntries: report.totals.totalEntries,
        summaryStatusCounts: report.summaryStatusCounts,
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
