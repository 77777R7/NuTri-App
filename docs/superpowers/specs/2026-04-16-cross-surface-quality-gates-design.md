# Cross-Surface Quality Gates Design v0

Date: 2026-04-16

## Purpose

This spec upgrades the current Science & Ingredients closure from a single-pipeline
validation result into a user-journey quality system. The goal is not to run the
largest possible sample immediately. The goal is to define stronger judgment
standards, then expand sampling in a controlled way.

The v0 scope covers:

- Phase A: freeze the current Science baseline as narrative evidence.
- Phase B: define Quality Standard v0.
- Phase C: create Golden Journey Pack v0.
- Phase D: extend validation reporting without changing scan UI.
- Phase E: add search relevance and search-origin result consistency tests.

## Current Baseline

The current Science & Ingredients closure should be treated as
`science-baseline-v1` for PR and handoff purposes:

- sample count: 1752
- route pass: 1752/1752
- default ingredient quality pass: 1752/1752
- UX source/copy pass: 1752/1752
- sidecar 5xx/timeout: 0
- source weak hint leakage: 0
- ingredient overview generic: 0
- ingredient overview factual echo: 0
- ingredient overview selected mismatch: 0
- scientific background generic: 0
- scientific background selected mismatch: 0
- failure buckets: empty

This proves the current Science pipeline is substantially healthier for the
covered sample and current gates. It does not prove real-device scan stability,
search relevance, search-origin result consistency, profile-aware safety copy,
or sparse-data UX.

## Existing Repo Constraints

The barcode scan flow is frozen and release-sensitive. This design must not
require changes to:

- `app/scan/barcode.tsx`
- `app/scan/result.tsx`
- `components/scan/**`
- `hooks/useStreamAnalysis.ts`
- scan-related API wiring

Existing assets to reuse:

- `docs/scan-release-gate.md` already defines core 5 scan products, score
  expectations, digest/hash alignment, and performance gates.
- `docs/scan-barcode-freeze.md` defines the protected scan behavior.
- `docs/qa-allergy-step-spec-v1.md` defines allergy/restriction UX and notes
  that live profile schema does not yet expose final allergy columns.
- `tests/scan/*` already contains many contract tests for crash-proofing,
  never blank behavior, score consistency, allergy insight, personalization
  context, and sidecar isolation.
- `app/search/index.tsx` currently opens search results by seeding a barcode
  session and routing to `/scan/result`. In v0, the "search detail page" is
  therefore the search-origin scan result surface, not a separate detail route.

## Non-Goals

v0 does not:

- modify scan UX or barcode routing.
- introduce snapshot cache behavior.
- make full database sweep a release blocker.
- implement every taxonomy category from the long-form GPT Pro proposal.
- rely on live profile DB columns that are not present yet.

## Phase A: Freeze Science Baseline

Record `science-baseline-v1` in PR and handoff language. The artifact may remain
local unless the repo later adopts a convention for committed validation
outputs.

Acceptance criteria:

- PR/handoff summary includes the 1752/1752 closure evidence.
- No new larger Science run is required before moving to gate design.
- Future Science changes can compare against this baseline by sample manifest
  or narrative evidence.

## Phase B: Quality Standard v0

Quality Standard v0 defines pass/warn/fail semantics for ingredient/category
quality, copy quality, profile-aware risks, and cross-surface consistency.

### Category Taxonomy v0

Start with 12 practical categories instead of a 27-category complete taxonomy:

1. Vitamin and mineral singles
2. Mineral stacks
3. Multivitamin and B-complex products
4. Probiotics, phage, and microbiome products
5. Omega-3 source oils and EPA/DHA breakdowns
6. Botanicals and extracts
7. Sleep and amino-acid products
8. CLA, carnitine, and metabolic/body-composition products
9. Protein and fiber products
10. Food-like products, greens, teas, gummies, snacks, and drink mixes
11. Prenatal and kids products
12. Sparse, malformed, or strong-title/weak-facts products

### Default Anchor Rules

Pass:

- The default anchor matches the title-led primary active, normalized facts row,
  or a deliberate category-level row for broad formulas.
- Macro/package rows do not become anchors unless the product is explicitly a
  food-like or electrolyte category where that row is the product meaning.

Warn:

- A category-level anchor is used because facts are sparse or multiple actives
  are genuinely tied.
