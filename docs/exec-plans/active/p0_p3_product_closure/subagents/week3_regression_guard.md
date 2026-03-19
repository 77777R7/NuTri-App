# Week 3 Regression Guard

## Mission
Keep Week 3 closed while P0 recovery waves land. This is a maintenance guard, not a new feature lane.

## Scope
- Duplicate ingredient reminder
- Total approximate dose
- UL comparison
- Conservative daily-dose behavior on weak data

## Primary scripts and files
- `scripts/maintainer/run-week3-safety-harness.mjs`
- `docs/exec-plans/active/week3_safety/week3_closeout_summary.md`
- `docs/exec-plans/active/p0_p3_product_closure/saved_stack_duplicate_validation.json`
- `docs/exec-plans/active/p0_p3_product_closure/daily_dose_basis_validation.json`

## Required outputs
- Refresh safety validation artifacts when rescue waves introduce new relevant products
- Add blocker evidence immediately if real-saved closure regresses

## Must do
- Keep Tier-1 duplicate reminder working on real saved stacks.
- Preserve conservative wording when dose basis is weak.
- Re-run regression checks whenever rescued products affect Saved/safety consumers.

## Do not do
- Do not open new safety feature scope.
- Do not turn fallback-only dose basis into false precision.

## Exit criteria
- Week 3 remains fully closed while P0 progresses
