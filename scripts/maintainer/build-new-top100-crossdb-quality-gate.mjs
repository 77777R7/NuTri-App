#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";

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

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));

const writeJson = async (filePath, payload) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const writeText = async (filePath, body) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, body, "utf8");
};

const normalizeBrand = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[’'`.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const toSet = (arr) => [...new Set((Array.isArray(arr) ? arr : []).map((v) => String(v ?? "").trim()).filter(Boolean))];

const sourceTypeFromCounts = ({ usCount, caCount, sampleEvidenceCount }) => {
  const out = [];
  if (usCount > 0) out.push("dsld");
  if (caCount > 0) out.push("lnhpd");
  if (sampleEvidenceCount > 0) out.push("web");
  return out;
};

const methodToMatchedBy = (method) => {
  const m = String(method ?? "").trim().toLowerCase();
  if (!m) return "unknown";
  if (m === "direct_text") return "canonical";
  if (m === "title_phrase") return "title_led";
  if (m.includes("fuzzy")) return "fuzzy";
  return m;
};

const riskScoreFor = (row) => {
  let score = 0;
  if (row.isLowCaPresence) score += 2.0;
  if (row.isTitleLedOnly) score += 2.5;
  if (row.sourceCount <= 1) score += 1.5;
  if (row.totalCount <= 2) score += 1.5;
  if (row.totalCount <= 0) score += 2.0;
  if (row.onlyIherb) score += 0.75;
  return Number(score.toFixed(3));
};

const auditLowCa = (row) => {
  const reasons = [];
  let pass = true;

  if (row.totalCount <= 0) {
    pass = false;
    reasons.push("no_crossdb_presence");
  }
  if (row.isTitleLedOnly) {
    pass = false;
    reasons.push("title_led_only_signal");
  }
  if (row.sourceCount <= 1) {
    pass = false;
    reasons.push("single_source_signal");
  }
  if ((row.caCount || 0) === 0) {
    pass = false;
    reasons.push("ca_count_zero");
  }

  return {
    auditPass: pass,
    auditReasons: reasons.length > 0 ? reasons : ["low_ca_but_multi_signal_ok"],
  };
};

const main = async () => {
  const analysisJson =
    resolvePath(getArg("analysis-json"))
    ?? path.join(ROOT_DIR, "output", "v1.6.14-brand-discovery", "new_top100_brands_analysis.json");

  const outDir =
    resolvePath(getArg("out-dir"))
    ?? path.join(ROOT_DIR, "output", `v1.6.14-new-top100-nightly-${new Date().toISOString().replace(/[:.]/g, "-")}`, "phase_a1");

  const payload = await readJson(analysisJson);
  const rows = Array.isArray(payload?.finalBrands) ? payload.finalBrands : [];
  if (rows.length === 0) {
    console.error("[build-new-top100-crossdb-quality-gate] finalBrands empty");
    process.exit(1);
  }

  const seen = new Set();
  let duplicateCount = 0;

  const normalizedRows = rows.map((row, idx) => {
    const brandName = String(row?.display ?? row?.key ?? "").trim() || `unknown_brand_${idx + 1}`;
    const brandNorm = normalizeBrand(brandName);
    const dupeKey = brandNorm;
    if (seen.has(dupeKey)) duplicateCount += 1;
    seen.add(dupeKey);

    const usCount = Number(row?.usCount ?? 0) || 0;
    const caCount = Number(row?.caCount ?? 0) || 0;
    const totalCount = Number(row?.totalCount ?? usCount + caCount) || 0;
    const sourceSet = toSet(row?.sourceSet);
    const sourceCount = sourceSet.length;
    const sampleEvidence = Array.isArray(row?.sampleEvidence) ? row.sampleEvidence : [];

    const matchedBy = toSet(sampleEvidence.map((e) => methodToMatchedBy(e?.method)));
    const matchedTerm = toSet(sampleEvidence.map((e) => e?.evidence)).slice(0, 8);
    const sourceType = sourceTypeFromCounts({ usCount, caCount, sampleEvidenceCount: sampleEvidence.length });

    const isTitleLedOnly = sampleEvidence.length > 0
      ? sampleEvidence.every((e) => String(e?.method ?? "").toLowerCase() === "title_phrase")
      : false;
    const isLowCaPresence = caCount <= 2;
    const onlyIherb = sourceSet.length > 0 && sourceSet.every((src) => ["iherb", "iherb_ca"].includes(String(src).toLowerCase()));

    const tmp = {
      brandName,
      brandNorm,
      usCount,
      caCount,
      totalCount,
      matchedBy,
      matchedTerm,
      sourceType,
      sourceSet,
      sourceCount,
      isTitleLedOnly,
      isLowCaPresence,
      onlyIherb,
      sampleEvidence,
      execution_eligible: true,
    };

    const riskScore = riskScoreFor(tmp);
    const suspectedFalseHit =
      totalCount <= 0
      || (isTitleLedOnly && sourceCount <= 1)
      || (isLowCaPresence && sourceCount <= 1 && totalCount < 5);

    return {
      ...tmp,
      riskScore,
      suspectedFalseHit,
      execution_eligible: !suspectedFalseHit,
    };
  });

  const lowCaWatchlist = normalizedRows
    .filter((row) => row.isLowCaPresence)
    .map((row) => {
      const audit = auditLowCa(row);
      return {
        brandName: row.brandName,
        brandNorm: row.brandNorm,
        usCount: row.usCount,
        caCount: row.caCount,
        totalCount: row.totalCount,
        sourceCount: row.sourceCount,
        sourceSet: row.sourceSet,
        isTitleLedOnly: row.isTitleLedOnly,
        riskScore: row.riskScore,
        suspectedFalseHit: row.suspectedFalseHit,
        execution_eligible: audit.auditPass,
        auditPass: audit.auditPass,
        auditReasons: audit.auditReasons,
      };
    })
    .sort((a, b) => b.riskScore - a.riskScore || a.brandName.localeCompare(b.brandName));

  const watchlistAuditedCount = lowCaWatchlist.length;
  const lowCaAuditPassCount = lowCaWatchlist.filter((row) => row.auditPass).length;
  const lowCaBlockedCount = lowCaWatchlist.length - lowCaAuditPassCount;

  const riskSpotCheck = lowCaWatchlist.slice(0, 5).map((row, idx) => ({
    rank: idx + 1,
    brandName: row.brandName,
    riskScore: row.riskScore,
    evidence: {
      sourceCount: row.sourceCount,
      sourceSet: row.sourceSet,
      isTitleLedOnly: row.isTitleLedOnly,
      usCount: row.usCount,
      caCount: row.caCount,
    },
    recommendation: row.auditPass ? "tier2_only_if_needed" : "block_from_execution_slice",
  }));

  const invalidForExecution = normalizedRows
    .filter((row) => !row.execution_eligible)
    .map((row) => ({
      brandName: row.brandName,
      brandNorm: row.brandNorm,
      reasonCode: row.suspectedFalseHit ? "suspected_false_hit" : "quality_gate_failed",
      owner: "top100-quality-lane",
      status: "open",
      execution_eligible: false,
    }));

  const gatePass =
    normalizedRows.length === 100
    && duplicateCount === 0
    && watchlistAuditedCount === lowCaWatchlist.length;

  const qualityReport = {
    generatedAt: new Date().toISOString(),
    inputs: {
      analysisJson,
    },
    summary: {
      brandCount: normalizedRows.length,
      duplicateCount,
      lowCaWatchlistCount: lowCaWatchlist.length,
      lowCaAuditPassCount,
      lowCaBlockedCount,
      executionEligibleCount: normalizedRows.filter((row) => row.execution_eligible).length,
      executionIneligibleCount: normalizedRows.filter((row) => !row.execution_eligible).length,
      gatePass,
    },
    rows: normalizedRows.map((row) => ({
      brandName: row.brandName,
      brandNorm: row.brandNorm,
      usCount: row.usCount,
      caCount: row.caCount,
      totalCount: row.totalCount,
      matchedBy: row.matchedBy,
      matchedTerm: row.matchedTerm,
      sourceType: row.sourceType,
      sourceSet: row.sourceSet,
      sourceCount: row.sourceCount,
      isTitleLedOnly: row.isTitleLedOnly,
      isLowCaPresence: row.isLowCaPresence,
      onlyIherb: row.onlyIherb,
      riskScore: row.riskScore,
      suspectedFalseHit: row.suspectedFalseHit,
      execution_eligible: row.execution_eligible,
    })),
    spotCheck: riskSpotCheck,
    invalidForExecution,
    gates: {
      requiredBrandCount: 100,
      requiredDuplicateCount: 0,
      watchlistAudited: true,
      pass: gatePass,
    },
  };

  const watchlistReport = {
    generatedAt: qualityReport.generatedAt,
    summary: {
      lowCaWatchlistCount: lowCaWatchlist.length,
      lowCaAuditPassCount,
      lowCaBlockedCount,
    },
    rows: lowCaWatchlist,
    spotCheck: riskSpotCheck,
  };

  await writeJson(path.join(outDir, "new_top100_crossdb_quality_gate.json"), qualityReport);
  await writeJson(path.join(outDir, "low_ca_presence_watchlist.json"), watchlistReport);

  await writeText(
    path.join(outDir, "new_top100_crossdb_quality_gate.md"),
    [
      "# New Top100 Cross-DB Quality Gate",
      "",
      `- pass: ${gatePass}`,
      `- brandCount: ${qualityReport.summary.brandCount}`,
      `- duplicateCount: ${qualityReport.summary.duplicateCount}`,
      `- lowCaWatchlistCount: ${qualityReport.summary.lowCaWatchlistCount}`,
      `- lowCaAuditPassCount: ${qualityReport.summary.lowCaAuditPassCount}`,
      `- lowCaBlockedCount: ${qualityReport.summary.lowCaBlockedCount}`,
      `- executionEligibleCount: ${qualityReport.summary.executionEligibleCount}`,
      `- executionIneligibleCount: ${qualityReport.summary.executionIneligibleCount}`,
      "",
      "## Risk Spot-Check (Top 5)",
      ...riskSpotCheck.map((row) =>
        `- #${row.rank} ${row.brandName}: riskScore=${row.riskScore}, recommendation=${row.recommendation}`),
    ].join("\n") + "\n",
  );

  await writeText(
    path.join(outDir, "low_ca_presence_watchlist.md"),
    [
      "# Low CA Presence Watchlist",
      "",
      `- total: ${lowCaWatchlist.length}`,
      `- auditPass: ${lowCaAuditPassCount}`,
      `- blocked: ${lowCaBlockedCount}`,
      "",
      ...lowCaWatchlist.slice(0, 25).map((row) =>
        `- ${row.brandName}: ca=${row.caCount}, total=${row.totalCount}, auditPass=${row.auditPass}, reasons=${row.auditReasons.join(", ")}`),
    ].join("\n") + "\n",
  );

  console.log("[build-new-top100-crossdb-quality-gate] completed");
  console.log(JSON.stringify({
    outDir,
    gatePass,
    brandCount: qualityReport.summary.brandCount,
    lowCaWatchlistCount: qualityReport.summary.lowCaWatchlistCount,
  }, null, 2));
};

main().catch((error) => {
  console.error("[build-new-top100-crossdb-quality-gate] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
