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

const asNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeText = (value) => String(value ?? "").trim();
const normalizeToken = (value) =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

const GENERIC_PATTERN = /normal function|day-to-day wellness|general wellness/i;

const dedupeLines = (lines, max = 3) => {
  const out = [];
  const seen = new Set();
  for (const raw of lines) {
    const line = normalizeText(raw);
    if (!line) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
    if (out.length >= max) break;
  }
  return out;
};

const collectSegmentLines = (segments, kind) => {
  const bucket = segments?.[kind]?.en;
  if (!Array.isArray(bucket)) return [];
  return bucket
    .map((row) => ({
      text: normalizeText(row?.text),
      evidenceReferenceId: normalizeText(row?.evidence_reference_id),
      excerptStatus: normalizeText(row?.evidence_excerpt_status).toLowerCase(),
      confidence: asNumber(row?.overall_confidence, 0),
      evidenceGrade: normalizeText(row?.evidence_grade) || null,
      sentenceId: normalizeText(row?.sentence_id) || null,
      source: normalizeText(row?.source) || null,
    }))
    .filter((row) => row.text.length > 0);
};

const summarizeEntrySignals = (entry) => {
  const absorption = collectSegmentLines(entry?.segments, "absorption");
  const solubility = collectSegmentLines(entry?.segments, "solubility");
  const tolerability = collectSegmentLines(entry?.segments, "tolerability");
  const caveats = collectSegmentLines(entry?.segments, "caveats");

  const bestForBullets = dedupeLines([
    ...absorption.map((row) => row.text),
    ...tolerability.map((row) => row.text),
  ], 3).filter((line) => !GENERIC_PATTERN.test(line));

  const formImpactLine = dedupeLines([
    ...absorption.map((row) => row.text),
    ...solubility.map((row) => row.text),
  ], 1)[0] ?? null;

  const beforeYouBuyLine = dedupeLines(caveats.map((row) => row.text), 1)[0] ?? null;

  const evidenceLines = dedupeLines([
    ...absorption.map((row) => row.text),
    ...solubility.map((row) => row.text),
    ...tolerability.map((row) => row.text),
    ...caveats.map((row) => row.text),
  ], 6);

  return {
    bestForBullets,
    formImpactLine,
    beforeYouBuyLine,
    evidenceLines,
    segments: {
      absorption,
      solubility,
      tolerability,
      caveats,
    },
  };
};

