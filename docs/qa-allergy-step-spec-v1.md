# QA Allergy Step Spec v1

## 1. Purpose

This spec defines the first production-ready version of the QA onboarding
`Allergies & restrictions` step.

Goals:

- Collect lightweight user input that can later power `personal insight`.
- Keep onboarding simple and skippable.
- Reflect supplement-specific avoidance patterns, not only generic food
  allergen ordering.
- Use a canonical data model that is safe for future database queries and
  product matching.

This spec is intentionally focused on:

- onboarding input
- profile storage
- normalized matching inputs
- result-surface integration contract

It does **not** define the final UI for result-page rendering in detail.

## 2. Product Recommendation

Use a lightweight optional step titled:

- `Anything to avoid?`

Supporting text:

- `We use this to flag ingredients that may not fit your routine.`
- `Optional. You can skip this for now and update it later in Profile.`

Primary actions:

- `Continue`
- `Skip for now`

Why this step should exist now:

- The current roadmap puts `personal insight` and `QA allergy section` in the
  `Now` bucket.
- Without user allergy/restriction input, the product can only show generic
  label warnings, not true personalized ingredient conflict warnings.

## 3. Placement in Onboarding

Recommended order:

1. `welcome`
2. `data-trust`
3. `age-range`
4. `sex`
5. `experience`
6. `goals`
7. `types`
8. `allergy`
9. `blocker`
10. `setup`
11. `plan-preview`
12. `first-stack`
13. `done`

Recommended placement:

- after `types`
- before `blocker`

Reasoning:

- `goals` and `types` answer what the user wants.
- `allergy` answers what the user must avoid.
- `blocker` and `setup` answer how the product should support them.

## 4. Supplement-Specific Research Summary

There is no single official “supplement-only allergen ranking” from FDA.

The most reliable external rules are:

- dietary supplements still follow food allergen labeling requirements
- supplement `other ingredients` commonly include excipients such as gelatin,
  starches, colors, stabilizers, and flavors
- gluten is highly relevant to users, but should still be modeled separately
  from major allergen flags

Official references:

