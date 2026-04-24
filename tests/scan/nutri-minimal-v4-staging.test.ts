import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  buildFamilyExpansionBacklog,
  buildFullFamilyProductizationManifest,
  buildFormTaxonomyStaging,
  buildP0ExpansionSectionPlanDrafts,
  buildP0ExpansionWave,
  buildPromptGroundingReviewQueue,
  buildScientificEvidenceCandidateRegistry,
  normalizeWorkbookPackage,
  reviewScientificEvidenceCandidateRegistry,
  selectApprovedPromptGroundingRows,
  type ExistingCandidateQuery,
  type RawWorkbookPackage,
  DEFAULT_SCIENTIFIC_LANE_CONFIG,
} from "../../backend/src/staging/nutriMinimalV4";
import { buildReviewedFormExplainOverridesFromPromptGroundingRows } from "../../backend/scripts/promote-nutri-minimal-v4-prompt-grounding";

const baseWorkbook = (): RawWorkbookPackage => ({
  metadata: {
    package_version: "v4.0",
    generated_at: "2026-04-23T00:00:00Z",
    source_workbook: "/tmp/nutri.xlsx",
  },
  sheets: {
    Ingredients: [
      {
        ingredient_id: "vitamin_b12",
        ingredient: "Vitamin B12",
        category: "vitamin",
        forms_count: 1,
        evidence_count: 1,
        refs_count: 2,
      },
      {
        ingredient_id: "vitamin_b6",
        ingredient: "Vitamin B6",
        category: "vitamin",
        forms_count: 1,
        evidence_count: 1,
        refs_count: 1,
      },
      {
        ingredient_id: "magnesium",
        ingredient: "Magnesium",
        category: "mineral",
        forms_count: 2,
        evidence_count: 1,
        refs_count: 2,
      },
      {
        ingredient_id: "protein",
        ingredient: "Protein",
        category: "nutrient",
        forms_count: 1,
        evidence_count: 1,
        refs_count: 1,
      },
      {
        ingredient_id: "same",
        ingredient: "SAMe",
        category: "other",
        forms_count: 1,
        evidence_count: 1,
        refs_count: 1,
      },
    ],
    Forms: [
      {
        ingredient_id: "magnesium",
        form_key: "citrate",
        form_display: "Magnesium Citrate",
        reference_ids: "ref_pmid_magnesium",
      },
    ],
    Evidence: [
      {
        ingredient_id: "magnesium",
        goal: "sleep_stress",
        reference_ids: "ref_pmid_magnesium;ref_search_magnesium",
      },
      {
        ingredient_id: "vitamin_b12",
        goal: "energy_performance",
        reference_ids: "ref_search_b12",
      },
      {
        ingredient_id: "vitamin_b6",
        goal: "energy_performance",
        reference_ids: "",
      },
    ],
    Citations: [
      {
        id: "ref_pmid_magnesium",
        type: "pmid",
        identifier: "2407766",
        source: "PubMed",
        url: "https://pubmed.ncbi.nlm.nih.gov/2407766/",
        audit_status: "needs_review",
        link_status: "resolved",
        resolution_priority: 1,
      },
      {
        id: "ref_search_magnesium",
        type: "pubmed_search",
        identifier: null,
        source: "PubMed",
        url: "https://pubmed.ncbi.nlm.nih.gov/?term=magnesium%20bioavailability%20humans",
        audit_status: "needs_review",
        link_status: "search",
        resolution_priority: 2,
      },
      {
        id: "ref_search_b12",
        type: "pubmed_search",
        identifier: null,
        source: "PubMed",
        url: "https://pubmed.ncbi.nlm.nih.gov/?term=vitamin%20b12%20supplementation",
        audit_status: "needs_review",
        link_status: "search",
        resolution_priority: 1,
      },
    ],
    FormAliases: [
      {
        applies_to_ingredient_id: null,
        maps_to_form_key: null,
        token_raw: "oxide",
        token_normalized: "oxide",
        alias_confidence: 0.8,
        notes: "Generic form token",
      },
      {
        applies_to_ingredient_id: "magnesium",
        maps_to_form_key: "bisglycinate",
        token_raw: "bis-glycinate",
        token_normalized: "bisglycinate",
        alias_confidence: 0.9,
        notes: "Ingredient-specific alias",
      },
      {
        applies_to_ingredient_id: null,
        maps_to_form_key: null,
        token_raw: "x",
        token_normalized: "x",
        alias_confidence: 0.2,
        notes: "Too short",
      },
    ],
    NormalizationRules: [
      {
        rule_id: "NR1",
        pattern: "\\bbis[- ]?glycinate\\b",
        replacement: "bisglycinate",
        description: "Normalize bisglycinate",
      },
    ],
    CoverageReport: [
      {
        ingredient_id: "magnesium",
        forms_count: 2,
        refs_total: 2,
        refs_verified: 1,
        evidence_rows: 1,
        gap_flag_low_identity: false,
        gap_flag_premium_low_factor_conf: false,
        gap_flag_high_search_refs: true,
      },
      {
        ingredient_id: "protein",
        forms_count: 1,
        refs_total: 1,
        refs_verified: 0,
        evidence_rows: 1,
        gap_flag_low_identity: false,
        gap_flag_premium_low_factor_conf: false,
        gap_flag_high_search_refs: true,
      },
    ],
    EvidenceExcerpts: [
      {
        excerpt_id: "ex_good",
        citation_id: "ref_pmid_magnesium",
        capture_status: "captured",
        excerpt_text:
          "Magnesium citrate and magnesium oxide have different oral bioavailability profiles.",
      },
      {
        excerpt_id: "ex_bad",
        citation_id: "ref_search_b12",
        capture_status: "needs_capture",
        excerpt_text: null,
      },
    ],
    CuratedOverrides_v4: [
      {
        override_id: "ov_good",
        ingredient_id: "magnesium",
        form_key: "citrate",
        absorption_en:
          "Magnesium citrate is a disclosed organic salt form used for comparison-safe label reading.",
        tolerability_en: "Tolerance can vary across formulas.",
        solubility_en: "Solubility differs by form.",
        caveats_en: "Evidence is context-dependent.",
      },
      {
        override_id: "ov_bad",
        ingredient_id: "magnesium",
        form_key: "oxide",
        absorption_en:
          "This is the best absorbed form and treats deficiency fast.",
        tolerability_en: null,
        solubility_en: null,
        caveats_en: null,
      },
    ],
  },
});