- The anchor is acceptable but lower confidence, with a visible reason code.

Fail:

- Sugar, calories, potassium macro residue, package form, flavor, serving size,
  or a minor companion steals the default anchor.
- A known title-led product chooses a secondary ingredient instead of the lead
  ingredient or family.

### Overview Copy Rules

Pass:

- Copy names the selected ingredient or selected category.
- Copy explains label role, product role, or comparison value.
- Blend/proprietary copy is honest about grouped disclosure and does not imply
  item-level transparency.

Warn:

- Copy is family-level because source data is sparse, but it still names the
  family and uncertainty.

Fail:

- Copy is generic wellness filler.
- Copy is only a factual echo of supplement facts.
- Copy leaks internal source language such as web hints.
- Copy uses stale phrases that were removed from current templates.

### Scientific Background Rules

Pass:

- Background is selected-ingredient or selected-category specific.
- It uses safe support/context language, not treatment/prevention language.
- Source-sensitive classes such as algal oil, fish oil, krill oil, probiotic
  strains, and botanical trade names remain source-aware.

Warn:

- Background falls back to a category-level explanation for sparse data.

Fail:

- Background is generic wellness copy.
- Background discusses a different ingredient than the selected anchor.
- Background makes unsupported medical or contraindication claims.

### Persona Gates

Persona gates use synthetic profile context in v0. They must not depend on live
profile DB columns that are not deployed.

Required persona overlays:

- fish allergy
- shellfish allergy
- dairy allergy
- soy allergy
- gluten restriction
- gelatin/animal-based restriction
- vegan preference
- pregnancy/prenatal context
- melatonin sensitivity
- stimulant sensitivity
- duplicate zinc/magnesium/vitamin D stack
- digestion goal
- sleep goal
- immunity goal
- fitness/recovery goal

Pass:

- Explicit ingredient/source conflicts produce a warning or relevant chip.
- Negative controls do not produce unrelated warnings.
- Goal relevance is specific and conservative.

Warn:

- Data is weak and the system gives a low-confidence or data-limited warning.

Fail:

- Explicit source/allergen risk is missed.
- The app says or implies "safe for you" when risk is uncertain.
- Goal language becomes a result guarantee or treatment claim.

### Cross-Surface Consistency Gates

The same product must remain coherent across:

- barcode-origin scan result
- search-origin scan result
- Science sidecar content
- result cards or seed payloads

Pass:

- Canonical product identity, barcode, brand/name, selected anchor, score band,
  and major warnings are consistent.

Warn:

- Detail copy is richer than the seed/result card but does not contradict it.

Fail:

- Search result seed opens a different product or variant.
- Main score and mini score diverge in stable state.
- Scan-origin and search-origin result surfaces choose different anchors for the
  same barcode/profile/data version.

### Failure Severity

P0:

- crash, hang, blank result page, or unsafe "safe for you" style language in
  high-risk context.

P1:

- wrong product, wrong default anchor, missed explicit allergy/source risk,
  score mismatch, or medical overclaim.

P2:

- generic copy, weak source leakage, stale fallback, poor search ranking, or
  profile relevance weakness.

P3:

- cosmetic copy polish, non-blocking badge order, or minor wording issues.

## Phase C: Golden Journey Pack v0

Golden Journey Pack v0 is a curated scenario manifest, not a random sample. It
should be small enough to review and hard enough to catch user-facing failures.

Target size:

- 80 to 120 scenarios.

Required scenario groups:

- Core 5 scan release products from `docs/scan-release-gate.md`.
- Representative samples from the previously fixed 58 default-anchor failures.
- 20 to 30 search queries:
  - exact product title
  - brand + product
  - ingredient
  - alias
  - typo
  - barcode
- Persona overlays from the v0 persona list.
- Sparse facts, malformed facts, food-like boundary, and strong-title/weak-facts
  products.
- Same-barcode comparison for barcode-origin vs search-origin result.

Each scenario should define:

- scenario id
- surface: `barcode_scan`, `search`, or `search_origin_result`
- input barcode or query
- optional search result seed
- optional synthetic profile/persona
- expected category
- expected default anchor behavior
- expected warning behavior
- expected copy constraints
- blocking gates

## Phase D: Reporter Extension

