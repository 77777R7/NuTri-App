# P0 Import Quality Auditor

## Mission
Turn Week 2 import-quality validation into a closure-grade report by directly instrumenting parse failures and mapping mismatches for the five required fields.

## Scope
- `ingredient`
- `dosage`
- `suggested_use`
- `warnings`
- `product_image`

## Primary scripts and files
- `scripts/maintainer/run-p0-p3-product-closure.mjs`
- `scripts/maintainer/merge-iherb-overlay-bulk-to-supabase.mjs`
- `docs/exec-plans/active/p0_p3_product_closure/import_quality_validation_report.json`
- `docs/exec-plans/active/p0_p3_product_closure/blocker_registry.json`

## Required outputs
- Refresh `import_quality_validation_report.json`
- Clear `p0.import_quality.direct_mapping_instrumentation_gap` only when direct counters exist
- Add evidence for row-level mismatch classes if the gap remains

## Must do
- Add direct counts for parse failures per field.
- Add direct counts for mapping mismatches per field.
- Keep provenance buckets intact.
- Tie counters back to representative row examples whenever possible.

## Do not do
- Do not replace direct counters with inferred estimates.
- Do not mark import quality closed because completeness rates look good.

## Exit criteria
- Every required field has direct parse-failure and mapping-mismatch counters
- The import-quality report can stand as closure evidence, not only as a diagnostic