const existingQueries: ExistingCandidateQuery[] = [
  {
    family: "magnesium",
    lane: "form_and_tolerability_context",
    variant_key: null,
    query: "magnesium citrate oxide bioavailability humans",
    priority: "P0",
    selection_notes: ["Prefer human oral comparison studies."],
  },
  {
    family: "b12",
    lane: "deficiency_and_supplementation_context",
    variant_key: null,
    query: "vitamin B12 supplementation deficiency humans",
    priority: "P0",
    selection_notes: ["Prefer supplementation-context evidence."],
  },
];

test("family backlog crosswalk keeps mapped, backlog-only, and unresolved buckets separate", () => {
  const normalized = normalizeWorkbookPackage(baseWorkbook());
  const backlog = buildFamilyExpansionBacklog(normalized);

  const b12 = backlog.find((row) => row.source_ingredient_id === "vitamin_b12");
  const protein = backlog.find((row) => row.source_ingredient_id === "protein");
  const same = backlog.find((row) => row.source_ingredient_id === "same");

  assert.equal(b12?.mapped_family, "b12");
  assert.equal(b12?.mapping_status, "mapped_existing_family");
  assert.equal(protein?.mapped_family, "protein");
  assert.match(
    (protein?.coverage_gap_flags ?? []).join(" "),
    /backlog_only_runtime_family/,
  );
  assert.equal(same?.mapped_family, "same");
  assert.equal(same?.mapping_status, "mapped_existing_family");
});

test("full-family productization manifest closes all remaining candidates with explicit safety tiers", () => {
  const normalized = normalizeWorkbookPackage(baseWorkbook());
  const backlog = buildFamilyExpansionBacklog(normalized);
  const manifest = buildFullFamilyProductizationManifest(normalized, backlog);

  assert.equal(manifest.summary.input_rows, 1);
  assert.equal(manifest.summary.crosswalk_rescue, 1);
  assert.equal(manifest.summary.productized_runtime_families, 1);
  const same = manifest.full_family_productization_manifest.find(
    (row) => row.source_ingredient_id === "same",
  );
  assert.equal(same?.canonical_family, "same");
  assert.equal(same?.closure_decision, "rescue_to_canonical_runtime_family");
  assert.equal(same?.safety_boundary_tier, "high");
  assert.match(same?.hard_boundary ?? "", /Hard boundary/i);
});

test("generated full-family productization manifest closes the 85 plus 10 backlog with review statuses", () => {
  const manifestPath =
    "backend/data/staging/nutri-minimal-v4/full-family-productization-manifest.json";
  assert.ok(fs.existsSync(manifestPath), "manifest artifact should exist");

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
    summary: Record<string, number>;
    full_family_productization_manifest: Array<Record<string, unknown>>;
  };
  const rows = manifest.full_family_productization_manifest;
  const decisions = rows.reduce<Record<string, number>>((acc, row) => {
    const decision = String(row.closure_decision);
    acc[decision] = (acc[decision] ?? 0) + 1;
    return acc;
  }, {});
  const reviewStatuses = rows.reduce<Record<string, number>>((acc, row) => {
    const status = String(row.evidence_review_status);
    acc[status] = (acc[status] ?? 0) + 1;
    return acc;
  }, {});

  assert.equal(rows.length, 95);
  assert.equal(decisions.productize_runtime_family, 85);
  assert.equal(decisions.rescue_to_canonical_runtime_family, 10);
  assert.equal(manifest.summary.rejected_from_runtime_productization, 0);
  assert.equal(
    Object.values(reviewStatuses).reduce((sum, count) => sum + count, 0),
    95,
  );
  assert.ok((reviewStatuses.approved ?? 0) > 0);
  assert.ok((reviewStatuses.needs_edit ?? 0) > 0);
  assert.ok((reviewStatuses.rejected ?? 0) > 0);

  for (const row of rows) {
    const family = String(row.canonical_family);
    assert.ok(
      Object.keys(DEFAULT_SCIENTIFIC_LANE_CONFIG[family] ?? {}).length,
      `${family} should have section-plan lane coverage`,
    );
  }
});

test("form taxonomy staging derives parsing sheets and filters inadmissible generic tokens", () => {
  const normalized = normalizeWorkbookPackage(baseWorkbook());
  const staging = buildFormTaxonomyStaging(normalized);

  assert.equal(staging.sheets.form_aliases.length, 1);
  assert.equal(staging.sheets.token_aliases.length, 2);
  assert.ok(
    staging.sheets.generic_form_tokens.some(
      (row) => row.token_normalized === "oxide",
    ),
  );
  assert.ok(
    staging.sheets.generic_form_tokens.some(
      (row) => row.token_normalized === "bisglycinate",
    ),
  );
  assert.equal(staging.rejected_aliases[0]?.token_raw, "x");
});

