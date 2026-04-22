# Scientific Background Evidence Pack Design v1

Date: 2026-04-22

## Purpose

This spec adds a reviewed evidence-pack layer for `scientificBackground` so the
current family-specific sections can become more citation-grounded without
changing scan UI, scan routing, or scan-time network behavior.

The goal is not to turn the runtime into a live literature search surface. The
goal is to keep the current deterministic planner and fallback architecture,
then feed it a stronger offline evidence substrate for high-value families.

v1 scope covers:

- an offline-reviewed evidence artifact for scientific background sections
- a loader that matches the existing reviewed-package pattern
- compiler insertion points for fallback enrichment and live-writer grounding
- first-family rollout for `magnesium`, `iron`, `omega_3`, `protein`, and
  `fiber`
- a curation pipeline that can use the
  `life-science-research` plugin offline, not at runtime

## Existing Repo Constraints

This design must preserve the current barcode freeze boundary. It must not
require changes to:

- `app/scan/barcode.tsx`
- `app/scan/result.tsx`
- `components/scan/**`
- `hooks/useStreamAnalysis.ts`
- scan-related API wiring in `backend/src/server.ts`

This design should reuse the current scientific background architecture instead
of replacing it:

- `backend/src/insights/scientificBackgroundCompiler.ts`
- `shared/types/ingredientScience.ts`
- `backend/src/insights/reviewedPackage.ts`
- `backend/data/reviewed/reviewed-form-explains-v4.json`

## Current State

`scientificBackground` already returns a structured block:

- `mode`
- `selectedLabel`
- `selectedDose`
- `introLine`
- `sections[]`
- `closingNote`

Each section already has:

- `heading`
- `summary`
- `bullets`
- `evidenceRead`
- `shopperMeaning`

The current chain is strong in three ways:

- section planning is family-specific
- deterministic fallback is productized and guarded against generic drift
- runtime can reject low-quality writer output and repair back to fallback

The current chain is weaker in two ways:

- many family sections are still grounded more by curated prose than by a
  reusable evidence pack
- form, absorption, and comparison sections are not yet fed by a systematic
  reviewed evidence substrate

## Design Principle

The evidence pack sits before runtime writing, not inside runtime retrieval.

This means:

- no scan-time PubMed calls
- no sidecar dependency on external research tools
- no runtime hard switch from deterministic fallback to research retrieval

Instead:

1. offline research and curation builds the pack
2. backend loader reads the pack at startup
3. planner/compiler binds section lanes to reviewed evidence
4. fallback and live-writer prompt context both consume the same reviewed pack

## Proposed Artifacts

Add two data files and one loader:

- `backend/data/reviewed/scientific-background-evidence.v1.json`
- `backend/data/reviewed/scientific-background-evidence-overrides.v1.json`
- `backend/src/insights/scientificBackgroundEvidencePackage.ts`

The overrides file is optional and should follow the same pattern as
`reviewedPackage.ts`, so corrections can land without regenerating the base
artifact.

## Target Families In v1

v1 focuses on families that are already productized in
`scientificBackgroundCompiler.ts` and are valuable enough to justify reviewed
grounding.

### 1. Magnesium

Primary lanes:

- `form_and_tolerability_context`
- `what_product_comparison_depends_on`

Secondary lane:

- `common_use_contexts`

Why this family is in v1:

- form and comparison language is already core to the product story
- this family has usable comparative literature for citrate, oxide, glycinate,
  and related forms

### 2. Iron

Primary lanes:

- `form_and_tolerability_context`
- `what_product_comparison_depends_on`

Secondary lane:

- `iron_status_and_deficiency_context`

Why this family is in v1:

- `ferrous bisglycinate` versus `ferrous sulfate` and related literature is
  productizable
- shopper meaning depends heavily on form disclosure

### 3. Omega-3

Primary lanes:

- `inflammation_and_recovery_context` for `EPA`
- `brain_and_eye_context` for `DHA`
- `broader_cardiovascular_context` for broader `omega_3`

Secondary lanes:

- `lipid_and_triglyceride_research`
- `developmental_and_structural_roles_in_research`
- `how_this_differs_from_broader_heart_claims`

Why this family is in v1:

- the planner is already strong
- the value gap is evidence grounding and citation-boundary support, not new
  wording structure

### 4. Protein

Primary lanes:

- `muscle_and_recovery_context`
- `protein_type_and_disclosure_context`

Secondary lane:

- `satiety_and_meal_support_context`

Why this family is in v1:

- shopper comparison depends on type disclosure more than generic marketing
- the family is newly productized and benefits from stronger grounding early

