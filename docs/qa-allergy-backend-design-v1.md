# QA Allergy Backend Design v1

## Status

This document is **design only**.

Nothing in this file should be interpreted as already applied to Supabase or
already wired into the production result lane.

Current intent:

- finish the QA onboarding allergy UI first
- keep backend work unexecuted until the UI is approved
- then connect storage, normalization, and insight generation in one pass

## Goal

Support allergy-aware personalized guidance in the production results lane
without reopening the hidden personalization research UI.

The backend should eventually answer:

- what the user wants to avoid
- whether the scanned or selected product conflicts with that
- where the conflict comes from
- whether the label detail is strong enough to trust the match

## Existing Reality

### User-side

The live main Supabase project does **not** currently store:

- `allergy_flags`
- `ingredient_restrictions`

The onboarding UI can collect these values locally, but they are not yet
persisted server-side.

### Product-side

The current product/facts tables do **not** have normalized allergen columns.

The most useful raw evidence already exists in:

- `dsld_labels_meta.inactive_ingredients`
- `dsld_labels_meta.active_ingredients_summary`
- `dsld_facts.facts_json`
- `dsld_label_facts.facts_json`
- `lnhpd_facts.facts_json`
- `iherb_overlay_products.supplement_facts`

Because those tables are large source-of-truth tables, the recommended backend
approach is to compute allergen flags into a **derived table**, not to mutate
the source tables directly.

## Canonical Data Model

### `allergy_flags`

- `milk`
- `egg`
- `fish`
- `shellfish`
- `tree_nuts`
- `peanuts`
- `wheat`
- `soy`
- `sesame`

### `ingredient_restrictions`

- `gluten`
- `gelatin_animal_based`

### Important rule

UI ordering should be supplement-first, but backend storage should remain
canonical and normalized.

## Draft Schema Plan

These drafts already exist locally and are **not applied**:

- [20260324120000_user_profiles_allergy_fields.sql](/Users/howard07/NuTriApp/nutri-app/supabase/migrations/20260324120000_user_profiles_allergy_fields.sql)
- [20260324121000_product_allergen_flags.sql](/Users/howard07/NuTriApp/nutri-app/supabase/migrations/20260324121000_product_allergen_flags.sql)

### Draft 1: `user_profiles`

Planned additions:

- `allergy_flags text[] not null default '{}'`
- `ingredient_restrictions text[] not null default '{}'`

Purpose:

- persist the user’s onboarding selections
- support future Profile editing
- feed result-lane conflict matching

### Draft 2: `product_allergen_flags`

Planned derived table:

- `source_kind`
- `source_id`
- `allergy_flags`
- `ingredient_restrictions`
- `match_evidence`
- timestamps

Purpose:

- avoid mutating large source tables
- keep normalization/backfill isolated
- enable fast product-vs-user conflict checks

## Proposed Backend Modules

These are design targets only. They do not exist yet unless noted.

### 1. Taxonomy + normalization

Suggested files:

- `backend/src/allergy/allergenTaxonomy.ts`
- `backend/src/allergy/allergenNormalization.ts`

Responsibilities:

- map raw terms into canonical flags
- separate true allergy flags from non-allergen restrictions
- avoid false positives such as:
  - `milk thistle` -> should **not** map to `milk`
  - `gluten-free` -> should **not** map to `gluten`

Examples:

- `anchovy`, `cod`, `salmon`, `fish oil` -> `fish`
- `krill`, `shrimp`, `lobster`, `crab` -> `shellfish`
- `whey`, `casein`, `lactose` -> `milk`
- `soy lecithin` -> `soy`
- `almond`, `cashew`, `walnut` -> `tree_nuts`
- `gelatin` -> `gelatin_animal_based`

### 2. Source extractors

Suggested files:

- `backend/src/allergy/extractFromDsld.ts`
- `backend/src/allergy/extractFromLnhpd.ts`
- `backend/src/allergy/extractFromIherbOverlay.ts`

Responsibilities:

- read raw fields from each source
- emit normalized candidate flags plus evidence
- keep source-specific parsing logic isolated

### 3. Derived table writer / backfill

Suggested files:

- `backend/src/allergy/productAllergenFlagsRepository.ts`
- `backend/scripts/backfill-product-allergen-flags.ts`

Responsibilities:

- upsert derived rows into `product_allergen_flags`
- keep `match_evidence` for explainability
- support partial refresh/backfill instead of full-table rewrites

### 4. User conflict insight builder

Suggested file:

- `backend/src/allergy/allergyInsightBuilder.ts`

Responsibilities:

- compare user `allergy_flags` and `ingredient_restrictions`
  against normalized product flags
- return summary-level conflict status
- attach explainable detail for expandable UI

## Proposed Insight Contract v1

This should eventually be embedded into the production results lane.

```ts
type AllergyInsight = {
  status: 'clear' | 'flagged' | 'unknown';
  matchedAllergyFlags: string[];
  matchedRestrictions: string[];
  summary: string;
  details: Array<{
    flag: string;
    source: 'active_ingredient' | 'inactive_ingredient' | 'label_disclosure' | 'warning';
    matchedText?: string;
    confidence: 'high' | 'medium' | 'low';
  }>;
};
```

### Intended user-facing behavior

Summary examples:

- `May conflict with your allergy settings`
- `No allergy-related flags detected`
- `Needs more label detail to confirm`

Detail examples:

- `Fish detected in active ingredients`
- `Gelatin detected in capsule ingredients`
- `Soy detected in other ingredients`

## Production Result Lane Integration

The intended place for this is the production results lane, alongside:

- `If it fits your goal`
- `Personal insight`
- `Recommended dosage`
- safety-first section ordering

Recommended ordering in the future detailed view:

1. safety card
2. personal insight
3. allergy insight
4. dosage context
5. deeper ingredient/details sections

## Execution Order Once UI Is Approved

1. Apply `user_profiles` allergy/restriction migration
2. Regenerate Supabase types
3. Extend onboarding/profile sync payload
4. Implement normalization helpers
5. Backfill `product_allergen_flags`
6. Build `allergyInsight` contract
7. Attach it to the production result lane

## Explicit Non-Goals For Now

- Do not execute migrations yet
- Do not backfill product flags yet
- Do not change scan-protected files as part of this allergy design work
- Do not reopen the hidden personalization research UI