test("scientific candidate registry only emits configured runtime lanes and sends backlog-only families to stubs", () => {
  const normalized = normalizeWorkbookPackage(baseWorkbook());
  const backlog = buildFamilyExpansionBacklog(normalized);
  const registry = buildScientificEvidenceCandidateRegistry(
    normalized,
    backlog,
    DEFAULT_SCIENTIFIC_LANE_CONFIG,
    existingQueries,
  );

  assert.ok(
    registry.scientific_evidence_candidate_registry.some(
      (row) =>
        row.family === "magnesium" &&
        row.lane === "form_and_tolerability_context",
    ),
  );
  assert.ok(
    registry.scientific_evidence_candidate_registry.some(
      (row) =>
        row.family === "b12" &&
        row.lane === "deficiency_and_supplementation_context",
    ),
  );
  assert.ok(
    registry.backlog_lane_stubs.some(
      (row) =>
        row.source_ingredient_id === "protein" &&
        row.review_reasons.includes("backlog_only_runtime_family"),
    ),
  );
});

test("scientific review gate approves rows with verified review/human evidence and rejects search-only rows without resolved PMID support", async () => {
  const normalized = normalizeWorkbookPackage(baseWorkbook());
  const backlog = buildFamilyExpansionBacklog(normalized);
  const registry = buildScientificEvidenceCandidateRegistry(
    normalized,
    backlog,
    DEFAULT_SCIENTIFIC_LANE_CONFIG,
    existingQueries,
  );

  const reviewed = await reviewScientificEvidenceCandidateRegistry(
    registry,
    async ({ row }) => {
      if (
        row.family === "magnesium" &&
        row.lane === "form_and_tolerability_context"
      ) {
        return {
          query_used: row.query,
          verified_pmids: [
            {
              pmid: "2407766",
              title:
                "Magnesium bioavailability from magnesium citrate and magnesium oxide.",
              pubdate: "1990 Feb",
              pubtype: ["Clinical Trial", "Journal Article", "Review"],
              url: "https://pubmed.ncbi.nlm.nih.gov/2407766/",
            },
            {
              pmid: "11550076",
              title:
                "Bioavailability and pharmacokinetics of magnesium after administration of magnesium salts to humans.",
              pubdate: "2001 Sep-Oct",
              pubtype: ["Review", "Journal Article"],
              url: "https://pubmed.ncbi.nlm.nih.gov/11550076/",
            },
          ],
        };
      }
      return {
        query_used: row.query,
        verified_pmids: [],
      };
    },
  );

  const magnesium = reviewed.scientific_evidence_candidate_registry.find(
    (row) =>
      row.family === "magnesium" &&
      row.lane === "form_and_tolerability_context",
  );
  const b12 = reviewed.scientific_evidence_candidate_registry.find(
    (row) =>
      row.family === "b12" &&
      row.lane === "deficiency_and_supplementation_context",
  );

  assert.equal(magnesium?.review_status, "approved");
  assert.ok(magnesium?.review_reasons.includes("approved_with_verified_pmids"));
  assert.equal(b12?.review_status, "rejected");
  assert.ok(
    b12?.review_reasons.includes("only_search_url_without_resolved_source"),
  );
});

test("scientific review gate degrades a reviewer exception into a row-level non-approved status instead of aborting the whole batch", async () => {
  const normalized = normalizeWorkbookPackage(baseWorkbook());
  const backlog = buildFamilyExpansionBacklog(normalized);
  const registry = buildScientificEvidenceCandidateRegistry(
    normalized,
    backlog,
    DEFAULT_SCIENTIFIC_LANE_CONFIG,
    existingQueries,
  );

  const reviewed = await reviewScientificEvidenceCandidateRegistry(
    registry,
    async ({ row }) => {
      if (row.family === "magnesium") {
        throw new Error("timeout");
      }
      return {
        query_used: row.query,
        verified_pmids: [],
      };
    },
  );

  const magnesium = reviewed.scientific_evidence_candidate_registry.find(
    (row) =>
      row.family === "magnesium" &&
      row.lane === "form_and_tolerability_context",
  );

  assert.ok(magnesium);
  assert.notEqual(magnesium?.review_status, "approved");
});

test("lane-specific manual PMID seeds are injected for iron, vitamin c, and zinc boundary-support lanes", () => {
  const workbook = baseWorkbook();
  workbook.sheets.Ingredients.push(
    {
      ingredient_id: "iron",
      ingredient: "Iron",
      category: "mineral",
      forms_count: 2,
      evidence_count: 1,
      refs_count: 2,
    },
    {
      ingredient_id: "vitamin_c",
      ingredient: "Vitamin C",
      category: "vitamin",
      forms_count: 1,
      evidence_count: 1,
      refs_count: 1,
    },
    {
      ingredient_id: "zinc",
      ingredient: "Zinc",
      category: "mineral",
      forms_count: 1,
      evidence_count: 1,
      refs_count: 1,
    },
  );
  workbook.sheets.Evidence.push(
    { ingredient_id: "iron", goal: "energy_performance", reference_ids: "" },
    { ingredient_id: "vitamin_c", goal: "beauty", reference_ids: "" },
    { ingredient_id: "zinc", goal: "beauty", reference_ids: "" },
  );

  const normalized = normalizeWorkbookPackage(workbook);
  const backlog = buildFamilyExpansionBacklog(normalized);
  const registry = buildScientificEvidenceCandidateRegistry(
    normalized,
    backlog,
    DEFAULT_SCIENTIFIC_LANE_CONFIG,
    existingQueries,
  );

  const ironLane = registry.scientific_evidence_candidate_registry.find(
    (row) =>
      row.family === "iron" && row.lane === "form_and_tolerability_context",
  );
  const vitaminCLane = registry.scientific_evidence_candidate_registry.find(
    (row) =>
      row.family === "vitamin_c" && row.lane === "collagen_and_tissue_support",
  );
  const zincLane = registry.scientific_evidence_candidate_registry.find(
    (row) => row.family === "zinc" && row.lane === "skin_and_barrier_research",
  );

  assert.ok(
    ironLane?.seed_citations.some(
      (citation) => citation.identifier === "PMID:15743016",
    ),
  );
  assert.ok(
    vitaminCLane?.seed_citations.some(
      (citation) => citation.identifier === "PMID:28805671",
    ),
  );
  assert.ok(
    vitaminCLane?.seed_citations.some(
      (citation) => citation.identifier === "PMID:27852613",
    ),
  );
  assert.ok(
    zincLane?.seed_citations.some(
      (citation) => citation.identifier === "PMID:29439479",
    ),
  );
  assert.match(vitaminCLane?.query ?? "", /wound healing|skin health/i);
  assert.match(zincLane?.query ?? "", /dermatology|wound healing|acne/i);
});

