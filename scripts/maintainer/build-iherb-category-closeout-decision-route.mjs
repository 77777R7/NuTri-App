#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

import {
  readJson,
  toRelative,
  writeJson,
} from "./lib/iherb-score-category-harness.mjs";

const ROOT = process.cwd();
const TODAY = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const findLatestMatchingDir = async (prefix) => {
  const outputDir = path.join(ROOT, "output");
  const entries = await fs.readdir(outputDir, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => entry.name)
    .sort();
  if (candidates.length === 0) return null;
  return path.join(outputDir, candidates[candidates.length - 1]);
};

const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", `iherb_category_closeout_decision_route_${TODAY}`),
);

const slugify = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const taxonomyMeta = {
  metabolic_glucose_support: {
    priority: "P0",
    rolloutWave: "T1",
    decision: "implement_next",
    recommendedScope: "berberine-led glucose/metabolic support products",
    whyNow: "Already has a repeat cohort once the rescued berberine row is included, and the products are clearly supplement in-scope.",
  },
  sports_anabolic_support: {
    priority: "P1",
    rolloutWave: "T1",
    decision: "implement_next",
    recommendedScope: "ecdysterone / anabolic-support specialty sports products",
    whyNow: "Two rows already cluster here, and forcing them into the current sports amino lane would blur semantics.",
  },
  cholesterol_lipid_support: {
    priority: "P1",
    rolloutWave: "T1",
    decision: "design_now_validate_before_detector",
    recommendedScope: "red yeast rice and similar cholesterol/lipid-support products",
    whyNow: "Semantically clean, but current cohort is only one sample; worth defining before more rows are collected.",
  },
  liver_bile_support: {
    priority: "P2",
    rolloutWave: "T2",
    decision: "hold_for_more_cohort",
    recommendedScope: "TUDCA / hepatic-bile support",
    whyNow: "Valid specialty lane, but too small to justify immediate detector work.",
  },
  cellular_nucleotide_support: {
    priority: "P2",
    rolloutWave: "T2",
    decision: "hold_for_more_cohort",
    recommendedScope: "RNA/DNA and nucleotide support products",
    whyNow: "Concept is real but the current sample count is too low for confident rollout.",
  },
};

const excludeAuditMeta = {
  "143157": {
    auditDecision: "rescue_to_new_taxonomy_candidate",
    reviewedDisposition: "in_scope_specialty_supplement",
    recommendedAction: "move_to_metabolic_glucose_support_candidate_pool",
    rationale: "Berberine is clearly a supplement and should not be excluded; it belongs with the metabolic/glucose-support taxonomy candidate.",
  },
  "133142": {
    auditDecision: "confirm_exclude_out_of_scope",
    reviewedDisposition: "non_supplement_grocery",
    recommendedAction: "exclude_from_deep_category_taxonomy",
    rationale: "Stroopwafels are pantry/grocery food and should stay outside supplement deep-category scope.",
  },
  "329": {
    auditDecision: "confirm_exclude_out_of_scope",
    reviewedDisposition: "non_supplement_food_additive",
    recommendedAction: "exclude_from_deep_category_taxonomy",
    rationale: "Stevia sweetener powder is a grocery/food-additive item rather than a supplement taxonomy target.",
  },
  "117563": {
    auditDecision: "rescue_to_existing_category",
    reviewedDisposition: "in_scope_botanical_supplement",
    recommendedAction: "route_to_botanical_herbal_support",
    rationale: "Capsuled cinnamon is a botanical supplement and should remain in-scope under the existing herbal lane.",
  },
  "70939": {
    auditDecision: "confirm_exclude_out_of_scope",
    reviewedDisposition: "non_supplement_food_additive",
    recommendedAction: "exclude_from_deep_category_taxonomy",
    rationale: "Zero-calorie sweetener is a pantry product, not a supplement deep-category target.",
  },
  "112321": {
    auditDecision: "confirm_exclude_out_of_scope",
    reviewedDisposition: "non_supplement_oral_care_health_aid",
    recommendedAction: "exclude_from_supplement_deep_category_taxonomy",
    rationale: "Dry-mouth melts are an oral-care symptomatic aid, not an ingestible supplement category target.",
  },
  "146636": {
    auditDecision: "confirm_exclude_out_of_scope",
    reviewedDisposition: "non_supplement_grocery",
    recommendedAction: "exclude_from_deep_category_taxonomy",
    rationale: "Sugar cubes are pantry merchandise and should be out of scope.",
  },
  "103143": {
    auditDecision: "confirm_exclude_out_of_scope",
    reviewedDisposition: "non_supplement_seasoning",
    recommendedAction: "exclude_from_deep_category_taxonomy",
    rationale: "Seasoning rub is food prep merchandise, not a supplement.",
  },
  "64889": {
    auditDecision: "confirm_exclude_out_of_scope",
    reviewedDisposition: "non_supplement_functional_food",
    recommendedAction: "exclude_from_deep_category_taxonomy",
    rationale: "Manuka honey is a functional food, but still outside the supplement deep-category taxonomy scope.",
  },
};

