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

const demoMdPath = getArg("demo-md");
const tracePath = getArg("trace");
const outDir = getArg("out-dir", path.join(ROOT, "output", "demo"));

if (!demoMdPath || !tracePath) {
  console.error("Usage: node scripts/maintainer/lint-demo-ui-example.mjs --demo-md <path> --trace <path>");
  process.exit(1);
}

const readJson = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const readText = async (p) => String(await fs.readFile(p, "utf8"));

const has = (text, pattern) => pattern.test(text);
const linesBetween = (text, startHeading, endHeading) => {
  const escapedStart = startHeading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedEnd = endHeading ? endHeading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : null;
  const pattern = escapedEnd
    ? new RegExp(`${escapedStart}([\\s\\S]*?)${escapedEnd}`, "i")
    : new RegExp(`${escapedStart}([\\s\\S]*)$`, "i");
  const match = text.match(pattern);
  if (!match) return [];
  return match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.replace(/^-+\s*/, "").trim());
};

const main = async () => {
  await fs.mkdir(outDir, { recursive: true });
  const [md, trace] = await Promise.all([readText(demoMdPath), readJson(tracePath)]);
  const issues = [];

  const requiredHeadings = [
    "## 0) Nutri Score Card v2",
    "## 1) Product Overview",
    "## 2) Science & Ingredients",
    "## 3) Practical Usage",
    "## 4) Safety & Tips",
    "### Source strip",
    "### Best for",
    "### What this product provides (verified)",
    "### Missing info (single CTA)",
    "### Verified ingredient snapshot (names only)",
    "### Form matters (two forms, no confusion)",
    "### NIH ODS (general science, short)",
    "### AI summary (buying explanation, 3 sentences)",
    "### Directions (from label / record)",
    "### Timing tip (general)",
    "### Conservative guidance (general)",
    "### Label warnings (product-specific)",
    "### Upper limit (NIH ODS, general)",
    "### General watch-outs (general)",
    "### Data status",
    "### Third-party quality mark (Integrity helper)",
  ];
  for (const heading of requiredHeadings) {
    if (!md.includes(heading)) {
      issues.push({
        type: "structure",
        severity: "high",
        message: `Missing required heading: ${heading}`,
      });
    }
  }

  const v2ModuleHeadings = [
    "### Ingredient Safety",
    "### Formula Transparency",
    "### Label Clarity (Directions & Warnings)",
    "### Manufacturing Standards",
    "### Testing & Verification",
    "### Product Quality Signals",
  ];
  for (const heading of v2ModuleHeadings) {
    if (!md.includes(heading)) {
      issues.push({
        type: "scorecard_v2_structure",
        severity: "high",
        message: `Missing scorecard module heading: ${heading}`,
      });
    }
  }

  const scorecardSectionText = linesBetween(md, "## 0) Nutri Score Card v2", "## 1) Product Overview").join(" ");
  if (!/\b(Verified|Detected|Not verified|Not shown)\b/i.test(scorecardSectionText)) {
    issues.push({
      type: "scorecard_v2_structure",
      severity: "high",
      message: "Nutri Score Card v2 must include checklist chip states (Verified/Detected/Not verified/Not shown).",
    });
  }
  if (/✅|⛔|◻/.test(scorecardSectionText)) {
    issues.push({
      type: "scorecard_v2_semantics",
      severity: "high",
      message: "Nutri Score Card v2 should not render emoji checklist symbols.",
    });
  }
  if (/overlay_iherb/i.test(md)) {
    issues.push({
      type: "source_tier_semantics",
      severity: "high",
      message: "User-facing demo text must not expose raw source tier token overlay_iherb.",
    });
  }
  if (!/\bOverall band:\s*(Excellent|Strong|Good|Fair|Limited|Weak)\b/i.test(scorecardSectionText)) {
    issues.push({
      type: "scorecard_v2_structure",
      severity: "high",
      message: "Nutri Score Card v2 must include a valid overall band label.",
    });
  }
  const moduleBandMatches = scorecardSectionText.match(/\bBand:\s*(High|Moderate|Limited|Low)\b/gi) ?? [];
  if (moduleBandMatches.length < 6) {
    issues.push({
      type: "scorecard_v2_structure",
      severity: "high",
      message: "Each v2 module must include a valid module band label.",
    });
  }
  if (/Directions are not included in the official record|Please use the bottle's Directions panel|Serving cue \(verified\)/i.test(scorecardSectionText)) {
    issues.push({
      type: "scorecard_scope",
      severity: "high",
      message: "Score card should include checklist labels only, not full directions text.",
    });
  }

  const bestForLines = linesBetween(md, "### Best for", "### What this product provides (verified)");
  const hasBestFor = bestForLines.some((line) => /^Best for:/i.test(line));
  const hasGoodIf = bestForLines.some((line) => /^Good if you want:/i.test(line));
  const hasNotIdeal = bestForLines.some((line) => /^Not ideal if:/i.test(line));
  if (!hasBestFor || !hasGoodIf || !hasNotIdeal) {
    issues.push({
      type: "best_for_completeness",
      severity: "high",
      message: "Best for section must include Best for / Good if you want / Not ideal if.",
    });
  }

  const aiSummaryLines = linesBetween(md, "### AI summary (buying explanation, 3 sentences)", "## 3) Practical Usage");
  if (aiSummaryLines.length !== 3) {
    issues.push({
      type: "ai_summary_contract",
      severity: "high",
      message: `AI summary must contain exactly 3 bullet lines, found ${aiSummaryLines.length}.`,
    });
  } else {
    if (!/^Often used (to support|for)\b/i.test(aiSummaryLines[0])) {
      issues.push({
        type: "ai_summary_contract",
        severity: "high",
        message: "AI summary sentence 1 must be the general-use sentence.",
      });
    }
    if (!/^This product provides\b/i.test(aiSummaryLines[1]) || !/\bbut\b/i.test(aiSummaryLines[1])) {
      issues.push({
        type: "ai_summary_contract",
        severity: "high",
        message: "AI summary sentence 2 must be provide + comparability status.",
      });
    }
    if (!/^Main limitation:/i.test(aiSummaryLines[2]) || !/\bNext step:/i.test(aiSummaryLines[2])) {
      issues.push({
        type: "ai_summary_contract",
        severity: "high",
        message: "AI summary sentence 3 must be limitation + single next step.",
      });
    }
  }

  const providesText = linesBetween(md, "### What this product provides (verified)", "### Missing info (single CTA)").join(" ");
  const scienceText = linesBetween(md, "## 2) Science & Ingredients", "## 3) Practical Usage").join(" ");
  const usageText = linesBetween(md, "## 3) Practical Usage", "## 4) Safety & Tips").join(" ");
  const safetyText = linesBetween(md, "## 4) Safety & Tips", null).join(" ");

  const scienceDoseMatches = scienceText.match(/\b\d+(\.\d+)?\s*(mg|mcg|iu|g)\b/gi) ?? [];
  if (scienceDoseMatches.length > 1) {
    issues.push({
      type: "redundancy",
      severity: "high",
      message: "Science block repeats numeric dose information more than once.",
    });
  }
  const nonUsageBullets = [
    ...linesBetween(md, "### What this product provides (verified)", "### Missing info (single CTA)"),
    ...linesBetween(md, "## 2) Science & Ingredients", "## 3) Practical Usage"),
    ...linesBetween(md, "## 4) Safety & Tips", null),
  ];
  if (
    nonUsageBullets.some((line) =>
      /^(Directions are not included in the official record|Source:\s*scanned_label|Serving cue \(verified\))/i.test(
        line,
      ),
    )
  ) {
    issues.push({
      type: "redundancy",
      severity: "high",
      message: "Directions content should appear only in Practical Usage.",
    });
  }
  const missingInfoMentions = (md.match(/Missing info \(single CTA\)|To improve accuracy:/gi) ?? []).length;
  if (missingInfoMentions < 2) {
    issues.push({
      type: "structure",
      severity: "high",
      message: "Missing info block and CTA must appear in Overview.",
    });
  }
  if (/To improve accuracy:/i.test(scienceText) || /To improve accuracy:/i.test(usageText) || /To improve accuracy:/i.test(safetyText)) {
    issues.push({
      type: "redundancy",
      severity: "high",
      message: "Missing-info CTA must only appear in Overview.",
    });
  }

  const directionsAdded = trace?.sampleSelection?.directions_added === true;
  const hasDirectionsMissing = /directions are not included in the official record|directions missing/i.test(usageText);
  const hasScannedLabelSource = /source:\s*scanned_label\s*\(patched\)/i.test(usageText);
  if (directionsAdded && hasScannedLabelSource && hasDirectionsMissing) {
    issues.push({
      type: "contradiction",
      severity: "high",
      message: "Directions show scanned_label source but still claim directions are missing.",
    });
  }

  if (has(md, /dosage form:.*(ubiquinol|ubiquinone).*ingredient form \(chemical\):.*softgel/i)) {
    issues.push({
      type: "form_confusion",
      severity: "high",
      message: "Dosage form and ingredient chemical form appear swapped.",
    });
  }

  if (has(md, /\bsafe\b|\beffective\b|\bworks?\b|\bcures?\b|\btreats?\b/i)) {
    issues.push({
      type: "forbidden_terms",
      severity: "high",
      message: "Medical-claim wording detected (safe/effective/works/cures/treats).",
    });
  }
  if (has(md, /normal function|day-to-day wellness|general wellness/i)) {
    issues.push({
      type: "fluff_terms",
      severity: "high",
      message: "Fluff terms detected in demo copy.",
    });
  }

  const qualitySummary = trace?.qualityMarkAuditSummary ?? {};
  const qualityEvidenceRef = String(qualitySummary?.evidenceRef ?? "");
  const qualitySearchOnly = qualitySummary?.checkedMode === "search_only" ||
    qualitySummary?.evidenceType === "search" ||
    /duckduckgo\.com\/html\/\?q=/i.test(qualityEvidenceRef);
  if (qualitySearchOnly && !/Status:\s*unknown \(search-only evidence; no verified mark page\/image found yet\)/i.test(md)) {
    issues.push({
      type: "quality_mark_semantics",
      severity: "high",
      message: "Search-only quality-mark evidence must be rendered as unknown(search-only evidence...).",
    });
  }

  const scoredV2Items = Array.isArray(trace?.nutriScoreCardV2?.modules)
    ? trace.nutriScoreCardV2.modules.flatMap((module) =>
        Array.isArray(module?.checklist)
          ? module.checklist.filter((item) => item?.scoreEligible !== false)
          : [],
      )
    : [];
  const overlayClaimKnownCount = scoredV2Items.filter((item) =>
    item?.evidenceStrength === "overlay_claim" && item?.state !== "unknown"
  ).length;
  const knownScoredCount = scoredV2Items.filter((item) => item?.state !== "unknown").length;
  const overlayDominant = knownScoredCount > 0 && (overlayClaimKnownCount / knownScoredCount) >= 0.7;
  const confidencePct = Number(trace?.nutriScoreCardV2?.confidencePct ?? 0);
  if (overlayDominant && confidencePct >= 100) {
    issues.push({
      type: "confidence_semantics",
      severity: "high",
      message: "Confidence cannot be 100 when score evidence is dominated by overlay claims.",
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    ok: issues.filter((item) => item.severity === "high").length === 0,
    demoMdPath,
    tracePath,
    issueCount: issues.length,
    issues,
  };
  const outJson = path.join(outDir, "ux_demo_lint_report.json");
  const outMd = path.join(outDir, "ux_demo_lint_report.md");
  await fs.writeFile(outJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const lines = [
    "# UX Demo Lint Report",
    "",
    `- status: ${report.ok ? "pass" : "fail"}`,
    `- issue_count: ${report.issueCount}`,
    `- demo: ${demoMdPath}`,
    `- trace: ${tracePath}`,
    "",
    "## Findings",
    ...(
      issues.length > 0
        ? issues.map((item, idx) => `${idx + 1}. [${item.severity}] ${item.type}: ${item.message}`)
        : ["1. No lint findings."]
    ),
  ];
  await fs.writeFile(outMd, `${lines.join("\n")}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        ok: report.ok,
        output: {
          json: outJson,
          md: outMd,
        },
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