test("p0 expansion wave picks balanced new-family candidates and emits implementation-ready lane stubs", () => {
  const workbook: RawWorkbookPackage = {
    metadata: {
      package_version: "v4.0",
      generated_at: "2026-04-23T00:00:00Z",
      source_workbook: "/tmp/nutri.xlsx",
    },
    sheets: {
      Ingredients: [
        {
          ingredient_id: "hawthorn_extract",
          ingredient: "Hawthorn Extract",
          category: "botanical",
          forms_count: 4,
          evidence_count: 3,
          refs_count: 10,
          synonyms: "Crataegus; Hawthorn extract",
        },
        {
          ingredient_id: "schisandra",
          ingredient: "Schisandra",
          category: "botanical",
          forms_count: 4,
          evidence_count: 3,
          refs_count: 8,
          synonyms: "Schisandra chinensis; Schisandra extract",
        },
        {
          ingredient_id: "holy_basil",
          ingredient: "Holy Basil",
          category: "botanical",
          forms_count: 4,
          evidence_count: 3,
          refs_count: 6,
          synonyms: "Ocimum tenuiflorum; Holy basil extract",
        },
        {
          ingredient_id: "weak_candidate",
          ingredient: "Weak Candidate",
          category: "botanical",
          forms_count: 3,
          evidence_count: 3,
          refs_count: 4,
        },
      ],
      Forms: [
        {
          ingredient_id: "hawthorn_extract",
          form_key: "standardized_extract",
          form_display: "Standardized hawthorn extract",
        },
        {
          ingredient_id: "schisandra",
          form_key: "standardized_extract",
          form_display: "Standardized schisandra extract",
        },
        {
          ingredient_id: "holy_basil",
          form_key: "standardized_extract",
          form_display: "Standardized holy basil extract",
        },
      ],
      Evidence: [],
      Citations: [],
      FormAliases: [],
      NormalizationRules: [],
      CoverageReport: [
        {
          ingredient_id: "hawthorn_extract",
          refs_verified: 3,
        },
        {
          ingredient_id: "schisandra",
          refs_verified: 2,
          gap_flag_high_search_refs: true,
        },
        {
          ingredient_id: "holy_basil",
          refs_verified: 2,
          gap_flag_high_search_refs: true,
        },
        {
          ingredient_id: "weak_candidate",
          refs_verified: 0,
          gap_flag_high_search_refs: true,
        },
      ],
      EvidenceExcerpts: [],
      CuratedOverrides_v4: [],
    },
  };

  const normalized = normalizeWorkbookPackage(workbook);
  const backlog = buildFamilyExpansionBacklog(normalized);
  const wave = buildP0ExpansionWave(normalized, backlog, 2);

  assert.equal(wave.p0_expansion_wave.length, 2);
  assert.deepEqual(
    new Set(wave.p0_expansion_wave.map((row) => row.source_ingredient_id)),
    new Set(["hawthorn_extract", "schisandra"]),
  );
  const hawthorn = wave.p0_expansion_wave.find(
    (row) => row.source_ingredient_id === "hawthorn_extract",
  );
  const milkThistle = wave.p0_expansion_wave.find(
    (row) => row.source_ingredient_id === "schisandra",
  );
  assert.ok(
    hawthorn?.pattern_keywords.includes("Standardized hawthorn extract"),
  );
  assert.equal(
    hawthorn?.scientific_background_lanes[0]?.lane_key,
    "primary_use_context",
  );
  assert.equal(
    milkThistle?.scientific_background_lanes[1]?.lane_key,
    "extract_standardization_context",
  );
});