- [FDA Food Allergies](https://www.fda.gov/food/food-labeling-nutrition/food-allergies)
- [FDA Questions and Answers on Dietary Supplements](https://www.fda.gov/food/information-consumers-using-dietary-supplements/questions-and-answers-dietary-supplements)
- [FDA Gluten and Food Labeling](https://www.fda.gov/food/nutrition-education-resources-materials/gluten-and-food-labeling)

Internal catalog analysis on the main runtime project (`dlwlobgmjzcmpirwvetq`)
showed strong supplement-specific signals in raw label data:

- `gelatin` is by far the strongest inactive-ingredient signal
- `soy` and `milk/dairy-derived` signals are common in inactive ingredients
- `fish` is common as an active ingredient signal
- `shellfish` is less frequent overall, but highly supplement-relevant
- `gluten` is not a top allergen flag, but is highly user-salient

This leads to a supplement-first UX order rather than a pure food-top-9 order.

## 5. UX Recommendation

### 5.1 Primary visible chips

Show these 6 by default:

- `Fish`
- `Shellfish`
- `Dairy`
- `Soy`
- `Gluten`
- `Gelatin / animal-based`

### 5.2 Secondary `More` list

Show these after expansion:

- `Egg`
- `Sesame`
- `Tree nuts`
- `Peanuts`
- `Wheat`

### 5.3 Additional controls

- `No known allergies`
- `Skip for now`

### 5.4 Interaction rules

- Multi-select is allowed.
- Selecting `No known allergies` clears all other selections.
- Selecting any specific flag clears `No known allergies`.
- `Skip for now` stores no allergy data and advances onboarding.

## 6. Canonical Data Model

UI ordering should be supplement-first.

Stored values should still be canonical and standardized.

### 6.1 `allergy_flags`

Allowed canonical values:

- `milk`
- `egg`
- `fish`
- `shellfish`
- `tree_nuts`
- `peanuts`
- `wheat`
- `soy`
- `sesame`

### 6.2 `ingredient_restrictions`

Allowed canonical values:

- `gluten`
- `gelatin_animal_based`

### 6.3 Display-to-storage mapping

- `Dairy` -> `milk`
- `Tree nuts` -> `tree_nuts`
- `Gelatin / animal-based` -> `gelatin_animal_based`

## 7. Current Schema Reality

The live main Supabase project was inspected directly.

### 7.1 `user_profiles`

Current real columns are still old-profile oriented:

- `user_id`
- `height`
- `weight`
- `age`
- `gender`
- `dietary_preference`
- `activity_level`
- `location`
- `timezone`
- `created_at`
- `updated_at`

Important finding:

- `user_profiles` currently has no `allergy_flags`
- `user_profiles` currently has no `ingredient_restrictions`

Important drift note:

- The live schema is older than the onboarding-v2 expectations in
  [`lib/supabase/profile.ts`](/Users/howard07/NuTriApp/nutri-app/lib/supabase/profile.ts).

### 7.2 Product-side tables

The following tables do **not** currently contain standardized allergy columns:

- [`supplements`](/Users/howard07/NuTriApp/nutri-app/types/supabase.ts)
- [`supplement_ingredients`](/Users/howard07/NuTriApp/nutri-app/supabase/migrations/20240608120000_initial_schema.sql)
- [`product_ingredients`](/Users/howard07/NuTriApp/nutri-app/types/supabase.ts)

The best existing raw evidence sources are:

- `dsld_labels_meta.inactive_ingredients`
- `dsld_labels_meta.active_ingredients_summary`
- `dsld_facts.facts_json`
- `dsld_label_facts.facts_json`
- `lnhpd_facts.facts_json`
- `iherb_overlay_products.supplement_facts`

This means the product-side system has raw material for matching, but not a
stable normalized allergy layer yet.

## 8. Recommended Database Design

### 8.1 Migration 1: user input storage

Recommended migration name:

- `add_user_profile_allergy_fields`

Recommended columns on `public.user_profiles`:

- `allergy_flags text[] not null default '{}'`
- `ingredient_restrictions text[] not null default '{}'`

Recommended database constraints:

- `allergy_flags` must be a subset of canonical allergy values
- `ingredient_restrictions` must be a subset of canonical restriction values

### 8.2 Migration 2: derived product-side allergen table

Do **not** add allergy columns directly to large source tables such as:

- `product_ingredients`
- `lnhpd_facts`
- `dsld_label_facts`
- `iherb_overlay_products`

Recommended derived table:

- `public.product_allergen_flags`

Suggested columns:

- `id uuid primary key default gen_random_uuid()`
- `source_kind text not null`
- `source_id text not null`
- `allergy_flags text[] not null default '{}'`
- `ingredient_restrictions text[] not null default '{}'`
- `match_evidence jsonb not null default '{}'::jsonb`
- `computed_at timestamptz not null default timezone('utc', now())`
- `updated_at timestamptz not null default timezone('utc', now())`

Suggested uniqueness:

- `unique (source_kind, source_id)`

Suggested indexes:

- GIN on `allergy_flags`
- GIN on `ingredient_restrictions`

Why this design is recommended:

- source tables remain authoritative and untouched
- allergen detection stays derivable and replaceable
- future re-normalization is easier
- product matching stays fast and queryable

## 9. Onboarding Data Contract

Recommended additions to
[`types/onboarding.ts`](/Users/howard07/NuTriApp/nutri-app/types/onboarding.ts):

```ts
allergyFlags?: string[];
ingredientRestrictions?: string[];
```

Recommended additions to
[`lib/validation/onboarding.ts`](/Users/howard07/NuTriApp/nutri-app/lib/validation/onboarding.ts):

- `allergyFlags` schema
- `ingredientRestrictions` schema

Recommended new page:

- [`app/onboarding/allergy.tsx`](/Users/howard07/NuTriApp/nutri-app/app/onboarding)

Recommended config updates:

- [`app/onboarding/_layout.tsx`](/Users/howard07/NuTriApp/nutri-app/app/onboarding/_layout.tsx)
- [`lib/onboarding-v2.ts`](/Users/howard07/NuTriApp/nutri-app/lib/onboarding-v2.ts)

`ONBOARDING_TOTAL_STEPS` should be incremented by 1.

## 10. Product-Side Normalization Layer

The first version should normalize raw evidence into canonical flags without
changing scan UX or source tables.

Recommended normalization inputs:

- `inactive_ingredients`
- `active_ingredients_summary`
- parsed `facts_json`
- parsed `supplement_facts`
- `contains` / `allergen` / `warning` / `other ingredients` text

Examples of normalization:

- `anchovy`, `salmon`, `cod` -> `fish`
- `krill`, `shrimp`, `lobster`, `crab` -> `shellfish`
- `whey`, `casein`, `lactose` -> `milk`
- `soy lecithin` -> `soy`
- `almond`, `cashew`, `walnut` -> `tree_nuts`
- `gelatin` -> `gelatin_animal_based`

Important false-positive rule:

- terms like `gluten-free` must not become `gluten`

## 11. Personal Insight Contract v1

This onboarding step should feed a later result-surface contract with three
levels:

### 11.1 Summary state

- `flagged`
- `clear`
- `unknown`

### 11.2 Summary copy examples

- `May conflict with your allergy settings`
- `No allergy-related flags detected`
- `Needs more label detail to confirm`

### 11.3 Detail payload

Suggested payload structure:

```ts
type AllergyInsight = {
  status: 'flagged' | 'clear' | 'unknown';
  matchedAllergies: string[];
  matchedRestrictions: string[];
  sources: Array<'active' | 'inactive' | 'contains_statement' | 'warning'>;
  evidence: Array<{
    sourceType: 'active' | 'inactive' | 'contains_statement' | 'warning';
    rawText: string;
    normalizedFlag: string;
  }>;
};
```

## 12. Acceptance Criteria

This spec is considered implemented when:

- onboarding includes the new optional allergy step
- selections persist locally in onboarding draft
- selections sync into `user_profiles`
- canonical values are enforced in storage
- the system can normalize product-side allergen flags from raw label data
- personal insight can report at least:
  - `flagged`
  - `clear`
  - `unknown`

## 13. Non-Goals for v1

Do not include in v1:

- free-text allergy entry
- medication allergy intake
- medical condition questionnaires
- clinical severity scoring
- full inactive-ingredient explainability UI
- scan UX changes

## 14. Recommended Build Order

1. Add `user_profiles` allergy columns
2. Add onboarding step and draft validation
3. Sync profile writes
4. Create `product_allergen_flags`
5. Add normalization job/helper
6. Connect result-surface personal insight

## 15. Open Decisions

The following still need product sign-off:

- Should primary chips be ordered by supplement-specific commonness or by user
  familiarity?
- Should `Wheat` stay behind `More` if `Gluten` is already primary?
- Should `No known allergies` be visually exclusive or behave like a normal chip?
- Should later Profile editing use the same chip groups or a flatter list?
