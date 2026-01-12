# LNHPD form_raw retrofit

Purpose
- Improve LNHPD `form_raw` extraction without touching scoring logic.
- Target rows where `ingredient_id` is resolved but `form_raw` is missing.

Mapping rules (LNHPD medicinal ingredients)
- source_material: map plant-part hints to tokens like `root`, `seed`, `bark`, `rhizome`, `flower`, `aerial`, `fruit`, `leaf`, `whole`.
- extract_type_desc: add `fresh` or `dry` tokens.
- ratio_numerator + ratio_denominator: add `extract` and ratio token like `5:1`.
- potency_constituent + potency_amount + potency_unit: add constituent tokens and amount token like `20%`.
- dried_herb_equivalent: add `dhe` token only.
- Guardrails: if source_material looks like solvent/animal/homeopathy, do not emit form_raw.
- Filter out single-letter and numeric-only tokens.

Runbook
1) Build rebackfill runlist (LNHPD only)
```
cd backend
npx tsx scripts/build-formraw-rebackfill-lnhpd.ts --limit 5000 --output output/formraw/formraw_rebackfill_lnhpd.jsonl
```

2) Targeted rebackfill (force)
```
npx tsx scripts/backfill-v4-scores.ts --failures-input output/formraw/formraw_rebackfill_lnhpd.jsonl --failures-force
```

3) Fixed-sample compare (LNHPD)
```
npx tsx scripts/diagnose-form-coverage-compare.ts \
  --source lnhpd \
  --source-ids-file output/diagnostics/lnhpd_sample_ids.json \
  --output output/diagnostics/lnhpd_after_formraw.json \
  --compare output/diagnostics/lnhpd_before.json \
  --compare-output output/diagnostics/lnhpd_compare_formraw.json
```

Expected gates
- formRawMissingAmongResolved should drop (target < 0.85 initial gate).
- zeroCoverageRatio should not worsen.

Notes
- This change only improves `form_raw` extraction and requires targeted rebackfill.
- No dataset version bump is required for this step.