test("p0 expansion section-plan drafts emit buildSectionPlan-style args with family-aware bullet themes", () => {
  const workbook: RawWorkbookPackage = {
    metadata: {
      package_version: "v4.0",
      generated_at: "2026-04-23T00:00:00Z",
      source_workbook: "/tmp/nutri.xlsx",
    },
    sheets: {
      Ingredients: [
        {
          ingredient_id: "hawthorn_extract",
          ingredient: "Hawthorn Extract",
          category: "botanical",
          forms_count: 4,
          evidence_count: 3,
          refs_count: 10,
          synonyms: "Crataegus; Hawthorn extract",
        },
        {
          ingredient_id: "schisandra",
          ingredient: "Schisandra",
          category: "botanical",
          forms_count: 4,
          evidence_count: 3,
          refs_count: 6,
          synonyms: "Schisandra chinensis; Schisandra extract",
        },
      ],
      Forms: [
        {
          ingredient_id: "hawthorn_extract",
          form_key: "standardized_extract",
          form_display: "Standardized hawthorn extract",
        },
        {
          ingredient_id: "schisandra",
          form_key: "standardized_extract",
          form_display: "Standardized schisandra extract",
        },
      ],
      Evidence: [],
      Citations: [],
      FormAliases: [],
      NormalizationRules: [],
      CoverageReport: [
        {
          ingredient_id: "hawthorn_extract",
          refs_verified: 3,
        },
        {
          ingredient_id: "schisandra",
          refs_verified: 2,
          gap_flag_high_search_refs: true,
        },
      ],
      EvidenceExcerpts: [],
      CuratedOverrides_v4: [],
    },
  };

  const normalized = normalizeWorkbookPackage(workbook);
  const backlog = buildFamilyExpansionBacklog(normalized);
  const drafts = buildP0ExpansionSectionPlanDrafts(normalized, backlog, 2);
  const hawthorn = drafts.p0_expansion_section_plan_drafts.find(
    (row) => row.family === "hawthorn_extract",
  );
  const milkThistle = drafts.p0_expansion_section_plan_drafts.find(
    (row) => row.family === "schisandra",
  );

  assert.equal(drafts.p0_expansion_section_plan_drafts.length, 2);
  assert.equal(
    hawthorn?.section_plan_args[0]?.headingId,
    "primary_use_context",
  );
  assert.equal(hawthorn?.section_plan_args[0]?.bulletThemes.length, 3);
  assert.match(
    hawthorn?.section_plan_args[1]?.bulletThemes[0] ?? "",
    /Standardized hawthorn extract|Crataegus/i,
  );
  assert.equal(
    milkThistle?.section_plan_args[1]?.headingId,
    "extract_standardization_context",
  );
  assert.match(
    milkThistle?.section_plan_args[1]?.bulletThemes[0] ?? "",
    /Standardized schisandra extract|Schisandra chinensis/i,
  );
});