const main = async () => {
  const inputPath =
    resolvePath(getArg("input-json"))
    ?? "/Users/howard07/Downloads/nutri_minimal_data_package_v4_0_en_only_review_excerpts.json";

  const minConfidence = Math.max(0, Math.min(1, asNumber(getArg("min-confidence"), 0.6)));
  const runtimeCopyEnabled = !["0", "false", "off"].includes(String(getArg("runtime-copy", "1")).toLowerCase());
  const runtimeCopyPath =
    resolvePath(getArg("runtime-copy-path")) ?? path.join(ROOT_DIR, "data", "kb", "v4_safe_science_subset.json");
  const outDir =
    resolvePath(getArg("out-dir"))
    ?? path.join(
      ROOT_DIR,
      "output",
      `v1.6.14-e-plus-${new Date().toISOString().replace(/[:.]/g, "-")}`,
      "ux",
    );

  await ensureDir(outDir);

  const pkg = await readJson(inputPath);
  const excerpts = Array.isArray(pkg?.evidence_excerpts) ? pkg.evidence_excerpts : [];
  const forms = Array.isArray(pkg?.form_explain_library_top100) ? pkg.form_explain_library_top100 : [];
  const overrides = Array.isArray(pkg?.curated_overrides) ? pkg.curated_overrides : [];

  const excerptByCitation = new Map();
  for (const row of excerpts) {
    const citationId = normalizeText(row?.citation_id);
    if (!citationId) continue;
    excerptByCitation.set(citationId, {
      captureStatus: normalizeText(row?.capture_status).toLowerCase(),
      auditStatus: normalizeText(row?.audit_status).toLowerCase(),
      source: normalizeText(row?.source) || null,
      url: normalizeText(row?.url) || null,
      excerptId: normalizeText(row?.excerpt_id) || null,
    });
  }

  const stats = {
    totalFormEntries: forms.length,
    totalOverrides: overrides.length,
    keptFormEntries: 0,
    keptOverrides: 0,
    rejectedLowConfidence: 0,
    rejectedReviewStatus: 0,
    rejectedEvidenceStatus: 0,
    rejectedNoSignals: 0,
  };

  const entries = [];
  const upsert = (candidate) => {
    const key = `${candidate.ingredient_id}|${candidate.form_key}`;
    const existingIdx = entries.findIndex((row) => `${row.ingredient_id}|${row.form_key}` === key);
    if (existingIdx === -1) {
      entries.push(candidate);
      return;
    }
    const existing = entries[existingIdx];
    const preferCandidate =
      (existing.source_kind !== "curated_override" && candidate.source_kind === "curated_override")
      || candidate.overall_confidence > existing.overall_confidence;
    if (preferCandidate) entries[existingIdx] = candidate;
  };

  const validateLine = (line, entryConfidence) => {
    if (!line?.text) return false;
    if (line.confidence > 0 && line.confidence < minConfidence) return false;
    const confidence = line.confidence > 0 ? line.confidence : entryConfidence;
    if (confidence < minConfidence) return false;
    if (line.excerptStatus !== "captured") return false;
    if (!line.evidenceReferenceId) return false;
    const excerptMeta = excerptByCitation.get(line.evidenceReferenceId);
    if (!excerptMeta) return false;
    if (excerptMeta.captureStatus !== "captured" || excerptMeta.auditStatus !== "verified") return false;
    return true;
  };

  const ingest = ({ row, sourceKind }) => {
    const ingredientId = normalizeToken(row?.ingredient_id);
    const formKey = normalizeToken(row?.form_key);
    if (!ingredientId || !formKey) return;

    const entryConfidence = asNumber(row?.overall_confidence, 0);
    if (entryConfidence < minConfidence) {
      stats.rejectedLowConfidence += 1;
      return;
    }

    if (sourceKind === "curated_override") {
      const reviewStatus = normalizeText(row?.curation?.review_status).toLowerCase();
      if (reviewStatus !== "approved") {
        stats.rejectedReviewStatus += 1;
        return;
      }
    }

    const rawSignals = summarizeEntrySignals(row);
    const filteredSegments = {
      absorption: rawSignals.segments.absorption.filter((line) => validateLine(line, entryConfidence)),
      solubility: rawSignals.segments.solubility.filter((line) => validateLine(line, entryConfidence)),
      tolerability: rawSignals.segments.tolerability.filter((line) => validateLine(line, entryConfidence)),
      caveats: rawSignals.segments.caveats.filter((line) => validateLine(line, entryConfidence)),
    };

    const totalSafeLines =
      filteredSegments.absorption.length
      + filteredSegments.solubility.length
      + filteredSegments.tolerability.length
      + filteredSegments.caveats.length;

    if (totalSafeLines === 0) {
      stats.rejectedEvidenceStatus += 1;
      return;
    }

    const bestForBullets = dedupeLines([
      ...filteredSegments.absorption.map((x) => x.text),
      ...filteredSegments.tolerability.map((x) => x.text),
    ], 3).filter((line) => !GENERIC_PATTERN.test(line));

    const formImpactLine = dedupeLines([
      ...filteredSegments.absorption.map((x) => x.text),
      ...filteredSegments.solubility.map((x) => x.text),
    ], 1)[0] ?? null;

    const beforeYouBuyLine = dedupeLines(filteredSegments.caveats.map((x) => x.text), 1)[0] ?? null;

    if (bestForBullets.length === 0 && !formImpactLine && !beforeYouBuyLine) {
      stats.rejectedNoSignals += 1;
      return;
    }

    if (sourceKind === "curated_override") stats.keptOverrides += 1;
    else stats.keptFormEntries += 1;

    upsert({
      ingredient_id: ingredientId,
      ingredient: normalizeText(row?.ingredient) || null,
      form_key: formKey,
      form_display: normalizeText(row?.form_display) || null,
      form_family: normalizeText(row?.form_family) || null,
      source_kind: sourceKind,
      overall_confidence: entryConfidence,
      evidence_grade: normalizeText(row?.evidence_grade) || null,
      reference_ids: Array.isArray(row?.reference_ids)
        ? row.reference_ids.map((x) => normalizeText(x)).filter(Boolean)
        : [],
      best_for_bullets: bestForBullets,
      form_impact_line: formImpactLine,
      before_you_buy_line: beforeYouBuyLine,
      evidence_lines: dedupeLines([
        ...filteredSegments.absorption.map((x) => x.text),
        ...filteredSegments.solubility.map((x) => x.text),
        ...filteredSegments.tolerability.map((x) => x.text),
        ...filteredSegments.caveats.map((x) => x.text),
      ], 6),
      segments: {
        absorption: filteredSegments.absorption,
        solubility: filteredSegments.solubility,
        tolerability: filteredSegments.tolerability,
        caveats: filteredSegments.caveats,
      },
    });
  };

  for (const row of forms) ingest({ row, sourceKind: "form_library" });
  for (const row of overrides) ingest({ row, sourceKind: "curated_override" });

  const indexByIngredient = {};
  const signalsByIngredient = {};
  for (const entry of entries) {
    if (!indexByIngredient[entry.ingredient_id]) indexByIngredient[entry.ingredient_id] = [];
    indexByIngredient[entry.ingredient_id].push(entry);
  }

  for (const [ingredientId, rows] of Object.entries(indexByIngredient)) {
    rows.sort((a, b) => b.overall_confidence - a.overall_confidence || String(a.form_key).localeCompare(String(b.form_key)));
    const primary = rows[0];
    signalsByIngredient[ingredientId] = {
      ingredient_id: ingredientId,
      ingredient: primary?.ingredient ?? null,
      best_for_bullets: dedupeLines(rows.flatMap((row) => row.best_for_bullets || []), 3),
      form_impact_line:
        rows.map((row) => row.form_impact_line).find((line) => normalizeText(line).length > 0) ?? null,
      before_you_buy_line:
        rows.map((row) => row.before_you_buy_line).find((line) => normalizeText(line).length > 0) ?? null,
      evidence_lines: dedupeLines(rows.flatMap((row) => row.evidence_lines || []), 8),
      max_confidence: Math.max(...rows.map((row) => asNumber(row.overall_confidence, 0))),
      source_tier: "general_science",
    };
  }

  const ingredientCoverage = Object.entries(indexByIngredient)
    .map(([ingredientId, rows]) => ({ ingredient_id: ingredientId, forms: rows.length }))
    .sort((a, b) => b.forms - a.forms || a.ingredient_id.localeCompare(b.ingredient_id));

  const subset = {
    schemaVersion: "v1.6.14-safe-science-subset-1",
    generatedAt: new Date().toISOString(),
    sourcePackagePath: inputPath,
    sourcePackageVersion: normalizeText(pkg?.metadata?.package_version) || null,
    sourcePackageSha256: normalizeText(pkg?.metadata?.package_sha256) || null,
    minConfidence,
    rules: {
      capture_status: "captured",
      audit_status: "verified",
      overall_confidence_min: minConfidence,
      override_review_status: "approved",
    },
    stats,
    entries,
    indexByIngredient,
    signalsByIngredient,
    ingredientCoverage,
  };

  const fitReport = {
    generatedAt: subset.generatedAt,
    inputPath,
    sourcePackageVersion: subset.sourcePackageVersion,
    minConfidence,
    totalFormEntries: stats.totalFormEntries,
    totalOverrides: stats.totalOverrides,
    keptEntries: entries.length,
    keptFormEntries: stats.keptFormEntries,
    keptOverrides: stats.keptOverrides,
    rejected: {
      lowConfidence: stats.rejectedLowConfidence,
      reviewStatus: stats.rejectedReviewStatus,
      evidenceStatus: stats.rejectedEvidenceStatus,
      noSignals: stats.rejectedNoSignals,
    },
    ingredientCoverageCount: ingredientCoverage.length,
    topIngredientsByForms: ingredientCoverage.slice(0, 20),
  };

  await writeJson(path.join(outDir, "v4_safe_science_subset.json"), subset);
  if (runtimeCopyEnabled) {
    await writeJson(runtimeCopyPath, subset);
  }
  await writeJson(path.join(outDir, "v4_package_fit_report.json"), fitReport);
  await writeText(
    path.join(outDir, "v4_package_fit_report.md"),
    [
      "# v4 Package Fit Report",
      "",
      `- inputPath: ${inputPath}`,
      `- sourcePackageVersion: ${fitReport.sourcePackageVersion ?? "unknown"}`,
      `- minConfidence: ${minConfidence}`,
      `- keptEntries: ${fitReport.keptEntries}`,
      `- keptFormEntries: ${fitReport.keptFormEntries}`,
      `- keptOverrides: ${fitReport.keptOverrides}`,
      "",
      "## Rejections",
      `- lowConfidence: ${fitReport.rejected.lowConfidence}`,
      `- reviewStatus: ${fitReport.rejected.reviewStatus}`,
      `- evidenceStatus: ${fitReport.rejected.evidenceStatus}`,
      `- noSignals: ${fitReport.rejected.noSignals}`,
      "",
      `- ingredientCoverageCount: ${fitReport.ingredientCoverageCount}`,
      `- runtimeCopyEnabled: ${runtimeCopyEnabled}`,
      `- runtimeCopyPath: ${runtimeCopyEnabled ? runtimeCopyPath : "disabled"}`,
    ].join("\n") + "\n",
  );

  console.log("[build-v4-safe-science-subset] completed");
  console.log(
    JSON.stringify(
      {
        outDir,
        keptEntries: entries.length,
        ingredientCoverageCount: ingredientCoverage.length,
        runtimeCopyEnabled,
        runtimeCopyPath: runtimeCopyEnabled ? runtimeCopyPath : null,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error("[build-v4-safe-science-subset] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