### 5. Fiber

Primary lanes:

- `digestive_regularity_context`
- `source_and_solubility_context`

Secondary lane:

- `satiety_and_gut_context`

Why this family is in v1:

- fiber products vary heavily by source and solubility
- this is a strong fit for reviewer-curated comparison language

## Evidence Pack Data Model

The design should mirror the repo's current reviewed-package style instead of
inventing a separate philosophy.

### Package Metadata

```json
{
  "metadata": {
    "source_version": "v1.0",
    "generated_at": "2026-04-22T00:00:00Z",
    "package_version": "scientific-background-evidence-v1"
  }
}
```

### Evidence Row Shape

Each row should be keyed to a family and a section lane, not only to a form.

```json
{
  "ingredient_family": "magnesium",
  "section_key": "form_and_tolerability_context",
  "variant_key": "citrate_vs_oxide",
  "variant_label": "Magnesium citrate versus oxide comparison context",
  "evidence_grade": "B",
  "overall_confidence": 0.82,
  "display_text": "Comparative human studies support a cautious form-comparison narrative for citrate versus oxide, but not a universal best-form ranking.",
  "segments": {
    "summary_support": {
      "en": [
        {
          "text": "Comparative human studies support a cautious form-comparison narrative for citrate versus oxide, but not a universal best-form ranking.",
          "sentence_id": "mg_form_001",
          "evidence_reference_id": "pmid:2407766",
          "evidence_grade": "B"
        }
      ]
    },
    "evidence_read_support": {
      "en": [
        {
          "text": "Head-to-head studies exist, but the evidence is better for careful comparison than for declaring one universal best form.",
          "sentence_id": "mg_form_002",
          "evidence_reference_id": "pmid:32162607",
          "evidence_grade": "B"
        }
      ]
    },
    "shopper_meaning_support": {
      "en": [
        {
          "text": "Check the exact form and elemental amount before assuming two magnesium labels belong in the same comparison set.",
          "sentence_id": "mg_form_003",
          "evidence_reference_id": "pmid:14596323",
          "evidence_grade": "B"
        }
      ]
    },
    "caveats": {
      "en": [
        {
          "text": "Do not convert these studies into a universal best-form or best-absorption claim across every dose and formula setting.",
          "sentence_id": "mg_form_004",
          "evidence_reference_id": "pmid:2407766",
          "evidence_grade": "C"
        }
      ]
    }
  },
  "supporting_references": [
    {
      "id": "pmid:2407766",
      "source": "pubmed",
      "title": "Magnesium bioavailability from magnesium citrate and magnesium oxide."
    }
  ]
}
```

### Row Selection Rules

Rows should be selected by:

- `ingredient_family`
- `section_key`
- optional `variant_key`

`variant_key` is useful when the same family section needs narrower grounding,
for example:

- `epa_primary`
- `dha_primary`
- `citrate_vs_oxide`
- `ferrous_bisglycinate_anchor`
- `whey_vs_plant_comparison`
- `psyllium_soluble_anchor`

If no specific variant matches, the compiler should fall back to the
family-and-section row.

## Loader Design

Create `backend/src/insights/scientificBackgroundEvidencePackage.ts`.

Recommended exports:

```ts
export type ScientificBackgroundEvidenceSentence = {
  text: string;
  sentenceId: string | null;
  excerptId: string | null;
  referenceId: string | null;
  evidenceGrade: string | null;
};

export type ScientificBackgroundEvidenceSegments = {
  summarySupport?: ScientificBackgroundEvidenceSentence[];
  evidenceReadSupport?: ScientificBackgroundEvidenceSentence[];
  shopperMeaningSupport?: ScientificBackgroundEvidenceSentence[];
  caveats?: ScientificBackgroundEvidenceSentence[];
};

export type ScientificBackgroundEvidenceRow = {
  ingredientFamily: string;
  sectionKey: string;
  variantKey?: string;
  variantLabel?: string;
  evidenceGrade?: "A" | "B" | "C" | "D" | "E";
  overallConfidence?: number;
  displayText?: string;
  segments: ScientificBackgroundEvidenceSegments;
  meta: ReviewedPackageMeta;
};

export function getScientificBackgroundEvidence(
  ingredientFamily: string,
  sectionKey: string,
  locale: "en",
  variantKey?: string,
): ScientificBackgroundEvidenceRow | null;
```

Implementation notes:

- mirror `reviewedPackage.ts` loading and override behavior
- limit sentence buckets to a small number per segment
- keep `locale` scoped to `en` for v1
- keep the loader optional and fail-safe; missing files must not break runtime

## Compiler Insertion Points