test("promoted runtime-family batch maps into canonical families before remaining backlog expansion", () => {
  const workbook = baseWorkbook();
  workbook.sheets.Ingredients.push(
    {
      ingredient_id: "quercetin",
      ingredient: "Quercetin",
      category: "botanical",
      forms_count: 3,
      evidence_count: 2,
      refs_count: 4,
    },
    {
      ingredient_id: "vitamin_e",
      ingredient: "Vitamin E",
      category: "vitamin",
      forms_count: 3,
      evidence_count: 2,
      refs_count: 4,
    },
    {
      ingredient_id: "vitamin_k2",
      ingredient: "Vitamin K2",
      category: "vitamin",
      forms_count: 3,
      evidence_count: 2,
      refs_count: 4,
    },
    {
      ingredient_id: "chromium",
      ingredient: "Chromium",
      category: "mineral",
      forms_count: 2,
      evidence_count: 2,
      refs_count: 4,
    },
    {
      ingredient_id: "selenium",
      ingredient: "Selenium",
      category: "mineral",
      forms_count: 2,
      evidence_count: 2,
      refs_count: 4,
    },
    {
      ingredient_id: "vitamin_a",
      ingredient: "Vitamin A",
      category: "vitamin",
      forms_count: 3,
      evidence_count: 2,
      refs_count: 4,
    },
    {
      ingredient_id: "dgl_licorice",
      ingredient: "DGL Licorice",
      category: "botanical",
      forms_count: 2,
      evidence_count: 2,
      refs_count: 4,
    },
    {
      ingredient_id: "kava",
      ingredient: "Kava",
      category: "botanical",
      forms_count: 3,
      evidence_count: 2,
      refs_count: 4,
    },
    {
      ingredient_id: "slippery_elm",
      ingredient: "Slippery Elm",
      category: "botanical",
      forms_count: 2,
      evidence_count: 2,
      refs_count: 4,
    },
    {
      ingredient_id: "glutathione",
      ingredient: "Glutathione",
      category: "other",
      forms_count: 3,
      evidence_count: 2,
      refs_count: 4,
    },
    {
      ingredient_id: "alpha_lipoic_acid",
      ingredient: "Alpha-Lipoic Acid",
      category: "other",
      forms_count: 3,
      evidence_count: 2,
      refs_count: 4,
    },
    {
      ingredient_id: "biotin",
      ingredient: "Biotin",
      category: "vitamin",
      forms_count: 2,
      evidence_count: 2,
      refs_count: 4,
    },
    {
      ingredient_id: "copper",
      ingredient: "Copper",
      category: "mineral",
      forms_count: 2,
      evidence_count: 2,
      refs_count: 4,
    },
    {
      ingredient_id: "riboflavin",
      ingredient: "Riboflavin",
      category: "vitamin",
      forms_count: 2,
      evidence_count: 2,
      refs_count: 4,
    },
    {
      ingredient_id: "aloe_vera",
      ingredient: "Aloe Vera",
      category: "botanical",
      forms_count: 3,
      evidence_count: 2,
      refs_count: 4,
    },
    {
      ingredient_id: "l_arginine",
      ingredient: "L-Arginine",
      category: "amino_acid",
      forms_count: 3,
      evidence_count: 2,
      refs_count: 4,
    },
    {
      ingredient_id: "l_ornithine",
      ingredient: "L-Ornithine",
      category: "amino_acid",
      forms_count: 3,
      evidence_count: 2,
      refs_count: 4,
    },
    {
      ingredient_id: "molybdenum",
      ingredient: "Molybdenum",
      category: "mineral",
      forms_count: 3,
      evidence_count: 2,
      refs_count: 4,
    },
    {
      ingredient_id: "iodine",
      ingredient: "Iodine",
      category: "mineral",
      forms_count: 3,
      evidence_count: 2,
      refs_count: 4,
    },
    {
      ingredient_id: "papain",
      ingredient: "Papain",
      category: "enzyme",
      forms_count: 3,
      evidence_count: 2,
      refs_count: 4,
    },
    {
      ingredient_id: "passionflower",
      ingredient: "Passionflower",
      category: "botanical",
      forms_count: 3,
      evidence_count: 2,
      refs_count: 4,
    },
    {
      ingredient_id: "st_john_s_wort",
      ingredient: "St. John's Wort",
      category: "botanical",
      forms_count: 3,
      evidence_count: 2,
      refs_count: 4,
    },
    {
      ingredient_id: "lavender",
      ingredient: "Lavender",
      category: "botanical",
      forms_count: 3,
      evidence_count: 2,
      refs_count: 4,
    },
    {
      ingredient_id: "lemon_balm",
      ingredient: "Lemon balm",
      category: "botanical",
      forms_count: 3,
      evidence_count: 2,
      refs_count: 4,
    },
    {
      ingredient_id: "pantothenic_acid",
      ingredient: "Pantothenic Acid",
      category: "vitamin",
      forms_count: 3,
      evidence_count: 2,
      refs_count: 4,
    },
    {
      ingredient_id: "niacin",
      ingredient: "Niacin",
      category: "vitamin",
      forms_count: 2,
      evidence_count: 2,
      refs_count: 4,
    },
    {
      ingredient_id: "garlic_extract",
      ingredient: "Garlic Extract",
      category: "botanical",
      forms_count: 3,
      evidence_count: 3,
      refs_count: 5,
    },
    {
      ingredient_id: "ginger_root",
      ingredient: "Ginger Root",
      category: "botanical",
      forms_count: 3,
      evidence_count: 3,
      refs_count: 5,
    },
    {
      ingredient_id: "olive_leaf_extract",
      ingredient: "Olive Leaf Extract",
      category: "botanical",
      forms_count: 3,
      evidence_count: 3,
      refs_count: 5,
    },
    {
      ingredient_id: "pygeum",
      ingredient: "Pygeum",
      category: "botanical",
      forms_count: 3,
      evidence_count: 3,
      refs_count: 5,
    },
    {
      ingredient_id: "resveratrol",
      ingredient: "Resveratrol",
      category: "other",
      forms_count: 3,
      evidence_count: 3,
      refs_count: 5,
    },
    {
      ingredient_id: "gaba",
      ingredient: "GABA",
      category: "other",
      forms_count: 3,
      evidence_count: 3,
      refs_count: 5,
    },
    {
      ingredient_id: "msm",
      ingredient: "MSM",
      category: "other",
      forms_count: 3,
      evidence_count: 3,
      refs_count: 5,
    },
    {
      ingredient_id: "zeaxanthin",
      ingredient: "Zeaxanthin",
      category: "other",
      forms_count: 3,
      evidence_count: 3,
      refs_count: 5,
    },
    {
      ingredient_id: "red_yeast_rice",
      ingredient: "Red Yeast Rice",
      category: "botanical",
      forms_count: 3,
      evidence_count: 3,
      refs_count: 5,
    },
    {
      ingredient_id: "royal_jelly",
      ingredient: "Royal Jelly",
      category: "botanical",
      forms_count: 3,
      evidence_count: 3,
      refs_count: 5,
    },
    {
      ingredient_id: "saffron_extract",
      ingredient: "Saffron Extract",
      category: "botanical",
      forms_count: 3,
      evidence_count: 3,
      refs_count: 5,
    },
    {
      ingredient_id: "tribulus_terrestris",
      ingredient: "Tribulus Terrestris",
      category: "botanical",
      forms_count: 3,
      evidence_count: 3,
      refs_count: 5,
    },
    {
      ingredient_id: "turkey_tail_mushroom",
      ingredient: "Turkey Tail Mushroom",
      category: "botanical",
      forms_count: 3,
      evidence_count: 3,
      refs_count: 5,
    },
    {
      ingredient_id: "milk_thistle",
      ingredient: "Milk Thistle",
      category: "botanical",
      forms_count: 3,
      evidence_count: 3,
      refs_count: 5,
    },
  );

  const normalized = normalizeWorkbookPackage(workbook);
  const backlog = buildFamilyExpansionBacklog(normalized);
  const mapped = new Map(
    backlog.map((row) => [row.source_ingredient_id, row] as const),
  );

  assert.equal(mapped.get("quercetin")?.mapped_family, "quercetin");
  assert.equal(mapped.get("vitamin_e")?.mapped_family, "vitamin_e");
  assert.equal(mapped.get("vitamin_k2")?.mapped_family, "vitamin_k2");
  assert.equal(mapped.get("chromium")?.mapped_family, "chromium");
  assert.equal(mapped.get("selenium")?.mapped_family, "selenium");
  assert.equal(mapped.get("vitamin_a")?.mapped_family, "vitamin_a");
  assert.equal(mapped.get("dgl_licorice")?.mapped_family, "dgl_licorice");
  assert.equal(mapped.get("kava")?.mapped_family, "kava");
  assert.equal(mapped.get("slippery_elm")?.mapped_family, "slippery_elm");
  assert.equal(mapped.get("glutathione")?.mapped_family, "glutathione");
  assert.equal(
    mapped.get("alpha_lipoic_acid")?.mapped_family,
    "alpha_lipoic_acid",
  );
  assert.equal(mapped.get("biotin")?.mapped_family, "biotin");
  assert.equal(mapped.get("copper")?.mapped_family, "copper");
  assert.equal(mapped.get("riboflavin")?.mapped_family, "riboflavin");
  assert.equal(mapped.get("aloe_vera")?.mapped_family, "aloe_vera");
  assert.equal(mapped.get("l_arginine")?.mapped_family, "l_arginine");
  assert.equal(mapped.get("l_ornithine")?.mapped_family, "l_ornithine");
  assert.equal(mapped.get("molybdenum")?.mapped_family, "molybdenum");
  assert.equal(mapped.get("iodine")?.mapped_family, "iodine");
  assert.equal(mapped.get("papain")?.mapped_family, "papain");
  assert.equal(mapped.get("passionflower")?.mapped_family, "passionflower");
  assert.equal(mapped.get("st_john_s_wort")?.mapped_family, "st_john_s_wort");
  assert.equal(mapped.get("lavender")?.mapped_family, "lavender");
  assert.equal(mapped.get("lemon_balm")?.mapped_family, "lemon_balm");
  assert.equal(
    mapped.get("pantothenic_acid")?.mapped_family,
    "pantothenic_acid",
  );
  assert.equal(mapped.get("niacin")?.mapped_family, "b3_niacinamide");
  assert.equal(mapped.get("garlic_extract")?.mapped_family, "garlic_extract");
  assert.equal(mapped.get("ginger_root")?.mapped_family, "ginger_root");
  assert.equal(
    mapped.get("olive_leaf_extract")?.mapped_family,
    "olive_leaf_extract",
  );
  assert.equal(mapped.get("pygeum")?.mapped_family, "pygeum");
  assert.equal(mapped.get("resveratrol")?.mapped_family, "resveratrol");
  assert.equal(mapped.get("gaba")?.mapped_family, "gaba");
  assert.equal(mapped.get("msm")?.mapped_family, "msm");
  assert.equal(mapped.get("zeaxanthin")?.mapped_family, "zeaxanthin");
  assert.equal(mapped.get("red_yeast_rice")?.mapped_family, "red_yeast_rice");
  assert.equal(mapped.get("royal_jelly")?.mapped_family, "royal_jelly");
  assert.equal(mapped.get("saffron_extract")?.mapped_family, "saffron_extract");
  assert.equal(
    mapped.get("tribulus_terrestris")?.mapped_family,
    "tribulus_terrestris",
  );
  assert.equal(
    mapped.get("turkey_tail_mushroom")?.mapped_family,
    "turkey_tail_mushroom",
  );
  assert.equal(mapped.get("milk_thistle")?.mapped_family, "milk_thistle");
  assert.equal(mapped.get("niacin")?.mapping_status, "mapped_existing_family");
});