const keepPolicyMeta = {
  "151804": {
    backlogLane: "semantic_scope_hold",
    reopenTrigger: "Reopen only if we introduce a dedicated weight-management shakes / meal-replacement taxonomy.",
    rationale: "Hybrid shake/functional-food positioning is too broad for the current supplement taxonomy.",
  },
  "155021": {
    backlogLane: "cohort_wait",
    reopenTrigger: "Reopen if two or more similar pain/inflammation blend products accumulate in the unknown backlog.",
    rationale: "Curaphen is a mixed functional blend and does not yet justify a dedicated lane.",
  },
  "63390": {
    backlogLane: "policy_hold",
    reopenTrigger: "Reopen only if ingestible teas become first-class deep-category targets.",
    rationale: "Wrapped tea bags currently sit outside the main supplement detector design.",
  },
  "4599": {
    backlogLane: "taxonomy_boundary_hold",
    reopenTrigger: "Reopen if we later create a weight/fat-binding or broader metabolic adjunct taxonomy.",
    rationale: "Chitosan is in-scope as a supplement, but current category semantics are still too fuzzy to place it confidently.",
  },
};

const toMarkdown = (payload) => {
  const { summary, taxonomyPlan, excludeReview, keepUnknownPolicy, automationReview } = payload;
  const lines = [];
  lines.push("# iHerb Category Closeout Decision Route");
  lines.push("");
  lines.push("## Baseline");
  lines.push("");
  lines.push(`- unknownCategoryRate: ${summary.unknownCategoryRate}%`);
  lines.push(`- unknownSampleCount: ${summary.unknownSampleCount}`);
  lines.push(`- newTaxonomyCandidates: ${summary.newTaxonomyCandidates}`);
  lines.push(`- excludeNonSupplement: ${summary.excludeNonSupplement}`);
  lines.push(`- keepUnknownForNow: ${summary.keepUnknownForNow}`);
  lines.push("");
  lines.push("## Next Taxonomy");
  lines.push("");
  for (const item of taxonomyPlan.rolloutOrder) {
    lines.push(`- ${item.taxonomyKey}: ${item.priority} / ${item.rolloutWave} / ${item.decision}`);
    lines.push(`  - scope: ${item.recommendedScope}`);
    lines.push(`  - sampleCount: ${item.sampleCount}`);
  }
  lines.push("");
  lines.push("## Exclude Review");
  lines.push("");
  lines.push(`- confirmed_exclude: ${excludeReview.summary.confirmedExclude}`);
  lines.push(`- rescued_to_existing_category: ${excludeReview.summary.rescuedToExistingCategory}`);
  lines.push(`- rescued_to_new_taxonomy_candidate: ${excludeReview.summary.rescuedToNewTaxonomy}`);
  lines.push("");
  lines.push("## Keep Unknown");
  lines.push("");
  for (const bucket of keepUnknownPolicy.buckets) {
    lines.push(`- ${bucket.brandName} / ${bucket.title}`);
    lines.push(`  - lane: ${bucket.backlogLane}`);
    lines.push(`  - reopen: ${bucket.reopenTrigger}`);
  }
  lines.push("");
  lines.push("## Automation Value");
  lines.push("");
  lines.push(`- current_focus_high_value: ${automationReview.summary.highValueNow}`);
  lines.push(`- current_focus_optional: ${automationReview.summary.optionalNow}`);
  lines.push(`- current_focus_low_value: ${automationReview.summary.lowValueNow}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const buildTaxonomyPlan = (rows) => {
  const grouped = new Map();
  for (const row of rows) {
    const key = row.proposedTaxonomyKey;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  const rolloutOrder = [...grouped.entries()]
    .map(([taxonomyKey, members]) => {
      const meta = taxonomyMeta[taxonomyKey] ?? {
        priority: "P2",
        rolloutWave: "T2",
        decision: "hold_for_more_cohort",
        recommendedScope: taxonomyKey,
        whyNow: "No explicit decision metadata found.",
      };
      return {
        taxonomyKey,
        sampleCount: members.length,
        sampleProducts: members.map((row) => ({
          productId: row.productId,
          brandName: row.brandName,
          title: row.title,
        })),
        ...meta,
      };
    })
    .sort((a, b) => {
      const priorityScore = { P0: 0, P1: 1, P2: 2 };
      return (priorityScore[a.priority] ?? 9) - (priorityScore[b.priority] ?? 9)
        || a.rolloutWave.localeCompare(b.rolloutWave)
        || b.sampleCount - a.sampleCount
        || a.taxonomyKey.localeCompare(b.taxonomyKey);
    });

  return {
    schemaVersion: "iherb_category_taxonomy_vnext.v1",
    generatedAt: new Date().toISOString(),
    summary: {
      taxonomyCandidateCount: rows.length,
      uniqueTaxonomyKeys: rolloutOrder.length,
      implementNextCount: rolloutOrder.filter((item) => item.decision === "implement_next").length,
      validateFirstCount: rolloutOrder.filter((item) => item.decision === "design_now_validate_before_detector").length,
      holdCount: rolloutOrder.filter((item) => item.decision === "hold_for_more_cohort").length,
    },
    rolloutOrder,
  };
};

const buildExcludeReview = (rows) => {
  const reviewedRows = rows.map((row) => ({
    ...row,
    ...(excludeAuditMeta[row.productId] ?? {
      auditDecision: "needs_manual_review",
      reviewedDisposition: "unresolved",
      recommendedAction: "manual_review",
      rationale: "No explicit review metadata found.",
    }),
  }));

  return {
    schemaVersion: "iherb_exclude_non_supplement_review.v1",
    generatedAt: new Date().toISOString(),
    summary: {
      reviewedCount: reviewedRows.length,
      confirmedExclude: reviewedRows.filter((row) => row.auditDecision === "confirm_exclude_out_of_scope").length,
      rescuedToExistingCategory: reviewedRows.filter((row) => row.auditDecision === "rescue_to_existing_category").length,
      rescuedToNewTaxonomy: reviewedRows.filter((row) => row.auditDecision === "rescue_to_new_taxonomy_candidate").length,
      unresolved: reviewedRows.filter((row) => row.auditDecision === "needs_manual_review").length,
    },
    reviewedRows,
    outputs: {
      confirmedExcludeSeed: "exclude_non_supplement_confirmed.json",
      rescuedRows: "exclude_non_supplement_rescued.json",
    },
  };
};

const buildKeepUnknownPolicy = (rows) => ({
  schemaVersion: "iherb_keep_unknown_policy.v1",
  generatedAt: new Date().toISOString(),
  summary: {
    backlogCount: rows.length,
    semanticScopeHold: rows.filter((row) => keepPolicyMeta[row.productId]?.backlogLane === "semantic_scope_hold").length,
    cohortWait: rows.filter((row) => keepPolicyMeta[row.productId]?.backlogLane === "cohort_wait").length,
    policyHold: rows.filter((row) => keepPolicyMeta[row.productId]?.backlogLane === "policy_hold").length,
    taxonomyBoundaryHold: rows.filter((row) => keepPolicyMeta[row.productId]?.backlogLane === "taxonomy_boundary_hold").length,
  },
  buckets: rows.map((row) => ({
    ...row,
    ...(keepPolicyMeta[row.productId] ?? {
      backlogLane: "manual_hold",
      reopenTrigger: "Manual review required before reopening.",
      rationale: "No explicit keep policy found.",
    }),
  })),
});

const buildAutomationReview = () => ({
  schemaVersion: "automation_value_review.v1",
  generatedAt: new Date().toISOString(),
  summary: {
    highValueNow: 0,
    optionalNow: 2,
    lowValueNow: 8,
  },
  assessments: [
    {
      automationId: "nutri-coverage-control-tower",
      valueTier: "optional",
      reasoning: "Still useful as a broad monitor, but it is no longer the driver for the current taxonomy closeout work.",
      recommendation: "Keep active only if you still want periodic top-level repo monitoring.",
    },
    {
      automationId: "week2-p0-rescue-executor",
      valueTier: "optional",
      reasoning: "Still has value for the 20k+ iHerb queue, but it is orthogonal to the deep-category closeout lane we just finished.",
      recommendation: "Keep active only if queue rescue should continue in the background.",
    },
    {
      automationId: "week2-marks-loop-00",
      valueTier: "low",
      reasoning: "Third-party tested claim expansion is no longer the main ROI lane for the current project phase.",
      recommendation: "Leave paused.",
    },
    {
      automationId: "week2-marks-loop-30",
      valueTier: "low",
      reasoning: "Duplicate cadence of the same third-party loop adds little value now.",
      recommendation: "Leave paused.",
    },
    {
      automationId: "week2-marks-loop",
      valueTier: "low",
      reasoning: "Legacy variant of the same marks loop and no longer aligned with the current focus.",
      recommendation: "Leave paused.",
    },
    {
      automationId: "dsld-closure-monitor",
      valueTier: "low",
      reasoning: "Legacy DSLD release monitoring is unrelated to the current taxonomy closeout decision work.",
      recommendation: "Leave paused.",
    },
    {
      automationId: "dsld-release-rebackfill-monitor",
      valueTier: "low",
      reasoning: "Legacy DSLD rebackfill monitoring is not creating present value for the current roadmap.",
      recommendation: "Leave paused.",
    },
    {
      automationId: "dsld-scale-50k-monitor",
      valueTier: "low",
      reasoning: "Old DSLD scale monitor; useful historically, not for the current track.",
      recommendation: "Leave paused.",
    },
    {
      automationId: "dsld-scale-scoreable-monitor",
      valueTier: "low",
      reasoning: "Old scoreable DSLD monitor; no longer tied to our active decisions.",
      recommendation: "Leave paused.",
    },
    {
      automationId: "nightly-schedule-archive",
      valueTier: "low",
      reasoning: "Nightly regression archiving is orthogonal to the category/taxonomy closeout lane.",
      recommendation: "Leave paused unless release QA resumes.",
    },
  ],
});

const main = async () => {
  const defaultCloseoutDir =
    getArg("closeout-dir")
    || await findLatestMatchingDir("iherb_unknown_category_closeout_pack_wave7_")
    || path.join(ROOT, "output", `iherb_unknown_category_closeout_pack_wave7_${TODAY}`);

  const [closeout, taxonomyRows, excludeRows, keepRows] = await Promise.all([
    readJson(path.join(defaultCloseoutDir, "unknown_category_closeout_pack.json")),
    readJson(path.join(defaultCloseoutDir, "new_taxonomy_candidates.json")),
    readJson(path.join(defaultCloseoutDir, "exclude_non_supplement_seed.json")),
    readJson(path.join(defaultCloseoutDir, "keep_unknown_backlog.json")),
  ]);

  const excludeReview = buildExcludeReview(Array.isArray(excludeRows) ? excludeRows : []);
  const taxonomyPlan = buildTaxonomyPlan(Array.isArray(taxonomyRows) ? taxonomyRows : []);
  const keepUnknownPolicy = buildKeepUnknownPolicy(Array.isArray(keepRows) ? keepRows : []);
  const automationReview = buildAutomationReview();

  const payload = {
    schemaVersion: "iherb_category_closeout_decision_route.v1",
    generatedAt: new Date().toISOString(),
    inputs: {
      closeoutPackPath: toRelative(path.join(defaultCloseoutDir, "unknown_category_closeout_pack.json")),
      taxonomyCandidatesPath: toRelative(path.join(defaultCloseoutDir, "new_taxonomy_candidates.json")),
      excludeSeedPath: toRelative(path.join(defaultCloseoutDir, "exclude_non_supplement_seed.json")),
      keepUnknownBacklogPath: toRelative(path.join(defaultCloseoutDir, "keep_unknown_backlog.json")),
    },
    summary: closeout.summary,
    taxonomyPlan: {
      summary: taxonomyPlan.summary,
      rolloutOrder: taxonomyPlan.rolloutOrder,
    },
    excludeReview: {
      summary: excludeReview.summary,
      recommendations: {
        confirmedExcludeSeed: "exclude_non_supplement_confirmed.json",
        rescuedRows: "exclude_non_supplement_rescued.json",
      },
    },
    keepUnknownPolicy: {
      summary: keepUnknownPolicy.summary,
      buckets: keepUnknownPolicy.buckets,
    },
    automationReview: {
      summary: automationReview.summary,
      assessments: automationReview.assessments,
    },
  };

  await fs.mkdir(OUT_DIR, { recursive: true });
  await Promise.all([
    writeJson(path.join(OUT_DIR, "category_closeout_decision_route.json"), payload),
    writeJson(path.join(OUT_DIR, "taxonomy_vnext_design.json"), taxonomyPlan),
    writeJson(path.join(OUT_DIR, "exclude_non_supplement_reviewed.json"), excludeReview),
    writeJson(path.join(OUT_DIR, "exclude_non_supplement_confirmed.json"), excludeReview.reviewedRows.filter((row) => row.auditDecision === "confirm_exclude_out_of_scope")),
    writeJson(path.join(OUT_DIR, "exclude_non_supplement_rescued.json"), excludeReview.reviewedRows.filter((row) => row.auditDecision !== "confirm_exclude_out_of_scope")),
    writeJson(path.join(OUT_DIR, "keep_unknown_backlog_policy.json"), keepUnknownPolicy),
    writeJson(path.join(OUT_DIR, "automation_value_review.json"), automationReview),
    fs.writeFile(path.join(OUT_DIR, "category_closeout_decision_route.md"), toMarkdown(payload), "utf8"),
  ]);

  console.log(JSON.stringify({
    ok: true,
    outDir: toRelative(OUT_DIR),
    summary: payload.summary,
    taxonomyPlan: taxonomyPlan.summary,
    excludeReview: excludeReview.summary,
    keepUnknownPolicy: keepUnknownPolicy.summary,
    automationReview: automationReview.summary,
  }, null, 2));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