### 1. Section Planning Bind

After `buildResearchPlan()` or `buildLabelContextPlan()`, bind each section to
an optional evidence row by:

- family
- section key
- optional variant key derived from the descriptor

This does not change the response shape yet. It only enriches the compiler's
internal context.

### 2. Deterministic Fallback Enrichment

`buildScientificBackgroundDeterministicFallback()` should remain the source of
truth when live writing fails.

For v1, evidence rows should enrich these fields when present:

- `summary`
- `evidenceRead`
- `shopperMeaning`

Rules:

- use evidence-pack copy when it is strong enough and aligned to the selected
  family/section
- keep current handcrafted fallback as the final safety net
- never produce an empty field because evidence is missing

### 3. Live-Writer Prompt Grounding

`compileScientificBackgroundAsync()` should include a compact evidence payload
for the active sections when it asks the live writer to draft structured JSON.

The live writer should receive:

- selected family
- section headings
- evidence-pack `displayText`
- up to 1 or 2 supporting sentences per segment
- caveat guidance

This is not for direct citation rendering in UI. It is to make the writer less
generic and less likely to overstate claims.

### 4. Repair And Quality Gates

Evidence-pack presence should not relax the current quality gates.

It should help reduce failures such as:

- `scientific_background_generic`
- `scientific_background_selected_mismatch`

But the same repair and rejection behavior should still apply if writer output
drifts.

## Variant-Key Suggestions By Family

### Magnesium

- `glycinate_anchor`
- `citrate_vs_oxide`
- `generic_form_comparison`

### Iron

- `ferrous_bisglycinate_anchor`
- `ferrous_sulfate_anchor`
- `generic_form_comparison`

### Omega-3

- `epa_primary`
- `dha_primary`
- `combined_omega3_primary`
- `source_disclosure_boundary`

### Protein

- `whey_anchor`
- `plant_protein_anchor`
- `blend_disclosure_boundary`

### Fiber

- `psyllium_anchor`
- `inulin_anchor`
- `soluble_vs_blend_comparison`

## Offline Curation Pipeline

The evidence pack should be built offline with a repeatable curation flow.

Recommended pipeline:

1. choose `family + section_key + variant_key`
2. use the `life-science-research` plugin offline to search PubMed and PMC
3. collect candidate studies and reviews
4. screen out non-productizable or overly clinical claims
5. write reviewed sentences for:
   - `summarySupport`
   - `evidenceReadSupport`
   - `shopperMeaningSupport`
   - `caveats`
6. export JSON rows into the reviewed evidence artifact
7. use overrides for corrections and wording repairs

This keeps runtime stable while still letting research coverage expand.

## Evidence Authoring Rules

All pack content should follow the same runtime safety posture as current
scientific background content.

Allowed:

- support/context language
- cautious comparison language
- source-aware and form-aware shopper interpretation
- bounded statements about where evidence is clearer or more mixed

Not allowed:

- universal best-form claims
- treatment, prevention, or cure language
- absolute superiority claims that outrun the evidence
- direct copy that assumes every formula setting behaves the same way

## Rollout Plan

### Phase 1

Create the artifact and loader with empty or minimal data.

Acceptance:

- loader is optional and safe
- no runtime regressions when evidence rows are absent

### Phase 2

Fill the first P0 section rows:

- `magnesium.form_and_tolerability_context`
- `iron.form_and_tolerability_context`
- `omega_3` `EPA/DHA` primary lanes
- `protein.protein_type_and_disclosure_context`
- `fiber.source_and_solubility_context`

Acceptance:

- fallback becomes more specific where evidence rows exist
- no generic drift increase

### Phase 3

Ground the live writer with the same evidence rows.

Acceptance:

- runtime quality gates still pass
- live output is more family- and section-specific than before

## Validation

Add targeted tests instead of broad snapshot churn.

Recommended validation layers:

- loader parsing tests for valid and partial packages
- compiler tests proving evidence rows enrich fallback without breaking missing
  data behavior
- quality-gate tests confirming generic and mismatch guards still hold
- at least one family-specific test per v1 family showing section enrichment

## Non-Goals

v1 does not:

- expose raw citations in the end-user UI
- make scan results render bibliography cards
- fetch literature at runtime
- require every current family to have evidence coverage
- replace the existing deterministic fallback system

## Expected Outcome

If this design lands cleanly, `scientificBackground` becomes stronger in the
areas users are most likely to challenge:

- form and comparison context
- section-specific research grounding
- shopper-facing meaning that feels sourced rather than generic

The result should be higher-confidence science copy without sacrificing the
repo's current runtime stability.