test("p1 expansion wave starts from remaining new-family backlog without promoting runtime truth", () => {
  const raw = fs.readFileSync(
    new URL(
      "../../backend/data/staging/nutri-minimal-v4/p1-expansion-wave.json",
      import.meta.url,
    ),
    "utf8",
  );
  const wave = JSON.parse(raw) as {
    meta: { p0_expansion_rows_remaining: number; target_count: number };
    p1_expansion_wave: Array<{
      source_ingredient_id: string;
      implementation_priority: string;
      safety_boundary_tier: string;
      proposed_runtime_lanes: string[];
      review_gate: string;
    }>;
  };

  assert.equal(wave.meta.p0_expansion_rows_remaining, 0);
  assert.equal(wave.meta.target_count, 15);
  assert.deepEqual(
    wave.p1_expansion_wave.slice(0, 6).map((row) => row.source_ingredient_id),
    [
      "boswellia",
      "bacopa_monnieri",
      "bilberry",
      "elderberry",
      "echinacea",
      "cranberry_extract",
    ],
  );
  assert.ok(
    wave.p1_expansion_wave.every(
      (row) =>
        row.implementation_priority === "P1" &&
        row.proposed_runtime_lanes.length >= 3 &&
        /LSR ncbi-entrez required/i.test(row.review_gate),
    ),
  );
  assert.equal(
    wave.p1_expansion_wave.find(
      (row) => row.source_ingredient_id === "bitter_melon",
    )?.safety_boundary_tier,
    "high",
  );
});

test("manual PMID seeds stabilize calcium coformulation and folate form-labeling lanes", () => {
  const workbook = baseWorkbook();
  workbook.sheets.Ingredients.push(
    {
      ingredient_id: "calcium",
      ingredient: "Calcium",
      category: "mineral",
      forms_count: 2,
      evidence_count: 1,
      refs_count: 1,
    },
    {
      ingredient_id: "folate",
      ingredient: "Folate",
      category: "vitamin",
      forms_count: 2,
      evidence_count: 1,
      refs_count: 1,
    },
  );
  workbook.sheets.Evidence.push(
    { ingredient_id: "calcium", goal: "bone", reference_ids: "" },
    { ingredient_id: "folate", goal: "womens_health", reference_ids: "" },
  );

  const normalized = normalizeWorkbookPackage(workbook);
  const backlog = buildFamilyExpansionBacklog(normalized);
  const registry = buildScientificEvidenceCandidateRegistry(
    normalized,
    backlog,
    DEFAULT_SCIENTIFIC_LANE_CONFIG,
    existingQueries,
  );

  const calciumLane = registry.scientific_evidence_candidate_registry.find(
    (row) =>
      row.family === "calcium" &&
      row.lane === "how_coformulation_changes_comparison",
  );
  const folateLane = registry.scientific_evidence_candidate_registry.find(
    (row) =>
      row.family === "folate" && row.lane === "what_form_labeling_changes",
  );

  assert.ok(
    calciumLane?.seed_citations.some(
      (citation) => citation.identifier === "PMID:29279934",
    ),
  );
  assert.ok(
    folateLane?.seed_citations.some(
      (citation) => citation.identifier === "PMID:30010385",
    ),
  );
  assert.match(calciumLane?.query ?? "", /vitamin D|bone mineral density/i);
  assert.match(folateLane?.query ?? "", /methylfolate|5-MTHF/i);
});

