# Scan Result Quality Wave 1

Date: 2026-04-27
Base MVP gate: `scan-result-rc-cached-720-final2-20260427`
Production deploy verified: `dep-d7nihj0g4nts73b6p5og` / `8410e357d29e2460de92d65df7937292d8c0ba44`

## Scope Boundary

This wave starts after the cached-first Scan Result MVP gate passed. It is not a stability gate and it should not reopen P0/P1 bucket-chasing unless a new blocking issue appears.

Do not mix this wave with Expo camera work, Express migration, or frozen scan-result UI rewrites.

## Baseline From MVP Gate

- 720 cached-first stratified products completed.
- Sidecar rows: 4,320.
- Decision support errors: 0.
- Sidecar errors: 0.
- AI P0/P1: 0.
- Visible blank/unavailable AI rows: 0.
- Overclaim rows: 0.
- Cached-first AI fallback was expected because full live AI was not confirmed.

## Workstream 1: API Pass-Rate Lift

Goal: raise live API pass-rate for `ingredient_overview`, `scientific_background`, and `product_overview_ai` without slowing scan core.

Rules:

- Run only stratified live-AI samples, never full corpus live AI by default.
- Require explicit `--confirm-live-ai` for live generation.
- Track `llm_timeout`, `parse_failed`, `quality_gate_rejected`, blank/unavailable, and p95 sidecar latency separately.
- Do not relax hard medical, disease, treatment, cure, superiority, or unsafe guarantee gates.

First families to measure:

- coq10
- creatine
- collagen
- probiotic_or_blend
- ashwagandha
- turmeric
- berberine
- green_tea_extract
- nac

Exit criteria:

- No P0/P1 regression in cached-first sample.
- Live-AI sample has route-specific reason buckets for every reject.
- Any gate relaxation must be paired with regression tests that prove unsafe copy remains blocked.

## Workstream 2: Premium Scientific Background Writing

Goal: make Scientific Background feel like a useful research snapshot, not generic fallback prose.

Rules:

- Preserve the current UX structure: summary, limited bullets, evidence badge, shopper meaning callout.
- Improve only family-specific research lanes and comparison meaning.
- Keep safety-sensitive families bounded: red yeast rice, pygeum, tribulus, St. John's wort, berberine, NAC, hormone/metabolic/urinary/liver/sleep-mood botanicals.

First target families:

- coq10
- creatine
- collagen
- probiotic_or_blend
- ashwagandha
- turmeric
- berberine
- green_tea_extract
- nac

Exit criteria:

- Scientific Background fallback/generation includes a concrete lane, boundary, and shopping implication.
- No generic wellness-only copy is promoted as premium output.
- No disease/treatment/superiority language leaks into user-facing copy.

## Workstream 3: Evidence Grounding

Goal: add reviewed evidence rows only where they improve user decisions.

Rules:

- Raw workbook prose, search-only citations, and unapproved excerpts do not enter live prompt grounding.
- Use reviewed evidence package only after source relevance and shopper-safe wording review.
- Prefer evidence that supports comparison decisions: form/source, dose context, population/context boundary, and safety caveat.

First evidence candidates:

- creatine primary performance/recovery context
- coq10 formulation/source context
- collagen source/type and dose-context comparison
- probiotic strain/CFU/disclosure context
- ashwagandha extract standardization and safety boundary
- turmeric/curcumin form and absorption-context boundary
- berberine metabolic safety boundary
- green tea extract EGCG/caffeine/safety boundary
- NAC form/safety-sensitive boundary

Exit criteria:

- Every promoted row has reviewed status and source metadata.
- Every safety-sensitive row has a caveat that prevents blanket benefit language.
- `needs_edit` and `rejected` rows remain blocked from live grounding.

## Workstream 4: P3 Copy Polish

Goal: fix low-risk but visible polish issues after stability is green.

Rules:

- Fix deterministic grammar, anchor phrasing, and broad-but-safe awkward lines.
- Do not chase subjective style-only copy until API pass-rate and evidence coverage have their own baseline.
- Keep tests focused on representative failures.

First polish shipped in this wave:

- Product Overview fallback now avoids `a Iron` style lead phrasing by choosing the article from the lead phrase.

Remaining polish candidates:

- awkward `X-led category formula` phrasing where category is too broad but safe
- duplicate formula wording
- low-value but non-dangerous generic fallback lines
- capitalization and article polish for acronyms/forms

Exit criteria:

- No grammar fix introduces a family-anchor regression.
- P3 fixes are batched, tested, and stopped before they distract from API/evidence work.
