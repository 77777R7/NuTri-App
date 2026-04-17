# Golden Journey Pack v0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first non-UI cross-surface quality harness for curated scan/search/profile scenarios.

**Architecture:** Store a small curated JSON fixture, validate it with focused reporter utilities, and add offline search relevance scoring that accepts API-shaped responses. This keeps v0 away from scan freeze files while creating a reusable path toward larger journey packs.

**Tech Stack:** Node test runner, ES modules, JSON fixtures, maintainer reporter utilities.

---

### Task 1: Golden Journey Fixture

**Files:**
- Create: `data/validation/golden-journey-pack.v0.json`
- Test: `tests/scan/cross-surface-golden-journey.test.mjs`

- [ ] Create a 20-30 scenario fixture with core 5 scan products, fixed default-anchor buckets, persona overlays, search queries, and search-origin result checks.
- [ ] Include explicit `category`, `surface`, `origin`, `expected`, and `gates` fields for each scenario.
- [ ] Keep the fixture data-only so it can expand to 80-120 scenarios later.

### Task 2: Cross-Surface Reporter Utilities

**Files:**
- Create: `scripts/maintainer/lib/cross-surface-quality-reporting.mjs`
- Test: `tests/scan/cross-surface-golden-journey.test.mjs`

- [ ] Export allowed taxonomy/persona/surface constants.
- [ ] Export `validateGoldenJourneyPack`, `summarizeGoldenJourneyPack`, `evaluateCrossSurfaceConsistency`, and `scoreSearchRelevanceCase`.
- [ ] Return reason-coded pass/warn/fail results rather than throwing in evaluator functions.

### Task 3: Fixture Schema And Persona Tests

**Files:**
- Modify: `tests/scan/cross-surface-golden-journey.test.mjs`

- [ ] Assert the fixture has 20-30 scenarios.
- [ ] Assert the fixture covers core scan, search, search-origin result, at least 10 categories, and at least 10 personas.
- [ ] Assert all scenarios validate with no schema errors.
- [ ] Assert unsafe language and explicit source/allergy examples are represented.

### Task 4: Search Relevance API-Shape Tests

**Files:**
- Create: `tests/search/search-relevance-golden.test.mjs`

- [ ] Build API-shaped mock responses from the fixture.
- [ ] Assert exact-title top1, brand-product top3, ingredient recall@5, alias recall@5, typo recall@5, barcode exact hit, and click-through seed consistency.
- [ ] Include a negative example that fails the exact-title gate.

### Task 5: Verification

**Files:**
- All created files above.

- [ ] Run `node --test tests/scan/cross-surface-golden-journey.test.mjs tests/search/search-relevance-golden.test.mjs`.
- [ ] Run existing focused Science tests.
- [ ] Run backend build.
- [ ] Run `git diff --check` for the new files and touched Science closure files.