test("manual PMID seeds stabilize remaining low-support P1 lanes for b6, melatonin, and vitamin d", () => {
  const workbook = baseWorkbook();
  workbook.sheets.Ingredients.push(
    {
      ingredient_id: "vitamin_d",
      ingredient: "Vitamin D",
      category: "vitamin",
      forms_count: 1,
      evidence_count: 1,
      refs_count: 1,
    },
    {
      ingredient_id: "melatonin",
      ingredient: "Melatonin",
      category: "other",
      forms_count: 1,
      evidence_count: 1,
      refs_count: 1,
    },
  );
  workbook.sheets.Evidence.push(
    { ingredient_id: "vitamin_d", goal: "bone", reference_ids: "" },
    { ingredient_id: "melatonin", goal: "sleep_stress", reference_ids: "" },
  );

  const normalized = normalizeWorkbookPackage(workbook);
  const backlog = buildFamilyExpansionBacklog(normalized);
  const registry = buildScientificEvidenceCandidateRegistry(
    normalized,
    backlog,
    DEFAULT_SCIENTIFIC_LANE_CONFIG,
    existingQueries,
  );

  const b6Lane = registry.scientific_evidence_candidate_registry.find(
    (row) => row.family === "b6" && row.lane === "why_dose_context_matters",
  );
  const melatoninLane = registry.scientific_evidence_candidate_registry.find(
    (row) =>
      row.family === "melatonin" &&
      row.lane === "what_dose_and_use_context_can_change",
  );
  const vitaminDLane = registry.scientific_evidence_candidate_registry.find(
    (row) =>
      row.family === "vitamin_d" &&
      row.lane === "what_interpretation_depends_on",
  );

  assert.ok(
    b6Lane?.seed_citations.some(
      (citation) => citation.identifier === "PMID:33376337",
    ),
  );
  assert.ok(
    melatoninLane?.seed_citations.some(
      (citation) => citation.identifier === "PMID:38888087",
    ),
  );
  assert.ok(
    melatoninLane?.seed_citations.some(
      (citation) => citation.identifier === "PMID:33962317",
    ),
  );
  assert.ok(
    vitaminDLane?.seed_citations.some(
      (citation) => citation.identifier === "PMID:30313003",
    ),
  );
  assert.ok(
    vitaminDLane?.seed_citations.some(
      (citation) => citation.identifier === "PMID:34520402",
    ),
  );
  assert.match(b6Lane?.query ?? "", /dose|safety|neuropathy/i);
  assert.match(melatoninLane?.query ?? "", /dose|timing|extended-release/i);
  assert.match(
    vitaminDLane?.query ?? "",
    /baseline status|25\(OH\)D|dose|supplementation/i,
  );
});

test("prefer_config lanes override stale reviewed candidate queries when the lane config is marked authoritative", () => {
  const workbook = baseWorkbook();
  workbook.sheets.Ingredients.push({
    ingredient_id: "zinc",
    ingredient: "Zinc",
    category: "mineral",
    forms_count: 1,
    evidence_count: 1,
    refs_count: 1,
  });
  workbook.sheets.Evidence.push({
    ingredient_id: "zinc",
    goal: "beauty",
    reference_ids: "",
  });

  const normalized = normalizeWorkbookPackage(workbook);
  const backlog = buildFamilyExpansionBacklog(normalized);
  const registry = buildScientificEvidenceCandidateRegistry(
    normalized,
    backlog,
    DEFAULT_SCIENTIFIC_LANE_CONFIG,
    [
      ...existingQueries,
      {
        family: "zinc",
        lane: "skin_and_barrier_research",
        variant_key: null,
        query: "zinc testosterone randomized trial",
        priority: "P1",
        selection_notes: ["stale query"],
      },
    ],
  );

  const zincLane = registry.scientific_evidence_candidate_registry.find(
    (row) => row.family === "zinc" && row.lane === "skin_and_barrier_research",
  );

  assert.ok(zincLane);
  assert.notEqual(zincLane?.query, "zinc testosterone randomized trial");
  assert.match(zincLane?.query ?? "", /dermatology|wound healing|acne/i);
});

test("prompt-grounding review queue only approves captured, linked, policy-safe rows", () => {
  const normalized = normalizeWorkbookPackage(baseWorkbook());
  const backlog = buildFamilyExpansionBacklog(normalized);
  const queue = buildPromptGroundingReviewQueue(
    normalized,
    backlog,
    DEFAULT_SCIENTIFIC_LANE_CONFIG,
  );

  const approved = selectApprovedPromptGroundingRows(queue);
  assert.ok(approved.some((row) => row.source_id === "ex_good"));
  assert.ok(approved.some((row) => row.source_id === "ov_good"));

  const badExcerpt = queue.prompt_grounding_review_queue.find(
    (row) => row.source_id === "ex_bad",
  );
  const badOverride = queue.prompt_grounding_review_queue.find(
    (row) => row.source_id === "ov_bad",
  );

  assert.equal(badExcerpt?.review_status, "rejected");
  assert.ok(badExcerpt?.review_reasons.includes("capture_not_complete"));
  assert.equal(badOverride?.review_status, "rejected");
  assert.ok(badOverride?.review_reasons.includes("unsafe_prose_claim"));
});

test("prompt-grounding promotion only emits reviewed form overrides from approved captured excerpts", () => {
  const normalized = normalizeWorkbookPackage(baseWorkbook());
  const backlog = buildFamilyExpansionBacklog(normalized);
  const queue = buildPromptGroundingReviewQueue(
    normalized,
    backlog,
    DEFAULT_SCIENTIFIC_LANE_CONFIG,
  );

  const promoted = buildReviewedFormExplainOverridesFromPromptGroundingRows(
    queue.prompt_grounding_review_queue,
  );

  assert.equal(promoted.length, 1);
  assert.equal(promoted[0]?.ingredient_id, "magnesium");
  assert.equal(promoted[0]?.form_key, "citrate");
  assert.match(JSON.stringify(promoted), /form-level label context only/i);
  assert.doesNotMatch(JSON.stringify(promoted), /cures/i);
});