Extend validation reporting before changing UI. The existing
`scripts/maintainer/lib/science-validation-reporting.mjs` remains the base for
Science gates, but v0 needs a cross-surface layer that can score journey
scenarios.

New report dimensions:

- `category`
- `persona`
- `surface`
- `origin`: `barcode_scan` or `search_result`
- `canonicalProductConsistency`
- `scoreConsistency`
- `selectedAnchorConsistency`
- `warningConsistency`
- `goalRelevance`
- `allergySensitivityRelevance`
- `unsafeLanguage`

Gate output should remain simple:

- `pass`
- `warn`
- `fail`
- reason code
- representative example
- suspected root cause

This layer can start as pure fixture/reporting logic. It does not need to call
mobile UI or change scan components in v0.

## Phase E: Search Relevance Tests

Search is the clearest current gap. v0 should test backend/API and seed
consistency first, not UI styling.

Initial metrics:

- exact product title: Top1 accuracy
- brand + product: Top3 recall
- ingredient query: Recall@5
- alias query: Recall@5
- typo query: Recall@5
- barcode query: exact hit
- click-through seed consistency

Required alias targets:

- D3 / Vitamin D
- B12 / cobalamin names
- Sensoril / Ashwagandha
- Matcha / Green Tea
- Algal Oil / Omega-3
- Protectis
- Floraphage
- Osfortis

Click-through seed consistency means a search result's `productId`, `name`,
`brand`, `barcode`, `upcCode`, `category`, `dose`, and facts/coverage statuses
must be preserved into the search-origin scan result session and must not
resolve to a conflicting canonical product.

## Current Search Golden Journey Status

The first live local replay slice is now in a usable state and should be cited
in PR and handoff notes as search evidence, not as a reason to skip the next
quality-standard steps.

Current local evidence:

- live local warm-index replay requires about 1.5 to 2 minutes after backend
  startup before results are representative.
- final local replay passed 7/7 scenarios.
- the Sports Research Omega-3 scenario was corrected from a stale exact-title
  expectation to the current live brand-and-family expectation.
- barcode exact-hit behavior is now closed for replay coverage.
- Sensoril and related alias ranking is now closed for replay coverage.
- matcha to green tea family ranking is now closed for replay coverage.

Local replay artifacts remain local by default and should not be committed
unless the repo later adopts an output-artifact convention:

- `output/search-validation/search-golden-replay-1776387299472.json`
- `output/search-validation/search-golden-replay-1776387299472.md`

## Validation Commands for v0 Implementation

When v0 is implemented, the minimum local verification should include:

- existing Science hardening tests
- existing scan sidecar isolation/409 contracts
- existing allergy/personalization scan contracts
- new Golden Journey reporter tests
- new search relevance API tests
- backend build
- targeted diff check for touched files

## Staging and Commit Guidance

Keep this work separate from the current Science closure commit and the separate
security/config cleanup. Do not include validation artifacts by default.

Expected future files may include:

- `docs/superpowers/specs/2026-04-16-cross-surface-quality-gates-design.md`
- `data/validation/golden-journey-pack.v0.json`
- `scripts/maintainer/lib/cross-surface-quality-reporting.mjs`
- `tests/search/search-relevance-golden.test.mjs`
- `tests/scan/cross-surface-golden-journey.test.mjs`

Scan freeze files should not be modified in v0 unless a test exposes a critical
release blocker and the user explicitly approves a scan-area fix.

## Open Decisions

1. Whether to store Golden Journey Pack v0 under `data/validation/`,
   `tests/fixtures/`, or `scripts/maintainer/fixtures/`.
2. Whether the live local replay runner should gain an explicit warm-ready
   wait/poll step so operators do not accidentally validate against cold
   fallback results.
3. Whether warning thresholds should be global in v0 or category-specific from
   the first implementation pass.

## Recommended First Implementation Slice

Build the smallest non-UI slice first:

1. Add Golden Journey Pack v0 fixture with 20 to 30 scenarios.
2. Add category/persona/schema validation for that fixture.
3. Add reporter utilities that can classify pass/warn/fail for persona,
   unsafe-language, and cross-surface consistency fields.
4. Add search relevance fixtures and API-level tests for exact/alias/barcode
   cases.
5. Only after this is stable, expand to 80 to 120 scenarios.

This keeps the first slice useful without destabilizing the scan release surface.
